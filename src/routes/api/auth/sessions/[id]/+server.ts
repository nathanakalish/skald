import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { sessions, pushSubscriptions } from '$lib/db/schema.js';
import { and, eq } from 'drizzle-orm';
import { requireUser, getSessionCookieName } from '$lib/server/auth.js';

/**
 * DELETE /api/auth/sessions/[id]
 *
 * Revoke a single session. Also drops any push subscriptions linked to it
 * (newer subs only — pre-link rows have a NULL session_id and aren't
 * touched here, by design).
 *
 * Resolving "id" handles two cases:
 *   1. A short fingerprint (the last 8 chars of the token) — what the UI sends.
 *   2. The full token — only allowed for the caller's own current session,
 *      so we never let one device guess another device's full token.
 */
export const DELETE: RequestHandler = async (event) => {
	const user = requireUser(event);
	const idParam = event.params.id ?? '';
	const currentToken = event.cookies.get(getSessionCookieName()) ?? '';

	const target = resolveSession(idParam, user.id, currentToken);
	if (!target) return json({ error: 'Session not found' }, { status: 404 });

	// Cascade: drop push subs for this session, then delete the session row.
	db.delete(pushSubscriptions)
		.where(and(eq(pushSubscriptions.userId, user.id), eq(pushSubscriptions.sessionId, target.id)))
		.run();
	db.delete(sessions).where(eq(sessions.id, target.id)).run();

	// If the caller revoked themselves, clear the cookie.
	if (target.id === currentToken) {
		event.cookies.delete(getSessionCookieName(), { path: '/' });
	}

	return json({ ok: true, signedOutSelf: target.id === currentToken });
};

function resolveSession(idParam: string, userId: number, currentToken: string) {
	if (!idParam) return null;
	if (idParam.length < 4 || idParam.length > 128) return null;
	// Short-fingerprint match: the UI only ever sees the last 8 chars.
	if (idParam.length <= 16) {
		const all = db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, userId)).all();
		const match = all.find((s) => s.id.endsWith(idParam));
		return match ?? null;
	}
	// Full-token match: only honored when it equals the caller's own cookie,
	// otherwise reject — we never accept arbitrary tokens from request input.
	if (idParam !== currentToken) return null;
	const row = db.select({ id: sessions.id }).from(sessions)
		.where(and(eq(sessions.id, idParam), eq(sessions.userId, userId))).get();
	return row ?? null;
}
