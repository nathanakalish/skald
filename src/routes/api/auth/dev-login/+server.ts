import type { RequestHandler } from '@sveltejs/kit';
import { json, redirect, error } from '@sveltejs/kit';
import { db } from '$lib/db/index.js';
import { users } from '$lib/db/schema.js';
import { eq } from 'drizzle-orm';
import { createSession, getSessionCookieName, getSessionMaxAge } from '$lib/server/auth.js';
import { isDevAuthBypassEnabled, DEV_AUTH_USERNAME } from '$lib/server/devAuth.js';
import { logger } from '$lib/server/logger.js';

/**
 * Dev-only auth bypass.
 *
 * Gated entirely behind the `SKALD_DEV_AUTH_BYPASS=1` environment variable.
 * When enabled, hitting this endpoint creates (if needed) a fixed admin
 * user named `dev` and issues a normal session cookie. Intended for local
 * testing only — never enable in production.
 */
type Cookies = Parameters<RequestHandler>[0]['cookies'];

function signIn(url: URL, cookies: Cookies, userAgent: string | null): { id: number; username: string; role: string } {
	if (!isDevAuthBypassEnabled()) {
		throw error(404, 'Not found');
	}

	let user = db.select().from(users).where(eq(users.username, DEV_AUTH_USERNAME)).get();
	if (!user) {
		const result = db
			.insert(users)
			.values({ username: DEV_AUTH_USERNAME, role: 'admin', pictureUrl: null })
			.run();
		user = {
			id: Number(result.lastInsertRowid),
			username: DEV_AUTH_USERNAME,
			role: 'admin',
			pictureUrl: null,
			createdAt: new Date().toISOString(),
		};
	}

	const token = createSession(user.id, userAgent);
	cookies.set(getSessionCookieName(), token, {
		path: '/',
		httpOnly: true,
		secure: url.protocol === 'https:',
		sameSite: 'lax',
		maxAge: getSessionMaxAge(),
	});
	logger.warn('auth: dev bypass login', { userId: user.id, username: user.username });
	return { id: user.id, username: user.username, role: user.role };
}

export const POST: RequestHandler = async ({ url, cookies, request }) => {
	const u = signIn(url, cookies, request.headers.get('user-agent'));
	return json({ ok: true, username: u.username, role: u.role });
};

// GET is a convenience for hitting the URL directly in a browser.
export const GET: RequestHandler = async ({ url, cookies, request }) => {
	signIn(url, cookies, request.headers.get('user-agent'));
	throw redirect(303, '/');
};
