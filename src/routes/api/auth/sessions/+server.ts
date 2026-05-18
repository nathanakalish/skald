import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { sessions } from '$lib/db/schema.js';
import { eq, and, gt } from 'drizzle-orm';
import { requireUser, getSessionCookieName, hashSessionToken } from '$lib/server/auth.js';

/**
 * Signed-in devices (sessions). Push notification state is intentionally NOT
 * exposed here — it lives on its own primary list at /api/push/devices, which
 * IS the database of devices that receive notifications. Trying to merge the
 * two introduces fragile session<->subscription linking heuristics that
 * proved unreliable in practice.
 */

interface SessionListItem {
	id: string;
	fingerprint: string;
	current: boolean;
	userAgent: string;
	createdAt: string | null;
	lastSeenAt: string | null;
	expiresAt: string;
	notificationsDisabledAt: string | null;
}

export const GET: RequestHandler = async (event) => {
	const user = requireUser(event);
	const currentTokenRaw = event.cookies.get(getSessionCookieName()) ?? '';
	const currentSessionId = currentTokenRaw ? hashSessionToken(currentTokenRaw) : '';
	const now = new Date().toISOString().replace('T', ' ').replace('Z', '');

	const rows = db
		.select({
			id: sessions.id,
			expiresAt: sessions.expiresAt,
			createdAt: sessions.createdAt,
			lastSeenAt: sessions.lastSeenAt,
			userAgent: sessions.userAgent,
			notificationsDisabledAt: sessions.notificationsDisabledAt
		})
		.from(sessions)
		.where(and(eq(sessions.userId, user.id), gt(sessions.expiresAt, now)))
		.all();

	const list: SessionListItem[] = rows.map((r) => ({
		id: r.id,
		// Don't expose the raw token. Short fingerprint lets the user tell
		// devices apart without enabling cross-tab token theft.
		fingerprint: r.id.slice(-8),
		current: r.id === currentSessionId,
		userAgent: r.userAgent ?? '',
		createdAt: r.createdAt,
		lastSeenAt: r.lastSeenAt,
		expiresAt: r.expiresAt,
		notificationsDisabledAt: r.notificationsDisabledAt
	}));

	return json({ sessions: list });
};
