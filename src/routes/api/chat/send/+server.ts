import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { messages, chats } from '$lib/db/schema.js';
import { eq, and, sql } from 'drizzle-orm';
import { cacheInlineImages } from '$lib/services/imageCache.js';
import { enqueueJob } from '$lib/server/messageQueue.js';
import { requireUser } from '$lib/server/auth.js';
import { applyRegexScripts } from '$lib/services/regex.js';
import { bumpChatTail, recomputeChatTail } from '$lib/db/chatTail.js';
import { broadcast } from '$lib/server/realtime.js';

/**
 * Fire-and-forget: save the user message, enqueue the LLM job, return immediately.
 */
export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const {
		chatId,
		content: rawContent,
		regenerate,
		greeting,
		parentId: clientParentId,
		guidance: rawGuidance,
		impersonationSwipes: rawImpersonationSwipes,
		impersonationSwipeIndex: rawImpersonationIdx,
	} = await event.request.json();

	if (!chatId) return json({ error: 'chatId required' }, { status: 400 });

	// Verify ownership.
	const chat = db.select().from(chats).where(and(eq(chats.id, chatId), eq(chats.userId, user.id))).get();
	if (!chat) return json({ error: 'Chat not found' }, { status: 404 });

	const guidance = typeof rawGuidance === 'string' && rawGuidance.trim() ? rawGuidance : undefined;

	// Normalize impersonation-swipe payload from the client. The user may have
	// produced multiple impersonation drafts; each becomes a swipe on the
	// outgoing user message so they can flip between them later.
	type ImpSwipeIn = { draft?: string; reasoning?: string; guidance?: string };
	let impSwipes: ImpSwipeIn[] = [];
	if (Array.isArray(rawImpersonationSwipes)) {
		impSwipes = rawImpersonationSwipes
			.filter((e: any) => e && typeof e === 'object')
			.map((e: any) => ({
				draft: typeof e.draft === 'string' ? e.draft : '',
				reasoning: typeof e.reasoning === 'string' ? e.reasoning : '',
				guidance: typeof e.guidance === 'string' && e.guidance.trim() ? e.guidance : undefined,
			}));
	}
	let impIdx = Number.isFinite(rawImpersonationIdx) ? Math.max(0, Math.min(impSwipes.length - 1, Number(rawImpersonationIdx))) : 0;

	// Save the user message (skip on regenerate / greeting).
	let userMsgId: number | null = null;
	if (!regenerate && !greeting) {
		let content = await cacheInlineImages(rawContent);
		content = applyRegexScripts(content, user.id, 'user_input', chat.characterId);

		// IDOR guard: when the client supplies a parentId, it must point at a
		// message that lives in this chat. Otherwise fall back to the chat's
		// active leaf.
		let userParentId: number | null = chat.activeLeafId ?? null;
		if (clientParentId != null) {
			if (typeof clientParentId !== 'number' || !Number.isFinite(clientParentId)) {
				return json({ error: 'parentId must be a number' }, { status: 400 });
			}
			const parent = db.select({ id: messages.id }).from(messages)
				.where(and(eq(messages.id, clientParentId), eq(messages.chatId, chatId))).get();
			if (!parent) return json({ error: 'parentId does not belong to this chat' }, { status: 400 });
			userParentId = clientParentId;
		}

		// If the client passed impersonation swipes, fold them into the
		// user message so all generated drafts are preserved as swipes.
		// The selected swipe wins for `content` / current `guidance`.
		let messageSwipes: string[] = [content];
		let messageReasoning: string[] = [''];
		let messageSwipeIndex = 0;
		let messageGuidance: string | null = guidance ?? null;
		if (impSwipes.length > 0) {
			messageSwipes = impSwipes.map(s => s.draft ?? '');
			messageReasoning = impSwipes.map(s => s.reasoning ?? '');
			messageSwipeIndex = impIdx;
			// Selected swipe's text is what we just sent; trust it.
			messageSwipes[impIdx] = content;
			// Per-swipe guidance lives at this entry; fall back to the
			// guidance passed alongside the send for the active one.
			messageGuidance = impSwipes[impIdx]?.guidance ?? guidance ?? null;
		}

		// Atomic: insert the message, advance the leaf, and clear the
		// in-flight impersonation swipes in one go so a partial failure
		// can't leave a dangling leaf pointer or stale draft.
		userMsgId = db.transaction((tx) => {
			const result = tx.insert(messages)
				.values({
					chatId,
					role: 'user',
					content,
					swipes: JSON.stringify(messageSwipes),
					swipeIndex: messageSwipeIndex,
					reasoning: JSON.stringify(messageReasoning),
					guidance: messageGuidance,
					parentId: userParentId,
				})
				.run();
			const id = Number(result.lastInsertRowid);
			tx.update(chats).set({ activeLeafId: id, updatedAt: sql`datetime('now')` }).where(eq(chats.id, chatId)).run();
			tx.update(chats).set({
				impersonationSwipes: null,
				impersonationSwipeIndex: 0,
				impersonationStatus: null,
			}).where(eq(chats.id, chatId)).run();
			return id;
		});
		bumpChatTail(chatId, content, 'user');
		// Cross-device sync: tell other tabs/devices about the new user message so
		// an open ChatView appends it without waiting for the assistant streaming
		// pass to finish. Also clear the impersonation swipes everywhere.
		if (userMsgId != null) {
			const row = db.select().from(messages).where(eq(messages.id, userMsgId)).get();
			if (row) broadcast(user.id, { type: 'message:created', chatId, message: row as any });
		}
		broadcast(user.id, {
			type: 'chat:impersonation', chatId,
			data: { status: null, swipes: [], swipeIndex: 0 }
		});
	}

	// Hand it off to the background queue.
	try {
		const jobId = enqueueJob({
			chatId,
			regenerate: !!regenerate,
			greeting: !!greeting,
			guidance,
		});
		return json({ ok: true, jobId, userMsgId });
	} catch (err) {
		// M5: roll back the user message we just inserted; otherwise the chat is
		// left with a leaf that has no scheduled assistant reply.
		if (userMsgId != null) {
			try {
				db.delete(messages).where(eq(messages.id, userMsgId)).run();
				recomputeChatTail(chatId);
				broadcast(user.id, { type: 'message:deleted', chatId, ids: [userMsgId] });
			} catch { /* best-effort cleanup */ }
		}
		return json({ error: err instanceof Error ? err.message : 'Failed to enqueue job' }, { status: 500 });
	}
};
