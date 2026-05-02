import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { chats, messages } from '$lib/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth.js';

// PATCH: Set activeLeafId directly (used for "continue from here" to start a branch)
export const PATCH: RequestHandler = async (event) => {
	const user = requireUser(event);
	const chatId = Number(event.params.id);
	const { activeLeafId } = await event.request.json();

	if (typeof activeLeafId !== 'number') {
		return json({ error: 'activeLeafId must be a number' }, { status: 400 });
	}

	const chat = db.select().from(chats).where(and(eq(chats.id, chatId), eq(chats.userId, user.id))).get();
	if (!chat) return json({ error: 'Chat not found' }, { status: 404 });

	// IDOR guard: the message must actually belong to this chat. Without this
	// check, an authenticated user could repoint their chat's leaf at any
	// other user's message id.
	const leaf = db.select({ id: messages.id }).from(messages)
		.where(and(eq(messages.id, activeLeafId), eq(messages.chatId, chatId))).get();
	if (!leaf) return json({ error: 'Message does not belong to this chat' }, { status: 400 });

	db.update(chats).set({ activeLeafId }).where(eq(chats.id, chatId)).run();

	return json({ success: true, activeLeafId });
};
