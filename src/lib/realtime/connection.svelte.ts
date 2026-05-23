import { browser } from '$app/environment';
import { toasts } from '$lib/stores/toast.svelte.js';

/**
 * The whole long-lived realtime connection layer lives here:
 *   - SSE to `/api/events` with reconnect + eventual give-up;
 *   - exposes `connectionState` ('connected' | 'disconnected' | 'failed')
 *     plus a `manualReconnect()` action for the disconnect modal;
 *   - revalidates the build version on connect / visibility / pageshow / online
 *     and reloads the page when the server's shipped a new bundle out from
 *     under us;
 *   - reports presence (focus + active chat) to `/api/presence` with a 30s heartbeat;
 *   - syncs the user's IANA timezone to the server on first connect;
 *   - listens for service-worker `open-chat` messages and forwards them via `onSwOpenChat`.
 *
 * Everything chat-state-y happens inside the caller's `onEvent` callback so
 * this stays UI-agnostic. SSE messages are JSON-parsed once and handed off;
 * malformed events get silently dropped (better than a noisy console).
 *
 * Lifted out of `+layout.svelte` (~400 lines was getting embarrassing).
 */

declare const __APP_VERSION__: string;

// Module-scoped so multiple effect runs (or two callers in the same tab)
// can't each trigger their own reload toast. Once we've decided to reload
// for a given server version, every other call short-circuits.
let reloadingForUpdate = false;
let versionCheckInFlight = false;

