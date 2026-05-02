import type { RequestHandler } from './$types.js';
import { requireUser } from '$lib/server/auth.js';
import { buildEverythingBundle } from '$lib/server/bundle.js';

export const GET: RequestHandler = async (event) => {
	const user = requireUser(event);
	const url = event.url;
	const flag = (k: string, def = true) => {
		const v = url.searchParams.get(k);
		if (v == null) return def;
		return v === 'true' || v === '1';
	};

	const result = await buildEverythingBundle(user.id, {
		includePersonas: flag('personas', true),
		includeSettings: flag('settings', true),
		includeThemes: flag('themes', true),
		includeProviders: flag('providers', false)
	});

	const stamp = new Date().toISOString().slice(0, 10);
	return new Response(new Uint8Array(result.buffer), {
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename="skald-backup-${stamp}.skald.zip"`,
			'X-Bundle-Counts': JSON.stringify(result.counts)
		}
	});
};
