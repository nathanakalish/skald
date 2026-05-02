import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { providers } from '$lib/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth.js';
import { broadcast } from '$lib/server/realtime.js';

function toLight(p: typeof providers.$inferSelect) {
	const { apiKey, ...rest } = p;
	return { ...rest, hasKey: !!apiKey };
}

export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const { order } = await event.request.json();

	if (!Array.isArray(order)) {
		return json({ error: 'order must be an array of provider IDs' }, { status: 400 });
	}

	for (let i = 0; i < order.length; i++) {
		db.update(providers).set({ sortOrder: i }).where(and(eq(providers.id, order[i]), eq(providers.userId, user.id))).run();
	}

	const list = db.select().from(providers).where(eq(providers.userId, user.id)).orderBy(providers.sortOrder).all();
	broadcast(user.id, { type: 'provider:replaced', providers: list.map(toLight) as any });
	return json({ ok: true });
};
