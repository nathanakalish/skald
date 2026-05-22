import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { chats } from '$lib/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth.js';
import { eventBus } from '$lib/server/eventBus.js';
import { ApiError } from '$lib/server/apiError.js';

/**
 * Mark a chat as read (reset unread count to 0).
 */
export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const chatId = Number(event.params.id);
	if (!chatId) return ApiError.badRequest('Invalid chat ID');

	db.update(chats).set({ unread: 0 }).where(and(eq(chats.id, chatId), eq(chats.userId, user.id))).run();
	eventBus.emit({ type: 'unread', chatId, userId: user.id, data: { count: 0 } });

	event.locals.logger?.debug('chats: marked read', { chatId });

	return json({ ok: true });
};
