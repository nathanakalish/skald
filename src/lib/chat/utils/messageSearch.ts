import type { Message } from '$lib/chat/message';

/**
 * Build the set of message ids whose content contains the (case-insensitive)
 * query. Pure so the orchestrator can drop it straight into `$derived.by`,
 * and so it's trivial to unit test.
 */
export function computeSearchMatches(messages: Pick<Message, 'id' | 'content'>[], query: string): Set<number> {
	const q = query.trim().toLowerCase();
	if (!q) return new Set();
	const out = new Set<number>();
	for (const m of messages) {
		if (m.content.toLowerCase().includes(q)) out.add(m.id);
	}
	return out;
}
