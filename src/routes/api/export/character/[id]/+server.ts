import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { requireUser } from '$lib/server/auth.js';
import { buildCharacterBundle } from '$lib/server/bundle.js';

export const GET: RequestHandler = async (event) => {
	const user = requireUser(event);
	const id = Number(event.params.id);
	if (!Number.isFinite(id)) return json({ error: 'Invalid character id' }, { status: 400 });

	const result = await buildCharacterBundle(user.id, id);
	if (!result) return json({ error: 'Character not found' }, { status: 404 });

	const safeName = result.characterName.replace(/[^a-zA-Z0-9_-]/g, '_') || `character_${id}`;
	return new Response(new Uint8Array(result.buffer), {
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename="${safeName}.skald.zip"`,
			'X-Bundle-Counts': JSON.stringify(result.counts)
		}
	});
};
