import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { pushSubscriptions } from '$lib/db/schema.js';
import { and, eq } from 'drizzle-orm';
import { requireUser, getSessionCookieName, hashSessionToken } from '$lib/server/auth.js';

/**
 * GET — quick check based on session_id linkage only. Used by callers that
 * don't have access to the current Push subscription endpoint.
 */
export const GET: RequestHandler = async (event) => {
	const user = requireUser(event);
	const rawToken = event.cookies.get(getSessionCookieName()) ?? null;
	if (!rawToken) {
		return json({ subscribed: false });
	}
	// push_subscriptions.session_id stores the SHA-256 hash of the cookie
	// token (matches sessions.id, which is also hashed).
	const sessionId = hashSessionToken(rawToken);

	const row = db
		.select({ id: pushSubscriptions.id })
		.from(pushSubscriptions)
		.where(and(eq(pushSubscriptions.userId, user.id), eq(pushSubscriptions.sessionId, sessionId)))
		.get();

	return json({ subscribed: !!row });
};

/**
 * POST { endpoint? } — authoritative status check that also self-heals the
 * session_id link. If the caller's service worker has a subscription, the
 * endpoint is the unique key for the row; we link any matching row to the
 * current session_id (covers legacy NULL-session_id rows and rows registered
 * under a previous session id, e.g. an iOS PWA hanging on to its subscription
 * across a re-auth). Returns subscribed=true iff such a row exists for this
 * user.
 *
 * Falls back to the GET behaviour (session_id match) when no endpoint comes
 * in.
 */
export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const rawToken = event.cookies.get(getSessionCookieName()) ?? null;
	const sessionId = rawToken ? hashSessionToken(rawToken) : null;
	let body: { endpoint?: unknown } = {};
	try {
		body = await event.request.json();
	} catch { /* empty body is allowed */ }
	const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : '';

	if (endpoint) {
		const row = db
			.select({ id: pushSubscriptions.id, sessionId: pushSubscriptions.sessionId })
			.from(pushSubscriptions)
			.where(and(eq(pushSubscriptions.userId, user.id), eq(pushSubscriptions.endpoint, endpoint)))
			.get();
		if (row) {
			if (sessionId && row.sessionId !== sessionId) {
				db.update(pushSubscriptions)
					.set({ sessionId })
					.where(eq(pushSubscriptions.id, row.id))
					.run();
			}
			return json({ subscribed: true });
		}
		return json({ subscribed: false });
	}

	if (!sessionId) return json({ subscribed: false });
	const row = db
		.select({ id: pushSubscriptions.id })
		.from(pushSubscriptions)
		.where(and(eq(pushSubscriptions.userId, user.id), eq(pushSubscriptions.sessionId, sessionId)))
		.get();
	return json({ subscribed: !!row });
};
