/**
 * Web Push notification sender.
 * VAPID keys must be supplied via env. We deliberately do NOT persist them
 * to the DB anymore — a DB backup leak would otherwise let an attacker
 * forge push notifications for every subscribed device.
 * Run `npx web-push generate-vapid-keys` once and set the env vars.
 */
import webpush from 'web-push';
import { db } from '$lib/db/index.js';
import { pushSubscriptions } from '$lib/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { logger } from '$lib/server/logger.js';

let vapidPublicKey: string | null = null;
let vapidInitialized = false;
let warnedMissing = false;

/** Ensure VAPID keys exist (env only). Returns the public key or null. */
function initVapid(): string | null {
	if (vapidInitialized) return vapidPublicKey;
	vapidInitialized = true;

	const publicKey = process.env.VAPID_PUBLIC_KEY || '';
	const privateKey = process.env.VAPID_PRIVATE_KEY || '';

	if (!publicKey || !privateKey) {
		if (!warnedMissing) {
			logger.warn(
				'Web push disabled: VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY env vars are not set. ' +
				'Generate a pair with `npx web-push generate-vapid-keys` and add them to your environment.'
			);
			warnedMissing = true;
		}
		vapidPublicKey = null;
		return null;
	}

	// Apple APNs requires a valid mailto: or https: subject — 'localhost' is rejected.
	const subject = process.env.VAPID_SUBJECT
		|| (process.env.ORIGIN ? process.env.ORIGIN : 'https://github.com/nathanakalish/skald');

	webpush.setVapidDetails(subject, publicKey, privateKey);
	vapidPublicKey = publicKey;
	return publicKey;
}

/** Get the VAPID public key for client subscription, or null if push is disabled. */
export function getVapidPublicKey(): string | null {
	return initVapid();
}

/** Send a push notification to every subscribed device for a user. */
export async function sendPushNotification(
	userId: number,
	payload: { title: string; body: string; icon?: string; data?: Record<string, unknown> }
): Promise<void> {
	// Make sure VAPID is initialised. Skip silently if push isn't configured.
	if (!initVapid()) return;

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
	try { endpointHost = new URL(subscription.endpoint).host; } catch (err) { logger.debug('push: endpoint URL parse failed', { err: String(err) }); }
	logger.info('push subscription saved', { userId, endpointHost });
}

/** Remove a push subscription. */
export function removeSubscription(userId: number, endpoint: string): void {
	const result = db.delete(pushSubscriptions)
		.where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)))
		.run();
	if (result.changes > 0) {
		let endpointHost = '';
		try { endpointHost = new URL(endpoint).host; } catch (err) { logger.debug('push: endpoint URL parse failed', { err: String(err) }); }
		logger.info('push subscription removed', { userId, endpointHost });
	}
}
