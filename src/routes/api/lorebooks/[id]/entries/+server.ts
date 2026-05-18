import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { lorebookEntries, lorebooks } from '$lib/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth.js';

export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const lorebookId = Number(event.params.id);
	const body = await event.request.json();

	// Verify lorebook ownership
	const lorebook = db.select().from(lorebooks).where(and(eq(lorebooks.id, lorebookId), eq(lorebooks.userId, user.id))).get();
	if (!lorebook) return json({ error: 'Not found' }, { status: 404 });

	// CRUD-L3: coerce to a finite number so NaN/strings from a misbehaving
	// client don't end up stored verbatim and breaking the ordering pass.
	const rawOrder = Number(body.insertionOrder);
	const insertionOrder = Number.isFinite(rawOrder) ? rawOrder : 100;

	const entry = db
		.insert(lorebookEntries)
		.values({
			lorebookId,
			keywords: body.keywords,
			content: body.content,
			insertionOrder,
			enabled: body.enabled ?? true,
			caseSensitive: body.caseSensitive ?? false,
			constant: body.constant ?? false
		})
		.returning()
		.get();

	event.locals.logger?.debug('lorebookEntry: created', {
		lorebookId, entryId: entry.id, keywords: entry.keywords, constant: entry.constant,
	});

	return json(entry);
};
