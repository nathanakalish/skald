import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { requireUser } from '$lib/server/auth.js';
import { removeSubscription } from '$lib/server/webPush.js';

export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const body = await event.request.json();

	const { endpoint } = body;
	if (!endpoint || typeof endpoint !== 'string') {
		return json({ error: 'Missing endpoint' }, { status: 400 });
	}

	removeSubscription(user.id, endpoint);
	event.locals.logger?.info('push: unsubscribed', {
		endpointHost: (() => { try { return new URL(endpoint).host; } catch { return null; } })(),
	});
	return json({ ok: true });
};
