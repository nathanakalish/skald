<script lang="ts">
	import { KeyRound, Lock, Unlock } from 'lucide-svelte';
	import { pinLock } from '$lib/stores/pinLock.svelte.js';
	import { toasts } from '$lib/stores/toast.svelte.js';

	type PinPolicy = 'on-focus' | 'on-open' | 'timeout';

	let mode = $state<'idle' | 'set' | 'change' | 'remove'>('idle');
	let busy = $state(false);

	// Form fields — reused across set / change / remove. Cleared on submit
	// or cancel so a leftover digit can't sneak into the next operation.
	let currentPin = $state('');
	let newPin = $state('');
	let confirmPin = $state('');
	let policy = $state<PinPolicy>('on-focus');
	let timeoutMinutes = $state(5);
	let formError = $state('');

	// Policy-only edits (no PIN change) use this card; pre-populated from the
	// hydrated store on open so the displayed values match reality.
	let editingPolicy = $state(false);
	let policyDraft = $state<PinPolicy>('on-focus');
	let policyTimeoutDraft = $state(5);

	function startSet() {
		mode = 'set';
		currentPin = '';
		newPin = '';
		confirmPin = '';
		policy = 'on-focus';
		timeoutMinutes = 5;
		formError = '';
	}

	function startChange() {
		mode = 'change';
		currentPin = '';
		newPin = '';
		confirmPin = '';
		formError = '';
	}

	function startRemove() {
		mode = 'remove';
		currentPin = '';
		formError = '';
	}

	function cancel() {
		mode = 'idle';
		formError = '';
		currentPin = newPin = confirmPin = '';
	}

	function validateNewPin(): string | null {
		if (!/^\d{4,8}$/.test(newPin)) return 'PIN must be 4–8 digits';
		if (newPin !== confirmPin) return 'PINs do not match';
		return null;
	}

	async function submitSet() {
		formError = validateNewPin() ?? '';
		if (formError) return;
		busy = true;
		try {
			const res = await fetch('/api/account/pin', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ newPin, policy, timeoutMinutes: policy === 'timeout' ? timeoutMinutes : undefined })
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) { formError = data.error || 'Failed to set PIN'; return; }
			pinLock.updatePolicy({ enabled: true, policy: data.policy, timeoutMinutes: data.timeoutMinutes });
			toasts.success('PIN set');
			cancel();
		} finally { busy = false; }
	}

	async function submitChange() {
		formError = validateNewPin() ?? '';
		if (formError) return;
		if (!/^\d{4,8}$/.test(currentPin)) { formError = 'Enter your current PIN'; return; }
		busy = true;
		try {
			const res = await fetch('/api/account/pin', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ currentPin, newPin })
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) { formError = data.error || 'Failed to change PIN'; return; }
			toasts.success('PIN updated');
			cancel();
		} finally { busy = false; }
	}

	async function submitRemove() {
		if (!/^\d{4,8}$/.test(currentPin)) { formError = 'Enter your current PIN'; return; }
		busy = true;
		try {
			const res = await fetch('/api/account/pin', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ currentPin })
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) { formError = data.error || 'Failed to remove PIN'; return; }
			pinLock.updatePolicy({ enabled: false, policy: 'disabled', timeoutMinutes: null });
			toasts.success('PIN removed');
			cancel();
		} finally { busy = false; }
	}

	function startPolicyEdit() {
		policyDraft = (pinLock.policy === 'disabled' ? 'on-focus' : pinLock.policy) as PinPolicy;
		policyTimeoutDraft = pinLock.timeoutMinutes ?? 5;
		editingPolicy = true;
	}

	async function savePolicy() {
		busy = true;
		try {
			const res = await fetch('/api/account/pin', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ policy: policyDraft, timeoutMinutes: policyDraft === 'timeout' ? policyTimeoutDraft : undefined })
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) { toasts.error(data.error || 'Failed to update policy'); return; }
			pinLock.updatePolicy({ enabled: true, policy: data.policy, timeoutMinutes: data.timeoutMinutes });
			toasts.success('Lock policy updated');
			editingPolicy = false;
		} finally { busy = false; }
	}

	function policyLabel(p: string): string {
		switch (p) {
			case 'on-focus': return 'Every time the app regains focus';
			case 'on-open': return 'When the app is first opened';
			case 'timeout': return `After ${pinLock.timeoutMinutes ?? '?'} minute${pinLock.timeoutMinutes === 1 ? '' : 's'} of inactivity`;
			default: return 'Disabled';
		}
	}
</script>

