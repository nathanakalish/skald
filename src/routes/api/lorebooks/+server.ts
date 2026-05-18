import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { lorebooks, lorebookEntries, chatLorebooks } from '$lib/db/schema.js';
import { desc, eq } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth.js';
import { broadcast } from '$lib/server/realtime.js';
import { enforceCreate } from '$lib/server/userLimits.js';
import { lorebookEntryFingerprint } from '$lib/services/lorebook.js';

// One-time lorebook deduplication (runs once per server start per user). Used
// to live in +layout.server.ts; moved here so the slim layout load stays slim.
const dedupedUsers = new Set<number>();
function deduplicateLorebooks(userId: number) {
	if (dedupedUsers.has(userId)) return;
	dedupedUsers.add(userId);

	const allLb = db.select().from(lorebooks).where(eq(lorebooks.userId, userId)).all();
	const groups = new Map<string, typeof allLb>();
	for (const lb of allLb) {
		const key = `${lb.name}|||${lb.description ?? ''}`;
		const group = groups.get(key);
		if (group) group.push(lb);
		else groups.set(key, [lb]);
	}

	for (const [, group] of groups) {
		if (group.length <= 1) continue;
		group.sort((a, b) => a.id - b.id);
		const keep = group[0];
		const dupeIds = group.slice(1).map(d => d.id);

		const keptFingerprints = new Set(
			db.select().from(lorebookEntries).where(eq(lorebookEntries.lorebookId, keep.id)).all()
				.map(e => lorebookEntryFingerprint(e.keywords, e.content))
		);

		for (const dupeId of dupeIds) {
			for (const entry of db.select().from(lorebookEntries).where(eq(lorebookEntries.lorebookId, dupeId)).all()) {
				const fp = lorebookEntryFingerprint(entry.keywords, entry.content);
				if (!keptFingerprints.has(fp)) {
					db.update(lorebookEntries).set({ lorebookId: keep.id }).where(eq(lorebookEntries.id, entry.id)).run();
					keptFingerprints.add(fp);
				}
			}
			db.update(chatLorebooks).set({ lorebookId: keep.id }).where(eq(chatLorebooks.lorebookId, dupeId)).run();
			db.delete(lorebooks).where(eq(lorebooks.id, dupeId)).run();
		}
	}
}

export const GET: RequestHandler = async (event) => {
	const user = requireUser(event);
	deduplicateLorebooks(user.id);
	const list = db
		.select()
		.from(lorebooks)
		.where(eq(lorebooks.userId, user.id))
		.orderBy(desc(lorebooks.createdAt))
		.all();
	return json({ lorebooks: list });
};

export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const body = await event.request.json();

	const limitResponse = enforceCreate('lorebooks', user.id, JSON.stringify(body ?? {}).length);
	if (limitResponse) return limitResponse;

	const lorebook = db
		.insert(lorebooks)
		.values({
			userId: user.id,
			name: body.name,
			description: body.description || ''
		})
		.returning()
		.get();

	broadcast(user.id, { type: 'lorebook:created', lorebook: lorebook as any });
	event.locals.logger.info('lorebooks: created', { lorebookId: lorebook.id });
	return json(lorebook);
};
