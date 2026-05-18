import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { logger } from '$lib/server/logger.js';
import { runBaselineMigrations } from './baselineMigrations.js';
import { runMigrations } from './migrate.js';

const DATA_DIR = join(process.cwd(), 'data');
mkdirSync(DATA_DIR, { recursive: true });

const sqlite = new Database(join(DATA_DIR, 'skald.db'));
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
// WAL + NORMAL synchronous = big write speedup, no real durability cost.
sqlite.pragma('synchronous = NORMAL');
// Wait up to 5s on lock contention instead of immediately throwing SQLITE_BUSY.
sqlite.pragma('busy_timeout = 5000');
// 64 MiB page cache (negative = KiB).
sqlite.pragma('cache_size = -64000');
// Keep temporary tables/indexes in memory instead of spilling to disk.
sqlite.pragma('temp_store = MEMORY');
// Memory-map the first 256 MiB so hot reads skip the syscall path.
sqlite.pragma('mmap_size = 268435456');

logger.info('db: connection opened', {
	path: join(DATA_DIR, 'skald.db'),
	journalMode: 'WAL',
});

// Slow-query log. Wraps better-sqlite3's prepare()/exec() so anything taking
// longer than SLOW_QUERY_MS lands in the JSON log with the SQL and a sample
// of the bound params. Threshold is configurable via env (default 50ms).
//
// Why monkey-patch the underlying connection rather than wrap drizzle: every
// drizzle query funnels through `prepare(sql).<run|get|all>(params)` on the
// raw connection, plus a few one-shot `exec()` calls. Patching here catches
// every code path — drizzle queries, raw SQL, and migrations — without
// touching call sites.
const SLOW_QUERY_MS = Number(process.env.SLOW_QUERY_MS ?? '50');
function instrumentForSlowLog(db: Database.Database) {
	const origPrepare = db.prepare.bind(db);
	(db as any).prepare = (sql: string) => {
		const stmt = origPrepare(sql);
		const compactSql = sql.replace(/\s+/g, ' ').trim();
		for (const method of ['run', 'get', 'all', 'iterate'] as const) {
			const orig = (stmt as any)[method].bind(stmt);
			(stmt as any)[method] = (...args: unknown[]) => {
				const t0 = performance.now();
				let result: unknown;
				try {
					result = orig(...args);
				} catch (err) {
					logger.error('db query failed', {
						method,
						sql: compactSql.slice(0, 300),
						paramCount: args.length,
						err,
					});
					throw err;
				}
				const dt = performance.now() - t0;
				if (dt > SLOW_QUERY_MS) {
					logger.warn('slow query', {
						ms: Math.round(dt),
						method,
						sql: compactSql.slice(0, 300),
						paramCount: args.length,
					});
				}
				return result;
			};
		}
		return stmt;
	};

	const origExec = db.exec.bind(db);
	(db as any).exec = (sql: string) => {
		const t0 = performance.now();
		let result: unknown;
		try {
			result = origExec(sql);
		} catch (err) {
			logger.error('db exec failed', { sql: sql.slice(0, 300), err });
			throw err;
		}
		const dt = performance.now() - t0;
		if (dt > SLOW_QUERY_MS) {
			logger.warn('slow query (exec)', { ms: Math.round(dt), sql: sql.slice(0, 300) });
		}
		return result;
	};
}
instrumentForSlowLog(sqlite);

export const db = drizzle(sqlite, { schema });

/** Direct access to the underlying better-sqlite3 connection (needed for native backup). */
export const rawDb = sqlite;

// Idempotent baseline DDL (predates drizzle migrations) — seeds an empty DB
// and brings older DBs up to current schema.
runBaselineMigrations(sqlite);

// Graceful shutdown — close the DB connection.
function shutdown() {
	try {
		sqlite.close();
		logger.info('db: connection closed');
	} catch {}
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', shutdown);

// Apply any pending migrations from drizzle/migrations/ — runs after the
// imperative baseline DDL above. Fatal on failure (better than silent drift).
runMigrations(sqlite);

// Periodic incremental VACUUM. Dead pages accumulate as rows churn (message
// edits, chat deletes, regenerations). Without this the file grows without
// shrinking. PRAGMA incremental_vacuum is non-blocking-ish (does small chunks
// of work) compared to plain VACUUM which rewrites the entire DB. Cheap when
// the freelist is empty, so running daily is fine — and Node's setInterval
// can't take a value > 2^31-1 ms (~24.8 days), so a literal "monthly"
// interval silently clamps to 1ms and fires constantly.
sqlite.pragma('auto_vacuum = INCREMENTAL');
const VACUUM_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily
const vacuumTimer = setInterval(() => {
	try {
		const t0 = performance.now();
		sqlite.pragma('incremental_vacuum');
		logger.info('db: incremental vacuum done', { ms: Math.round(performance.now() - t0) });
	} catch (err) {
		logger.warn('db: incremental vacuum failed', { err: String(err) });
	}
}, VACUUM_INTERVAL_MS);
// Don't block process exit on the vacuum timer.
vacuumTimer.unref?.();
