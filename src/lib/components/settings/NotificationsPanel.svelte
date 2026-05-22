<script lang="ts">
	import { Bell } from 'lucide-svelte';
	import { slide } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import { toasts } from '$lib/stores/toast.svelte.js';
	import { settingsStore } from '$lib/stores/settings.svelte.js';
	import { urlBase64ToUint8Array } from '$lib/utils.js';
	import { tooltip } from '$lib/tooltip.js';
	import ToggleSwitch from '$lib/components/settings/ToggleSwitch.svelte';
	import SettingRow from '$lib/components/settings/SettingRow.svelte';

	interface Props {
		active: boolean;
	}
	let { active }: Props = $props();

	const s = $derived(settingsStore.settings);

	async function save(key: string, value: string | boolean | number) {
		const ok = await settingsStore.save(key as any, value);
		if (ok) toasts.success('Setting saved');
	}

	async function toggle(key: keyof typeof s) {
		await save(String(key), !s[key]);
	}

	// Per-device silent toggle is browser-local; doesn't go through settingsStore.
	let localDeviceSilent = $state(false);

	// Notification permission state
	let notifPermission = $state<string>('unsupported');
	let notifStatus = $state('');
	let isSecureCtx = $state(true);

	// Web push subscription state
	let pushSubscribed = $state(false);
	let pushLoading = $state(false);
	let pushStatus = $state('');

	$effect(() => {
		if (active) {
			if ('Notification' in window) notifPermission = Notification.permission;
			isSecureCtx = typeof window.isSecureContext === 'boolean' ? window.isSecureContext : true;
			if (typeof localStorage !== 'undefined') {
				localDeviceSilent = localStorage.getItem('skald-device-silent') === 'true';
			}
			if (notifPermission === 'granted' && 'PushManager' in window) {
				navigator.serviceWorker?.ready.then(async (reg) => {
					const sub = await reg.pushManager.getSubscription();
					pushSubscribed = !!sub;
				});
			}
		}
	});

	function requestNotifPermission() {
		Notification.requestPermission().then((result) => {
			notifPermission = result;
			if (result !== 'granted') {
				notifStatus = `Permission returned "${result}". On iOS, go to Settings → Notifications → Skald and enable Allow Notifications, then try again.`;
			} else {
				notifStatus = '';
				subscribeToPush();
			}
		}).catch((err) => {
			notifStatus = `Error: ${err instanceof Error ? err.message : String(err)}`;
		});
	}

	async function subscribeToPush() {
		if (!('PushManager' in window)) { pushStatus = 'Push not supported in this browser.'; return; }
		pushLoading = true;
		pushStatus = '';
		try {
			const keyRes = await fetch('/api/push/vapid-key');
			const { key } = await keyRes.json();
			if (!key) { pushStatus = 'Server has no VAPID key configured.'; return; }

			const reg = await navigator.serviceWorker.ready;
			const sub = await reg.pushManager.subscribe({
				userVisibleOnly: true,
				applicationServerKey: urlBase64ToUint8Array(key)
			});

			const subJson = sub.toJSON();
			await fetch('/api/push/subscribe', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ endpoint: subJson.endpoint, keys: subJson.keys })
			});

			pushSubscribed = true;
			pushStatus = '';
		} catch (err) {
			pushStatus = `Failed: ${err instanceof Error ? err.message : String(err)}`;
		} finally {
			pushLoading = false;
		}
	}

	async function unsubscribeFromPush() {
		pushLoading = true;
		pushStatus = '';
		try {
			const reg = await navigator.serviceWorker.ready;
			const sub = await reg.pushManager.getSubscription();
			if (sub) {
				await fetch('/api/push/unsubscribe', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ endpoint: sub.endpoint })
				});
				await sub.unsubscribe();
			}
			pushSubscribed = false;
		} catch (err) {
			pushStatus = `Failed: ${err instanceof Error ? err.message : String(err)}`;
		} finally {
			pushLoading = false;
		}
	}

	async function testPush() {
		pushLoading = true;
		pushStatus = '';
		try {
			const res = await fetch('/api/push/test', { method: 'POST' });
			const data = await res.json();
			if (!res.ok) {
				pushStatus = `Test failed: ${data.error || res.statusText}`;
			} else {
				pushStatus = 'Test sent — you should receive a notification shortly.';
			}
		} catch (err) {
			pushStatus = `Test failed: ${err instanceof Error ? err.message : String(err)}`;
		} finally {
			pushLoading = false;
		}
	}

	function toggleDeviceSilent() {
		localDeviceSilent = !localDeviceSilent;
		try {
			localStorage.setItem('skald-device-silent', String(localDeviceSilent));
			window.dispatchEvent(new CustomEvent('skald-device-silent-change', { detail: localDeviceSilent }));
		} catch { /* ignore */ }
	}
