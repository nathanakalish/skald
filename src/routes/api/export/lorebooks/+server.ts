import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { requireUser } from '$lib/server/auth.js';
import { buildLorebooksBundle } from '$lib/server/bundle.js';

export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const body = await event.request.json().catch(() => ({}));

	const ids = Array.isArray(body.lorebookIds)
		? body.lorebookIds.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n))
		: [];
	if (ids.length === 0) return json({ error: 'No lorebooks selected' }, { status: 400 });

	const result = await buildLorebooksBundle(user.id, ids);
	if (result.counts.lorebooks === 0) {
		return json({ error: 'No matching lorebooks found' }, { status: 404 });
	}

	const stamp = new Date().toISOString().slice(0, 10);
	const name = result.counts.lorebooks === 1
		? `skald-lorebook-${stamp}.skald.zip`
		: `skald-lorebooks-${stamp}.skald.zip`;

	return new Response(new Uint8Array(result.buffer), {
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename="${name}"`,
			'X-Bundle-Counts': JSON.stringify(result.counts)
		}
	});
};
