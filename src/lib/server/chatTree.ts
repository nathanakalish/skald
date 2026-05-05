/**
 * Walk a chat's active branch from a leaf message id back to the root using a
 * recursive CTE. Returns messages in chronological (root-first) order.
 *
 * Way cheaper than loading every message in the chat and walking in JS once
 * the conversation gets long.
 */
import { rawDb } from '$lib/db/index.js';

/** Raw row shape returned by SQLite (snake_case). Mapped to camelCase by callers. */
export interface RawMessageRow {
	id: number;
	chat_id: number;
	parent_id: number | null;
	role: string;
	content: string;
	swipes: string | null;
	swipe_index: number | null;
	reasoning: string | null;
	created_at: string;
	guidance: string | null;
}

export interface MessageRow {
	id: number;
	chatId: number;
	parentId: number | null;
	role: string;
	content: string;
	swipes: string | null;
	swipeIndex: number | null;
	reasoning: string | null;
	createdAt: string;
	guidance: string | null;
}

function mapRow(r: RawMessageRow): MessageRow {
	return {
		id: r.id,
		chatId: r.chat_id,
		parentId: r.parent_id,
		role: r.role,
		content: r.content,
		swipes: r.swipes,
		swipeIndex: r.swipe_index,
		reasoning: r.reasoning,
		createdAt: r.created_at,
		guidance: r.guidance ?? null,
	};
}

const PATH_SQL = `
WITH RECURSIVE path(id, parent_id, depth) AS (
	SELECT id, parent_id, 0 FROM messages WHERE id = ?
	UNION ALL
	SELECT m.id, m.parent_id, p.depth + 1
	FROM messages m
	JOIN path p ON m.id = p.parent_id
)
SELECT m.* FROM messages m
JOIN path p ON p.id = m.id
ORDER BY p.depth DESC
`;

/** Load active path from leaf to root in chronological order. */
export function loadActivePath(leafId: number): MessageRow[] {
	const rows = rawDb.prepare(PATH_SQL).all(leafId) as RawMessageRow[];
	return rows.map(mapRow);
}

/** Sibling info per message id (used for swipe navigation in the UI). */
export interface SiblingInfo {
	index: number;
	total: number;
}

/**
 * Compute sibling info for every message in a chat: how many messages share
 * each parent_id, and the index of each one within its siblings (ordered by id).
 *
 * One SQL query — no need to load every message into Node memory.
 */
export function loadSiblings(chatId: number): { siblingsByParent: Map<number | null, number[]> } {
	const rows = rawDb.prepare(
		'SELECT id, parent_id FROM messages WHERE chat_id = ? ORDER BY id ASC'
	).all(chatId) as { id: number; parent_id: number | null }[];

	const siblingsByParent = new Map<number | null, number[]>();
	for (const r of rows) {
		const key = r.parent_id ?? null;
		const arr = siblingsByParent.get(key);
		if (arr) arr.push(r.id);
		else siblingsByParent.set(key, [r.id]);
	}
	return { siblingsByParent };
}

/**
 * Find the deepest descendant of `chatId` that has no children.
 * Used as a fallback when chat.activeLeafId is missing.
 */
export function findDeepestLeaf(chatId: number): number | null {
	const row = rawDb.prepare(`
		WITH RECURSIVE walk(id, depth) AS (
			SELECT id, 0 FROM messages WHERE chat_id = ? AND parent_id IS NULL
			UNION ALL
			SELECT m.id, w.depth + 1 FROM messages m
			JOIN walk w ON m.parent_id = w.id
		)
		SELECT id FROM walk ORDER BY depth DESC, id ASC LIMIT 1
	`).get(chatId) as { id: number } | undefined;
	return row?.id ?? null;
}
