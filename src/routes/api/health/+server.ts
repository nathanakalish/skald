import type { RequestHandler } from './$types.js';
import { rawDb } from '$lib/db/index.js';
import { logger } from '$lib/server/logger.js';

/**
 * Liveness/readiness probe. Returns 200 with { status, db } when the database
 * is reachable; 503 otherwise. Bypasses auth (allowed by hooks.server.ts).
 */
export const GET: RequestHandler = async () => {
	let dbOk = false;
	try {
		const row = rawDb.prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;
		dbOk = row?.ok === 1;
	} catch (err) {
		dbOk = false;
		logger.error('health: db probe failed', { err });
	}

	if (!dbOk) {
		logger.error('health: degraded', { db: 'error' });
	}

	const body = JSON.stringify({
		status: dbOk ? 'ok' : 'degraded',
		db: dbOk ? 'ok' : 'error',
		uptime: Math.round(process.uptime()),
		version: process.env.npm_package_version,
	});

	return new Response(body, {
		status: dbOk ? 200 : 503,
		headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
	});
};
