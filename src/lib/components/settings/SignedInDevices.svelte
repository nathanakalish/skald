<script lang="ts">
	import { Bell, BellOff, LogOut, Monitor, Loader2, RefreshCw } from 'lucide-svelte';
	import { onMount } from 'svelte';
	import { slide } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import { toasts } from '$lib/stores/toast.svelte.js';
	import { settingsStore } from '$lib/stores/settings.svelte.js';
	import ConfirmModal from '$lib/components/ConfirmModal.svelte';
	import { tooltip } from '$lib/tooltip.js';

	/**
	 * Unified device list: each row is one physical device, showing both its
	 * sign-in session (if any) and its push subscription state (if any).
	 *
	 * Sessions and push subscriptions live in different tables and aren't
	 * formally linked, so we best-effort merge by user-agent string. A device
	 * may appear with only a session (push not enabled), only a push
	 * subscription (session expired but the browser is still receiving
	 * notifications), or both.
	 */

	interface Session {
		id: string;
		fingerprint: string;
		current: boolean;
		userAgent: string;
		createdAt: string | null;
		lastSeenAt: string | null;
		expiresAt: string;
		notificationsDisabledAt: string | null;
	}

	interface PushDevice {
		id: number;
		fingerprint: string;
		endpoint: string;
		userAgent: string | null;
		sessionId: string | null;
		createdAt: string | null;
	}

	interface DeviceRow {
		key: string;
		session: Session | null;
		push: PushDevice | null;
		isCurrent: boolean;
	}

	let sessions = $state<Session[]>([]);
	let pushDevices = $state<PushDevice[]>([]);
	let loading = $state(true);
	let error = $state('');
	let acting = $state<string | null>(null);
	let actingPush = $state<number | null>(null);
	let localEndpoint = $state<string | null>(null);

	type PendingAction =
		| { kind: 'signOut'; session: Session; title: string; message: string }
		| { kind: 'stopPush'; push: PushDevice; isCurrent: boolean; title: string; message: string };

	let pending = $state<PendingAction | null>(null);

	async function getLocalEndpoint(): Promise<string | null> {
		try {
			if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
			const reg = await navigator.serviceWorker.ready;
			const sub = await reg.pushManager.getSubscription();
			return sub?.endpoint ?? null;
		} catch {
			return null;
		}
	}

	async function load() {
		loading = true;
		error = '';
		try {
			const [sessRes, devRes, ep] = await Promise.all([
				fetch('/api/auth/sessions'),
				fetch('/api/push/devices'),
				getLocalEndpoint()
			]);
			localEndpoint = ep;
			if (!sessRes.ok || !devRes.ok) {
				error = 'Failed to load devices';
				return;
			}
			const sessData = await sessRes.json();
			const devData = await devRes.json();
			sessions = sessData.sessions ?? [];
			pushDevices = devData.devices ?? [];
		} catch (err) {
			error = err instanceof Error ? err.message : 'Network error';
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		void load();
	});

	const rows = $derived.by<DeviceRow[]>(() => {
		const out: DeviceRow[] = [];
		const usedPushIds = new Set<number>();

		// First pass: each session, optionally paired with the push device
		// that was registered by this very session. We used to UA-match here
		// but identical user-agents (two iPhones, two Chromes on Windows)
		// silently cross-linked rows. Push subs carry their owning sessionId
		// now, so use that as the authoritative pairing key. Fall back to UA
		// only for legacy rows whose sessionId was never set.
		for (const sess of sessions) {
			let matchPush = pushDevices.find(
				(d) => !usedPushIds.has(d.id) && d.sessionId === sess.id
			) ?? null;
			if (!matchPush) {
				const ua = sess.userAgent ?? '';
				matchPush = pushDevices.find(
					(d) => !usedPushIds.has(d.id) && !d.sessionId && (d.userAgent ?? '') === ua
				) ?? null;
			}
			if (matchPush) usedPushIds.add(matchPush.id);
			const isCurrent = sess.current;
			out.push({
				key: `s:${sess.fingerprint}`,
				session: sess,
				push: matchPush,
				isCurrent
			});
		}

		// Second pass: push devices that didn't match any session.
		for (const dev of pushDevices) {
			if (usedPushIds.has(dev.id)) continue;
			out.push({
				key: `p:${dev.id}`,
				session: null,
				push: dev,
				isCurrent: dev.endpoint === localEndpoint
			});
		}

		// Current device floats to top.
		out.sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent));
		return out;
	});

	function askSignOut(row: DeviceRow) {
		if (!row.session) return;
		const sess = row.session;
		pending = {
			kind: 'signOut',
			session: sess,
			title: sess.current ? 'Sign out this device?' : 'Sign out device?',
			message: sess.current
				? 'You will be returned to the login screen.'
				: `Sign out "${describeUA(sess.userAgent)}"?`
		};
	}

	function askStopPush(row: DeviceRow) {
		if (!row.push) return;
		const dev = row.push;
		const isCurrent = dev.endpoint === localEndpoint;
		pending = {
			kind: 'stopPush',
			push: dev,
			isCurrent,
			title: 'Stop notifications?',
			message: isCurrent
				? 'Stop sending notifications to this device. The notification banner will reappear here next time you load the app.'
				: `Stop sending notifications to "${describeUA(dev.userAgent)}".`
		};
	}

	async function confirmPending() {
		const p = pending;
		pending = null;
		if (!p) return;
		if (p.kind === 'signOut') await signOut(p.session);
		else await removePushDevice(p.push, p.isCurrent);
	}

	async function signOut(sess: Session) {
		acting = sess.fingerprint;
		try {
			if (sess.current) {
				try {
					if ('serviceWorker' in navigator && 'PushManager' in window) {
						const reg = await navigator.serviceWorker.ready;
						const sub = await reg.pushManager.getSubscription();
						await sub?.unsubscribe();
					}
				} catch { /* best-effort */ }
			}
			const res = await fetch(`/api/auth/sessions/${sess.fingerprint}`, { method: 'DELETE' });
			if (!res.ok) {
				toasts.error('Failed to sign out device');
				return;
			}
			const body = await res.json();
			if (body.signedOutSelf) {
				window.location.reload();
				return;
			}
			sessions = sessions.filter((s) => s.fingerprint !== sess.fingerprint);
			toasts.success('Device signed out');
		} catch (err) {
			toasts.error(err instanceof Error ? err.message : 'Network error');
		} finally {
			acting = null;
		}
	}

	async function removePushDevice(dev: PushDevice, isCurrent: boolean) {
		actingPush = dev.id;
		try {
			if (isCurrent) {
				try {
					if ('serviceWorker' in navigator && 'PushManager' in window) {
						const reg = await navigator.serviceWorker.ready;
						const sub = await reg.pushManager.getSubscription();
						await sub?.unsubscribe();
					}
				} catch { /* best-effort */ }
			}
			const res = await fetch(`/api/push/devices?endpoint=${encodeURIComponent(dev.endpoint)}`, { method: 'DELETE' });
			if (!res.ok) {
				toasts.error('Failed to remove device');
				return;
			}
			pushDevices = pushDevices.filter((d) => d.id !== dev.id);
			toasts.success('Notifications stopped on that device');
			if (isCurrent) {
				localEndpoint = null;
				setTimeout(() => window.location.reload(), 600);
			}
		} catch (err) {
			toasts.error(err instanceof Error ? err.message : 'Network error');
		} finally {
			actingPush = null;
		}
	}

	function describeUA(ua: string | null | undefined): string {
		if (!ua) return 'Unknown device';
		const browser = /Edg\//.test(ua) ? 'Edge'
			: /OPR\/|Opera/.test(ua) ? 'Opera'
			: /Chrome\//.test(ua) ? 'Chrome'
			: /Firefox\//.test(ua) ? 'Firefox'
			: /Safari\//.test(ua) ? 'Safari'
			: 'Browser';
		const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS'
			: /Android/.test(ua) ? 'Android'
			: /Mac OS X/.test(ua) ? 'macOS'
			: /Windows/.test(ua) ? 'Windows'
			: /Linux/.test(ua) ? 'Linux'
			: 'Unknown OS';
		return `${browser} on ${os}`;
	}

	function rowLabel(row: DeviceRow): string {
		const ua = row.session?.userAgent ?? row.push?.userAgent ?? null;
		return describeUA(ua);
	}

	function rowFingerprint(row: DeviceRow): string {
		if (row.session) return row.session.fingerprint;
		if (row.push) return row.push.fingerprint;
		return '';
	}

	function rowSubtitle(row: DeviceRow): string {
		const parts: string[] = [];
		if (row.session) {
			parts.push(`Signed in ${relativeTime(row.session.createdAt)}`);
			parts.push(`last seen ${relativeTime(row.session.lastSeenAt)}`);
		} else if (row.push) {
			parts.push(`Push registered ${relativeTime(row.push.createdAt)}`);
		}
		return parts.join(' · ');
	}

	function relativeTime(iso: string | null): string {
		if (!iso) return '—';
		const t = new Date(iso.replace(' ', 'T') + (iso.endsWith('Z') ? '' : 'Z')).getTime();
		if (!Number.isFinite(t)) return iso;
		const delta = Date.now() - t;
		const m = Math.floor(delta / 60_000);
		if (m < 1) return 'just now';
		if (m < 60) return `${m} min ago`;
		const h = Math.floor(m / 60);
		if (h < 24) return `${h}h ago`;
		const d = Math.floor(h / 24);
		if (d < 30) return `${d}d ago`;
		return new Date(t).toLocaleDateString();
	}
