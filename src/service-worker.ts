/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

declare let self: ServiceWorkerGlobalScope;

import { build, files, version } from '$service-worker';

const CACHE_NAME = `skald-cache-${version}`;

// Build artefacts + static files
const ASSETS = [...build, ...files];

// Cache key for the most recent successful navigation HTML. Used as the
// offline fallback so a refresh / cold-load during a deploy or proxy outage
// keeps showing the app shell (and its disconnect overlay) instead of the
// reverse proxy's error page. Refreshed on every successful navigation.
const NAV_FALLBACK_URL = '/__skald-nav-fallback__';

self.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE_NAME);
			await cache.addAll(ASSETS);
			// Prime the offline navigation fallback with the current shell.
			// `credentials: 'include'` is needed because the SvelteKit shell
			// is server-rendered against the user's session. A failure here
			// just leaves the fallback unprimed — the next successful
			// navigation will populate it.
			try {
				const response = await fetch('/', { credentials: 'include' });
				if (response.ok) {
					await cache.put(NAV_FALLBACK_URL, response.clone());
				}
			} catch { /* best-effort; not worth blocking install */ }
			await self.skipWaiting();
		})()
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches.keys().then(async (keys) => {
			for (const key of keys) {
				if (key !== CACHE_NAME) {
					await caches.delete(key);
				}
			}
			await self.clients.claim();
		})
	);
});

self.addEventListener('notificationclick', (event) => {
	event.notification.close();

	const chatId = event.notification.data?.chatId;
	const targetUrl = chatId ? `/?chat=${chatId}` : '/';

	event.waitUntil(
		self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
			// Focus an existing window if we have one.
			for (const client of clients) {
				if ('focus' in client) {
					await client.focus();
					if (chatId) {
						client.postMessage({ type: 'open-chat', chatId });
					}
					return;
				}
			}
			// Otherwise spin up a new window aimed at the chat.
			await self.clients.openWindow(targetUrl);
		})
	);
});

// Push handler — required for iOS to recognise this PWA as push-capable.
self.addEventListener('push', (event) => {
	const data = event.data?.json() ?? {};
	const title = data.title || 'Skald';
	// macOS demands absolute URLs for notification icons.
	const base = self.location.origin;
	const icon = data.icon ? `${base}${data.icon}` : `${base}/icon-192.png`;
	const options: NotificationOptions = {
		body: data.body || 'New message',
		icon,
		badge: `${base}/icon-192.png`,
		tag: data.data?.chatId ? `chat-${data.data.chatId}` : 'skald',
		renotify: true,
		data: data.data || {},
	};
	event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('fetch', (event) => {
	if (event.request.method !== 'GET') return;

	const url = new URL(event.request.url);

	// Skip API requests and external resources.
	if (url.pathname.startsWith('/api/')) return;
	if (url.origin !== self.location.origin) return;

	const isNavigation =
		event.request.mode === 'navigate' ||
		(event.request.destination === '' && event.request.headers.get('accept')?.includes('text/html'));

	// Navigation HTML: network-first with an offline fallback to the last
	// good shell. Cached shells live under the version-stamped CACHE_NAME so
	// their embedded hashed-chunk URLs stay consistent with whatever build
	// artefacts the install handler pre-cached — a new deploy bumps the
	// cache name, the activate handler drops the old one, and the next
	// successful navigation re-populates the fallback with the new HTML.
	//
	// Without this, a reload during a deploy (or any moment the reverse
	// proxy can't reach upstream) lands on the proxy's "Bad Gateway" page
	// and the user is stuck until they manually refresh post-deploy. With
	// it, they keep seeing the Skald shell + disconnect overlay, which
	// auto-reconnects in the background.
	if (isNavigation) {
		event.respondWith(
			(async () => {
				const cache = await caches.open(CACHE_NAME);
				try {
					const response = await fetch(event.request);
					if (response.ok) {
						// Refresh the fallback on every successful load so it
						// stays up to date — including after the user has been
						// browsing for a while and we want any newly-deployed
						// shell quirks (CSP, meta, etc) reflected in the
						// offline copy too.
						cache.put(NAV_FALLBACK_URL, response.clone()).catch(() => {});
						return response;
					}
					// Bad upstream (5xx from the proxy, etc): prefer the
					// cached shell when we have one. Only surface the real
					// error response when we genuinely have nothing better
					// to show.
					const cached = await cache.match(NAV_FALLBACK_URL);
					return cached ?? response;
				} catch {
					// Network unreachable (DNS, offline, proxy fully down).
					const cached = await cache.match(NAV_FALLBACK_URL);
					if (cached) return cached;
					return new Response('Offline', { status: 503 });
				}
			})()
		);
		return;
	}

	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE_NAME);

			// Build/static assets: cache-first (immutable, hashed filenames).
			if (ASSETS.includes(url.pathname)) {
				const cached = await cache.match(event.request);
				if (cached) return cached;
			}

			// Other same-origin GETs: network-first with cache fallback.
			try {
				const response = await fetch(event.request);
				if (response.status === 200) {
					cache.put(event.request, response.clone()).catch(() => {});
				}
				return response;
			} catch {
				const cached = await cache.match(event.request);
				if (cached) return cached;
				return new Response('Offline', { status: 503 });
			}
		})()
	);
});
