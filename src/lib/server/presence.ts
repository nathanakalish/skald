/**
 * In-memory presence tracking for connected users.
 * Tracks which chat each session is viewing and whether the browser tab is focused.
 * Used to suppress push notifications when the user is actively using the app.
 *
 * Design notes (the bits that bit us before):
 *   - `register()` is idempotent on `sessionId`: a reconnect (mobile bg/fg, network
 *     blip, version reload) MUST NOT wipe the existing focus/activeChatId state,
 *     or the user gets a "you're away" notification for ~30s after returning while
 *     we wait for the next heartbeat.
 *   - `update()` upserts. A `reportPresence({focused:true})` ping after a tab return
 *     races the SSE handshake; if the POST lands first and we don't have a session
 *     row, we'd otherwise silently drop the focus update. Upsert lets it stick, and
 *     the next SSE register will just bump `registeredAt`.
 *   - Stale sessions are evicted by a periodic sweep so an upsert created without
 *     an SSE backing it can't leak forever.
 */

interface Session {
	activeChatId: number | null;
	focused: boolean;
	lastUpdate: number;
	registeredAt: number;
}

/** Sessions whose last presence update is older than this are treated as not focused.
 * Heartbeat is 30s, so this allows ~5 missed pings before treating the tab as
 * backgrounded — survives a brief network blip + tab-switch without firing a
 * spurious push. Bumped from 90s after false-positive reports. */
const STALE_FOCUS_MS = 180 * 1000;

/** Sessions older than this with no updates get GC'd entirely. */
const SESSION_GC_MS = 10 * 60 * 1000;

class PresenceTracker {
	private sessions = new Map<number, Map<string, Session>>();

	constructor() {
		// Sweep dead sessions every minute. An entry can outlive its SSE if the
		// client `update()`d before reconnecting and then never came back (closed
		// laptop, killed PWA, etc.).
		if (typeof setInterval !== 'undefined') {
			const t = setInterval(() => this.gc(), 60 * 1000);
			// Don't keep the process alive just for presence cleanup.
			(t as any)?.unref?.();
		}
	}

	/** Register an SSE connection for a user. Preserves prior session state on reconnect. */
	register(userId: number, sessionId: string): number {
		if (!this.sessions.has(userId)) {
			this.sessions.set(userId, new Map());
		}
		const userSessions = this.sessions.get(userId)!;
		const now = Date.now();
		const existing = userSessions.get(sessionId);
		if (existing) {
			// Reconnect: keep focus + active chat as the client last reported them.
			// Resetting here is what caused the "still away" notification window
			// after a tab return on mobile.
			existing.registeredAt = now;
			existing.lastUpdate = now;
			return now;
		}
		userSessions.set(sessionId, {
			activeChatId: null,
			focused: false,
			lastUpdate: now,
			registeredAt: now
		});
		return now;
	}

	/** Unregister an SSE connection. Only removes if registeredAt matches (avoids race with reconnects). */
	unregister(userId: number, sessionId: string, registeredAt: number): void {
		const userSessions = this.sessions.get(userId);
		if (!userSessions) return;
		const session = userSessions.get(sessionId);
		if (session && session.registeredAt === registeredAt) {
			userSessions.delete(sessionId);
			if (userSessions.size === 0) this.sessions.delete(userId);
		}
	}

	/**
	 * Update focus state and/or active chat for a session. Upserts: if no session
	 * exists yet (e.g. focus ping arrived before the SSE handshake completed on
	 * tab return), we create one. The stale sweep cleans up if no SSE ever follows.
	 */
	update(userId: number, sessionId: string, data: { activeChatId?: number | null; focused?: boolean }): void {
		if (!this.sessions.has(userId)) {
			this.sessions.set(userId, new Map());
		}
		const userSessions = this.sessions.get(userId)!;
		const now = Date.now();
		let session = userSessions.get(sessionId);
		if (!session) {
			session = {
				activeChatId: null,
				focused: false,
				lastUpdate: now,
				registeredAt: now
			};
			userSessions.set(sessionId, session);
		}
		if (data.activeChatId !== undefined) session.activeChatId = data.activeChatId;
		if (data.focused !== undefined) session.focused = data.focused;
		session.lastUpdate = now;
	}

	/** Check if user has any focused session (on any chat). */
	hasAnyFocusedSession(userId: number): boolean {
		const userSessions = this.sessions.get(userId);
		if (!userSessions) return false;
		const cutoff = Date.now() - STALE_FOCUS_MS;
		for (const session of userSessions.values()) {
			if (session.focused && session.lastUpdate >= cutoff) return true;
		}
		return false;
	}

	/** Check if user has any focused session actively viewing the given chat. */
	hasFocusedSessionOnChat(userId: number, chatId: number): boolean {
		const userSessions = this.sessions.get(userId);
		if (!userSessions) return false;
		const cutoff = Date.now() - STALE_FOCUS_MS;
		for (const session of userSessions.values()) {
			if (session.focused && session.activeChatId === chatId && session.lastUpdate >= cutoff) return true;
		}
		return false;
	}

	private gc(): void {
		const cutoff = Date.now() - SESSION_GC_MS;
		for (const [userId, userSessions] of this.sessions) {
			for (const [sessionId, session] of userSessions) {
				if (session.lastUpdate < cutoff) userSessions.delete(sessionId);
			}
			if (userSessions.size === 0) this.sessions.delete(userId);
		}
	}
}

export const presence = new PresenceTracker();
