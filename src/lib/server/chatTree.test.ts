import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';

// Cycle guard for chatTree's PATH_SQL recursive CTE. We can't import the
// real prepared statement here (it binds to the app DB), so we re-run the
// exact same SQL shape against an in-memory database with a hand-crafted
// cycle and confirm the depth cap stops the walk.

const PATH_SQL_CAPPED = `
WITH RECURSIVE path(id, parent_id, depth) AS (
	SELECT id, parent_id, 0 FROM messages WHERE id = ?
	UNION ALL
	SELECT m.id, m.parent_id, p.depth + 1
	FROM messages m
	JOIN path p ON m.id = p.parent_id
	WHERE p.depth < ?
)
SELECT m.id, p.depth FROM messages m
JOIN path p ON p.id = m.id
ORDER BY p.depth DESC
`;

function makeDb() {
	const db = new Database(':memory:');
	db.exec(`
		CREATE TABLE messages (
			id INTEGER PRIMARY KEY,
			parent_id INTEGER
		);
	`);
	return db;
}

describe('chatTree cycle guard (DB-M5)', () => {
	it('terminates on a 2-node cycle without OOMing', () => {
		const db = makeDb();
		// 1 -> 2 -> 1 -> 2 -> ... infinite loop without the cap.
		db.exec(`INSERT INTO messages (id, parent_id) VALUES (1, 2), (2, 1);`);
		const rows = db.prepare(PATH_SQL_CAPPED).all(2, 100) as Array<{ id: number; depth: number }>;
		expect(rows.length).toBe(101); // capped at depth 100 → 101 rows (0..100 inclusive)
		const maxDepth = Math.max(...rows.map((r) => r.depth));
		expect(maxDepth).toBe(100);
		db.close();
	});

	it('terminates on a self-loop', () => {
		const db = makeDb();
		db.exec(`INSERT INTO messages (id, parent_id) VALUES (1, 1);`);
		const rows = db.prepare(PATH_SQL_CAPPED).all(1, 50) as Array<{ id: number; depth: number }>;
		expect(rows.length).toBe(51);
		db.close();
	});

	it('walks a normal acyclic chain to the root', () => {
		const db = makeDb();
		// 1 (root) -> 2 -> 3 -> 4 (leaf)
		db.exec(`INSERT INTO messages (id, parent_id) VALUES (1, NULL), (2, 1), (3, 2), (4, 3);`);
		const rows = db.prepare(PATH_SQL_CAPPED).all(4, 100000) as Array<{ id: number; depth: number }>;
		// chronological: root first
		expect(rows.map((r) => r.id)).toEqual([1, 2, 3, 4]);
		db.close();
	});
});
