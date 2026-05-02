import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { lorebooks, lorebookEntries, chatLorebooks } from '$lib/db/schema.js';
import { eq, and, inArray } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth.js';

export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);

	// Find all lorebooks for this user
	const allLorebooks = db.select().from(lorebooks).where(eq(lorebooks.userId, user.id)).all();

	// Group by name + description to find duplicates
	const groups = new Map<string, typeof allLorebooks>();
	for (const lb of allLorebooks) {
		const key = `${lb.name}|||${lb.description ?? ''}`;
		const group = groups.get(key);
		if (group) {
			group.push(lb);
		} else {
			groups.set(key, [lb]);
		}
	}

	let mergedCount = 0;
	let deletedCount = 0;

	for (const [, group] of groups) {
		if (group.length <= 1) continue;

		// Keep the oldest (lowest ID)
		group.sort((a, b) => a.id - b.id);
		const keep = group[0];
		const dupes = group.slice(1);
		const dupeIds = dupes.map(d => d.id);

		// Move entries from duplicates to the kept lorebook (avoid duplicate entries)
		const keptEntries = db.select().from(lorebookEntries).where(eq(lorebookEntries.lorebookId, keep.id)).all();
		const keptKeywords = new Set(keptEntries.map(e => e.keywords));

		for (const dupeId of dupeIds) {
			const dupeEntries = db.select().from(lorebookEntries).where(eq(lorebookEntries.lorebookId, dupeId)).all();
			for (const entry of dupeEntries) {
				if (!keptKeywords.has(entry.keywords)) {
					// Move unique entry to kept lorebook
					db.update(lorebookEntries)
						.set({ lorebookId: keep.id })
						.where(eq(lorebookEntries.id, entry.id))
						.run();
					keptKeywords.add(entry.keywords);
				}
				// Duplicate entries will be cascade-deleted with their lorebook
			}
		}

		// Update chatLorebooks references
		for (const dupeId of dupeIds) {
			db.update(chatLorebooks)
				.set({ lorebookId: keep.id })
				.where(eq(chatLorebooks.lorebookId, dupeId))
				.run();
		}

		// Delete duplicate lorebooks (entries cascade-delete)
		for (const dupeId of dupeIds) {
			db.delete(lorebooks).where(eq(lorebooks.id, dupeId)).run();
		}

		mergedCount++;
		deletedCount += dupeIds.length;
	}

	return json({ mergedCount, deletedCount });
};
