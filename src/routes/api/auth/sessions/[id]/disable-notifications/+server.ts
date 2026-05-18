import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { sessions, pushSubscriptions } from '$lib/db/schema.js';
import { and, eq } from 'drizzle-orm';
import { requireUser, getSessionCookieName, hashSessionToken } from '$lib/server/auth.js';

/**
 * POST /api/auth/sessions/[id]/disable-notifications
 *
 * Marks the target session's notifications as disabled (sets
 * `notifications_disabled_at`) and drops any linked push subscriptions.
 * Next time the device loads the layout, the client compares this
 * timestamp against its last-known value and resets its banner-dismissal
 * flag so the "Enable notifications" prompt reappears.
 *
 * DELETE on the same path clears the flag (used after the client has
 * acknowledged the disable, so the cycle doesn't repeat).
 */
export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const idParam = event.params.id ?? '';
	const currentTokenRaw = event.cookies.get(getSessionCookieName()) ?? '';
	const currentSessionId = currentTokenRaw ? hashSessionToken(currentTokenRaw) : '';

	const target = resolveSession(idParam, user.id, currentSessionId);
	if (!target) return json({ error: 'Session not found' }, { status: 404 });

	const now = new Date().toISOString();
	db.transaction(() => {
		db.update(sessions)
			.set({ notificationsDisabledAt: now })
			.where(eq(sessions.id, target.id))
			.run();
		db.delete(pushSubscriptions)
			.where(and(eq(pushSubscriptions.userId, user.id), eq(pushSubscriptions.sessionId, target.id)))
			.run();
	});

	event.locals.logger.info('session: notifications disabled', { sessionIdPrefix: target.id.slice(0, 8) });

	return json({ ok: true, notificationsDisabledAt: now });
};

export const DELETE: RequestHandler = async (event) => {
	const user = requireUser(event);
	const idParam = event.params.id ?? '';
	const currentTokenRaw = event.cookies.get(getSessionCookieName()) ?? '';
	const currentSessionId = currentTokenRaw ? hashSessionToken(currentTokenRaw) : '';

	const target = resolveSession(idParam, user.id, currentSessionId);
	if (!target) return json({ error: 'Session not found' }, { status: 404 });

	db.update(sessions)
		.set({ notificationsDisabledAt: null })
		.where(eq(sessions.id, target.id))
		.run();
	event.locals.logger.info('session: notifications re-enabled', { sessionIdPrefix: target.id.slice(0, 8) });
	return json({ ok: true });
};

function resolveSession(idParam: string, userId: number, currentSessionId: string) {
	if (!idParam) return null;
	if (idParam.length < 4 || idParam.length > 128) return null;
	if (idParam.length <= 16) {
		const all = db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, userId)).all();
		const match = all.find((s) => s.id.endsWith(idParam));
		return match ?? null;
	}
	if (idParam !== currentSessionId) return null;
	const row = db.select({ id: sessions.id }).from(sessions)
		.where(and(eq(sessions.id, idParam), eq(sessions.userId, userId))).get();
	return row ?? null;
}
