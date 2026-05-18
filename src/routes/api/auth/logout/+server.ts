import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import {
	deleteSession,
	getSessionCookieName,
	hashSessionToken
} from '$lib/server/auth.js';
import { db } from '$lib/db/index.js';
import { pushSubscriptions } from '$lib/db/schema.js';
import { eq } from 'drizzle-orm';
import { logger } from '$lib/server/logger.js';

export const POST: RequestHandler = async ({ cookies, locals }) => {
	const token = cookies.get(getSessionCookieName());
	if (token) {
		// Drop any push subscriptions tied to this session before the FK on
		// session_id nulls out — keeps the user's other devices subscribed,
		// but stops push from arriving on this signed-out device. The FK
		// references sessions.id (hashed), so push.session_id stores the
		// hashed token too.
		const hashed = hashSessionToken(token);
		db.delete(pushSubscriptions).where(eq(pushSubscriptions.sessionId, hashed)).run();
		deleteSession(token);
		(locals.logger ?? logger).info('auth: logout', { sessionIdPrefix: hashed.slice(0, 8) });
	}

	cookies.delete(getSessionCookieName(), { path: '/' });

	return json({ ok: true });
};
