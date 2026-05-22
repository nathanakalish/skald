import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { providers } from '$lib/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { createProvider, type ProviderType } from '$lib/providers/index.js';
import { retryOnce } from '$lib/providers/retry.js';
import { requireUser } from '$lib/server/auth.js';
import { ApiError } from '$lib/server/apiError.js';
import { providerProfiles } from '$lib/providers/profiles.js';

// Substrings that strongly suggest a model id is an image-generation model.
// Order matters for ranking — earlier entries score higher.
const IMAGE_HINTS = [
	'gpt-image',
	'dall-e',
	'imagen',
	'flux',
	'sdxl',
	'stable-diffusion',
	'sd-',
	'cogview',
	'gemini-2.5-flash-image',
	'gemini-flash-image',
	'kandinsky',
	'playground',
	'photoreal',
	'recraft',
	'ideogram',
	'firefly'
];

// Substrings that strongly suggest a NOT-image model (chat / embedding / tts / etc).
// Used to filter the long list down to a tractable shortlist when the provider
// returns hundreds of mixed-purpose entries.
const NON_IMAGE_HINTS = [
	'embed', 'embedding',
	'whisper', 'transcribe', 'tts',
	'rerank',
	'moderation',
	'realtime',
	'audio'
];

function imageScore(id: string): number {
	const lower = id.toLowerCase();
	for (let i = 0; i < IMAGE_HINTS.length; i++) {
		if (lower.includes(IMAGE_HINTS[i])) return IMAGE_HINTS.length - i;
	}
	return 0;
}

function looksLikeNonImage(id: string): boolean {
	const lower = id.toLowerCase();
	return NON_IMAGE_HINTS.some((h) => lower.includes(h));
}

export const GET: RequestHandler = async (event) => {
	const user = requireUser(event);
	const id = Number(event.params.id);
	const provider = db.select().from(providers).where(and(eq(providers.id, id), eq(providers.userId, user.id))).get();

	if (!provider) return ApiError.notFound('Provider not found');

	const profile = providerProfiles.find((p) => p.id === provider.type);
	const capability = profile?.imageGeneration ?? 'none';
	if (capability === 'none') {
		return json({ models: [], capability });
	}

	// ComfyUI has no listable model — the workflow JSON IS the model.
	if (capability === 'comfyui') {
		return json({ models: [], capability });
	}

	try {
		const llm = createProvider(provider.type as ProviderType, {
			endpoint: provider.endpoint,
			apiKey: provider.apiKey || '',
			model: provider.defaultModel || ''
		});

		const all = await retryOnce(() => llm.listModels());

		// Filter out obvious non-image entries, then sort by image score (known
		// image families first) and finally alphabetically. We don't hard-drop
		// unknown entries because some providers (notably Together / Fireworks)
		// ship image models under opaque ids that won't match any hint.
		const filtered = all.filter((m) => !looksLikeNonImage(m));
		filtered.sort((a, b) => {
			const sa = imageScore(a);
			const sb = imageScore(b);
			if (sa !== sb) return sb - sa;
			return a.localeCompare(b);
		});

		event.locals.logger?.debug('image models listed', {
			providerId: id, type: provider.type, total: all.length, returned: filtered.length
		});

		return json({ models: filtered, capability });
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Failed to fetch models';
		event.locals.logger?.warn('image models list failed', { providerId: id, type: provider.type, err: msg });
		return json({ error: msg, capability }, { status: 500 });
	}
};
