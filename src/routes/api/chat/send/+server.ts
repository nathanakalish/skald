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
	const { chatId, content: rawContent, regenerate, greeting, parentId: clientParentId } = await event.request.json();

	if (!chatId) return json({ error: 'chatId required' }, { status: 400 });

	// Verify ownership.
	const chat = db.select().from(chats).where(and(eq(chats.id, chatId), eq(chats.userId, user.id))).get();
	if (!chat) return json({ error: 'Chat not found' }, { status: 404 });

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

		// Atomic: insert the message and advance the leaf in one go so a partial
		// failure can't leave a dangling leaf pointer.
		userMsgId = db.transaction((tx) => {
			const result = tx.insert(messages)
				.values({ chatId, role: 'user', content, swipes: JSON.stringify([content]), swipeIndex: 0, parentId: userParentId })
				.run();
			const id = Number(result.lastInsertRowid);
			tx.update(chats).set({ activeLeafId: id, updatedAt: sql`datetime('now')` }).where(eq(chats.id, chatId)).run();
			return id;
		});
		bumpChatTail(chatId, content, 'user');
		// Cross-device sync: tell other tabs/devices about the new user message so
		// an open ChatView appends it without waiting for the assistant streaming
		// pass to finish.
		if (userMsgId != null) {
			const row = db.select().from(messages).where(eq(messages.id, userMsgId)).get();
			if (row) broadcast(user.id, { type: 'message:created', chatId, message: row as any });
		}
	}

	// Hand it off to the background queue.
	try {
		const jobId = enqueueJob({ chatId, regenerate: !!regenerate, greeting: !!greeting });
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
