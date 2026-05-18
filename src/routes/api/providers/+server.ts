import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { providers } from '$lib/db/schema.js';
import { count, sql, eq } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth.js';
import { broadcast } from '$lib/server/realtime.js';

// Strip the api key from a provider row and replace with a `hasKey` flag —
// matches the shape layout.server.ts ships and what the client store holds.
function toLight(p: typeof providers.$inferSelect) {
	const { apiKey, ...rest } = p;
	return { ...rest, hasKey: !!apiKey };
}

export const GET: RequestHandler = async (event) => {
	const user = requireUser(event);
	const list = db.select().from(providers).where(eq(providers.userId, user.id)).orderBy(providers.sortOrder).all();
	return json({ providers: list.map(toLight) });
};

export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const body = await event.request.json();

	// Validate endpoint URL — only allow http/https protocols
	if (body.endpoint) {
		try {
			const url = new URL(body.endpoint);
			if (url.protocol !== 'http:' && url.protocol !== 'https:') {
				return json({ error: 'Endpoint must use http or https protocol' }, { status: 400 });
			}
		} catch {
			return json({ error: 'Invalid endpoint URL' }, { status: 400 });
		}
	}

	const [{ total }] = db.select({ total: count() }).from(providers).where(eq(providers.userId, user.id)).all();
	const isFirst = total === 0;

	// Set sort order to end of list
	const maxOrder = db.select({ max: sql<number>`COALESCE(MAX(sort_order), -1)` }).from(providers).where(eq(providers.userId, user.id)).get();
	const nextOrder = (maxOrder?.max ?? -1) + 1;

	const provider = db
		.insert(providers)
		.values({
			userId: user.id,
			name: body.name,
			type: body.type,
			endpoint: body.endpoint,
			apiKey: body.apiKey || '',
			defaultModel: body.defaultModel || '',
			enabled: isFirst,
			sortOrder: nextOrder
		})
		.returning()
		.get();

	const light = toLight(provider);
	broadcast(user.id, { type: 'provider:created', provider: light as any });
	event.locals.logger.info('providers: created', { providerId: provider.id, type: provider.type });
	return json(light);
};
