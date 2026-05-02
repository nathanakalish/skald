import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { requireUser } from '$lib/server/auth.js';
import { safeFetch } from '$lib/server/safeFetch.js';

export const POST: RequestHandler = async (event) => {
	requireUser(event);

	const { url } = await event.request.json();
	if (!url || typeof url !== 'string') {
		return json({ valid: false });
	}

	// Only allow http/https URLs
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return json({ valid: false });
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		return json({ valid: false });
	}

	try {
		// safeFetch handles SSRF guard + manual redirect re-validation
		const headRes = await safeFetch(url, {
			method: 'HEAD',
			headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LinkChecker/1.0)' },
			timeoutMs: 5000
		});

		if (headRes.status === 405) {
			const getRes = await safeFetch(url, {
				method: 'GET',
				headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LinkChecker/1.0)' },
				timeoutMs: 5000
			});
			return json({ valid: getRes.ok });
		}

		return json({ valid: headRes.ok });
	} catch {
		return json({ valid: false });
	}
};
