/**
 * Background "everything" export jobs. One file per user, stored at
 * data/exports/export_<userId>.zip. Triggering a new job deletes any
 * previous file immediately so the user can't download a stale one
 * while the new one is building.
 */
import { join } from 'path';
import { existsSync, unlinkSync, mkdirSync, writeFileSync } from 'fs';
import { buildEverythingBundle, type BundleOptions } from './bundle.js';
import { broadcast } from './realtime.js';
import { logger } from './logger.js';

const EXPORT_DIR = join(process.cwd(), 'data', 'exports');

export function exportFilePath(userId: number): string {
	return join(EXPORT_DIR, `export_${userId}.zip`);
}

export function exportFileExists(userId: number): boolean {
	return existsSync(exportFilePath(userId));
}

export function deleteExportFile(userId: number): void {
	const p = exportFilePath(userId);
	if (existsSync(p)) {
		try { unlinkSync(p); } catch { /* ignore */ }
	}
}

// In-progress job tracking — prevents duplicate concurrent runs.
const running = new Set<number>();

export function isExportRunning(userId: number): boolean {
	return running.has(userId);
}

/** Start a background export job for the user. Returns false if one is already running. */
export function startExportJob(userId: number, opts: BundleOptions): boolean {
	if (running.has(userId)) return false;
	running.add(userId);

	// Delete the previous file now so the download button disappears while
	// the new one is building — no stale downloads.
	deleteExportFile(userId);
	mkdirSync(EXPORT_DIR, { recursive: true });

	void (async () => {
		try {
			const result = await buildEverythingBundle(userId, opts);
			writeFileSync(exportFilePath(userId), result.buffer);
			logger.info('background export complete', { userId });
			broadcast(userId, { type: 'export:ready' });
		} catch (err) {
			logger.error('background export failed', { userId, err: String(err) });
			broadcast(userId, { type: 'export:failed' });
		} finally {
			running.delete(userId);
		}
	})();

	return true;
}
