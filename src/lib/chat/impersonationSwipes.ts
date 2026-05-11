/**
 * Shared shape + parser for the impersonation-swipes blob persisted on
 * chats.impersonation_swipes. Used by both the server (chatProcessor,
 * impersonation API route) and the client (ChatView) so the three copies
 * of this don't drift.
 */

export interface ImpersonationSwipe {
	draft: string;
	reasoning: string;
	guidance?: string;
	generatedAt: string | null;
}

export function parseImpersonationSwipes(raw: unknown): ImpersonationSwipe[] {
	if (typeof raw !== 'string' || !raw) return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}
