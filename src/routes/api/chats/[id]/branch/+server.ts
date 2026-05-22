import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { chats, messages } from '$lib/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth.js';
import { loadActivePathPage, loadSiblingsScoped } from '$lib/server/chatTree.js';
import { ApiError } from '$lib/server/apiError.js';

// PATCH: Set activeLeafId directly (used for "continue from here" to start a branch)
export const PATCH: RequestHandler = async (event) => {
	const user = requireUser(event);
	const chatId = Number(event.params.id);
	const body = await event.request.json();
	const { activeLeafId } = body;
	const limit = typeof body.limit === 'number' && body.limit > 0 ? body.limit : 50;

	if (typeof activeLeafId !== 'number') {
		return ApiError.badRequest('activeLeafId must be a number');
	}

	const chat = db.select().from(chats).where(and(eq(chats.id, chatId), eq(chats.userId, user.id))).get();
	if (!chat) return ApiError.notFound('Chat not found');

	// IDOR guard: the message must actually belong to this chat. Without this
	// check, an authenticated user could repoint their chat's leaf at any
	// other user's message id.
	const leaf = db.select({ id: messages.id }).from(messages)
		.where(and(eq(messages.id, activeLeafId), eq(messages.chatId, chatId))).get();
	if (!leaf) return ApiError.badRequest('Message does not belong to this chat');

	db.update(chats).set({ activeLeafId }).where(eq(chats.id, chatId)).run();

	event.locals.logger?.debug('chats: branch set', { chatId, activeLeafId });

	// Return the new message window inline so the client can render immediately
	// without a second GET to /api/chats/[id]/data.
	const page = loadActivePathPage(activeLeafId, limit, 0);
	const siblingsByParent = loadSiblingsScoped(chatId, page.messages);

	const messageSiblings: Record<number, { index: number; total: number }> = {};
	for (const m of page.messages) {
		const siblings = siblingsByParent.get(m.parentId ?? null) ?? [m.id];
		messageSiblings[m.id] = { index: siblings.indexOf(m.id), total: siblings.length };
	}

	const lastMsg = page.messages[page.messages.length - 1];
	const hiddenBranchCount = lastMsg ? (siblingsByParent.get(lastMsg.id)?.length ?? 0) : 0;

	return json({
		success: true,
		activeLeafId,
		messages: page.messages,
		messageSiblings,
		hiddenBranchCount,
		totalMessages: page.total,
	});
};
