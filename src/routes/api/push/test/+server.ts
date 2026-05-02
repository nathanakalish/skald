import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { requireUser } from '$lib/server/auth.js';
import { sendPushNotification } from '$lib/server/webPush.js';

export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);

	try {
		await sendPushNotification(user.id, {
			title: 'Skald',
			body: 'Push notifications are working!',
			icon: '/icon-192.png',
			data: {}
		});
		return json({ ok: true });
	} catch (err) {
		return json({ error: err instanceof Error ? err.message : 'Push failed' }, { status: 500 });
	}
};
