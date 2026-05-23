<script lang="ts">
	import { WifiOff, Loader2 } from 'lucide-svelte';

	/**
	 * Blocking overlay shown when the realtime SSE channel is down.
	 *
	 * Visibility is driven entirely by `connectionState` — the parent passes
	 * the realtime store's state directly. We render nothing for `connecting`
	 * and `connected`; this avoids any "show then hide" flash during the
	 * normal handshake on a healthy load.
	 *
	 * The prop is deliberately NOT named `state`: in Svelte 5, `$state(...)`
	 * inside a script that also has a `state` prop trips the parser's store
	 * auto-subscribe heuristic (`$store` → `state.subscribe(...)`).
	 */
	let {
		connectionState,
		onretry
	}: {
		connectionState: 'connecting' | 'connected' | 'reconnecting' | 'failed';
		onretry: () => void;
	} = $props();

	// Disable the retry button briefly after a click so an impatient user
	// can't spam-fire EventSource opens against an unreachable server.
	let retrying = $state(false);
	let retryLockTimer: ReturnType<typeof setTimeout> | null = null;

	function handleRetry() {
		if (retrying) return;
		retrying = true;
		onretry();
		if (retryLockTimer) clearTimeout(retryLockTimer);
		retryLockTimer = setTimeout(() => { retrying = false; }, 1500);
	}

	// If the connection actually recovers, drop the spinner state immediately
	// so the next time the overlay reappears it doesn't open in a stale
	// "retrying" pose. (The overlay itself unmounts on 'connected', but the
	// state may briefly flip to 'reconnecting' before any retry click.)
	$effect(() => {
		if (connectionState === 'connected') {
			retrying = false;
			if (retryLockTimer) { clearTimeout(retryLockTimer); retryLockTimer = null; }
		}
	});

	const show = $derived(connectionState === 'reconnecting' || connectionState === 'failed');
</script>

{#if show}
	<div
		role="alertdialog"
		aria-modal="true"
		aria-labelledby="disconnect-overlay-title"
		aria-describedby="disconnect-overlay-body"
		class="fixed inset-0 z-[300] flex items-center justify-center bg-background"
	>
		<div class="mx-4 flex w-full max-w-sm flex-col items-center gap-5 rounded-2xl border border-border bg-card p-8 text-center shadow-2xl">
			<div class="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
				{#if connectionState === 'failed'}
					<WifiOff class="h-6 w-6 text-muted-foreground" />
				{:else}
					<Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
				{/if}
			</div>
			<div class="flex flex-col gap-2">
				<h2 id="disconnect-overlay-title" class="text-lg font-semibold text-foreground">
					{connectionState === 'failed' ? 'Can’t reach the server' : 'Reconnecting…'}
				</h2>
				<p id="disconnect-overlay-body" class="text-sm leading-relaxed text-muted-foreground">
					{#if connectionState === 'failed'}
						We’ve been unable to reach the server for several minutes. Check that it’s running, then retry.
					{:else}
						The connection to the server has dropped. We’re trying to reconnect automatically.
					{/if}
				</p>
			</div>
			<button
				type="button"
				onclick={handleRetry}
				disabled={retrying}
				class="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100"
			>
				{#if retrying}
					<Loader2 class="h-4 w-4 animate-spin" />
					Retrying…
				{:else}
					Retry now
				{/if}
			</button>
		</div>
	</div>
{/if}