<div class="rounded-xl border border-border p-4 space-y-3">
	<div class="flex items-center gap-3">
		<div class="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-primary">
			<KeyRound class="h-4 w-4" />
		</div>
		<div class="min-w-0 flex-1">
			<p class="font-medium">PIN lock</p>
			<p class="text-xs text-muted-foreground">
				{#if pinLock.enabled}
					{policyLabel(pinLock.policy)}
				{:else}
					Optional 4–8 digit PIN to guard the app against prying eyes.
				{/if}
			</p>
		</div>
		<div class="shrink-0">
			{#if pinLock.enabled}
				<Lock class="h-4 w-4 text-primary" />
			{:else}
				<Unlock class="h-4 w-4 text-muted-foreground" />
			{/if}
		</div>
	</div>

	{#if mode === 'idle' && !editingPolicy}
		<div class="flex flex-wrap gap-2">
			{#if pinLock.enabled}
				<button onclick={startPolicyEdit} class="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent">Change policy</button>
				<button onclick={startChange} class="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent">Change PIN</button>
				<button onclick={startRemove} class="rounded-lg border border-destructive/30 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10">Remove PIN</button>
			{:else}
				<button onclick={startSet} class="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">Set PIN</button>
			{/if}
		</div>
	{/if}

	<div class="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted-foreground">
		<p class="font-medium text-amber-500">Heads up — this is a light guard, not hardened security.</p>
		<p class="mt-1">It keeps the UI out of the way of someone glancing at your screen, but anyone with browser dev tools or technical know-how could bypass it. Don't rely on it to protect truly sensitive data.</p>
	</div>

	{#if editingPolicy}
		<div class="space-y-3 rounded-lg border border-border bg-background p-3">
			<div class="space-y-2">
				<span class="block text-xs font-medium text-muted-foreground">Lock the app…</span>
				<div class="flex flex-col gap-1.5">
					<label class="flex items-center gap-2 text-sm">
						<input type="radio" bind:group={policyDraft} value="on-focus" />
						Every time the app regains focus
					</label>
					<label class="flex items-center gap-2 text-sm">
						<input type="radio" bind:group={policyDraft} value="on-open" />
						Only when the app is first opened
					</label>
					<label class="flex items-center gap-2 text-sm">
						<input type="radio" bind:group={policyDraft} value="timeout" />
						After
						<input
							type="number"
							min="1"
							max="1440"
							bind:value={policyTimeoutDraft}
							disabled={policyDraft !== 'timeout'}
							class="w-16 rounded border border-input bg-background px-2 py-0.5 text-sm disabled:opacity-50"
						/>
						minutes of inactivity
					</label>
				</div>
			</div>
			<div class="flex justify-end gap-2">
				<button onclick={() => (editingPolicy = false)} class="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent">Cancel</button>
				<button onclick={savePolicy} disabled={busy} class="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">Save</button>
			</div>
		</div>
	{/if}

	{#if mode === 'set'}
		<div class="space-y-3 rounded-lg border border-border bg-background p-3">
			<div>
				<span class="mb-1 block text-xs font-medium text-muted-foreground">New PIN (4–8 digits)</span>
				<input type="password" inputmode="numeric" pattern="\d*" maxlength="8" bind:value={newPin}
					class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
			</div>
			<div>
				<span class="mb-1 block text-xs font-medium text-muted-foreground">Confirm PIN</span>
				<input type="password" inputmode="numeric" pattern="\d*" maxlength="8" bind:value={confirmPin}
					class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
			</div>
			<div class="space-y-2">
				<span class="block text-xs font-medium text-muted-foreground">Lock the app…</span>
				<div class="flex flex-col gap-1.5">
					<label class="flex items-center gap-2 text-sm">
						<input type="radio" bind:group={policy} value="on-focus" />
						Every time the app regains focus
					</label>
					<label class="flex items-center gap-2 text-sm">
						<input type="radio" bind:group={policy} value="on-open" />
						Only when the app is first opened
					</label>
					<label class="flex items-center gap-2 text-sm">
						<input type="radio" bind:group={policy} value="timeout" />
						After
						<input type="number" min="1" max="1440" bind:value={timeoutMinutes}
							disabled={policy !== 'timeout'}
							class="w-16 rounded border border-input bg-background px-2 py-0.5 text-sm disabled:opacity-50" />
						minutes of inactivity
					</label>
				</div>
			</div>
			{#if formError}<p class="text-sm text-destructive">{formError}</p>{/if}
			<div class="flex justify-end gap-2">
				<button onclick={cancel} class="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent">Cancel</button>
				<button onclick={submitSet} disabled={busy} class="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">Set PIN</button>
			</div>
		</div>
	{/if}

	{#if mode === 'change'}
		<div class="space-y-3 rounded-lg border border-border bg-background p-3">
			<div>
				<span class="mb-1 block text-xs font-medium text-muted-foreground">Current PIN</span>
				<input type="password" inputmode="numeric" pattern="\d*" maxlength="8" bind:value={currentPin}
					class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
			</div>
			<div>
				<span class="mb-1 block text-xs font-medium text-muted-foreground">New PIN (4–8 digits)</span>
				<input type="password" inputmode="numeric" pattern="\d*" maxlength="8" bind:value={newPin}
					class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
			</div>
			<div>
				<span class="mb-1 block text-xs font-medium text-muted-foreground">Confirm new PIN</span>
				<input type="password" inputmode="numeric" pattern="\d*" maxlength="8" bind:value={confirmPin}
					class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
			</div>
			{#if formError}<p class="text-sm text-destructive">{formError}</p>{/if}
			<div class="flex justify-end gap-2">
				<button onclick={cancel} class="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent">Cancel</button>
				<button onclick={submitChange} disabled={busy} class="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">Update</button>
			</div>
		</div>
	{/if}

	{#if mode === 'remove'}
		<div class="space-y-3 rounded-lg border border-border bg-background p-3">
			<p class="text-sm text-muted-foreground">Enter your current PIN to remove the lock.</p>
			<input type="password" inputmode="numeric" pattern="\d*" maxlength="8" bind:value={currentPin}
				class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
			{#if formError}<p class="text-sm text-destructive">{formError}</p>{/if}
			<div class="flex justify-end gap-2">
				<button onclick={cancel} class="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent">Cancel</button>
				<button onclick={submitRemove} disabled={busy} class="rounded-lg bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50">Remove PIN</button>
			</div>
		</div>
	{/if}
</div>
