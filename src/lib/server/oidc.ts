import { randomBytes, createHash } from 'crypto';
import * as jose from 'jose';

// ─── OIDC config from env ───

export function isOidcEnabled(): boolean {
	return !!process.env.OIDC_ISSUER_URL && !!process.env.OIDC_CLIENT_ID;
}

export function getOidcConfig() {
	return {
		issuerUrl: process.env.OIDC_ISSUER_URL ?? '',
		clientId: process.env.OIDC_CLIENT_ID ?? '',
		clientSecret: process.env.OIDC_CLIENT_SECRET ?? '',
		scopes: process.env.OIDC_SCOPES ?? 'openid profile groups',
		usernameClaim: process.env.OIDC_USERNAME_CLAIM ?? 'preferred_username',
		groupsClaim: process.env.OIDC_GROUPS_CLAIM ?? 'groups',
		adminGroup: process.env.OIDC_ADMIN_GROUP ?? 'skald_admin',
		userGroup: process.env.OIDC_USER_GROUP ?? '',
		// Default off. Operators must opt in to auto-creation; first-setup
		// (no users yet) is always allowed regardless.
		autoCreateUsers: process.env.OIDC_AUTO_CREATE_USERS === 'true',
	};
}

// ─── OIDC Discovery ───

interface OidcDiscovery {
	authorization_endpoint: string;
	token_endpoint: string;
	userinfo_endpoint: string;
	jwks_uri: string;
	issuer: string;
}

let cachedDiscovery: OidcDiscovery | null = null;
let discoveryCacheTime = 0;
const DISCOVERY_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

export async function getDiscovery(): Promise<OidcDiscovery> {
	const now = Date.now();
	if (cachedDiscovery && now - discoveryCacheTime < DISCOVERY_CACHE_TTL) {
		return cachedDiscovery;
	}

	const issuerUrl = getOidcConfig().issuerUrl.replace(/\/$/, '');
	const res = await fetch(`${issuerUrl}/.well-known/openid-configuration`, {
		signal: AbortSignal.timeout(10000)
	});

	if (!res.ok) {
		throw new Error(`OIDC discovery failed: ${res.status} ${res.statusText}`);
	}

	cachedDiscovery = await res.json();
	discoveryCacheTime = now;
	return cachedDiscovery!;
}

// ─── PKCE ───

export function generatePkce(): { verifier: string; challenge: string } {
	const verifier = randomBytes(32).toString('base64url');
	const challenge = createHash('sha256').update(verifier).digest('base64url');
	return { verifier, challenge };
}

export function generateState(): string {
	return randomBytes(16).toString('hex');
}

/** Random nonce (sent to IdP, verified on the way back via the id_token claim). */
export function generateNonce(): string {
	return randomBytes(16).toString('base64url');
}

// ─── Token Exchange ───

interface TokenResponse {
	access_token: string;
	id_token?: string;
	token_type: string;
	expires_in?: number;
}

export async function exchangeCode(
	code: string,
	redirectUri: string,
	codeVerifier: string
): Promise<TokenResponse> {
	const config = getOidcConfig();
	const discovery = await getDiscovery();

	const params = new URLSearchParams({
		grant_type: 'authorization_code',
		code,
		redirect_uri: redirectUri,
		client_id: config.clientId,
		code_verifier: codeVerifier,
	});

	// Some providers want client_secret even with PKCE.
	if (config.clientSecret) {
		params.set('client_secret', config.clientSecret);
	}

	const res = await fetch(discovery.token_endpoint, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: params.toString(),
		signal: AbortSignal.timeout(10000),
	});

	if (!res.ok) {
		const body = await res.text();
		throw new Error(`Token exchange failed: ${res.status} ${body}`);
	}

	return res.json();
}

// ─── Userinfo / Claims ───

export interface OidcClaims {
	username: string;
	groups: string[];
	picture: string | null;
}

/** Cached remote JWKS so jose can verify signatures without re-fetching keys. */
let jwksCache: { uri: string; jwks: ReturnType<typeof jose.createRemoteJWKSet> } | null = null;
function getJwks(jwksUri: string) {
	if (jwksCache && jwksCache.uri === jwksUri) return jwksCache.jwks;
	jwksCache = { uri: jwksUri, jwks: jose.createRemoteJWKSet(new URL(jwksUri)) };
	return jwksCache.jwks;
}

/**
 * Verify an OIDC ID token: signature against the IdP's JWKS, issuer matches
 * discovery, audience matches our client_id, and (when supplied) the nonce
 * matches what we set on the auth request. Returns the parsed claims.
 */
async function verifyIdToken(idToken: string, expectedNonce: string | null): Promise<Record<string, unknown>> {
	const discovery = await getDiscovery();
	const config = getOidcConfig();
	const { payload } = await jose.jwtVerify(idToken, getJwks(discovery.jwks_uri), {
		issuer: discovery.issuer,
		audience: config.clientId,
	});
	if (expectedNonce) {
		if (typeof payload.nonce !== 'string' || payload.nonce !== expectedNonce) {
			throw new Error('OIDC nonce mismatch');
		}
	}
	return payload as Record<string, unknown>;
}

export async function getUserClaims(tokenResponse: TokenResponse, expectedNonce: string | null = null): Promise<OidcClaims> {
	const config = getOidcConfig();

	// Prefer id_token (we can verify it). Fall back to userinfo over TLS.
	let claims: Record<string, unknown>;

	if (tokenResponse.id_token) {
		claims = await verifyIdToken(tokenResponse.id_token, expectedNonce);
	} else {
		const discovery = await getDiscovery();
		const res = await fetch(discovery.userinfo_endpoint, {
			headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
			signal: AbortSignal.timeout(10000),
		});
		if (!res.ok) throw new Error(`Userinfo request failed: ${res.status}`);
		claims = await res.json();
	}

	// Username
	const username = claims[config.usernameClaim];
	if (!username || typeof username !== 'string') {
		throw new Error(`Username claim '${config.usernameClaim}' not found or not a string in token`);
	}

	// Groups (may be nested, may be missing entirely)
	let groups: string[] = [];
	const rawGroups = claims[config.groupsClaim];
	if (Array.isArray(rawGroups)) {
		groups = rawGroups.filter((g): g is string => typeof g === 'string');
	}

	// Optional `picture` claim from the standard OIDC profile scope.
	let picture: string | null = null;
	const rawPicture = claims['picture'];
	if (typeof rawPicture === 'string' && /^https?:\/\//i.test(rawPicture.trim())) {
		picture = rawPicture.trim();
	}

	return { username: username.trim(), groups, picture };
}

/** Map OIDC groups to our internal role. */
export function roleFromGroups(groups: string[]): 'admin' | 'user' {
	const config = getOidcConfig();
	if (groups.includes(config.adminGroup)) return 'admin';
	return 'user';
}
