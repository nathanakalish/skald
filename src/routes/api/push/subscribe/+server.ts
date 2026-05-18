import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { requireUser, getSessionCookieName, hashSessionToken } from '$lib/server/auth.js';
import { saveSubscription } from '$lib/server/webPush.js';

export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const body = await event.request.json();

	const { endpoint, keys } = body;
	if (!endpoint || typeof endpoint !== 'string') {
		return json({ error: 'Missing endpoint' }, { status: 400 });
	}
	if (!keys?.p256dh || !keys?.auth) {
		return json({ error: 'Missing keys' }, { status: 400 });
	}

	// Tag the subscription with the current session so revoking the session
	// (sign-out / "remove device" / "disable notifications on this device")
	// can drop just this device's subscription without touching the others.
	// `sessions.id` stores the SHA-256 hash of the cookie token; the FK on
	// push_subscriptions.session_id points at that, so we must hash before
	// storing or the INSERT fails with a FK violation.
	const rawToken = event.cookies.get(getSessionCookieName()) ?? null;
	const sessionId = rawToken ? hashSessionToken(rawToken) : null;
	const userAgent = event.request.headers.get('user-agent') ?? null;

	saveSubscription(user.id, {
		endpoint,
		keys: { p256dh: keys.p256dh, auth: keys.auth },
		sessionId,
		userAgent
	});
	event.locals.logger?.info('push: subscribed', {
		endpointHost: (() => { try { return new URL(endpoint).host; } catch { return null; } })(),
		hasSessionId: !!sessionId,
	});
	return json({ ok: true });
};
