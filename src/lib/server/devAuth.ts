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

// Loud boot-time check if someone accidentally ships the dev bypass to a
// non-dev environment. Self-hosted single-user setups that intentionally run
// NODE_ENV=production with the bypass must opt-in via
// SKALD_DEV_AUTH_BYPASS_ALLOW_PROD=1; otherwise we hard-exit so an accidental
// misconfig can't ship a wide-open auth bypass.
if (isDevAuthBypassEnabled() && process.env.NODE_ENV !== 'development') {
	const allowProd =
		process.env.SKALD_DEV_AUTH_BYPASS_ALLOW_PROD === '1' ||
		process.env.SKALD_DEV_AUTH_BYPASS_ALLOW_PROD === 'true';
	// Lazy import to avoid a logger-loads-devAuth-loads-logger cycle in tests.
	void import('./logger.js').then(({ logger }) => {
		if (allowProd) {
			logger.warn('SKALD_DEV_AUTH_BYPASS is enabled in non-dev env (explicitly allowed)', {
				nodeEnv: process.env.NODE_ENV ?? '(unset)',
			});
		} else {
			logger.error('SKALD_DEV_AUTH_BYPASS is enabled but NODE_ENV is not "development"', {
				nodeEnv: process.env.NODE_ENV ?? '(unset)',
				hint: 'either unset SKALD_DEV_AUTH_BYPASS, or set SKALD_DEV_AUTH_BYPASS_ALLOW_PROD=1 to opt-in',
			});
			// Refusing to boot is the safer default — an accidental bypass in
			// prod is much worse than a noisy crash that forces an explicit
			// decision.
			process.exit(1);
		}
	});
}
