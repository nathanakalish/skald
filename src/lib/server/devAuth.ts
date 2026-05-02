/**
 * Dev-only authentication bypass helpers.
 *
 * Enabled when `SKALD_DEV_AUTH_BYPASS=1` is set in the server environment.
 * NEVER set this in production.
 */

export const DEV_AUTH_USERNAME = 'dev';

export function isDevAuthBypassEnabled(): boolean {
	const v = process.env.SKALD_DEV_AUTH_BYPASS;
	return v === '1' || v === 'true';
}