</script>

<div class="space-y-3">
	<div class="flex items-center justify-between gap-2">
		<div class="min-w-0">
			<h4 class="text-sm font-semibold flex items-center gap-1.5"><Monitor class="h-3.5 w-3.5 text-primary" /> Your devices</h4>
			<p class="text-xs text-muted-foreground">Active sign-in sessions and the devices receiving push notifications.</p>
		</div>
		<button
			type="button"
			onclick={load}
			disabled={loading}
			class="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
			use:tooltip={'Refresh'}
			aria-label="Refresh"
		>
			<RefreshCw class="h-4 w-4 {loading ? 'animate-spin' : ''}" />
		</button>
	</div>

	{#if error}
		<div class="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</div>
	{:else if loading && rows.length === 0}
		<div class="rounded-lg border border-border px-4 py-6 text-center text-sm text-muted-foreground">
			<Loader2 class="mx-auto mb-2 h-5 w-5 animate-spin" />
			Loading…
		</div>
	{:else if rows.length === 0}
		<div class="rounded-lg border border-border px-4 py-3 text-sm text-muted-foreground">No devices.</div>
	{:else}
		<ul class="space-y-2">
			{#each rows as row, i (row.key)}
				{@const pushOn = !!row.push}
				<li
					class="device-card-enter rounded-xl border border-border bg-card/40 p-3"
					style="--enter-delay: {Math.min(i * 40, 240)}ms"
					out:slide={{ duration: settingsStore.settings.reduceMotion ? 0 : 220, easing: quintOut, axis: 'y' }}
				>
					<div class="flex items-start gap-3">
						<div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
							<Monitor class="h-4 w-4" />
						</div>
						<div class="min-w-0 flex-1">
							<div class="flex flex-wrap items-center gap-2">
								<span class="text-sm font-medium">{rowLabel(row)}</span>
								{#if row.isCurrent}
									<span class="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">This device</span>
								{/if}
								{#if pushOn}
									<span class="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-500">
										<Bell class="h-3 w-3" /> Notifications on
									</span>
								{:else}
									<span class="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
										<BellOff class="h-3 w-3" /> Notifications off
									</span>
								{/if}
								{#if !row.session}
									<span class="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Signed out</span>
								{/if}
							</div>
							<p class="mt-0.5 truncate text-xs text-muted-foreground" use:tooltip={row.session?.userAgent ?? row.push?.userAgent ?? ''}>
								{rowSubtitle(row)}{rowFingerprint(row) ? ` · #${rowFingerprint(row)}` : ''}
							</p>
						</div>
					</div>
					<div class="mt-3 flex flex-wrap justify-end gap-2">
						{#if row.push}
							<button
								type="button"
								onclick={() => askStopPush(row)}
								disabled={actingPush === row.push.id}
								class="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
							>
								<BellOff class="h-3.5 w-3.5" />
								Stop notifications
							</button>
						{/if}
						{#if row.session}
							<button
								type="button"
								onclick={() => askSignOut(row)}
								disabled={acting === row.session.fingerprint}
								class="flex items-center gap-1.5 rounded-lg border border-destructive/30 px-2.5 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
							>
								<LogOut class="h-3.5 w-3.5" />
								Sign out
							</button>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<ConfirmModal
	open={pending !== null}
	title={pending?.title ?? ''}
	message={pending?.message ?? ''}
	confirmLabel={pending?.kind === 'signOut' ? 'Sign out' : 'Stop notifications'}
	variant="danger"
	onconfirm={confirmPending}
	oncancel={() => { pending = null; }}
/>

<style>
	.device-card-enter {
		opacity: 0;
		transform: translateY(8px);
		animation: device-card-in 0.28s cubic-bezier(0.22, 1, 0.36, 1) var(--enter-delay, 0ms) forwards;
	}

	@keyframes device-card-in {
		to { opacity: 1; transform: translateY(0); }
	}
</style>
