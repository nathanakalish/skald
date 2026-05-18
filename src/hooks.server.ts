import type { Handle, HandleServerError } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { db } from '$lib/db/index.js';
import { themes, userSettings } from '$lib/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { validateSession, getSessionCookieName, cleanupExpiredSessions } from '$lib/server/auth.js';
import { logger } from '$lib/server/logger.js';
import { startBackupSchedule } from '$lib/server/backup.js';
import { checkRateLimit } from '$lib/server/rateLimit.js';
import { getAdminSettingNumber } from '$lib/server/adminSettings.js';
import * as themeCache from '$lib/server/themeCache.js';
import { isOidcEnabled } from '$lib/server/oidc.js';

// One-shot boot banner so operators can immediately see the build, runtime,
// and which subsystems are wired up.
logger.info('skald server starting', {
	version: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'unknown',
	nodeVersion: process.version,
	logLevel: process.env.LOG_LEVEL || 'info',
	oidcEnabled: isOidcEnabled(),
	allowLocalProviders: process.env.ALLOW_LOCAL_PROVIDERS === 'true',
	devAuthEnabled: process.env.DEV_AUTH_ENABLED === 'true',
	slowQueryMs: Number(process.env.SLOW_QUERY_MS ?? '50'),
});

// Reap expired sessions on boot, then again every hour. unref() so this doesn't keep the process alive.
cleanupExpiredSessions();
setInterval(() => cleanupExpiredSessions(), 60 * 60 * 1000).unref();

// Graceful shutdown signal logging — the actual DB close lives in src/lib/db/index.ts.
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
	process.on(sig, () => logger.info('shutdown signal received', { signal: sig }));
}

// Last line of defence — if something escapes all our try/catches, at least it ends up in the logs.
process.on('uncaughtException', (err) => {
	logger.error('uncaughtException', { err });
});
process.on('unhandledRejection', (reason) => {
	logger.error('unhandledRejection', { reason: reason instanceof Error ? reason : { value: String(reason) } });
});

// Periodic DB backup, off unless BACKUP_* env vars are set.
startBackupSchedule();

/** Suppress per-request access logs for these (they fire too often / too noisy). */
const ACCESS_LOG_SKIP_PREFIXES = ['/api/health', '/api/events', '/_app/immutable/', '/api/images/cache/'];

/** Sessions we've already seen this run — used to log userAgent only on first request. */
const loggedSessions = new Set<number>();
const LOGGED_SESSIONS_MAX = 5000;

/** Anything that could change state — require Origin == Host for CSRF. */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Per-user rate limits on the expensive endpoints. `max` is pulled from admin settings each tick. */
const RATE_LIMITED_PREFIXES: Array<{ prefix: string; settingKey: string }> = [
	// LLM streaming/sending — burst protection so one user can't peg a single GPU
	{ prefix: '/api/chat/send', settingKey: 'chatRateLimit' },
	{ prefix: '/api/chat/stream', settingKey: 'chatRateLimit' },
	// Imports — these do real work (parsing, image fetches, optimization)
	{ prefix: '/api/characters/import', settingKey: 'characterImportRateLimit' },
	{ prefix: '/api/lorebooks/import', settingKey: 'lorebookImportRateLimit' },
	// CHUB browse + import — we're a thin pipe to an upstream that has its own limits
	{ prefix: '/api/chub/', settingKey: 'chubBrowseRateLimit' },
	// AI-driven greeting reformat
	{ prefix: '/api/reformat', settingKey: 'reformatRateLimit' },
];

/** IP-keyed rate limit for the unauth endpoints. Cred-stuffing and OIDC-state replay love these. */
const AUTH_RATE_LIMITED_PREFIXES: Array<{ prefix: string; max: number }> = [
	{ prefix: '/api/auth/oidc/', max: 20 },
	{ prefix: '/api/auth/dev-login', max: 20 },
	{ prefix: '/api/auth/login', max: 20 },
	{ prefix: '/api/auth/register', max: 10 },
	{ prefix: '/api/setup', max: 10 },
];

