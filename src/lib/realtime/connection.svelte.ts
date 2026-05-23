import { browser } from '$app/environment';
import { toasts } from '$lib/stores/toast.svelte.js';

/**
 * Long-lived realtime layer:
 *   - SSE to `/api/events` with jittered backoff + a hard give-up window;
 *   - exposes a tight 4-state machine
 *     ('connecting' | 'connected' | 'reconnecting' | 'failed')
 *     plus `manualReconnect()` for the disconnect overlay;
 *   - revalidates the build version on connect / visibility / pageshow / online
 *     and reloads when the server's shipped a new bundle;
 *   - heartbeats presence to `/api/presence` and syncs the user's timezone;
 *   - forwards service-worker `open-chat` messages.
 *
 * Design notes (after several iterations of overlay flicker):
 *   - The overlay's visibility is driven PURELY by `connectionState`. There
 *     are no "show after N seconds" grace timers — every previous attempt at
 *     that introduced flicker (visibility handler re-arming the timer, etc).
 *   - The state machine moves to `reconnecting` on the FIRST SSE error after
 *     any non-error state, and only moves back to `connected` when the
 *     server's `connected` sentinel actually arrives. EventSource.onopen is
 *     ignored entirely because some reverse-proxy setups fire it for
 *     buffered/cached responses that never deliver real data.
 *   - Stale-EventSource guards on every handler so a queued event from a
 *     torn-down stream can't flip the state of a brand-new attempt.
 */

declare const __APP_VERSION__: string;

// Module-scoped so concurrent effect runs / multiple callers in the same tab
// can't each trigger their own reload toast. Once we've decided to reload for
// a given server version, every other call short-circuits.
let reloadingForUpdate = false;
let versionCheckInFlight = false;

// Hard cap: only ever reload ONCE per loaded shell, per server version. If a
// stuck service worker keeps handing back the old bundle after the reload, we'd
// otherwise loop forever (toast → reload → still stale → toast).
const RELOAD_MARKER_KEY = 'skald:reloadedForVersion';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'failed';

interface CreateRealtimeConnectionOptions {
	/** Usually `() => !!data.user` — when false, no SSE / presence calls fire. */
	getEnabled: () => boolean;
	sessionId: string;
	getActiveChatId: () => number | null;
	/** Fires once per parsed SSE event. */
	onEvent: (event: any) => void;
	/** Fires when the service worker sends an `open-chat` message. */
	onSwOpenChat: (chatId: number) => void;
	/** User's stored timezone — if it doesn't match `Intl`, we PATCH /api/settings. */
	getInitialUserTimezone?: () => string | null | undefined;
}

