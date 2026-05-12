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

// Loud, one-time boot warning if someone accidentally ships the dev bypass to a
// non-dev environment. Logged at error level so it surfaces in any sane log
// pipeline. Doesn't refuse to start — that would break legitimate self-hosted
// installs that intentionally run NODE_ENV=production with the bypass for a
// single-user setup — but at least it's screamingly obvious.
if (isDevAuthBypassEnabled() && process.env.NODE_ENV !== 'development') {
	// Lazy import to avoid a logger-loads-devAuth-loads-logger cycle in tests.
	void import('./logger.js').then(({ logger }) => {
		logger.error('SKALD_DEV_AUTH_BYPASS is enabled but NODE_ENV is not "development"', {
			nodeEnv: process.env.NODE_ENV ?? '(unset)',
			hint: 'unset SKALD_DEV_AUTH_BYPASS in production deploys',
		});
	});
}
