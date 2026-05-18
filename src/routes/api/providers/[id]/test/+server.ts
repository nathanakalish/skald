import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { providers } from '$lib/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { createProvider, type ProviderType } from '$lib/providers/index.js';
import { requireUser } from '$lib/server/auth.js';

export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const id = Number(event.params.id);
	const provider = db.select().from(providers).where(and(eq(providers.id, id), eq(providers.userId, user.id))).get();

	if (!provider) {
		return json({ ok: false, error: 'Provider not found' }, { status: 404 });
	}

	const t0 = Date.now();
	try {
		const llm = createProvider(provider.type as ProviderType, {
			endpoint: provider.endpoint,
			apiKey: provider.apiKey || '',
			model: provider.defaultModel || ''
		});

		const result = await llm.testConnection();
		const durationMs = Date.now() - t0;
		if (result.ok) {
			event.locals.logger?.info('providers: test ok', { providerId: id, type: provider.type, durationMs });
		} else {
			event.locals.logger?.warn('providers: test failed', { providerId: id, type: provider.type, durationMs, error: result.error });
		}
		return json(result);
	} catch (err) {
		const durationMs = Date.now() - t0;
		const msg = err instanceof Error ? err.message : 'Connection test failed';
		event.locals.logger?.warn('providers: test threw', { providerId: id, type: provider.type, durationMs, err: msg });
		return json({ ok: false, error: msg });
	}
};
