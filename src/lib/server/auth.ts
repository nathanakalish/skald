import { randomBytes, createHash } from 'crypto';
import { db } from '$lib/db/index.js';
import { users, sessions } from '$lib/db/schema.js';
import { eq, and, gt, lt } from 'drizzle-orm';
import { error, type RequestEvent } from '@sveltejs/kit';

import { getAdminSettingNumber } from '$lib/server/adminSettings.js';

const SESSION_COOKIE = 'skald-session';
const SESSION_MAX_AGE_DAYS = 30;

/** SQLite-compatible UTC timestamp string ("YYYY-MM-DD HH:MM:SS.sss"). */
function sqlNow(offsetMs = 0): string {
	return new Date(Date.now() + offsetMs).toISOString().replace('T', ' ').replace('Z', '');
}

/**
 * Hash session tokens before they hit the database. The cookie still carries
 * the raw 32-byte hex token; only the hash gets persisted, so a leaked DB
 * snapshot can't be replayed as live sessions.
 */
function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

/** Create a new session for a user. Returns the session token (caller stores in cookie). */
export function createSession(userId: number, userAgent: string | null = null): string {
	const token = randomBytes(32).toString('hex');
	const days = getAdminSettingNumber('sessionDurationDays') || SESSION_MAX_AGE_DAYS;
	const expiresAt = sqlNow(days * 24 * 60 * 60 * 1000);
	const ua = userAgent ? userAgent.slice(0, 512) : null;

	db.insert(sessions).values({
		id: hashToken(token),
		userId,
		expiresAt,
		userAgent: ua
	}).run();
	return token;
}

/** Validate a session token. Returns the user, or null if invalid/expired. */
export function validateSession(token: string): { id: number; username: string; role: string; pictureUrl: string | null } | null {
	const now = sqlNow();
	const hashed = hashToken(token);
	const row = db
		.select({
			sessionId: sessions.id,
			userId: users.id,
			username: users.username,
			role: users.role,
			pictureUrl: users.pictureUrl,
			expiresAt: sessions.expiresAt
		})
		.from(sessions)
		.innerJoin(users, eq(sessions.userId, users.id))
		.where(and(eq(sessions.id, hashed), gt(sessions.expiresAt, now)))
		.get();

	if (!row) return null;
	bumpSessionLastSeen(hashed);
	return { id: row.userId, username: row.username, role: row.role, pictureUrl: row.pictureUrl ?? null };
}

const lastSeenCache = new Map<string, number>();
const LAST_SEEN_THROTTLE_MS = 60_000;
/** Bound the cache so a long-lived process doesn't accumulate one entry per
 * historic session token ever seen. Eviction is FIFO; over-eviction just
 * costs an extra DB write next time. */
const LAST_SEEN_CACHE_MAX = 5000;

function bumpSessionLastSeen(hashedToken: string): void {
	const now = Date.now();
	const cached = lastSeenCache.get(hashedToken) ?? 0;
	if (now - cached < LAST_SEEN_THROTTLE_MS) return;
	if (lastSeenCache.size >= LAST_SEEN_CACHE_MAX) {
		const firstKey = lastSeenCache.keys().next().value;
		if (firstKey !== undefined) lastSeenCache.delete(firstKey);
	}
	lastSeenCache.set(hashedToken, now);
	try {
		db.update(sessions).set({ lastSeenAt: sqlNow() }).where(eq(sessions.id, hashedToken)).run();
	} catch { /* best-effort — must never crash the request path */ }
}

/** Delete a session (logout). */
export function deleteSession(token: string): void {
	const hashed = hashToken(token);
	db.delete(sessions).where(eq(sessions.id, hashed)).run();
	lastSeenCache.delete(hashed);
}

/** Cleanup pass: delete every expired session row. */
export function cleanupExpiredSessions(): void {
	db.delete(sessions).where(lt(sessions.expiresAt, sqlNow())).run();
}

/** Cookie name used for the session. */
export function getSessionCookieName(): string {
	return SESSION_COOKIE;
}

/** Session max age in seconds. */
export function getSessionMaxAge(): number {
	const days = getAdminSettingNumber('sessionDurationDays') || SESSION_MAX_AGE_DAYS;
	return days * 24 * 60 * 60;
}

/**
 * Pull the authenticated user off a request. Throws 401 if there's no session.
 */
export function requireUser(event: RequestEvent): { id: number; username: string; role: string; pictureUrl: string | null } {
	const user = event.locals.user;
	if (!user) throw error(401, 'Authentication required');
	return user;
}

/**
 * Like requireUser, but admin-only. 403 if the user isn't an admin.
 */
export function requireAdmin(event: RequestEvent): { id: number; username: string; role: string; pictureUrl: string | null } {
	const user = requireUser(event);
	if (user.role !== 'admin') throw error(403, 'Admin access required');
	return user;
}

/** True if at least one user exists in the DB. Used by the first-run flow. */
export function hasAnyUsers(): boolean {
	const row = db.select({ id: users.id }).from(users).limit(1).get();
	return !!row;
}
