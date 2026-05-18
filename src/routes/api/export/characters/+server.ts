import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { requireUser } from '$lib/server/auth.js';
import { buildCharactersBundle } from '$lib/server/bundle.js';

export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const body = await event.request.json().catch(() => ({}));

	const ids = Array.isArray(body.characterIds)
		? body.characterIds.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n))
		: [];
	if (ids.length === 0) return json({ error: 'No characters selected' }, { status: 400 });

	const includeChats = body.includeChats !== false;

	const result = await buildCharactersBundle(user.id, ids, { includeChats });
	if (result.counts.characters === 0) {
		return json({ error: 'No matching characters found' }, { status: 404 });
	}

	const stamp = new Date().toISOString().slice(0, 10);
	const name = result.counts.characters === 1
		? `skald-character-${stamp}.skald.zip`
		: `skald-characters-${stamp}.skald.zip`;

	return new Response(new Uint8Array(result.buffer), {
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename="${name}"`,
			'X-Bundle-Counts': JSON.stringify(result.counts)
		}
	});
};
