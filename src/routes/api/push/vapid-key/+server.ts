import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { requireUser } from '$lib/server/auth.js';
import { getVapidPublicKey } from '$lib/server/webPush.js';

export const GET: RequestHandler = async (event) => {
	requireUser(event);
	return json({ key: getVapidPublicKey() });
};
