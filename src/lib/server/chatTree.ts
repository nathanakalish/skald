/**
 * Walk a chat's active branch from a leaf message id back to the root using a
 * recursive CTE. Returns messages in chronological (root-first) order.
 *
 * Way cheaper than loading every message in the chat and walking in JS once
 * the conversation gets long.
 */
import { rawDb } from '$lib/db/index.js';

/** Raw row shape returned by SQLite (snake_case). Mapped to camelCase by callers. */
interface RawMessageRow {
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
	impersonation_guidance: string | null;
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
	impersonationGuidance: string | null;
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
		impersonationGuidance: r.impersonation_guidance ?? null,
	};
}

const PATH_SQL = `
WITH RECURSIVE path(id, parent_id, depth) AS (
	SELECT id, parent_id, 0 FROM messages WHERE id = ?
	UNION ALL
	SELECT m.id, m.parent_id, p.depth + 1
	FROM messages m
	JOIN path p ON m.id = p.parent_id
	WHERE p.depth < 100000
)
SELECT m.* FROM messages m
JOIN path p ON p.id = m.id
ORDER BY p.depth DESC
`;

// Count only — walks id+parent_id (no large content columns), much cheaper
// than SELECT m.* for long conversations.
const COUNT_SQL = `
WITH RECURSIVE path(id, parent_id, depth) AS (
	SELECT id, parent_id, 0 FROM messages WHERE id = ?
	UNION ALL
	SELECT m.id, m.parent_id, p.depth + 1 FROM messages m
	JOIN path p ON m.id = p.parent_id
	WHERE p.depth < 100000
)
SELECT COUNT(*) AS total FROM path
`;

// The depth < 100000 cap on PATH_SQL / COUNT_SQL is a cycle guard. parent_id
// is foreign-key constrained but not topology-checked, so a manual DB edit or
// a buggy import could in theory create a parent_id loop. Without the cap a
// cycle would walk the recursive CTE until SQLite or Node OOMs. 100k is well
// above any plausible chat depth (deepest chats observed: low hundreds) but
// low enough to bound worst-case memory.

// Bounded walk: only traverse maxDepth+1 steps from the leaf so we don't
// load thousands of full message rows just to paginate them in JS.
const PAGE_SQL = `
WITH RECURSIVE path(id, parent_id, depth) AS (
	SELECT id, parent_id, 0 FROM messages WHERE id = ?
	UNION ALL
	SELECT m.id, m.parent_id, p.depth + 1
	FROM messages m
	JOIN path p ON m.id = p.parent_id
	WHERE p.depth < ?
)
SELECT m.* FROM messages m
JOIN path p ON p.id = m.id
ORDER BY p.depth DESC
`;

// Pre-compile all fixed SQL — eliminates per-request Statement wrapper overhead
// from the slow-query instrumenter in db/index.ts. Parameters are still bound
// at call time; only the compilation + wrapper setup moves to startup.
const stmtPath = rawDb.prepare(PATH_SQL);
const stmtCount = rawDb.prepare(COUNT_SQL);
const stmtPage = rawDb.prepare(PAGE_SQL);
const stmtAllSiblings = rawDb.prepare('SELECT id, parent_id FROM messages WHERE chat_id = ? ORDER BY id ASC');
const stmtRoots = rawDb.prepare('SELECT id, parent_id FROM messages WHERE chat_id = ? AND parent_id IS NULL ORDER BY id ASC');
const stmtSiblingIds = rawDb.prepare('SELECT id FROM messages WHERE parent_id = ? ORDER BY id ASC');
const stmtRootIds = rawDb.prepare('SELECT id FROM messages WHERE parent_id IS NULL AND chat_id = ? ORDER BY id ASC');
const stmtFirstChild = rawDb.prepare('SELECT id FROM messages WHERE parent_id = ? ORDER BY created_at ASC LIMIT 1');

/** Load active path from leaf to root in chronological order. */
export function loadActivePath(leafId: number): MessageRow[] {
	const rows = stmtPath.all(leafId) as RawMessageRow[];
	return rows.map(mapRow);
}

/**
 * Load a paginated tail of the active path.
 *
 * offset=0 returns the newest `limit` messages; offset=N skips the N newest
 * (for loading earlier pages). Also returns the true total path length so the
 * client can display "{X remaining}" and derive hasMore.
 *
 * For a 2000-message chat with limit=50: loads 51 full rows (not 2000) — the
 * count query reads only id+parent_id pairs which are tiny.
 */
