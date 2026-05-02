import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { lorebooks, lorebookEntries } from '$lib/db/schema.js';
import { eq } from 'drizzle-orm';
import { requireOwned } from '$lib/server/ownership.js';
import { broadcast } from '$lib/server/realtime.js';

export const GET: RequestHandler = async (event) => {
	const { row: lorebook } = requireOwned(event, lorebooks, event.params.id);
	const entries = db
		.select()
		.from(lorebookEntries)
		.where(eq(lorebookEntries.lorebookId, lorebook.id))
		.all();
	return json({ ...lorebook, entries });
};

export const PUT: RequestHandler = async (event) => {
	const { user, row: existing } = requireOwned(event, lorebooks, event.params.id);
	const id = existing.id;
	const body = await event.request.json();

	db.update(lorebooks)
		.set({ name: body.name, description: body.description, enabled: body.enabled })
		.where(eq(lorebooks.id, id))
		.run();

	const updated = db.select().from(lorebooks).where(eq(lorebooks.id, id)).get();
	if (updated) broadcast(user.id, { type: 'lorebook:updated', id, lorebook: updated as any });
	return json({ ok: true, lorebook: updated });
};

export const DELETE: RequestHandler = async (event) => {
	const { user, row: existing } = requireOwned(event, lorebooks, event.params.id);
	db.delete(lorebooks).where(eq(lorebooks.id, existing.id)).run();
	broadcast(user.id, { type: 'lorebook:deleted', id: existing.id });
	return json({ ok: true });
};
