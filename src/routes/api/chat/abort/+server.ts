import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { chats } from '$lib/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { abortChat } from '$lib/server/messageQueue.js';
import { requireUser } from '$lib/server/auth.js';

export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const { chatId } = await event.request.json();
	if (!chatId) return json({ error: 'chatId required' }, { status: 400 });

	// Verify ownership
	const chat = db.select().from(chats).where(and(eq(chats.id, chatId), eq(chats.userId, user.id))).get();
	if (!chat) return json({ error: 'Chat not found' }, { status: 404 });

	const aborted = abortChat(chatId);
	return json({ ok: true, aborted });
};
