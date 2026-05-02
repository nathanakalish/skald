import { browser } from '$app/environment';
import { urlBase64ToUint8Array } from '$lib/utils.js';

const DISMISS_KEY = 'skald-notif-dismissed';

/**
 * Owns the browser-notification permission flow:
 *   - reads `Notification.permission` (or 'unsupported' on platforms without the API)
 *   - persists the "don't bug me" dismissal flag
 *   - on `enable()`, requests permission and (on grant) subscribes to web push
 *     using the server-supplied VAPID key
 *
 * Lives outside the SSE / in-app-toast machinery — that stays inline because
 * it's tangled up with the realtime stream handler.
 */
export function createNotificationPermission() {
	let permission = $state<NotificationPermission | 'unsupported'>('unsupported');
	let bannerDismissed = $state(false);
	let secureContext = $state(true);
	let status = $state(''); // user-facing feedback after enable()
	// Whether the browser currently has a live Web Push subscription on this
	// device. Drives the banner instead of `permission` alone, so the prompt
	// reappears after "Disable notifications" or after a fresh sign-in even
	// when the OS permission is still 'granted'.
	let pushSubscribed = $state(false);
	// Flips true once we've checked the current subscription state at least
	// once. Stops a first-paint banner flash before the async probe resolves
	// on already-subscribed devices.
	let pushSubscriptionReady = $state(false);

	if (browser) {
		// Web Push / Notification API only run in a secure context (HTTPS or
		// localhost). Treat insecure pages as "unsupported" so the banner stays
		// hidden and the settings explainer takes over.
		secureContext = typeof window.isSecureContext === 'boolean' ? window.isSecureContext : true;
		if ('Notification' in window) {
			permission = Notification.permission;
		}
		bannerDismissed = localStorage.getItem(DISMISS_KEY) === '1';
		// Ask the SW for an existing subscription so the banner stays hidden
		// when push really is active here.
		void refreshPushSubscribed();
	}

	async function refreshPushSubscribed(): Promise<boolean> {
		if (!browser) return false;
		pushSubscriptionReady = false;
		try {
			if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
				pushSubscribed = false;
				pushSubscriptionReady = true;
				return false;
			}
			const reg = await navigator.serviceWorker.ready;
			const sub = await reg.pushManager.getSubscription();
			if (!sub) {
				pushSubscribed = false;
				pushSubscriptionReady = true;
				return false;
			}
			// Server is the source of truth: this reflects whether the server will
			// actually send notifications to this device. We POST the subscription
			// endpoint so the server can self-heal the session_id link if it's
			// stale or NULL — otherwise the per-session "Push on" badge in
			// Settings → Account would lie about active devices whose push row
			// was registered before this session.
			const subJson = sub.toJSON();
			const statusRes = await fetch('/api/push/status', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				cache: 'no-store',
				body: JSON.stringify({ endpoint: subJson.endpoint })
			});
			if (statusRes.ok) {
				const body = await statusRes.json().catch(() => ({}));
				pushSubscribed = body?.subscribed === true;
			} else {
				// Status endpoint blipped — assume subscribed and let the next probe correct us.
				pushSubscribed = true;
			}
			pushSubscriptionReady = true;
			return pushSubscribed;
		} catch {
			pushSubscribed = false;
			pushSubscriptionReady = true;
			return false;
		}
	}

	function resetBannerDismissal() {
		bannerDismissed = false;
		if (browser) {
			try { localStorage.removeItem(DISMISS_KEY); } catch { /* ignore */ }
		}
	}

	function enable() {
		// requestPermission() MUST be the very first call — no awaits before it.
		// Any async gap and iOS drops the user-gesture chain.
		Notification.requestPermission()
			.then(async (result) => {
				permission = result;
				if (result === 'granted') {
					status = '';
					bannerDismissed = true;
					if ('PushManager' in globalThis && navigator.serviceWorker) {
						try {
							const keyRes = await fetch('/api/push/vapid-key');
							const { key } = await keyRes.json();
							if (key) {
								const reg = await navigator.serviceWorker.ready;
								const sub = await reg.pushManager.subscribe({
									userVisibleOnly: true,
									applicationServerKey: urlBase64ToUint8Array(key)
								});
								const subJson = sub.toJSON();
								await fetch('/api/push/subscribe', {
									method: 'POST',
									headers: { 'Content-Type': 'application/json' },
									body: JSON.stringify({ endpoint: subJson.endpoint, keys: subJson.keys })
								});
								await refreshPushSubscribed();
							}
						} catch {
							// Push subscribe blew up — user still gets local notifications.
						}
					}
				} else {
					status = `Permission returned "${result}". On iOS, go to Settings → Notifications → Skald and enable Allow Notifications, then try again.`;
				}
			})
			.catch((err) => {
				status = `Error: ${err instanceof Error ? err.message : String(err)}`;
			});
	}

	function dismissBanner() {
		bannerDismissed = true;
		if (browser) localStorage.setItem(DISMISS_KEY, '1');
	}

	return {
		get permission() {
			return permission;
		},
		get bannerDismissed() {
			return bannerDismissed;
		},
		get status() {
			return status;
		},
		get secureContext() {
			return secureContext;
		},
		get pushSubscribed() {
			return pushSubscribed;
		},
		get pushSubscriptionReady() {
			return pushSubscriptionReady;
		},
		enable,
		dismissBanner,
		resetBannerDismissal,
		refreshPushSubscribed
	};
}
