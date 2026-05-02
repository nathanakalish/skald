import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { lorebookEntries, lorebooks } from '$lib/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth.js';

export const PUT: RequestHandler = async (event) => {
	const user = requireUser(event);
	const lorebookId = Number(event.params.id);
	const entryId = Number(event.params.entryId);
	const body = await event.request.json();

	// Verify lorebook ownership
	const lorebook = db.select().from(lorebooks).where(and(eq(lorebooks.id, lorebookId), eq(lorebooks.userId, user.id))).get();
	if (!lorebook) return json({ error: 'Not found' }, { status: 404 });

	db.update(lorebookEntries)
		.set({
			keywords: body.keywords,
			content: body.content,
			insertionOrder: body.insertionOrder,
			enabled: body.enabled,
			caseSensitive: body.caseSensitive,
			constant: body.constant
		})
		.where(and(eq(lorebookEntries.id, entryId), eq(lorebookEntries.lorebookId, lorebookId)))
		.run();

	return json({ ok: true });
};

export const DELETE: RequestHandler = async (event) => {
	const user = requireUser(event);
	const lorebookId = Number(event.params.id);
	const entryId = Number(event.params.entryId);

	// Verify lorebook ownership
	const lorebook = db.select().from(lorebooks).where(and(eq(lorebooks.id, lorebookId), eq(lorebooks.userId, user.id))).get();
	if (!lorebook) return json({ error: 'Not found' }, { status: 404 });

	db.delete(lorebookEntries).where(and(eq(lorebookEntries.id, entryId), eq(lorebookEntries.lorebookId, lorebookId))).run();
	return json({ ok: true });
};