// Hard cap: only ever reload ONCE per loaded shell, per server version.
// If a stale service-worker keeps handing back the old bundle after the
// reload, we'd otherwise loop forever (toast → reload → still stale → toast).
const RELOAD_MARKER_KEY = 'skald:reloadedForVersion';

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
	let connectionState = $state<'connected' | 'disconnected' | 'failed'>('connected');
	let manualReconnectFn: (() => void) | null = null;

	function reportPresence(payload: { activeChatId?: number | null; focused?: boolean }) {
		// Skip if the user isn't logged in. The server returns 401, which Safari
		// renders as a scary "access control" console error, and there's no point
		// firing it in the first place.
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
		let wasConnected = false;
		// Failed connect attempts since the last successful onopen. We stay quiet on
		// the first failure because most drops are transient (mobile network handover,
		// server bounce, dev HMR reload) and recover on the next tick. Only when the
		// silent retry ALSO fails do we surface a "Disconnected" toast.
		let failedAttempts = 0;
		let disconnectToastShown = false;
		// Exponential backoff with full jitter (AWS-style). At 5s base / 60s cap and
		// 2x growth: 5s, 10s, 20s, 40s, 60s, 60s, … with each delay randomised in
		// [0, delay) so N tabs reconnecting after a server bounce don't thunder.
		const RECONNECT_BASE_MS = 5000;
		const RECONNECT_CAP_MS = 60_000;
		const GIVE_UP_AFTER = 3 * 60 * 1000;
		// How long to wait for the very first SSE handshake before flipping the
		// overlay on. Keeps a normal cold load from flashing an overlay during
		// the ~100ms it takes to open the stream while still surfacing the
		// "server unreachable" state quickly when we boot from the SW's cached
		// shell with the upstream actually down.
		const INITIAL_CONNECT_TIMEOUT_MS = 1500;
		let initialConnectTimer: ReturnType<typeof setTimeout> | null = null;
		function nextReconnectDelay(): number {
			const exp = Math.min(RECONNECT_CAP_MS, RECONNECT_BASE_MS * 2 ** failedAttempts);
			return Math.floor(Math.random() * exp);
		}

		async function checkVersion() {
			if (reloadingForUpdate || versionCheckInFlight) return;
			versionCheckInFlight = true;
			try {
				// Cache-bust so the PWA / service-worker fetch handler can't hand us
				// back a stale /api/version from disk.
				const res = await fetch('/api/version?t=' + Date.now(), {
					cache: 'no-store',
					headers: { 'Cache-Control': 'no-cache' },
					signal: AbortSignal.timeout(5000)
				});
				if (res.ok) {
					const { current } = await res.json();
					// Always compare against the build constant baked into THIS bundle.
					// We used to capture `serverVersion` from the first reply and compare
					// against that, which left PWAs stuck on stale builds: if the server
					// already had the new version when an old cached shell loaded, the
					// first check just stored the new value and never reloaded.
					if (current && current !== __APP_VERSION__) {
						// Don't loop: if we already reloaded once for this server version
						// but the cached bundle is still on the old version (likely a
						// stuck service worker), just stop nagging the user. Settling on
						// the next foreground / poll cycle is fine once the SW finally
						// swaps in the new build.
						let alreadyReloaded = false;
						try { alreadyReloaded = sessionStorage.getItem(RELOAD_MARKER_KEY) === current; }
						catch { /* sessionStorage may be blocked */ }
						if (alreadyReloaded) return;
						reloadingForUpdate = true;
						try { sessionStorage.setItem(RELOAD_MARKER_KEY, current); }
						catch { /* ignore */ }
						toasts.info('New version detected, reloading...', 3000);
						// Best-effort: poke the service worker to grab the new build
						// before we reload, so the next page load isn't served from
						// the previous version's cache.
						try {
							const reg = await navigator.serviceWorker?.getRegistration();
							await reg?.update();
						} catch { /* non-fatal */ }
						setTimeout(() => window.location.reload(), 1500);
					} else if (current && current === __APP_VERSION__) {
						// Bundle matches server again — clear the marker so a future
						// deploy in this same tab session can prompt another reload.
						try { sessionStorage.removeItem(RELOAD_MARKER_KEY); }
						catch { /* ignore */ }
					}
				}
			} catch { /* version check failed, not the end of the world */ }
			finally { versionCheckInFlight = false; }
		}

		function clearTimers() {
			if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
			if (giveUpTimer) { clearTimeout(giveUpTimer); giveUpTimer = null; }
			if (initialConnectTimer) { clearTimeout(initialConnectTimer); initialConnectTimer = null; }
		}

		function startGiveUpTimer() {
			if (giveUpTimer) return;
			giveUpTimer = setTimeout(() => {
				clearTimers();
				eventSource?.close();
				connectionState = 'failed';
			}, GIVE_UP_AFTER);
		}

		function scheduleReconnect() {
			if (reconnectTimer) return;
			reconnectTimer = setTimeout(() => {
				reconnectTimer = null;
				connect();
			}, nextReconnectDelay());
		}

		function showDisconnectedOverlay() {
			if (disconnectToastShown) return;
			connectionState = 'disconnected';
			disconnectToastShown = true;
			startGiveUpTimer();
		}

		function connect() {
			eventSource?.close();
			eventSource = new EventSource(`/api/events?sid=${sessionId}`);

			// Cold-boot safety net: if we've never managed a successful SSE
			// handshake and the EventSource is still spinning after a short
			// window, surface the disconnect overlay. This covers the case
			// where the SW served its cached shell and the upstream is
			// genuinely down — without this, the onerror branch below stays
			// silent (because wasConnected is false) and the user sees an
			// empty, hydrating UI instead of the overlay.
			if (!wasConnected && !initialConnectTimer) {
				initialConnectTimer = setTimeout(() => {
					initialConnectTimer = null;
					if (!wasConnected) showDisconnectedOverlay();
				}, INITIAL_CONNECT_TIMEOUT_MS);
			}

			eventSource.onopen = () => {
				clearTimers();
				if (wasConnected && disconnectToastShown) {
					toasts.success('Reconnected to server');
					checkVersion();
				} else if (!wasConnected) {
					checkVersion();
				}
				wasConnected = true;
				failedAttempts = 0;
				disconnectToastShown = false;
				connectionState = 'connected';
				// Resync full presence to the server immediately. Without this, the
				// server-side session re-registered for this SSE has stale focus/chat
				// state until the next focus event or 30s heartbeat — long enough to
				// fire a "you're away" push for a message that arrives right as the
				// user returns to the tab.
				reportPresence({
					focused: typeof document !== 'undefined' && document.hasFocus() && !document.hidden,
					activeChatId: getActiveChatId()
				});
			};

			eventSource.onmessage = (e) => {
				try {
					const event = JSON.parse(e.data);
					onEvent(event);
				} catch {
					// skip malformed events
				}
			};

			eventSource.onerror = () => {
				eventSource?.close();
				failedAttempts += 1;
				// Two separate "show the overlay" thresholds:
				//   • Previously connected (transient drop): stay silent on the
				//     first failure — most drops are mobile handover / HMR /
				//     bouncing server, and recover on the next tick. Surface
				//     after a second consecutive failure.
				//   • Never connected (cold boot, almost always means the SW
				//     handed back its cached shell because the server is down):
				//     show the overlay on the very first failure so the user
				//     isn't staring at an empty, mostly-broken UI while we
				//     silently retry.
				const threshold = wasConnected ? 2 : 1;
				if (failedAttempts >= threshold) {
					showDisconnectedOverlay();
				}
				scheduleReconnect();
			};
		}

		connect();

		manualReconnectFn = () => {
			clearTimers();
			failedAttempts = 0;
			disconnectToastShown = false;
			if (connectionState === 'failed') connectionState = 'disconnected';
			connect();
		};

		// Push the user's IANA timezone up so the server can evaluate quiet hours for push notifications.
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

		// Hard reconnect every time we come back to the foreground.
		// Mobile browsers (iOS Safari especially) freeze the page in the background and
		// the SSE connection goes silently stale: it still claims `readyState === OPEN`
		// but no events arrive. Forcing a reconnect on every visibility transition
		// pulls the buffered `complete` event back via Last-Event-ID, which unsticks
		// any chat that finished generating while we were away.
		const visibilityHandler = () => {
			if (!document.hidden) {
				clearTimers();
				// ALWAYS revalidate version on foreground. Quick visibility-driven
				// reconnects used to skip this because `disconnectToastShown` stays
				// false, leaving long-suspended PWAs running on a stale build forever.
				checkVersion();
				connect();
			}
			// Send full presence (focus + active chat) so the server can't end up
			// with a stale activeChatId after a long background period. The SSE
			// onopen will repeat this once the new connection lands; the upsert in
			// presence.update() makes either ordering safe.
			reportPresence({ focused: !document.hidden, activeChatId: getActiveChatId() });
		};
		document.addEventListener('visibilitychange', visibilityHandler);

		// Same revalidation on bfcache restore (Safari back/forward) and network-online —
		// both can drop us back into a long-running app that hasn't checked its version in a while.
		const pageshowHandler = (e: PageTransitionEvent) => {
			if (e.persisted) checkVersion();
		};
		const onlineHandler = () => { checkVersion(); };
		window.addEventListener('pageshow', pageshowHandler);
		window.addEventListener('online', onlineHandler);

		// Background poll every 5 minutes while the tab/PWA is foregrounded — covers the
		// case where neither visibility nor online ever fire (user keeps the PWA open
		// across a deploy without backgrounding).
		const VERSION_POLL_INTERVAL = 5 * 60 * 1000;
		const versionPollTimer = setInterval(() => {
			if (!document.hidden) checkVersion();
		}, VERSION_POLL_INTERVAL);
		// Immediate check on mount so a cold-loaded stale shell reloads even before
		// the SSE handshake completes.
		checkVersion();

		// Window focus/blur is more granular than visibilitychange, hence the second pair.
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
		}, 30000);

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
			clearTimers();
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