export function createRealtimeConnection({
	getEnabled,
	sessionId,
	getActiveChatId,
	onEvent,
	onSwOpenChat,
	getInitialUserTimezone
}: CreateRealtimeConnectionOptions) {
	// connecting   → initial state, no error yet. Overlay HIDDEN. Lives only
	//                for the brief handshake window — `onerror` or the
	//                `connected` sentinel moves us out of it.
	// connected    → server's `connected` sentinel received. Overlay HIDDEN.
	// reconnecting → SSE has errored since the last success (or ever, on a
	//                cold load with the server down). Overlay SHOWN.
	// failed       → exhausted the give-up window. Overlay SHOWN with
	//                stronger copy.
	let connectionState = $state<ConnectionState>('connecting');
	let manualReconnectFn: (() => void) | null = null;

	// Wrapper so every mutation of the state shows up in a single place when
	// debugging overlay flicker. The trace prefix makes it grep-friendly.
	function setState(next: ConnectionState, reason: string) {
		if (connectionState === next) return;
		// eslint-disable-next-line no-console
		console.debug(`[realtime] ${connectionState} → ${next} (${reason})`);
		connectionState = next;
	}

	function reportPresence(payload: { activeChatId?: number | null; focused?: boolean }) {
		// Skip when logged out — the 401 surfaces as a scary "access control"
		// error in Safari's console and there's nothing useful to report anyway.
		if (!getEnabled()) return;
		fetch('/api/presence', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ sessionId, ...payload })
		}).catch(() => { /* best-effort */ });
	}

	$effect(() => {
		if (!browser) return;
		if (!getEnabled()) return;

		let eventSource: EventSource | null = null;
		let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
		let giveUpTimer: ReturnType<typeof setTimeout> | null = null;
		// Source of truth for "have we had a real, server-confirmed stream this
		// session yet". Only flipped inside the `connected` sentinel handler.
		let everConnected = false;
		let failedAttempts = 0;

		// Exponential backoff with full jitter (AWS-style) so N tabs reconnecting
		// after a server bounce don't thunder. 2s base, capped at 30s, with the
		// exponent clamped so we don't compute huge intermediate numbers.
		const RECONNECT_BASE_MS = 2000;
		const RECONNECT_CAP_MS = 30_000;
		const GIVE_UP_AFTER_MS = 3 * 60 * 1000;

		function jitteredBackoff(): number {
			const exp = Math.min(RECONNECT_CAP_MS, RECONNECT_BASE_MS * 2 ** Math.min(failedAttempts, 6));
			return Math.floor(Math.random() * exp);
		}

		function clearReconnectTimers() {
			if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
			if (giveUpTimer) { clearTimeout(giveUpTimer); giveUpTimer = null; }
		}

		function armGiveUpTimer() {
			if (giveUpTimer) return;
			giveUpTimer = setTimeout(() => {
				giveUpTimer = null;
				eventSource?.close();
				eventSource = null;
				setState('failed', 'give-up timer expired');
			}, GIVE_UP_AFTER_MS);
		}

		function scheduleReconnect() {
			if (reconnectTimer) return;
			reconnectTimer = setTimeout(() => {
				reconnectTimer = null;
				openConnection();
			}, jitteredBackoff());
		}

		async function checkVersion() {
			if (reloadingForUpdate || versionCheckInFlight) return;
			versionCheckInFlight = true;
			try {
				// Cache-bust so the PWA / service worker can't hand us back a
				// stale /api/version from disk.
				const res = await fetch('/api/version?t=' + Date.now(), {
					cache: 'no-store',
					headers: { 'Cache-Control': 'no-cache' },
					signal: AbortSignal.timeout(5000)
				});
				if (!res.ok) return;
				const { current } = await res.json();
				if (!current) return;
				// Always compare against the build constant baked into THIS bundle.
				// Comparing against a captured "first seen" value left PWAs stuck on
				// stale builds when the server was already ahead at first load.
				if (current !== __APP_VERSION__) {
					let alreadyReloaded = false;
					try { alreadyReloaded = sessionStorage.getItem(RELOAD_MARKER_KEY) === current; }
					catch { /* sessionStorage may be blocked */ }
					if (alreadyReloaded) return;
					reloadingForUpdate = true;
					try { sessionStorage.setItem(RELOAD_MARKER_KEY, current); } catch { /* ignore */ }
					toasts.info('New version detected, reloading...', 3000);
					// Poke the SW so the next load gets the new bundle from network,
					// not the previous version's cache.
					try {
						const reg = await navigator.serviceWorker?.getRegistration();
						await reg?.update();
					} catch { /* non-fatal */ }
					setTimeout(() => window.location.reload(), 1500);
				} else {
					// Bundle matches server again — clear the marker so a future deploy
					// in this same tab can prompt another reload.
					try { sessionStorage.removeItem(RELOAD_MARKER_KEY); } catch { /* ignore */ }
				}
			} catch { /* version check best-effort */ }
			finally { versionCheckInFlight = false; }
		}

		function openConnection() {
			// Tear down any previous attempt. Capture `es` in closures so the
			// old handlers can detect they're stale — the spec doesn't guarantee
			// close() suppresses queued onerror dispatches, and we've seen them
			// flip state mid-reconnect in practice.
			eventSource?.close();
			eventSource = null;

			const es = new EventSource(`/api/events?sid=${sessionId}`);
			eventSource = es;

			// `connected` is the ONLY trigger for flipping to the connected
			// state. EventSource.onopen is not trustworthy in front of some
			// proxies (it can fire for cached / buffered responses that never
			// deliver real events).
			es.addEventListener('connected', () => {
				if (eventSource !== es) return; // stale handler from a previous attempt
				const wasOverlayUp = connectionState === 'reconnecting' || connectionState === 'failed';
				const firstTime = !everConnected;
				clearReconnectTimers();
				failedAttempts = 0;
				everConnected = true;
				setState('connected', 'sentinel received');

				if (wasOverlayUp && !firstTime) toasts.success('Reconnected to server');
				checkVersion();

				// Resync presence immediately; without this the server's view of
				// activeChatId/focused can lag long enough after a reconnect to
				// fire a stray "you're away" push.
				reportPresence({
					focused: typeof document !== 'undefined' && document.hasFocus() && !document.hidden,
					activeChatId: getActiveChatId()
				});
			});

			es.onmessage = (e) => {
				if (eventSource !== es) return;
				try { onEvent(JSON.parse(e.data)); }
				catch { /* malformed payload, drop silently */ }
			};

			es.onerror = () => {
				// Ignore stale handlers — a fresh openConnection() may have already
				// replaced this EventSource, and we don't want a queued error from
				// the old one to flip the new attempt into reconnecting.
				if (eventSource !== es) return;
				es.close();
				eventSource = null;
				failedAttempts += 1;

				// Any error before we're connected (cold boot, mid-connect drop,
				// proxy 502) means show the overlay. We don't need a grace timer
				// because EventSource.onerror only fires for genuine failures,
				// not slow handshakes — a healthy server's `connected` event
				// arrives well before any error would.
				if (connectionState !== 'reconnecting' && connectionState !== 'failed') {
					setState('reconnecting', 'EventSource error');
					armGiveUpTimer();
				}
				scheduleReconnect();
			};
		}

		openConnection();

		manualReconnectFn = () => {
			clearReconnectTimers();
			failedAttempts = 0;
			// Stay in 'reconnecting' (overlay visible) during the manual retry
			// handshake. Dropping back to 'connecting' here would hide the overlay
			// only to bring it straight back when the retry fails on a dead server.
			// The button's own pressed/spinner state is the feedback for the click.
			if (connectionState === 'failed') setState('reconnecting', 'manual retry from failed');
			openConnection();
		};

		// Push the user's IANA timezone up so the server can evaluate quiet
		// hours for push notifications.
		try {
			const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
			if (tz && tz !== getInitialUserTimezone?.()) {
				fetch('/api/settings', {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ userTimezone: tz })
				}).catch(() => { /* best-effort */ });
			}
		} catch { /* ignore */ }

		// Service worker pinging us (e.g. user tapped a notification — open that chat).
		const swMessageHandler = (e: MessageEvent) => {
			if (e.data?.type === 'open-chat' && e.data.chatId) {
				onSwOpenChat(e.data.chatId);
			}
		};
		navigator.serviceWorker?.addEventListener('message', swMessageHandler);

		// Mobile (iOS Safari especially) freezes the page in the background and
		// the SSE connection goes silently stale: readyState still reads OPEN
		// but no events arrive. Force a fresh connect on every visibility
		// transition so we pick up anything buffered via Last-Event-ID.
		const visibilityHandler = () => {
			if (!document.hidden) {
				// Cancel pending backoff so the retry happens immediately. The
				// overlay's visibility is driven purely by connectionState, so it
				// will NOT briefly hide just because we kicked off a new attempt.
				clearReconnectTimers();
				checkVersion();
				openConnection();
			}
			reportPresence({ focused: !document.hidden, activeChatId: getActiveChatId() });
		};
		document.addEventListener('visibilitychange', visibilityHandler);

		// Same revalidation on bfcache restore (Safari back/forward) and
		// network-online — both can drop us back into a long-running app that
		// hasn't checked its version in a while.
		const pageshowHandler = (e: PageTransitionEvent) => {
			if (e.persisted) checkVersion();
		};
		const onlineHandler = () => {
			checkVersion();
			// `online` is a strong hint that whatever was wrong might be over —
			// kick a reconnect immediately rather than waiting for the next backoff.
			if (connectionState === 'reconnecting' || connectionState === 'failed') {
				clearReconnectTimers();
				openConnection();
			}
		};
		window.addEventListener('pageshow', pageshowHandler);
		window.addEventListener('online', onlineHandler);

		// Background poll while the tab/PWA is foregrounded — covers the case
		// where neither visibility nor online ever fire (user keeps the PWA
		// open across a deploy without backgrounding).
		const VERSION_POLL_INTERVAL = 5 * 60 * 1000;
		const versionPollTimer = setInterval(() => {
			if (!document.hidden) checkVersion();
		}, VERSION_POLL_INTERVAL);
		// Immediate check on mount so a cold-loaded stale shell reloads even
		// before the SSE handshake completes.
		checkVersion();

		// Window focus/blur is more granular than visibilitychange.
		const focusHandler = () => reportPresence({ focused: true, activeChatId: getActiveChatId() });
		const blurHandler = () => reportPresence({ focused: false });
		window.addEventListener('focus', focusHandler);
		window.addEventListener('blur', blurHandler);

		reportPresence({ focused: document.hasFocus(), activeChatId: getActiveChatId() });

		// Heartbeat so the server can evict sessions that died without saying goodbye.
		const presenceHeartbeat = setInterval(() => {
			if (document.hasFocus() && !document.hidden) {
				reportPresence({ focused: true, activeChatId: getActiveChatId() });
			}
		}, 30_000);

		return () => {
			manualReconnectFn = null;
			clearInterval(presenceHeartbeat);
			clearInterval(versionPollTimer);
			document.removeEventListener('visibilitychange', visibilityHandler);
			window.removeEventListener('pageshow', pageshowHandler);
			window.removeEventListener('online', onlineHandler);
			window.removeEventListener('focus', focusHandler);
			window.removeEventListener('blur', blurHandler);
			navigator.serviceWorker?.removeEventListener('message', swMessageHandler);
			eventSource?.close();
			eventSource = null;
			clearReconnectTimers();
		};
	});

	// Push active-chat changes up so server-side presence knows where the user is.
	$effect(() => {
		const chatId = getActiveChatId();
		reportPresence({ activeChatId: chatId });
	});

	return {
		get connectionState() {
			return connectionState;
		},
		manualReconnect() {
			manualReconnectFn?.();
		}
	};
}