export function loadActivePathPage(
	leafId: number,
	limit: number,
	offset: number,
): { messages: MessageRow[]; total: number } {
	const { total } = stmtCount.get(leafId) as { total: number };
	if (total === 0) return { messages: [], total: 0 };

	// Walk back at most limit+offset steps from the leaf (depth 0). That
	// yields at most limit+offset+1 rows. We peek one extra row beyond what
	// we'll return so the parent_id check gives us "hasMore" for free, and
	// so the chronological slice maths works cleanly without off-by-one.
	const maxDepth = limit + offset;
	const rows = stmtPage.all(leafId, maxDepth) as RawMessageRow[];

	// rows is chronological (ORDER BY depth DESC → highest depth = oldest first).
	// Slice: skip `offset` rows from the newest end, take at most `limit`.
	const pageEnd = rows.length - offset;
	const pageStart = Math.max(0, pageEnd - limit);
	const page = pageEnd > 0 ? rows.slice(pageStart, pageEnd) : [];

	return { messages: page.map(mapRow), total };
}

/** Sibling info per message id (used for swipe navigation in the UI). */
interface SiblingInfo {
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
	const rows = stmtAllSiblings.all(chatId) as { id: number; parent_id: number | null }[];

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
 * Like loadSiblings but scoped to a visible page of messages.
 *
 * Instead of loading every id+parent_id pair in the chat, we only load pairs
 * for the parent_ids that appear in the visible window plus the leaf's children
 * (needed for hiddenBranchCount). For a 50-message page of a 2000-message chat
 * this is ~50 rows instead of 2000+.
 *
 * Returns the same Map<parent_id, child_ids[]> shape as loadSiblings so the
 * caller doesn't need to change how it builds messageSiblings.
 */
export function loadSiblingsScoped(
	chatId: number,
	visibleMessages: MessageRow[],
): Map<number | null, number[]> {
	if (visibleMessages.length === 0) return new Map();

	const leafId = visibleMessages[visibleMessages.length - 1].id;

	// Parent ids we need sibling lists for:
	// • each visible message's parentId (so we can compute swipe index/total)
	// • the leaf's own id (so caller can get hiddenBranchCount = leaf's children)
	const nonNullParentIds = new Set<number>([
		...visibleMessages
			.map((m) => m.parentId)
			.filter((id): id is number => id !== null),
		leafId,
	]);

	const hasRootMessages = visibleMessages.some((m) => m.parentId === null);
	const siblingsByParent = new Map<number | null, number[]>();

	if (nonNullParentIds.size > 0) {
		const placeholders = Array.from(nonNullParentIds).map(() => '?').join(',');
		const rows = rawDb.prepare(
			`SELECT id, parent_id FROM messages WHERE parent_id IN (${placeholders}) ORDER BY id ASC`
		).all(...Array.from(nonNullParentIds)) as { id: number; parent_id: number | null }[];
		for (const r of rows) {
			const key = r.parent_id ?? null;
			const arr = siblingsByParent.get(key);
			if (arr) arr.push(r.id);
			else siblingsByParent.set(key, [r.id]);
		}
	}

	if (hasRootMessages) {
		// Root-level messages are keyed by null; filter to this chat so we
		// don't accidentally pick up roots from other chats.
		const roots = stmtRoots.all(chatId) as { id: number; parent_id: number | null }[];
		siblingsByParent.set(null, roots.map((r) => r.id));
	}

	return siblingsByParent;
}

/**
 * IDs of all messages with the same parent as `messageId`, in id order.
 * For root messages (parentId = null), returns all root messages in the chat.
 * Uses idx_messages_parent — O(siblings) not O(chat size).
 */
export function findSiblingIds(parentId: number | null, chatId: number): number[] {
	if (parentId === null) {
		return (stmtRootIds.all(chatId) as { id: number }[]).map(r => r.id);
	}
	return (stmtSiblingIds.all(parentId) as { id: number }[]).map(r => r.id);
}

/**
 * Walk from startId to its deepest descendant, always following the
 * first child by created_at. Uses idx_messages_parent — O(depth) reads.
 */
export function walkToDeepestLeaf(startId: number): number {
	let current = startId;
	for (let depth = 0; depth < 10_000; depth++) {
		const child = stmtFirstChild.get(current) as { id: number } | undefined;
		if (!child) break;
		current = child.id;
	}
	return current;
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
