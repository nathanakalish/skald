/**
 * Web Push notification sender.
 * Auto-generates VAPID keys on first boot (stashed in admin_settings).
 * Sends push notifications to every subscribed device for a user.
 */
import webpush from 'web-push';
import { db } from '$lib/db/index.js';
import { pushSubscriptions, adminSettings } from '$lib/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { logger } from '$lib/server/logger.js';

/** Ensure VAPID keys exist (env override or auto-generated and persisted). */
function initVapid() {
	let publicKey = process.env.VAPID_PUBLIC_KEY || '';
	let privateKey = process.env.VAPID_PRIVATE_KEY || '';

	if (!publicKey || !privateKey) {
		// Try the DB.
		const pubRow = db.select().from(adminSettings).where(eq(adminSettings.key, 'vapidPublicKey')).get();
		const privRow = db.select().from(adminSettings).where(eq(adminSettings.key, 'vapidPrivateKey')).get();

		if (pubRow && privRow) {
			publicKey = pubRow.value;
			privateKey = privRow.value;
		} else {
			// Generate fresh keys and persist them.
			const keys = webpush.generateVAPIDKeys();
			publicKey = keys.publicKey;
			privateKey = keys.privateKey;

			db.insert(adminSettings)
				.values({ key: 'vapidPublicKey', value: publicKey })
				.onConflictDoUpdate({ target: adminSettings.key, set: { value: publicKey } })
				.run();
			db.insert(adminSettings)
				.values({ key: 'vapidPrivateKey', value: privateKey })
				.onConflictDoUpdate({ target: adminSettings.key, set: { value: privateKey } })
				.run();

			logger.info('Generated new VAPID keys for web push');
		}
	}

	// Apple APNs requires a valid mailto: or https: subject — 'localhost' is rejected.
	const subject = process.env.VAPID_SUBJECT
		|| (process.env.ORIGIN ? process.env.ORIGIN : 'https://github.com/nathanakalish/skald');

	webpush.setVapidDetails(
		subject,
		publicKey,
		privateKey
	);

	return publicKey;
}

let vapidPublicKey: string | null = null;

/** Get the VAPID public key (for client subscription). */
export function getVapidPublicKey(): string {
	if (!vapidPublicKey) vapidPublicKey = initVapid();
	return vapidPublicKey;
}

/** Send a push notification to every subscribed device for a user. */
export async function sendPushNotification(
	userId: number,
	payload: { title: string; body: string; icon?: string; data?: Record<string, unknown> }
): Promise<void> {
	// Make sure VAPID is initialised.
	getVapidPublicKey();

	const subs = db.select().from(pushSubscriptions)
		.where(eq(pushSubscriptions.userId, userId))
		.all();

	if (subs.length === 0) {
		logger.debug('No push subscriptions for user', { userId });
		return;
	}

	logger.debug('Sending push to subscriptions', { userId, count: subs.length });

	const MAX_PUSH_PAYLOAD = 3500; // browsers reject ~4 KiB; leave headroom
	let jsonPayload = JSON.stringify(payload);
	if (jsonPayload.length > MAX_PUSH_PAYLOAD) {
		// Truncate the body field (the only realistic offender) so the
		// notification still gets delivered instead of being silently dropped
		// by the browser's push service.
		const overhead = jsonPayload.length - payload.body.length;
		const room = Math.max(64, MAX_PUSH_PAYLOAD - overhead - 4);
		const truncated = { ...payload, body: payload.body.slice(0, room) + '\u2026' };
		jsonPayload = JSON.stringify(truncated);
		logger.warn('push payload truncated', { userId, originalLen: payload.body.length, newLen: truncated.body.length });
	}

	const results = await Promise.allSettled(
		subs.map(sub =>
			webpush.sendNotification(
				{
					endpoint: sub.endpoint,
					keys: { p256dh: sub.keysP256dh, auth: sub.keysAuth }
				},
				jsonPayload,
				{ TTL: 86400, urgency: 'high' }
			)
		)
	);

	// Clean up expired/invalid subscriptions.
	for (let i = 0; i < results.length; i++) {
		const result = results[i];
		if (result.status === 'fulfilled') {
			logger.debug('Push sent successfully', { endpoint: subs[i].endpoint, statusCode: result.value.statusCode });
		} else {
			const status = (result.reason as any)?.statusCode;
			// 404 or 410 → subscription expired or unsubscribed.
			if (status === 404 || status === 410) {
				db.delete(pushSubscriptions)
					.where(eq(pushSubscriptions.id, subs[i].id))
					.run();
				logger.info('Removed expired push subscription', { endpoint: subs[i].endpoint, status });
			} else {
				logger.warn('Push notification failed', {
					endpoint: subs[i].endpoint,
					status,
					error: result.reason?.message,
					body: (result.reason as any)?.body
				});
			}
		}
	}
}

/** Save a push subscription for a user. */
export function saveSubscription(
	userId: number,
	subscription: { endpoint: string; keys: { p256dh: string; auth: string }; sessionId?: string | null; userAgent?: string | null }
): void {
	db.insert(pushSubscriptions)
		.values({
			userId,
			sessionId: subscription.sessionId ?? null,
			endpoint: subscription.endpoint,
			keysP256dh: subscription.keys.p256dh,
			keysAuth: subscription.keys.auth,
			userAgent: subscription.userAgent ?? null
		})
		.onConflictDoUpdate({
			target: [pushSubscriptions.userId, pushSubscriptions.endpoint],
			set: {
				keysP256dh: subscription.keys.p256dh,
				keysAuth: subscription.keys.auth,
				...(subscription.sessionId ? { sessionId: subscription.sessionId } : {}),
				...(subscription.userAgent ? { userAgent: subscription.userAgent } : {})
			}
		})
		.run();
	let endpointHost = '';
	try { endpointHost = new URL(subscription.endpoint).host; } catch { /* ignore */ }
	logger.info('push subscription saved', { userId, endpointHost });
}

/** Remove a push subscription. */
export function removeSubscription(userId: number, endpoint: string): void {
	const result = db.delete(pushSubscriptions)
		.where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)))
		.run();
	if (result.changes > 0) {
		let endpointHost = '';
		try { endpointHost = new URL(endpoint).host; } catch { /* ignore */ }
		logger.info('push subscription removed', { userId, endpointHost });
	}
}
