/**
 * In-memory presence tracking for connected users.
 * Tracks which chat each session is viewing and whether the browser tab is focused.
 * Used to suppress push notifications when the user is actively using the app.
 */

interface Session {
	activeChatId: number | null;
	focused: boolean;
	lastUpdate: number;
	registeredAt: number;
}

/** Sessions whose last presence update is older than this are treated as not focused. */
const STALE_FOCUS_MS = 90 * 1000;

class PresenceTracker {
	private sessions = new Map<number, Map<string, Session>>();

	/** Register a new SSE connection for a user. */
	register(userId: number, sessionId: string): number {
		if (!this.sessions.has(userId)) {
			this.sessions.set(userId, new Map());
		}
		const now = Date.now();
		this.sessions.get(userId)!.set(sessionId, {
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

	/** Update focus state and/or active chat for a session. */
	update(userId: number, sessionId: string, data: { activeChatId?: number | null; focused?: boolean }): void {
		const userSessions = this.sessions.get(userId);
		if (!userSessions) return;
		const session = userSessions.get(sessionId);
		if (!session) return;
		if (data.activeChatId !== undefined) session.activeChatId = data.activeChatId;
		if (data.focused !== undefined) session.focused = data.focused;
		session.lastUpdate = Date.now();
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
}

export const presence = new PresenceTracker();
