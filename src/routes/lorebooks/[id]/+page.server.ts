import type { PageServerLoad } from './$types.js';
import { db } from '$lib/db/index.js';
import { lorebooks, lorebookEntries } from '$lib/db/schema.js';
import { eq, and, asc } from 'drizzle-orm';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user) throw error(401, 'Authentication required');
	const id = Number(params.id);
	const lorebook = db.select().from(lorebooks)
		.where(and(eq(lorebooks.id, id), eq(lorebooks.userId, locals.user.id)))
		.get();
	if (!lorebook) throw error(404, 'Lorebook not found');

	const entries = db
		.select()
		.from(lorebookEntries)
		.where(eq(lorebookEntries.lorebookId, id))
		.orderBy(asc(lorebookEntries.insertionOrder))
		.all();

	return { lorebook, entries };
};
