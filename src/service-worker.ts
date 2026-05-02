/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

declare let self: ServiceWorkerGlobalScope;

import { build, files, version } from '$service-worker';

const CACHE_NAME = `skald-cache-${version}`;

// Build artefacts + static files
const ASSETS = [...build, ...files];

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE_NAME)
			.then((cache) => cache.addAll(ASSETS))
			.then(() => self.skipWaiting())
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

	// Never cache navigation HTML — it embeds hashed chunk URLs that only exist
	// for the current deployment. Serving stale HTML after a redeploy breaks
	// the page (chunks 404). Let the browser fetch fresh.
	if (isNavigation) return;

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
