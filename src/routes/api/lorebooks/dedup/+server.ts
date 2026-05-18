import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { lorebooks, lorebookEntries, chatLorebooks } from '$lib/db/schema.js';
import { eq, and, inArray } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth.js';
import { lorebookEntryFingerprint } from '$lib/services/lorebook.js';

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

		// Whole dedup of one group is atomic: moving entries, relinking chats
		// and deleting the dupes have to either all land or none. A crash
		// halfway through leaves chat_lorebooks pointing at FK-violated rows.
		db.transaction(() => {
			const keptEntries = db.select().from(lorebookEntries).where(eq(lorebookEntries.lorebookId, keep.id)).all();
			const keptFingerprints = new Set(keptEntries.map(e => lorebookEntryFingerprint(e.keywords, e.content)));

			for (const dupeId of dupeIds) {
				const dupeEntries = db.select().from(lorebookEntries).where(eq(lorebookEntries.lorebookId, dupeId)).all();
				for (const entry of dupeEntries) {
					const fp = lorebookEntryFingerprint(entry.keywords, entry.content);
					if (!keptFingerprints.has(fp)) {
						db.update(lorebookEntries)
							.set({ lorebookId: keep.id })
							.where(eq(lorebookEntries.id, entry.id))
							.run();
						keptFingerprints.add(fp);
					}
					// Duplicate entries will be cascade-deleted with their lorebook
				}
			}

			for (const dupeId of dupeIds) {
				db.update(chatLorebooks)
					.set({ lorebookId: keep.id })
					.where(eq(chatLorebooks.lorebookId, dupeId))
					.run();
			}

			for (const dupeId of dupeIds) {
				db.delete(lorebooks).where(eq(lorebooks.id, dupeId)).run();
			}
		});

		mergedCount++;
		deletedCount += dupeIds.length;
	}

	event.locals.logger?.info('lorebooks: deduped', { mergedCount, deletedCount });

	return json({ mergedCount, deletedCount });
};
