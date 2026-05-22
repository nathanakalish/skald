import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { chats } from '$lib/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { abortChat } from '$lib/server/messageQueue.js';
import { requireUser } from '$lib/server/auth.js';
import { ApiError } from '$lib/server/apiError.js';

export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const { chatId } = await event.request.json();
	if (!chatId) return ApiError.badRequest('chatId required');

	// Verify ownership
	const chat = db.select().from(chats).where(and(eq(chats.id, chatId), eq(chats.userId, user.id))).get();
	if (!chat) return ApiError.notFound('Chat not found');

	const aborted = abortChat(chatId);
	event.locals.logger?.info('chat: abort requested', { chatId, aborted });
	return json({ ok: true, aborted });
};
