import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { isOidcEnabled, getOidcConfig, getDiscovery, generatePkce, generateState, generateNonce } from '$lib/server/oidc.js';

/** Initiate OIDC Authorization Code + PKCE flow */
export const GET: RequestHandler = async ({ url, cookies }) => {
	if (!isOidcEnabled()) {
		return new Response(JSON.stringify({ error: 'OIDC is not enabled' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const config = getOidcConfig();
	const discovery = await getDiscovery();
	const { verifier, challenge } = generatePkce();
	const state = generateState();
	const nonce = generateNonce();

	// Build the callback URL from the current request origin
	const redirectUri = `${url.origin}/api/auth/oidc/callback`;

	// Store PKCE verifier, state, and nonce in secure, httpOnly cookies
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

	redirect(302, authUrl.toString());
};
