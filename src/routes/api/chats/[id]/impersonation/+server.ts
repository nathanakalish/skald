import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { chats } from '$lib/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth.js';
import { broadcast } from '$lib/server/realtime.js';

/**
 * Clear the persisted impersonation draft. Called when the user accepts
 * (sends), edits past it, or explicitly discards. The realtime broadcast
 * keeps other devices' textareas in sync.
 */
export const DELETE: RequestHandler = async (event) => {
	const user = requireUser(event);
	const chatId = Number(event.params.id);
	if (!Number.isFinite(chatId)) return json({ error: 'Bad chat id' }, { status: 400 });

	const chat = db.select().from(chats).where(and(eq(chats.id, chatId), eq(chats.userId, user.id))).get();
	if (!chat) return json({ error: 'Chat not found' }, { status: 404 });

	db.update(chats)
		.set({ impersonationDraft: null, impersonationReasoning: null, impersonationStatus: null, impersonationGeneratedAt: null })
		.where(eq(chats.id, chatId))
		.run();

	broadcast(user.id, {
		type: 'chat:impersonation', chatId,
		data: { status: null, draft: null, reasoning: null, generatedAt: null }
	});

	return json({ ok: true });
};
