import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import {
	deleteSession,
	getSessionCookieName
} from '$lib/server/auth.js';
import { db } from '$lib/db/index.js';
import { pushSubscriptions } from '$lib/db/schema.js';
import { eq } from 'drizzle-orm';

export const POST: RequestHandler = async ({ cookies }) => {
	const token = cookies.get(getSessionCookieName());
	if (token) {
		// Drop any push subscriptions tied to this session before the FK on
		// session_id nulls out — keeps the user's other devices subscribed,
		// but stops push from arriving on this signed-out device.
		db.delete(pushSubscriptions).where(eq(pushSubscriptions.sessionId, token)).run();
		deleteSession(token);
	}

	cookies.delete(getSessionCookieName(), { path: '/' });

	return json({ ok: true });
};
