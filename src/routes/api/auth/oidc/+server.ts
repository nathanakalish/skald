import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { isOidcEnabled, getOidcConfig, getDiscovery, generatePkce, generateState, generateNonce } from '$lib/server/oidc.js';
import { logger } from '$lib/server/logger.js';

/** Initiate OIDC Authorization Code + PKCE flow */
export const GET: RequestHandler = async ({ url, cookies, locals }) => {
	if (!isOidcEnabled()) {
		return new Response(JSON.stringify({ error: 'OIDC is not enabled' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const config = getOidcConfig();
	const discovery = await getDiscovery();

	// Reuse an in-flight OIDC flow if one is already open in another tab.
	// This way clicking "Sign In" twice (or having two tabs with the same
	// signed-out app) doesn't clobber the first tab's PKCE verifier cookie
	// and break it. We only reuse if all three cookies are present; otherwise
	// we'd have a half-broken flow.
	const existingVerifier = cookies.get('oidc_verifier');
	const existingState = cookies.get('oidc_state');
	const existingNonce = cookies.get('oidc_nonce');
	const reuse = !!(existingVerifier && existingState && existingNonce);

	let verifier: string;
	let challenge: string;
	let state: string;
	let nonce: string;

	if (reuse) {
		verifier = existingVerifier!;
		state = existingState!;
		nonce = existingNonce!;
		// PKCE challenge is deterministic from the verifier — recompute it so
		// we don't have to persist it.
		const { createHash } = await import('node:crypto');
		challenge = createHash('sha256').update(verifier).digest('base64url');
	} else {
		const pkce = generatePkce();
		verifier = pkce.verifier;
		challenge = pkce.challenge;
		state = generateState();
		nonce = generateNonce();

		const cookieOpts = {
			path: '/',
			httpOnly: true,
			secure: url.protocol === 'https:',
			sameSite: 'lax' as const,
			maxAge: 600, // 10 minutes
		};
		cookies.set('oidc_verifier', verifier, cookieOpts);
		cookies.set('oidc_state', state, cookieOpts);
		cookies.set('oidc_nonce', nonce, cookieOpts);
	}

	// Build the callback URL from the current request origin
	const redirectUri = `${url.origin}/api/auth/oidc/callback`;

	// Build authorization URL
	const authUrl = new URL(discovery.authorization_endpoint);
	authUrl.searchParams.set('response_type', 'code');
	authUrl.searchParams.set('client_id', config.clientId);
	authUrl.searchParams.set('redirect_uri', redirectUri);
	authUrl.searchParams.set('scope', config.scopes);
	authUrl.searchParams.set('state', state);
	authUrl.searchParams.set('nonce', nonce);
	authUrl.searchParams.set('code_challenge', challenge);
	authUrl.searchParams.set('code_challenge_method', 'S256');
	authUrl.searchParams.set('prompt', 'login');

	(locals.logger ?? logger).info('auth: oidc redirect issued', { reused: reuse });

	redirect(302, authUrl.toString());
};
