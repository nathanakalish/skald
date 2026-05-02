import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { createProvider } from '$lib/providers/index.js';
import { requireUser } from '$lib/server/auth.js';

export const POST: RequestHandler = async (event) => {
	requireUser(event);
	const { type, endpoint, apiKey } = await event.request.json();

	if (!type || !endpoint) {
		return json({ error: 'Missing type or endpoint' }, { status: 400 });
	}

	// Validate endpoint URL — only allow http/https protocols
	try {
		const url = new URL(endpoint);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') {
			return json({ error: 'Endpoint must use http or https protocol' }, { status: 400 });
		}
	} catch {
		return json({ error: 'Invalid endpoint URL' }, { status: 400 });
	}

	try {
		const llm = createProvider(type, {
			endpoint,
			apiKey: apiKey || '',
			model: ''
		});

		const models = await llm.listModels();
		return json({ models });
	} catch (err) {
		return json(
			{ error: err instanceof Error ? err.message : 'Failed to fetch models' },
			{ status: 500 }
		);
	}
};
