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

	try {
		const llm = createProvider(provider.type as ProviderType, {
			endpoint: provider.endpoint,
			apiKey: provider.apiKey || '',
			model: provider.defaultModel || ''
		});

		const result = await llm.testConnection();
		return json(result);
	} catch (err) {
		return json({ ok: false, error: err instanceof Error ? err.message : 'Connection test failed' });
	}
};
