import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { chats } from '$lib/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth.js';
import { eventBus } from '$lib/server/eventBus.js';

/**
 * Toggle (or set) the mute state for a chat.
 * Body: { muted?: boolean } — if omitted, toggles current value.
 */
export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const chatId = Number(event.params.id);
	if (!chatId) return json({ error: 'Invalid chat ID' }, { status: 400 });

	const existing = db.select().from(chats)
		.where(and(eq(chats.id, chatId), eq(chats.userId, user.id)))
		.get();
	if (!existing) return json({ error: 'Not found' }, { status: 404 });

	let body: { muted?: boolean } = {};
	try { body = await event.request.json(); } catch { /* empty body → toggle */ }
	const next = typeof body.muted === 'boolean' ? body.muted : !existing.muted;

	db.update(chats).set({ muted: next })
		.where(and(eq(chats.id, chatId), eq(chats.userId, user.id)))
		.run();

	eventBus.emit({ type: 'chat-muted', chatId, userId: user.id, data: { muted: next } });

	return json({ ok: true, muted: next });
};
