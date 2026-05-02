/**
 * Wrappers around `fetch` that re-validate every redirect hop against the
 * SSRF allow-list. Without this, a public hostname can 301 to
 * 169.254.169.254 (cloud metadata) or any RFC1918 address and the default
 * `fetch` will follow it.
 */
import { assertPublicHost } from './ssrf.js';

const MAX_REDIRECTS = 5;

export interface SafeFetchOptions {
	method?: string;
	headers?: Record<string, string>;
	body?: BodyInit | null;
	signal?: AbortSignal;
	timeoutMs?: number;
}

/**
 * Fetch a user-controlled URL with manual redirect handling. Each hop is
 * re-validated with `assertPublicHost`, so an attacker cannot stage a
 * public-looking page that redirects internally.
 */
export async function safeFetch(initialUrl: string, opts: SafeFetchOptions = {}): Promise<Response> {
	let urlStr = initialUrl;
	let res: Response | null = null;
	const headers = opts.headers ?? {};

	let timeoutId: ReturnType<typeof setTimeout> | null = null;
	let controller: AbortController | null = null;
	let signal = opts.signal;
	if (opts.timeoutMs && !signal) {
		controller = new AbortController();
		signal = controller.signal;
		timeoutId = setTimeout(() => controller!.abort(), opts.timeoutMs);
	}

	try {
		for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
			const u = new URL(urlStr);
			if (u.protocol !== 'http:' && u.protocol !== 'https:') {
				throw new Error('refusing non-http(s) URL');
			}
			await assertPublicHost(u.hostname);

			res = await fetch(urlStr, {
				method: opts.method,
				headers,
				body: opts.body ?? undefined,
				redirect: 'manual',
				signal
			});

			if (res.status < 300 || res.status >= 400) {
				return res;
			}

			const next = res.headers.get('location');
			if (!next) return res;
			const nextUrl = new URL(next, urlStr);
			urlStr = nextUrl.toString();
		}
		throw new Error('too many redirects');
	} finally {
		if (timeoutId) clearTimeout(timeoutId);
	}
}
