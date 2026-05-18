import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { characters, chats } from '$lib/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth.js';
import { broadcast } from '$lib/server/realtime.js';

// Propagate a character edit to existing chats. Most character fields
// (description, personality, system prompt, …) are read live by the
// chat-context builder, so they "just work" — but the chat title and the
// sidebar-tail freshness are snapshotted at chat creation, so we fix
// those here. Existing greetings live in the messages table and are
// intentionally NOT touched (they may be the start of an in-progress
// story the user doesn't want rewritten).
export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const id = Number(event.params.id);
	const { oldName } = (await event.request.json().catch(() => ({}))) as { oldName?: string };

	const character = db
		.select()
		.from(characters)
		.where(and(eq(characters.id, id), eq(characters.userId, user.id)))
		.get();
	if (!character) return json({ error: 'Not found' }, { status: 404 });

	const affected = db
		.select()
		.from(chats)
		.where(and(eq(chats.userId, user.id), eq(chats.characterId, id)))
		.all();

	const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
	let renamed = 0;
	for (const chat of affected) {
		const patch: Record<string, unknown> = { updatedAt: now };
		// Only rename titles that still match the auto-generated default
		// for the previous name. Anything the user customised is left
		// alone.
		if (oldName && chat.title === `Chat with ${oldName}` && oldName !== character.name) {
			patch.title = `Chat with ${character.name}`;
			renamed++;
		}
		db.update(chats).set(patch).where(eq(chats.id, chat.id)).run();
		broadcast(user.id, { type: 'chat:patched', id: chat.id, patch });
	}

	event.locals.logger?.info('characters: sync-chats', {
		characterId: id, affected: affected.length, renamed,
	});

	return json({ count: affected.length, renamed });
};
