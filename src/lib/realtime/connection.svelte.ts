import { browser } from '$app/environment';
import { toasts } from '$lib/stores/toast.svelte.js';

/**
 * Long-lived realtime layer:
 *   - SSE to `/api/events` with jittered backoff + a hard give-up window;
 *   - exposes a small connection state machine
 *     ('connecting' | 'connected' | 'reconnecting' | 'failed')
 *     plus `manualReconnect()` for the disconnect overlay;
 *   - revalidates the build version on connect / visibility / pageshow / online
 *     and reloads when the server's shipped a new bundle;
 *   - heartbeats presence to `/api/presence` and syncs the user's timezone;
 *   - listens for service-worker `open-chat` messages.
 *
 * The state machine is deliberately tight: only the server's `connected`
 * sentinel flips us to `connected`, and once the overlay is up it stays up
 * until that sentinel arrives. That's what kills the "overlay → blank UI →
 * overlay" flicker the older version had during deploys / mobile handovers.
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
	// State machine semantics:
	//   connecting   → we haven't confirmed a real SSE handshake yet this
	//                  session. The overlay stays HIDDEN during this window so
	//                  a normal cold load doesn't flash anything.
	//   connected    → server sent us its `connected` sentinel; everything good.
	//   reconnecting → either we lost a previously-good connection, or the
	//                  cold-boot grace window expired without success. Overlay
	//                  is shown and we keep retrying in the background.
	//   failed       → exhausted the give-up window. Overlay still shown, copy
	//                  prompts the user to do something about it.
	let connectionState = $state<ConnectionState>('connecting');
	let manualReconnectFn: (() => void) | null = null;

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
		// Same deal as reportPresence — skip the whole circus when nobody's logged in.
		if (!getEnabled()) return;

		let eventSource: EventSource | null = null;
		let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
		let giveUpTimer: ReturnType<typeof setTimeout> | null = null;
		let coldBootTimer: ReturnType<typeof setTimeout> | null = null;
		// Latched true once the cold-boot grace window has been consumed —
		// either by firing (overlay raised) OR by a successful first connect.
		// Prevents the visibility handler from re-arming the grace timer on
		// every tab switch, which would otherwise hide the overlay for another
		// 4 seconds each time the user comes back to the tab.
		let coldBootConsumed = false;

		// Source of truth for "have we had a real, server-confirmed stream this
		// session yet". Only flipped inside the `connected` sentinel handler —
		// never on EventSource.onopen, which some reverse-proxy setups fire
		// spuriously for buffered responses that never deliver any data.
		let everConnected = false;
		let failedAttempts = 0;

		// Tunables. The cold-boot grace is generous on purpose: on slow networks
		// the SSE handshake can easily take >1s, and a brief overlay flash on
		// every normal page load was the loudest user complaint about the older
		// implementation.
		const RECONNECT_BASE_MS = 2000;
		const RECONNECT_CAP_MS = 30_000;
		const GIVE_UP_AFTER_MS = 3 * 60 * 1000;
		const COLD_BOOT_GRACE_MS = 4000;

		function jitteredBackoff(): number {
			// Exponential backoff with full jitter (AWS-style): N tabs all
			// reconnecting after a server bounce don't thunder.
			const exp = Math.min(RECONNECT_CAP_MS, RECONNECT_BASE_MS * 2 ** Math.min(failedAttempts, 6));
			return Math.floor(Math.random() * exp);
		}

		function clearAllTimers() {
			if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
			if (giveUpTimer) { clearTimeout(giveUpTimer); giveUpTimer = null; }
			// NOTE: coldBootTimer is intentionally NOT cleared here. It must fire
			// (or be cancelled by a successful `connected` event) exactly once per
			// session. Resetting it on every reconnect / visibility transition was
			// the source of the "overlay disappears for 4s every tab switch" bug.
		}

		function armGiveUpTimer() {
			if (giveUpTimer) return;
			giveUpTimer = setTimeout(() => {
				giveUpTimer = null;
				eventSource?.close();
				eventSource = null;
				connectionState = 'failed';
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
			// Tear down any previous attempt. Capture `es` in closures so the old
			// handlers can detect they're stale (the spec doesn't guarantee
			// close() suppresses queued onerror dispatches, and we've seen them
			// flip state mid-reconnect in practice).
			eventSource?.close();
			eventSource = null;

			const es = new EventSource(`/api/events?sid=${sessionId}`);
			eventSource = es;

			// Cold-boot grace: only arm this ONCE per session, on the very first
			// attempt. Once consumed (either by firing or by a successful connect),
			// subsequent openConnection() calls from visibility / manualReconnect
			// must NOT re-arm it — otherwise the overlay would drop every time we
			// retry, producing visible flicker.
			if (!coldBootConsumed && !coldBootTimer) {
				coldBootTimer = setTimeout(() => {
					coldBootTimer = null;
					coldBootConsumed = true;
					if (!everConnected) {
						connectionState = 'reconnecting';
						armGiveUpTimer();
					}
				}, COLD_BOOT_GRACE_MS);
			}

			// `connected` is the ONLY trigger for flipping to the connected
			// state. EventSource.onopen is not trustworthy in front of some
			// proxies (it can fire for cached / buffered responses that never
			// deliver real events). Driving state off the sentinel eliminates
			// the overlay → blank UI → overlay flicker that pattern causes.
			es.addEventListener('connected', () => {
				if (eventSource !== es) return; // stale handler from a previous attempt
				const wasOverlayUp = connectionState === 'reconnecting' || connectionState === 'failed';
				const firstTime = !everConnected;
				clearAllTimers();
				// Successful connect also consumes the cold-boot grace window —
				// future reopen calls should never re-arm it.
				if (coldBootTimer) { clearTimeout(coldBootTimer); coldBootTimer = null; }
				coldBootConsumed = true;
				failedAttempts = 0;
				everConnected = true;
				connectionState = 'connected';

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
				// Ignore errors from EventSources we've already replaced — otherwise
				// a stale onerror after openConnection() would flip the state of a
				// brand-new attempt and bump failedAttempts unnecessarily.
				if (eventSource !== es) return;
				es.close();
				eventSource = null;
				failedAttempts += 1;

				// Only flip the overlay on if we've actually had a working stream
				// before. Cold-boot errors are handled by the grace timer — flipping
				// here would defeat the anti-flicker delay.
				if (everConnected && connectionState === 'connected') {
					connectionState = 'reconnecting';
					armGiveUpTimer();
				}
				scheduleReconnect();
			};
		}

		openConnection();

		manualReconnectFn = () => {
			clearAllTimers();
			failedAttempts = 0;
			// Stay in 'reconnecting' (overlay visible) during the manual retry
			// handshake. Dropping back to 'connecting' here would hide the overlay
			// only to bring it straight back when the retry fails — flicker on a
			// dead server. The 'Retry Now' button + spinner is feedback enough.
			if (connectionState === 'failed') connectionState = 'reconnecting';
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
				// Cancel any pending backoff so the retry happens immediately, but
				// leave the cold-boot grace timer alone (clearAllTimers excludes it).
				// The overlay's visibility is driven purely by connectionState now —
				// it will NOT briefly hide just because we kicked off a new attempt.
				clearAllTimers();
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
		const onlineHandler = () => { checkVersion(); };
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
			clearAllTimers();
			if (coldBootTimer) { clearTimeout(coldBootTimer); coldBootTimer = null; }
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
