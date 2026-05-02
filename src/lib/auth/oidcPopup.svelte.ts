import { invalidateAll } from '$app/navigation';

/**
 * Owns the OIDC sign-in popup flow + dev bypass + error display state.
 *
 * Call once from `+layout.svelte` and bind the returned `.error` getter to
 * the sign-in UI. The composable wires its own `message` listener for popup
 * callbacks and parses `?oidc_error=` from the URL on mount.
 *
 * Must be called from inside an `$effect.root` or component init so its own
 * `$effect` blocks register correctly.
 */
export function createOidcPopup() {
	let error = $state('');

	function openPopup() {
		if (typeof window === 'undefined') return;
		const w = 500;
		const h = 650;
		const left = window.screenX + (window.outerWidth - w) / 2;
		const top = window.screenY + (window.outerHeight - h) / 2;
		const popup = window.open(
			'/api/auth/oidc',
			'oidc-login',
			`width=${w},height=${h},left=${left},top=${top},popup=1`
		);
		if (!popup || popup.closed) {
			error = 'Popup was blocked. Please allow popups for this site and try again.';
		}
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

	function handleOidcMessage(e: MessageEvent) {
		if (e.origin !== window.location.origin) return;
		if (e.data?.type !== 'oidc-callback') return;
		if (e.data.success) {
			error = '';
			invalidateAll();
		} else if (e.data.error) {
			error = e.data.error;
		}
	}

	// Listen for postMessage callbacks from the popup window.
	$effect(() => {
		if (typeof window === 'undefined') return;
		window.addEventListener('message', handleOidcMessage);
		return () => window.removeEventListener('message', handleOidcMessage);
	});

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
		openPopup,
		devSignIn
	};
}