</script>

<div class="space-y-6">
	<div>
		<h3 class="text-base font-semibold">Notifications</h3>
		<p class="text-sm text-muted-foreground">Manage notification preferences</p>
	</div>

	{#if !isSecureCtx}
		<div class="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 space-y-1">
			<p class="text-sm font-medium text-amber-500">Notifications require HTTPS</p>
			<p class="text-xs text-muted-foreground">Web Push uses VAPID, which browsers only allow on secure origins (HTTPS or <code>localhost</code>). Reach Skald over HTTPS to enable notifications.</p>
		</div>
		<button
			type="button"
			disabled
			aria-disabled="true"
			use:tooltip={'HTTPS required for notifications'}
			class="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground opacity-50 cursor-not-allowed"
		>
			<Bell class="h-4 w-4" />
			Enable Notifications
		</button>
	{:else if notifPermission === 'unsupported'}
		<div class="rounded-lg border border-border px-4 py-3">
			<p class="text-sm text-muted-foreground">Notifications are not supported in this browser.</p>
		</div>
	{:else if notifPermission === 'granted'}
		<div class="flex items-center gap-2 rounded-lg border border-green-500/20 bg-green-500/5 px-4 py-3 text-sm text-green-500">
			<Bell class="h-4 w-4" />
			<span>Notifications enabled</span>
		</div>
		<p class="text-sm text-muted-foreground">You'll receive alerts when background responses complete.</p>
	{:else}
		<button
			onclick={requestNotifPermission}
			class="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
		>
			<Bell class="h-4 w-4" />
			Enable Notifications
		</button>
		<p class="text-sm text-muted-foreground">Get alerts when background responses complete.</p>
		{#if notifStatus}
			<p class="text-xs text-amber-500">{notifStatus}</p>
		{/if}
	{/if}

	<!-- Notification content -->
	<div class={!isSecureCtx ? 'pointer-events-none opacity-50' : ''} aria-disabled={!isSecureCtx}>
		<SettingRow label="Notification content" description="What to show in the notification body.">
			<div class="flex gap-2 flex-wrap">
				{#each [{ value: 'generic', label: 'Generic' }, { value: 'preview', label: 'Message preview' }] as opt}
					<button
						class="rounded-lg border px-3 py-1.5 text-sm transition-colors {s.notificationStyle === opt.value ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent'}"
						onclick={() => save('notificationStyle', opt.value)}
					>
						{opt.label}
					</button>
				{/each}
			</div>
		</SettingRow>
	</div>

	<div class="{!isSecureCtx ? 'pointer-events-none opacity-50 space-y-3' : 'space-y-3'}" aria-disabled={!isSecureCtx}>
		<div class="grid gap-3 @xl:grid-cols-2">
			<ToggleSwitch
				label="Notification sound"
				description="Play a sound when a background response completes."
				checked={s.notificationSound}
				onchange={() => toggle('notificationSound')}
			/>
			<ToggleSwitch
				label="Show character avatar"
				description="Use the character's avatar as the notification icon. Not supported on Safari or iOS."
				checked={s.notificationAvatar}
				onchange={() => toggle('notificationAvatar')}
			/>
		</div>

		<ToggleSwitch
			label="In-app notifications"
			description="Show a brief toast when a message arrives for a different chat while you're using the app."
			checked={s.inAppNotifications}
			onchange={() => toggle('inAppNotifications')}
		/>

		<!-- Toast duration: 1-30 seconds, plus a 31st position that means "stay until dismissed". -->
		<div class={!s.inAppNotifications ? 'opacity-50 pointer-events-none' : ''}>
			<SettingRow
				label="Toast duration"
				description="How long in-app notifications stay on screen."
			>
				{#snippet action()}
					<span class="shrink-0 text-sm font-medium tabular-nums text-foreground">
						{s.notificationDuration >= 31 ? 'Until dismissed' : `${s.notificationDuration}s`}
					</span>
				{/snippet}
				<input
					type="range"
					min="1"
					max="31"
					step="1"
					value={s.notificationDuration}
					onchange={(e) => save('notificationDuration', String((e.target as HTMLInputElement).value))}
					class="w-full"
					aria-label="In-app notification duration"
				/>
			</SettingRow>
		</div>

		<!-- Silence this device (per-device, local-only) -->
		<ToggleSwitch
			label="Silence this device"
			description="Mute toast, sound, and OS notifications on this device only. Other devices unaffected."
			checked={localDeviceSilent}
			onchange={toggleDeviceSilent}
		/>

		<!-- Quiet hours -->
		<div class="rounded-lg border border-border">
			<ToggleSwitch
				label="Quiet hours"
				description="Suppress all notifications (push + in-app) during this window."
				checked={s.quietHoursEnabled}
				onchange={() => toggle('quietHoursEnabled')}
			/>
			{#if s.quietHoursEnabled}
				<div
					class="flex items-center gap-3 border-t border-border px-4 py-3"
					transition:slide={{ duration: s.reduceMotion ? 0 : 200, easing: quintOut, axis: 'y' }}
				>
					<label class="flex items-center gap-2 text-sm">
						<span class="text-muted-foreground">From</span>
						<input
							type="time"
							value={s.quietHoursStart}
							onchange={(e) => save('quietHoursStart', (e.target as HTMLInputElement).value)}
							class="rounded-md border border-border bg-background px-2 py-1 text-sm"
						/>
					</label>
					<label class="flex items-center gap-2 text-sm">
						<span class="text-muted-foreground">to</span>
						<input
							type="time"
							value={s.quietHoursEnd}
							onchange={(e) => save('quietHoursEnd', (e.target as HTMLInputElement).value)}
							class="rounded-md border border-border bg-background px-2 py-1 text-sm"
						/>
					</label>
				</div>
			{/if}
		</div>
	</div>

	<!-- Web Push Notifications -->
	{#if notifPermission === 'granted' && 'PushManager' in globalThis}
		<SettingRow label="Background push notifications" description="Receive notifications even when Skald isn't open. Works on mobile and desktop.">
			{#if pushSubscribed}
				<div class="flex items-center gap-3">
					<div class="flex items-center gap-2 text-sm text-green-500">
						<Bell class="h-4 w-4" />
						<span>Push active on this device</span>
					</div>
					<button
						onclick={unsubscribeFromPush}
						disabled={pushLoading}
						class="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50"
					>
						{pushLoading ? 'Working...' : 'Disable'}
					</button>
				</div>
				<button
					onclick={testPush}
					disabled={pushLoading}
					class="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50"
				>
					Send test notification
				</button>
			{:else}
				<button
					onclick={subscribeToPush}
					disabled={pushLoading}
					class="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
				>
					<Bell class="h-4 w-4" />
					{pushLoading ? 'Setting up...' : 'Enable push for this device'}
				</button>
			{/if}
			{#if pushStatus}
				<p class="text-xs text-amber-500">{pushStatus}</p>
			{/if}
		</SettingRow>
	{/if}
</div>
