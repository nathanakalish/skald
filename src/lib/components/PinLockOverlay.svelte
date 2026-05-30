<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { pinLock } from '$lib/stores/pinLock.svelte.js';
	import { KeyRound } from 'lucide-svelte';
	import Button from '$lib/components/ui/Button.svelte';

	let pinInput = $state('');
	let inputEl = $state<HTMLInputElement | undefined>();
	let busy = $state(false);
	let error = $state('');
	let retryAfterMs = $state(0);
	let now = $state(Date.now());

	// Tick a second-resolution clock only while we're locked out so the
	// countdown is live. Cheap because we tear it down on unlock.
	$effect(() => {
		if (!pinLock.locked || retryAfterMs <= 0) return;
		const id = setInterval(() => { now = Date.now(); }, 250);
		return () => clearInterval(id);
	});

	let lockoutStart = $state(0);
	let lockoutRemainingSec = $derived(retryAfterMs > 0 ? Math.max(0, Math.ceil((retryAfterMs - (now - lockoutStart)) / 1000)) : 0);

	$effect(() => {
		if (pinLock.locked) {
			pinInput = '';
			error = '';
			// Focus the input after the overlay paints.
			tick().then(() => inputEl?.focus());
		}
	});

	async function submit(e?: SubmitEvent) {
		e?.preventDefault();
		if (busy || lockoutRemainingSec > 0) return;
		if (!/^\d{4,8}$/.test(pinInput)) {
			error = 'PIN must be 4–8 digits';
			return;
		}
		busy = true;
		error = '';
		try {
			const res = await fetch('/api/account/pin/verify', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ pin: pinInput })
			});
			const data = await res.json().catch(() => ({}));
			if (res.ok) {
				pinLock.unlock();
				pinInput = '';
				retryAfterMs = 0;
				return;
			}
			if (res.status === 429 && typeof data.retryAfterMs === 'number') {
				retryAfterMs = data.retryAfterMs;
				lockoutStart = Date.now();
				error = 'Too many attempts. Try again shortly.';
			} else {
				error = data.error || 'Incorrect PIN';
			}
			pinInput = '';
			await tick();
			inputEl?.focus();
		} catch {
			error = 'Network error';
		} finally {
			busy = false;
		}
	}

	onMount(() => {
		// Block keyboard shortcuts and tabbing out of the overlay while locked.
		// Click-based focus moves can still happen, but everything else
		// behind the overlay is `pointer-events: none` via the z-index trap.
	});
</script>

{#if pinLock.locked}
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div
		class="fixed inset-0 z-[200] flex items-center justify-center bg-background/95 backdrop-blur-md"
		role="dialog"
		aria-modal="true"
		aria-label="Locked"
	>
		<div class="w-full max-w-sm space-y-5 rounded-2xl border border-border bg-translucent backdrop-blur-md p-6 shadow-2xl" style="--translucent-base: 1;">
			<div class="flex flex-col items-center gap-2 text-center">
				<div class="flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary">
					<KeyRound class="h-6 w-6" />
				</div>
				<h2 class="text-lg font-semibold">Enter your PIN</h2>
				<p class="text-sm text-muted-foreground">This app is locked. Enter your PIN to continue.</p>
			</div>

			<form onsubmit={submit} class="space-y-3">
				<input
					bind:this={inputEl}
					bind:value={pinInput}
					type="password"
					inputmode="numeric"
					autocomplete="off"
					pattern="\d*"
					maxlength="8"
					minlength="4"
					disabled={busy || lockoutRemainingSec > 0}
					class="w-full rounded-lg border border-input bg-background px-4 py-3 text-center text-xl tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
					placeholder="••••"
				/>

				{#if lockoutRemainingSec > 0}
					<p class="text-center text-sm text-destructive">Locked out — try again in {lockoutRemainingSec}s</p>
				{:else if error}
					<p class="text-center text-sm text-destructive">{error}</p>
				{/if}

				<Button
					variant="primary"
					type="submit"
					fullWidth
					loading={busy}
					disabled={busy || lockoutRemainingSec > 0 || pinInput.length < 4}
				>{busy ? 'Checking…' : 'Unlock'}</Button>
			</form>
		</div>
	</div>
{/if}
