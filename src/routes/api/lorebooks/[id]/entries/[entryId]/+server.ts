import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { lorebookEntries, lorebooks } from '$lib/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth.js';
import { validateLengths } from '$lib/server/fieldLimits.js';
import { ApiError } from '$lib/server/apiError.js';

const ENTRY_FIELD_LIMITS = {
	keywords: 'lorebookEntryKeys',
	content: 'lorebookEntryContent',
} as const;

export const PUT: RequestHandler = async (event) => {
	const user = requireUser(event);
	const lorebookId = Number(event.params.id);
	const entryId = Number(event.params.entryId);
	const body = await event.request.json();

	// Verify lorebook ownership
	const lorebook = db.select().from(lorebooks).where(and(eq(lorebooks.id, lorebookId), eq(lorebooks.userId, user.id))).get();
	if (!lorebook) return ApiError.notFound('Not found');

	const tooLong = validateLengths(body, ENTRY_FIELD_LIMITS);
	if (tooLong) return tooLong;

	// CRUD-L3: coerce to a finite number (see entries/+server.ts).
	const rawOrder = Number(body.insertionOrder);
	const insertionOrder = Number.isFinite(rawOrder) ? rawOrder : 100;

	db.update(lorebookEntries)
		.set({
			keywords: body.keywords,
			content: body.content,
			insertionOrder,
			enabled: body.enabled,
			caseSensitive: body.caseSensitive,
			constant: body.constant
		})
		.where(and(eq(lorebookEntries.id, entryId), eq(lorebookEntries.lorebookId, lorebookId)))
		.run();

	event.locals.logger?.debug('lorebookEntry: updated', { lorebookId, entryId, keys: Object.keys(body) });

	return json({ ok: true });
};

export const DELETE: RequestHandler = async (event) => {
	const user = requireUser(event);
	const lorebookId = Number(event.params.id);
	const entryId = Number(event.params.entryId);

	// Verify lorebook ownership
	const lorebook = db.select().from(lorebooks).where(and(eq(lorebooks.id, lorebookId), eq(lorebooks.userId, user.id))).get();
	if (!lorebook) return ApiError.notFound('Not found');

	db.delete(lorebookEntries).where(and(eq(lorebookEntries.id, entryId), eq(lorebookEntries.lorebookId, lorebookId))).run();
	event.locals.logger?.debug('lorebookEntry: deleted', { lorebookId, entryId });
	return json({ ok: true });
};
