/**
 * Lightweight migration runner.
 *
 * Reads `.sql` files from `drizzle/migrations/` in lexicographic order and
 * applies any that haven't been applied yet (tracked in the `_migrations` table).
 *
 * Each migration runs in its own transaction. Failure is fatal — better to fail
 * to start than to silently run on a half-migrated schema.
 */
import type Database from 'better-sqlite3';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { logger } from '$lib/server/logger.js';

const MIGRATIONS_DIR = join(process.cwd(), 'drizzle', 'migrations');

export function runMigrations(sqlite: Database.Database): void {
	sqlite.exec(`
		CREATE TABLE IF NOT EXISTS _migrations (
			filename TEXT PRIMARY KEY,
			applied_at TEXT NOT NULL DEFAULT (datetime('now'))
		)
	`);

	if (!existsSync(MIGRATIONS_DIR)) {
		return;
	}

	const files = readdirSync(MIGRATIONS_DIR)
		.filter((f) => f.endsWith('.sql'))
		.sort();

	if (files.length === 0) return;

	const applied = new Set(
		(sqlite.prepare('SELECT filename FROM _migrations').all() as { filename: string }[])
			.map((r) => r.filename)
	);

	for (const filename of files) {
		if (applied.has(filename)) continue;

		const filepath = join(MIGRATIONS_DIR, filename);
		const sql = readFileSync(filepath, 'utf-8');

		try {
			const tx = sqlite.transaction(() => {
				sqlite.exec(sql);
				sqlite.prepare('INSERT INTO _migrations (filename) VALUES (?)').run(filename);
			});
			tx();
			logger.info('migration applied', { filename });
		} catch (err) {
			logger.error('migration failed', { filename, err });
			throw new Error(`Migration ${filename} failed: ${(err as Error).message}`);
		}
	}
}
