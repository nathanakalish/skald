import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { providers } from '$lib/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { createProvider, type ProviderType } from '$lib/providers/index.js';
import { retryOnce } from '$lib/providers/retry.js';
import { requireUser } from '$lib/server/auth.js';
import { ApiError } from '$lib/server/apiError.js';

export const GET: RequestHandler = async (event) => {
	const user = requireUser(event);
	const id = Number(event.params.id);
	const provider = db.select().from(providers).where(and(eq(providers.id, id), eq(providers.userId, user.id))).get();

	if (!provider) {
		return ApiError.notFound('Provider not found');
	}

	try {
		const llm = createProvider(provider.type as ProviderType, {
			endpoint: provider.endpoint,
			apiKey: provider.apiKey || '',
			model: provider.defaultModel || ''
		});

		const models = await retryOnce(() => llm.listModels());
		event.locals.logger?.debug('providers: models listed', { providerId: id, type: provider.type, count: models.length });
		return json({ models });
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Failed to fetch models';
		event.locals.logger?.warn('providers: models list failed', { providerId: id, type: provider.type, err: msg });
		return json({ error: msg }, { status: 500 });
	}
};
