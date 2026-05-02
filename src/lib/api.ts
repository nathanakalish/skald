/**
 * Tiny fetch+toast helper. Encapsulates the try/catch/!ok/json/err.error
 * dance that appeared 30+ times across SettingsModal, ChatView, and the
 * layout. Keeps a single source of truth for client-side error display.
 *
 * - `application/json` is set automatically when a body is provided.
 * - On HTTP error: surfaces `body.error` if present, else `errorLabel`,
 *   else 'Request failed', and returns `null`.
 * - On network failure: surfaces `errorLabel` or 'Network error' and
 *   returns `null`.
 * - Logs the underlying error to console for debugging.
 */
import { toasts } from '$lib/stores/toast.svelte.js';

export interface ApiOptions extends Omit<RequestInit, 'body'> {
	/** JSON body — auto-stringified, content-type set. Mutually exclusive with `rawBody`. */
	json?: unknown;
	/** Raw body (FormData, Blob, string, etc) — used as-is, no content-type munging. */
	rawBody?: BodyInit;
	/** Toast text on failure. Used as fallback if the response has no `error` field. */
	errorLabel?: string;
	/** If true, do NOT show a toast — caller handles errors. Still returns null on failure. */
	silent?: boolean;
}

/**
 * Fetch JSON, toast on error. Returns the parsed body on success, `null` on
 * any failure. Pass `silent: true` to suppress the toast (useful when the
 * caller wants to render a custom error UI).
 */
export async function api<T = unknown>(url: string, opts: ApiOptions = {}): Promise<T | null> {
	const { json, rawBody, errorLabel, silent, headers, ...rest } = opts;

	const init: RequestInit = { ...rest };
	if (json !== undefined) {
		init.body = JSON.stringify(json);
		init.headers = { 'Content-Type': 'application/json', ...(headers ?? {}) };
	} else if (rawBody !== undefined) {
		init.body = rawBody;
		if (headers) init.headers = headers;
	} else if (headers) {
		init.headers = headers;
	}

	let res: Response;
	try {
		res = await fetch(url, init);
	} catch (err) {
		console.error('[api] network error', url, err);
		if (!silent) toasts.error(errorLabel || 'Network error');
		return null;
	}

	if (!res.ok) {
		let body: any = null;
		try { body = await res.json(); } catch { /* not JSON */ }
		const msg = body?.error || errorLabel || `Request failed (${res.status})`;
		if (!silent) toasts.error(msg);
		return null;
	}

	// 204 / empty body
	if (res.status === 204 || res.headers.get('content-length') === '0') {
		return {} as T;
	}

	try {
		return await res.json() as T;
	} catch (err) {
		console.error('[api] response parse error', url, err);
		if (!silent) toasts.error(errorLabel || 'Invalid response');
		return null;
	}
}
