import { invalidateAll } from '$app/navigation';

/**
 * OIDC + dev sign-in glue for the login screen.
 *
 * Sign-in is a top-level navigation (`location.replace`), not a popup —
 * that gives us the standard OIDC flow that every browser handles
 * identically, and `replace` keeps history depth unchanged so mobile
 * swipe-back gestures still belong to the sidebar drawer, not navigation.
 *
 * Call once from `+layout.svelte`. The composable also surfaces server-side
 * OIDC errors that bounced back as `?oidc_error=…`.
 */
export function createOidcSignIn() {
	let error = $state('');

	function signIn() {
		if (typeof window === 'undefined') return;
		// `replace` instead of `assign` so the IdP entry doesn't end up in
		// session history. After IdP→callback→/, history depth is unchanged.
		window.location.replace('/api/auth/oidc');
	}

	/** Dev-only auth bypass — gated server-side by SKALD_DEV_AUTH_BYPASS=1. */
	async function devSignIn() {
		error = '';
		try {
			const res = await fetch('/api/auth/dev-login', { method: 'POST' });
			if (!res.ok) {
				error = `Dev sign-in failed (${res.status})`;
				return;
			}
			await invalidateAll();
		} catch (err) {
			error = `Dev sign-in failed: ${err instanceof Error ? err.message : String(err)}`;
		}
	}

	// Surface server-side OIDC errors that came back via the redirect query param.
	$effect(() => {
		if (typeof window === 'undefined') return;
		const params = new URLSearchParams(window.location.search);
		const err = params.get('oidc_error');
		if (err) {
			error = err;
			const clean = new URL(window.location.href);
			clean.searchParams.delete('oidc_error');
			window.history.replaceState({}, '', clean.pathname + clean.search);
		}
	});

	return {
		get error() {
			return error;
		},
		clearError() {
			error = '';
		},
		signIn,
		devSignIn
	};
}
