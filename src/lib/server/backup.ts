/**
 * Periodic SQLite backups via better-sqlite3's native backup() API. Online and
 * crash-consistent — the database keeps accepting writes during the copy.
 *
 * Configuration (env vars):
 *   BACKUP_ENABLED        — "true" to turn it on (default: off)
 *   BACKUP_INTERVAL_HOURS — interval in hours (default: 24)
 *   BACKUP_RETENTION      — how many backups to keep (default: 7)
 *   BACKUP_DIR            — output directory (default: data/backups)
 */
import { join } from 'path';
import { mkdirSync, readdirSync, statSync, unlinkSync, renameSync, existsSync, statfsSync } from 'fs';
import Database from 'better-sqlite3';
import { rawDb } from '$lib/db/index.js';
import { logger } from '$lib/server/logger.js';

const DEFAULT_DIR = join(process.cwd(), 'data', 'backups');

function getConfig() {
	return {
		enabled: (process.env.BACKUP_ENABLED || '').toLowerCase() === 'true',
		intervalHours: Math.max(1, Number(process.env.BACKUP_INTERVAL_HOURS) || 24),
		retention: Math.max(1, Number(process.env.BACKUP_RETENTION) || 7),
		dir: process.env.BACKUP_DIR || DEFAULT_DIR,
	};
}

/** Run a single backup right now. Returns the resulting filename or null on failure. */
export async function runBackup(): Promise<string | null> {
	const { dir, retention } = getConfig();
	try {
		mkdirSync(dir, { recursive: true });
		const stamp = new Date().toISOString().replace(/[:.]/g, '-');
		const filename = `skald-${stamp}.db`;
		const target = join(dir, filename);
		const tmpTarget = `${target}.tmp`;

		// Best-effort disk-space check: refuse to start a copy that obviously
		// won't fit. A truncated backup looks valid but is useless on restore.
		try {
			const srcSize = statSync(rawDb.name).size;
			const stats = statfsSync(dir);
			const free = Number(stats.bavail) * Number(stats.bsize);
			// Need at least source size + 10% slack for WAL pages mid-flight.
			if (free > 0 && free < srcSize * 1.1) {
				logger.error('db backup aborted: insufficient disk space', { free, needed: srcSize });
				return null;
			}
		} catch (err) {
			logger.debug('db backup disk-space check skipped', { err: String(err) });
		}

		// Write to a .tmp sibling, integrity-check, then atomic rename. A
		// crash mid-copy leaves a .tmp orphan that the prune step ignores.
		if (existsSync(tmpTarget)) {
			try { unlinkSync(tmpTarget); } catch { /* ignore */ }
		}
		await rawDb.backup(tmpTarget);

		// PRAGMA integrity_check on the freshly written file. If it doesn't
		// return "ok", the backup is corrupt and we drop it rather than
		// shipping a broken file the user might later trust.
		try {
			const check = new Database(tmpTarget, { readonly: true, fileMustExist: true });
			let result: string;
			try {
				const row = check.pragma('integrity_check', { simple: true }) as string;
				result = String(row);
			} finally {
				check.close();
			}
			if (result !== 'ok') {
				logger.error('db backup failed integrity_check', { target: tmpTarget, result });
				try { unlinkSync(tmpTarget); } catch { /* ignore */ }
				return null;
			}
		} catch (err) {
			logger.error('db backup integrity_check threw', { err: String(err) });
			try { unlinkSync(tmpTarget); } catch { /* ignore */ }
			return null;
		}

		renameSync(tmpTarget, target);
		logger.info('db backup complete', { target });

		// Retention pruning — anything beyond the keep limit is toast.
		const files = readdirSync(dir)
			.filter((f) => f.startsWith('skald-') && f.endsWith('.db'))
			.map((f) => ({ name: f, mtime: statSync(join(dir, f)).mtimeMs }))
			.sort((a, b) => b.mtime - a.mtime);
		const stale = files.slice(retention);
		for (const f of stale) {
			try {
				unlinkSync(join(dir, f.name));
				logger.info('db backup pruned', { file: f.name });
			} catch (err) {
				logger.warn('db backup prune failed', { file: f.name, err });
			}
		}

		// Also clean up any stray .tmp files from previous crashes.
		for (const name of readdirSync(dir)) {
			if (name.startsWith('skald-') && name.endsWith('.db.tmp')) {
				try { unlinkSync(join(dir, name)); } catch { /* ignore */ }
			}
		}

		return filename;
	} catch (err) {
		logger.error('db backup failed', { err });
		return null;
	}
}

let started = false;

/** Start the periodic backup loop (idempotent). No-op unless BACKUP_ENABLED is "true". */
export function startBackupSchedule() {
	if (started) return;
	const cfg = getConfig();
	if (!cfg.enabled) return;
	started = true;
	logger.info('db backup schedule started', {
		intervalHours: cfg.intervalHours,
		retention: cfg.retention,
		dir: cfg.dir,
	});
	// One quick run shortly after startup, then on the configured cadence.
	setTimeout(() => { void runBackup(); }, 30_000).unref();
	setInterval(() => { void runBackup(); }, cfg.intervalHours * 60 * 60 * 1000).unref();
}