export const handle: Handle = async ({ event, resolve }) => {
	const startedAt = Date.now();
	const requestId = event.request.headers.get('x-request-id') || randomUUID();
	event.locals.requestId = requestId;
	event.locals.logger = logger.child({ requestId });

	const sessionToken = event.cookies.get(getSessionCookieName());
	const user = sessionToken ? validateSession(sessionToken) : null;
	event.locals.user = user;
	if (user) {
		event.locals.logger = event.locals.logger.child({ userId: user.id });
	}

	const path = event.url.pathname;
	const isAuthRoute = path.startsWith('/api/auth/');
	const isStaticAsset = path.startsWith('/avatars/') || path.startsWith('/api/images/');
	const isHealth = path === '/api/health';

	// Per-request entry log (debug). Includes userAgent only on the first request
	// of each session so we don't spam it on every page load.
	const skipAccessLog = ACCESS_LOG_SKIP_PREFIXES.some((p) => path.startsWith(p));
	if (!skipAccessLog) {
		let ua: string | undefined;
		if (user) {
			if (!loggedSessions.has(user.id)) {
				if (loggedSessions.size >= LOGGED_SESSIONS_MAX) loggedSessions.clear();
				loggedSessions.add(user.id);
				ua = event.request.headers.get('user-agent') ?? undefined;
			}
		} else {
			ua = event.request.headers.get('user-agent') ?? undefined;
		}
		event.locals.logger.debug('http request', {
			method: event.request.method,
			path,
			...(ua ? { userAgent: ua } : {}),
		});
	}

	// IP rate limit on the auth/setup endpoints. Runs before CSRF so a bot mash
	// gets the cheapest possible 429 reply.
	if (event.request.method === 'POST' || event.request.method === 'GET') {
		for (const rule of AUTH_RATE_LIMITED_PREFIXES) {
			if (path.startsWith(rule.prefix)) {
				let ip = 'unknown';
				try { ip = event.getClientAddress(); } catch { /* SSR pre-bind */ }
				const result = checkRateLimit(`ip:${ip}:${rule.prefix}`, rule.max, 60_000);
				if (!result.allowed) {
					event.locals.logger.warn('auth rate limit exceeded', { path, ip });
					return new Response(
						JSON.stringify({ error: 'Too many attempts — please slow down.' }),
						{
							status: 429,
							headers: {
								'Content-Type': 'application/json',
								'Retry-After': String(result.retryAfterSeconds),
							},
						}
					);
				}
				break;
			}
		}
	}

	// CSRF defence in depth. The cookie is SameSite=lax so a cross-origin fetch wouldn't
	// normally include it, but the belt-and-suspenders is cheap and catches misconfigured proxies.
	// OIDC callback is the only mutating endpoint that legitimately receives a cross-origin
	// request (the IdP redirects the browser back to us); everything else under /api/ is
	// expected to be same-origin and gets CSRF-checked.
	const isOidcCallback = path === '/api/auth/oidc/callback';
	if (path.startsWith('/api/') && MUTATING_METHODS.has(event.request.method) && !isOidcCallback) {
		const origin = event.request.headers.get('origin');
		// Internal SvelteKit subrequests (`event.fetch`) drop the Host header,
		// so fall back to the URL host that SvelteKit derives from forwarded headers.
		const host = event.request.headers.get('host') ?? event.url.host;
		if (origin) {
			let originHost: string | null = null;
			try { originHost = new URL(origin).host; } catch { /* malformed */ }
			if (!originHost || originHost !== host) {
				event.locals.logger.warn('csrf origin mismatch', { path, origin, host });
				return new Response(JSON.stringify({ error: 'Cross-origin request blocked' }), {
					status: 403,
					headers: { 'Content-Type': 'application/json' }
				});
			}
		} else {
			// No Origin? Fall back to Referer.
			const referer = event.request.headers.get('referer');
			if (referer) {
				let refererHost: string | null = null;
				try { refererHost = new URL(referer).host; } catch { /* malformed */ }
				if (!refererHost || refererHost !== host) {
					event.locals.logger.warn('csrf referer mismatch', { path, referer, host });
					return new Response(JSON.stringify({ error: 'Cross-origin request blocked' }), {
						status: 403,
						headers: { 'Content-Type': 'application/json' }
					});
				}
			}
			// Both Origin and Referer missing — some legit same-origin XHR clients omit both, so let it through.
		}
	}

	if (!user && !isAuthRoute && !isStaticAsset && !isHealth) {
		if (path.startsWith('/api/')) {
			return new Response(JSON.stringify({ error: 'Unauthorized' }), {
				status: 401,
				headers: { 'Content-Type': 'application/json' }
			});
		}
		// Page requests fall through — the layout will show the login/setup screen inline.
	}

	// Per-user rate limit on the expensive endpoints, only after the user is known.
	if (user) {
		for (const rule of RATE_LIMITED_PREFIXES) {
			if (path.startsWith(rule.prefix)) {
				const max = getAdminSettingNumber(rule.settingKey) || 30;
				const result = checkRateLimit(`u:${user.id}:${rule.prefix}`, max, 60_000);
				if (!result.allowed) {
					event.locals.logger.warn('user rate limit exceeded', { path, max });
					return new Response(
						JSON.stringify({ error: 'Rate limit exceeded — slow down a moment.' }),
						{
							status: 429,
							headers: {
								'Content-Type': 'application/json',
								'Retry-After': String(result.retryAfterSeconds),
							},
						}
					);
				}
				break;
			}
		}
	}

	// Already-logged-in user landing on /login or /setup — punt them home.
	if (user && (path === '/login' || path === '/setup')) {
		return new Response(null, { status: 303, headers: { location: '/' } });
	}

	// Resolve the active theme for SSR. Skip API routes — they don't render HTML.
	let attrs = 'class="dark"';

	if (user && !path.startsWith('/api/')) {
		// Theme lookup happens on every page render, so cache per user. The cache is
		// busted from the theme activate/update/delete endpoints.
		let activeTheme: typeof themes.$inferSelect | null | undefined = themeCache.get(user.id);

		if (activeTheme === undefined) {
			// Cache miss. Users pick a dark theme + a light theme; colorMode picks which one we render.
			// 'system' falls back to dark for SSR (no OS hint server-side); the client swaps via matchMedia on mount.
			const settingsRows = db
				.select()
				.from(userSettings)
				.where(eq(userSettings.userId, user.id))
				.all();
			const settingsMap = new Map(settingsRows.map(s => [s.key, s.value]));
			const colorMode = settingsMap.get('colorMode') ?? 'dark';
			const slotKey = colorMode === 'light' ? 'systemLightThemeId' : 'systemDarkThemeId';
			const fallbackMode: 'dark' | 'light' = colorMode === 'light' ? 'light' : 'dark';
			const slotId = settingsMap.get(slotKey);

			activeTheme = null;
			if (slotId) {
				activeTheme = db.select().from(themes).where(eq(themes.id, Number(slotId))).get() ?? null;
			}
			if (!activeTheme) {
				activeTheme = db.select().from(themes).where(and(eq(themes.isBuiltin, true), eq(themes.mode, fallbackMode))).limit(1).get() ?? null;
			}
			if (!activeTheme) {
				activeTheme = db.select().from(themes).where(eq(themes.isBuiltin, true)).limit(1).get() ?? null;
			}

			themeCache.set(user.id, activeTheme);
		}

		const isDark = !activeTheme || activeTheme.mode === 'dark';
		attrs = isDark ? 'class="dark"' : '';

		if (activeTheme) {
			let colors: Record<string, unknown> = {};
			try {
				colors = typeof activeTheme.colors === 'string'
					? JSON.parse(activeTheme.colors)
					: (activeTheme.colors as Record<string, unknown>);
				if (!colors || typeof colors !== 'object') colors = {};
			} catch (err) {
				// Corrupt theme JSON shouldn't take down the request. Skip the inline colours
				// and let the default CSS variables win (this is the M15 fix).
				event.locals.logger.warn('theme colors parse failed', { themeId: activeTheme.id, err: String(err) });
				colors = {};
			}
			// Allow-list for CSS values so a malicious theme can't sneak `expression()`
			// or anything else weird into the inline style attribute.
			const safeKey = /^[\w-]+$/;
			const safeValue = /^[\w\s().,#%-]+$/;
			const safeEntries = Object.entries(colors)
				.filter(([k, v]) =>
					typeof k === 'string' && typeof v === 'string' &&
					safeKey.test(k) &&
					safeValue.test(v as string)
				);
			const styleStr = safeEntries
				.map(([k, v]) => `--${k}:${v}`)
				.join(';');
			if (styleStr) {
				attrs += ` style="${styleStr}"`;
			}
		}
	}

	const response = await resolve(event, {
		transformPageChunk: ({ html }) =>
			html.replace('%sveltekit.html-attributes%', attrs)
	});

	// Echo request id so users can quote it in bug reports.
	response.headers.set('x-request-id', requestId);

	// Surface slow requests so we can find perf regressions before users do.
	const elapsed = Date.now() - startedAt;
	const bytesOut = Number(response.headers.get('content-length') || '0') || undefined;
	if (elapsed > 1000) {
		event.locals.logger.warn('slow request', {
			path,
			method: event.request.method,
			durationMs: elapsed,
			status: response.status,
			...(bytesOut !== undefined ? { bytesOut } : {}),
		});
	} else if (!skipAccessLog) {
		event.locals.logger.info('http response', {
			method: event.request.method,
			path,
			status: response.status,
			durationMs: elapsed,
			...(bytesOut !== undefined ? { bytesOut } : {}),
		});
	}

	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('X-Frame-Options', 'SAMEORIGIN');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
	// CSP gotchas: SvelteKit hydration emits inline script/style, and per-user themes
	// inject `style="..."` attrs — both need 'unsafe-inline'. Everything else is locked
	// down to same-origin or known-safe schemes (data:/blob: for inline avatars,
	// https: for CHUB and OIDC profile pictures).
	response.headers.set(
		'Content-Security-Policy',
		[
			"default-src 'self'",
			"script-src 'self' 'unsafe-inline'",
			"style-src 'self' 'unsafe-inline'",
			"img-src 'self' data: blob: https:",
			"media-src 'self' data: blob:",
			"font-src 'self' data:",
			"connect-src 'self'",
			"worker-src 'self' blob:",
			"manifest-src 'self'",
			"frame-ancestors 'self'",
			"base-uri 'self'",
			"form-action 'self'",
			"object-src 'none'"
		].join('; ')
	);

	// SvelteKit puts a hash in every immutable bundle filename, so a new deploy
	// invalidates by URL automatically — cache forever.
	if (path.startsWith('/_app/immutable/')) {
		response.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
	}

	return response;
};

/**
 * SvelteKit's escape hatch for unhandled errors in load functions and endpoints.
 * Whatever we return is what the user sees; the full detail goes to structured logs.
 */
export const handleError: HandleServerError = ({ error, event, status, message }) => {
	// 4xx is on the client — missing routes, bad input, or (mostly) bots scanning
	// for /wp-login.php and friends. Don't pollute the error log with those.
	if (status >= 400 && status < 500) {
		return { message: message || 'Not Found' };
	}
	const log = event.locals.logger ?? logger;
	log.error('unhandled server error', {
		err: error,
		path: event.url.pathname,
		method: event.request.method,
		userId: event.locals.user?.id ?? null,
		status,
	});
	return { message: message || 'Internal Server Error' };
};
