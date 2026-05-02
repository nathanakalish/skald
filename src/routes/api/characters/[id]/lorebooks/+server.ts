import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { lorebooks, lorebookEntries } from '$lib/db/schema.js';
import { eq, and, inArray } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth.js';

export const GET: RequestHandler = async (event) => {
	const user = requireUser(event);
	const characterId = Number(event.params.id);

	// Get lorebooks linked to this character only
	const books = db.select().from(lorebooks)
		.where(and(
			eq(lorebooks.userId, user.id),
			eq(lorebooks.characterId, characterId)
		))
		.all();

	if (books.length === 0) return json([]);

	// Batch-fetch all entries in a single query instead of N+1
	const bookIds = books.map(b => b.id);
	const allEntries = db.select().from(lorebookEntries)
		.where(inArray(lorebookEntries.lorebookId, bookIds))
		.all();
	const entriesByBook = Map.groupBy(allEntries, e => e.lorebookId);

	const result = books.map(book => ({
		...book,
		entries: entriesByBook.get(book.id) ?? []
	}));

	return json(result);
};
