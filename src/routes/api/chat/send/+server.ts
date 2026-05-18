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
import { lengthError, MAX_MESSAGE_CHARS } from '$lib/utils/validate.js';

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

	// Cap obviously oversized payloads early — these strings are about to hit
	// SQLite, the regex pipeline, and the LLM context budget calculator.
	const lenErr =
		lengthError('content', rawContent, MAX_MESSAGE_CHARS) ||
		lengthError('guidance', rawGuidance, MAX_MESSAGE_CHARS);
	if (lenErr) return json(lenErr, { status: 413 });
	if (Array.isArray(rawImpersonationSwipes)) {
		for (const s of rawImpersonationSwipes) {
			const e =
				lengthError('impersonation draft', s?.draft, MAX_MESSAGE_CHARS) ||
				lengthError('impersonation reasoning', s?.reasoning, MAX_MESSAGE_CHARS) ||
				lengthError('impersonation guidance', s?.guidance, MAX_MESSAGE_CHARS);
			if (e) return json(e, { status: 413 });
		}
	}

	// Verify ownership.
	const chat = db.select().from(chats).where(and(eq(chats.id, chatId), eq(chats.userId, user.id))).get();
	if (!chat) return json({ error: 'Chat not found' }, { status: 404 });
	if (chat.deletedAt != null) return json({ error: 'Chat has been deleted' }, { status: 410 });

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
	let impIdx = 0;
	if (impSwipes.length > 0 && Number.isFinite(rawImpersonationIdx)) {
		impIdx = Math.max(0, Math.min(impSwipes.length - 1, Number(rawImpersonationIdx)));
	}

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
		// The selected swipe wins for `content`.
		let messageSwipes: string[] = [content];
		let messageReasoning: string[] = [''];
		let messageSwipeIndex = 0;
		// Reply guidance steers the assistant reply; it lives on the
		// assistant message that gets produced (set by chatProcessor at
		// insert time), not on the user message. Only impersonation
		// guidance from the active swipe is preserved on the user row.
		const messageGuidance: string | null = null;
		let messageImpersonationGuidance: string | null = null;
		if (impSwipes.length > 0) {
			messageSwipes = impSwipes.map(s => s.draft ?? '');
			messageReasoning = impSwipes.map(s => s.reasoning ?? '');
			messageSwipeIndex = impIdx;
			// Selected swipe's text is what we just sent; trust it.
			messageSwipes[impIdx] = content;
			// Preserve the active swipe's impersonation guidance for later
			// inspection — it has nothing to do with the reply prompt.
			messageImpersonationGuidance = impSwipes[impIdx]?.guidance ?? null;
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
					impersonationGuidance: messageImpersonationGuidance,
					parentId: userParentId,
				})
				.run();
			const id = Number(result.lastInsertRowid);
			tx.update(chats).set({ activeLeafId: id, updatedAt: sql`datetime('now')` }).where(eq(chats.id, chatId)).run();
			tx.update(chats).set({
				impersonationSwipes: null,
				impersonationSwipeIndex: 0,
				impersonationStatus: null,
				// Clear cross-device draft mirrors too — the message is now
				// in flight, so any composing state is by definition done.
				pendingDraft: null,
				pendingDraftAt: Date.now(),
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
			status: null,
			swipes: [],
			swipeIndex: 0
		});
		// Mirror the draft clear into the realtime stream so other devices'
		// chat-bar textareas drop the now-stale composing state.
		broadcast(user.id, {
			type: 'chat:patched', id: chatId,
			patch: { pendingDraft: null, pendingDraftAt: Date.now() }
		});
	}

	// Hand it off to the background queue.
	try {
		// On regenerate, reply guidance lives on the assistant message itself
		// (the active leaf). Look it up here so guidance is always explicitly
		// linked to the message it belongs to, never inferred ambiently.
		let jobGuidance = guidance;
		if (regenerate && !jobGuidance) {
			const leafId = chat.activeLeafId;
			if (leafId) {
				const leaf = db.select({ role: messages.role, guidance: messages.guidance })
					.from(messages).where(eq(messages.id, leafId)).get();
				if (leaf?.role === 'assistant' && leaf.guidance && leaf.guidance.trim()) {
					jobGuidance = leaf.guidance;
				}
			}
		}
		const jobId = enqueueJob({
			chatId,
			regenerate: !!regenerate,
			greeting: !!greeting,
			guidance: jobGuidance,
		});
		// enqueueJob returns -1 when the chat is already processing (running
		// or queued). Surface that as a 409 instead of pretending we accepted
		// the request — otherwise the client thinks a fresh stream is coming
		// and waits forever for an event that never fires.
		if (jobId === -1) {
			if (userMsgId != null) {
				try {
					db.delete(messages).where(eq(messages.id, userMsgId)).run();
					recomputeChatTail(chatId);
					broadcast(user.id, { type: 'message:deleted', chatId, ids: [userMsgId] });
				} catch { /* best-effort cleanup */ }
			}
			event.locals.logger?.warn('chat: send rejected (already processing)', { chatId });
			return json(
				{ error: 'Chat is already processing a message — wait for it to finish or abort it first.' },
				{ status: 409 }
			);
		}
		event.locals.logger?.info('chat: send accepted', { chatId, jobId, userMsgId, regenerate: !!regenerate, greeting: !!greeting, hasGuidance: !!jobGuidance, impersonationSwipes: impSwipes.length });
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
		event.locals.logger?.warn('chat: send enqueue failed', { chatId, err: err instanceof Error ? err.message : String(err) });
		return json({ error: err instanceof Error ? err.message : 'Failed to enqueue job' }, { status: 500 });
	}
};
