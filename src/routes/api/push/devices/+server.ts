import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { pushSubscriptions } from '$lib/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth.js';
import { ApiError } from '$lib/server/apiError.js';

/**
 * Notification devices = the push_subscriptions table, the literal source of
 * truth for "where notifications get sent". One row per browser/device. The
 * endpoint is the unique device identifier; we expose only its tail as a
 * fingerprint so the user can tell rows apart without leaking a token that
 * could be used to forge a subscription.
 */

interface DeviceRow {
	id: number;
	fingerprint: string;
	endpoint: string;
	userAgent: string | null;
	sessionId: string | null;
	createdAt: string | null;
}

export const GET: RequestHandler = async (event) => {
	const user = requireUser(event);
	const rows = db
		.select({
			id: pushSubscriptions.id,
			endpoint: pushSubscriptions.endpoint,
			userAgent: pushSubscriptions.userAgent,
			sessionId: pushSubscriptions.sessionId,
			createdAt: pushSubscriptions.createdAt
		})
		.from(pushSubscriptions)
		.where(eq(pushSubscriptions.userId, user.id))
		.all();

	const devices: DeviceRow[] = rows.map((r) => ({
		id: r.id,
		fingerprint: r.endpoint.slice(-12),
		endpoint: r.endpoint,
		userAgent: r.userAgent,
		sessionId: r.sessionId,
		createdAt: r.createdAt
	}));

	return json({ devices });
};

/** DELETE /api/push/devices?endpoint=... — drop a single push subscription row. */
export const DELETE: RequestHandler = async (event) => {
	const user = requireUser(event);
	const endpoint = event.url.searchParams.get('endpoint');
	if (!endpoint) return ApiError.badRequest('Missing endpoint');

	db.delete(pushSubscriptions)
		.where(and(eq(pushSubscriptions.userId, user.id), eq(pushSubscriptions.endpoint, endpoint)))
		.run();
	event.locals.logger?.info('push: device removed', {
		endpointHost: (() => { try { return new URL(endpoint).host; } catch { return null; } })(),
	});
	return json({ ok: true });
};
