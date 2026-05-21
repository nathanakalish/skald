import type { RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/db/index.js';
import { users } from '$lib/db/schema.js';
import { eq } from 'drizzle-orm';
import { timingSafeEqual } from 'node:crypto';
import { createSession, getSessionCookieName, getSessionMaxAge } from '$lib/server/auth.js';
import {
	isOidcEnabled,
	getOidcConfig,
	exchangeCode,
	getUserClaims,
	roleFromGroups
} from '$lib/server/oidc.js';
import { logger } from '$lib/server/logger.js';

// Constant-time compare for two strings that may be attacker-influenced
// (state token), to avoid leaking which prefix matched via timing.
function safeEqStr(a: string, b: string): boolean {
	const ab = Buffer.from(a, 'utf8');
	const bb = Buffer.from(b, 'utf8');
	if (ab.length !== bb.length) return false;
	return timingSafeEqual(ab, bb);
}

function popupResponse(success: boolean, error?: string): Response {
	const payload = JSON.stringify({ type: 'oidc-callback', success, error: error ?? null });
	const fallbackUrl = success ? '/' : `/?oidc_error=${encodeURIComponent(error ?? '')}`;
	const fallbackJson = JSON.stringify(fallbackUrl);
	const successMsg = success ? 'Authentication successful. You can close this tab.' : '';
	const html = `<!DOCTYPE html><html><head><title>Authenticating...</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100dvh;margin:0;background:#111;color:#eee}p{text-align:center}</style></head><body><p id="msg">Authenticating...</p><script>
(function() {
	var msg = document.getElementById('msg');
	var fallback = ${fallbackJson};
	try {
		if (window.opener && !window.opener.closed) {
			window.opener.postMessage(${payload}, window.location.origin);
			window.close();
			// window.close() often gets blocked on mobile — fall back to a message instead of navigating.
			setTimeout(function() { msg.textContent = ${JSON.stringify(successMsg || 'You can close this tab.')}; }, 200);
			return;
		}
	} catch (e) { /* opener cross-origin blocked */ }
	// No opener — direct navigation or popup blocked. Redirect to the app.
	window.location.href = fallback;
})();
</script></body></html>`;
	return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } });
}

/** Handle OIDC callback — swap code for tokens, find/create user, mint a session. */
export const GET: RequestHandler = async ({ url, cookies, request }) => {
	if (!isOidcEnabled()) {
		return popupResponse(false, 'OIDC is not enabled');
	}

	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	const errorParam = url.searchParams.get('error');

	// IdP-side errors land here too.
	if (errorParam) {
		const desc = url.searchParams.get('error_description') ?? errorParam;
		return popupResponse(false, desc);
	}

	if (!code || !state) {
		return popupResponse(false, 'Missing code or state');
	}

	// Read OIDC cookies.
	const savedState = cookies.get('oidc_state');
	const savedVerifier = cookies.get('oidc_verifier');
	const savedNonce = cookies.get('oidc_nonce') ?? null;

	if (!savedState || !savedVerifier || !safeEqStr(state, savedState)) {
		// Validate state BEFORE clearing cookies — mismatched state means
		// either CSRF or a stale tab; either way we want a clear error.
		cookies.delete('oidc_state', { path: '/' });
		cookies.delete('oidc_verifier', { path: '/' });
		cookies.delete('oidc_nonce', { path: '/' });
		logger.warn('auth: oidc state mismatch');
		return popupResponse(false, 'Invalid state');
	}

	// State validated — burn the single-use cookies before continuing.
	cookies.delete('oidc_state', { path: '/' });
	cookies.delete('oidc_verifier', { path: '/' });
	cookies.delete('oidc_nonce', { path: '/' });

	const config = getOidcConfig();
	const redirectUri = `${url.origin}/api/auth/oidc/callback`;

	try {
		// Trade the auth code for tokens.
		const tokenResponse = await exchangeCode(code, redirectUri, savedVerifier);

		// Pull user claims (verifies id_token signature, issuer, audience, nonce).
		const claims = await getUserClaims(tokenResponse, savedNonce);
		const role = roleFromGroups(claims.groups);

		// userGroup gate, when configured. Admins bypass (admin group implies access).
		if (config.userGroup && role !== 'admin' && !claims.groups.includes(config.userGroup)) {
			logger.warn('auth: oidc user not in required group', { username: claims.username, requiredGroup: config.userGroup });
			return popupResponse(false, 'Account not authorized for this app.');
		}

		// Look up an existing user by username.
		let user = db.select().from(users).where(eq(users.username, claims.username)).get();

		let createdNewUser = false;

		if (user) {
			// Refresh role + picture from OIDC on each login.
			const patch: Partial<{ role: 'admin' | 'user'; pictureUrl: string | null }> = {};
			if (user.role !== role) patch.role = role;
			if ((user.pictureUrl ?? null) !== claims.picture) patch.pictureUrl = claims.picture;
			if (Object.keys(patch).length > 0) {
				db.update(users).set(patch).where(eq(users.id, user.id)).run();
			}
		} else if (config.autoCreateUsers) {
			// Auto-create: role comes from group claims. Two concurrent OIDC
			// callbacks for the same brand-new username can race past the
			// SELECT above; the UNIQUE(username) constraint catches it and we
			// re-fetch the row the winner inserted.
			try {
				const result = db
					.insert(users)
					.values({
						username: claims.username,
						role,
						pictureUrl: claims.picture,
					})
					.run();
				user = {
					id: Number(result.lastInsertRowid),
					username: claims.username,
					role,
					pictureUrl: claims.picture,
					pinHash: null,
					pinPolicy: 'disabled',
					pinTimeoutMinutes: null,
					createdAt: new Date().toISOString(),
				};
				createdNewUser = true;
				logger.info('auth: oidc user auto-created', { userId: user.id, username: user.username, role: user.role });
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				if (/UNIQUE constraint failed/i.test(msg)) {
					user = db.select().from(users).where(eq(users.username, claims.username)).get();
					if (!user) throw e;
				} else {
					throw e;
				}
			}
		} else {
			return popupResponse(false, 'Account not found. Contact your administrator.');
		}

		// Mint the session.
		const token = createSession(user.id, request.headers.get('user-agent'));

		cookies.set(getSessionCookieName(), token, {
			path: '/',
			httpOnly: true,
			secure: url.protocol === 'https:',
			sameSite: 'lax',
			maxAge: getSessionMaxAge(),
		});

		logger.info('auth: oidc login success', { userId: user.id, username: user.username, newUser: createdNewUser });

		return popupResponse(true);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'OIDC authentication failed';
		// Full error to logs, generic message to the popup.
		logger.error('OIDC callback failed', { error: message });
		return popupResponse(false, 'Authentication failed');
	}
};
