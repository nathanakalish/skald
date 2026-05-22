<script lang="ts">
	import { toasts } from '$lib/stores/toast.svelte.js';
	import { limitsState } from '$lib/limits.svelte.js';
	import ToggleSwitch from '$lib/components/settings/ToggleSwitch.svelte';
	import ConfirmModal from '$lib/components/ConfirmModal.svelte';

	interface Props {
		active: boolean;
	}
	let { active }: Props = $props();

	let instanceSettings = $state<Record<string, string>>({});
	let instanceLoading = $state(false);

	let cacheStats = $state<{ fileCount: number; totalBytes: number } | null>(null);
	let cacheStatsLoading = $state(false);
	let clearingCache = $state(false);
	let showClearCacheConfirm = $state(false);
	let showDisableCacheConfirm = $state(false);

	$effect(() => {
		if (active) {
			loadInstanceSettings();
			loadCacheStats();
		}
	});

	async function loadInstanceSettings() {
		instanceLoading = true;
		try {
			const res = await fetch('/api/admin/settings');
			if (res.ok) instanceSettings = await res.json();
		} finally {
			instanceLoading = false;
		}
	}

	async function saveInstanceSetting(key: string, value: string) {
		const prevValue = (instanceSettings as any)[key];
		instanceSettings = { ...instanceSettings, [key]: value };
		// Mirror the character-limits toggle into the reactive client store
		// immediately so the UI reflects the change without a page reload.
		if (key === 'characterLimitsEnabled') limitsState.set(value === 'true');
		try {
			const res = await fetch('/api/admin/settings', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ [key]: value })
			});
			if (!res.ok) throw new Error(String(res.status));
			toasts.success('Setting saved');
		} catch {
			instanceSettings = { ...instanceSettings, [key]: prevValue };
			if (key === 'characterLimitsEnabled') limitsState.set(prevValue === 'true');
			toasts.error('Failed to save setting');
		}
	}

	function formatBytes(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
		return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
	}

	async function loadCacheStats() {
		cacheStatsLoading = true;
		try {
			const res = await fetch('/api/admin/cache');
			if (res.ok) cacheStats = await res.json();
		} finally {
			cacheStatsLoading = false;
		}
	}

	async function clearCache() {
		clearingCache = true;
		try {
			const res = await fetch('/api/admin/cache', { method: 'DELETE' });
			if (res.ok) {
				const data = await res.json();
				toasts.success(`Cleared ${data.removed} cached file${data.removed === 1 ? '' : 's'}`);
				await loadCacheStats();
			} else {
				toasts.error('Failed to clear cache');
			}
		} finally {
			clearingCache = false;
			showClearCacheConfirm = false;
		}
	}

	function toggleImageCaching() {
		const currentlyDisabled = instanceSettings.disableImageCaching === 'true';
		if (currentlyDisabled) {
			saveInstanceSetting('disableImageCaching', 'false');
		} else {
			showDisableCacheConfirm = true;
		}
	}

	async function confirmDisableCaching(alsoClear: boolean) {
		showDisableCacheConfirm = false;
		await saveInstanceSetting('disableImageCaching', 'true');
		if (alsoClear) await clearCache();
	}
</script>

<div class="space-y-6">
	<div>
		<h3 class="text-base font-semibold">Instance Settings</h3>
		<p class="text-sm text-muted-foreground">Server-wide settings that apply to all users</p>
	</div>

	{#if instanceLoading}
		<div class="flex justify-center py-8">
			<div class="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
		</div>
	{:else}
		<!-- Session Duration -->
		<div class="space-y-2">
			<span class="block text-sm font-medium">Session duration</span>
			<div class="flex gap-2">
				{#each [{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }, { value: '365', label: '1 year' }] as opt}
					<button
						onclick={() => saveInstanceSetting('sessionDurationDays', opt.value)}
						class="flex-1 rounded-lg border px-3 py-1.5 text-sm {String(instanceSettings.sessionDurationDays ?? '30') === opt.value ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-accent'}"
					>{opt.label}</button>
				{/each}
			</div>
			<p class="text-xs text-muted-foreground">How long until users need to log in again. Applies to new sessions only.</p>
		</div>

		<!-- Rate Limits + Upload caps side-by-side on wide screens -->
		<div class="grid gap-4 lg:grid-cols-2">
			<div class="space-y-3 rounded-xl border border-border p-4">
				<div>
					<h4 class="text-sm font-semibold">Rate limits</h4>
					<p class="text-xs text-muted-foreground">Per-user requests allowed per minute on expensive endpoints.</p>
				</div>
				{#each [
					{ key: 'chatRateLimit', label: 'Chat send / stream', def: '30' },
					{ key: 'characterImportRateLimit', label: 'Character import', def: '10' },
					{ key: 'lorebookImportRateLimit', label: 'Lorebook import', def: '10' },
					{ key: 'chubBrowseRateLimit', label: 'CHUB browse / import (per user)', def: '30' },
					{ key: 'chubGlobalRateLimit', label: 'CHUB outbound (server-wide)', def: '120' },
					{ key: 'reformatRateLimit', label: 'Greeting reformat', def: '20' }
				] as item}
					<div class="flex items-center gap-3">
						<label for="rl-{item.key}" class="flex-1 text-sm">{item.label}</label>
						<input
							id="rl-{item.key}"
							type="number"
							min="1"
							max="1000"
							value={instanceSettings[item.key] ?? item.def}
							oninput={(e) => { const v = (e.target as HTMLInputElement).value; instanceSettings = { ...instanceSettings, [item.key]: v }; }}
							onchange={(e) => { const v = (e.target as HTMLInputElement).value; const n = Number(v); if (Number.isFinite(n) && n >= 1 && n <= 1000) saveInstanceSetting(item.key, String(n)); }}
							class="w-24 rounded-lg border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
						/>
						<span class="w-12 text-xs text-muted-foreground">/min</span>
					</div>
				{/each}
			</div>

			<div class="space-y-3 rounded-xl border border-border p-4">
				<div>
					<h4 class="text-sm font-semibold">Upload size limits</h4>
					<p class="text-xs text-muted-foreground">Maximum file sizes for character and lorebook imports (MiB).</p>
				</div>
				{#each [
					{ key: 'characterImportMaxMiB', label: 'Character PNG max size', def: '8' },
					{ key: 'lorebookImportMaxMiB', label: 'Lorebook JSON max size', def: '4' },
					{ key: 'avatarUploadMaxMiB', label: 'Avatar upload max size', def: '8' }
				] as item}
					<div class="flex items-center gap-3">
						<label for="sz-{item.key}" class="flex-1 text-sm">{item.label}</label>
						<input
							id="sz-{item.key}"
							type="number"
							min="1"
							max="256"
							value={instanceSettings[item.key] ?? item.def}
							oninput={(e) => { const v = (e.target as HTMLInputElement).value; instanceSettings = { ...instanceSettings, [item.key]: v }; }}
							onchange={(e) => { const v = (e.target as HTMLInputElement).value; const n = Number(v); if (Number.isFinite(n) && n >= 1 && n <= 256) saveInstanceSetting(item.key, String(n)); }}
							class="w-24 rounded-lg border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
						/>
						<span class="w-12 text-xs text-muted-foreground">MiB</span>
					</div>
				{/each}
			</div>
		</div>

		<!-- Per-user resource quotas -->
		<div class="space-y-3 rounded-xl border border-border p-4">
			<div>
				<h4 class="text-sm font-semibold">Per-user quotas</h4>
				<p class="text-xs text-muted-foreground">Whichever ceiling is reached first blocks new creates and imports. <span class="font-medium">0 = unlimited</span>.</p>
			</div>
			{#each [
				{ resource: 'Characters', countKey: 'maxCharactersPerUser', sizeKey: 'maxCharactersTotalMiB' },
				{ resource: 'Chats', countKey: 'maxChatsPerUser', sizeKey: 'maxChatsTotalMiB' },
				{ resource: 'Lorebooks', countKey: 'maxLorebooksPerUser', sizeKey: 'maxLorebooksTotalMiB' }
			] as quota}
				<div class="space-y-2">
					<p class="text-sm font-medium">{quota.resource}</p>
					<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
						<div class="flex items-center gap-2">
							<label for="q-{quota.countKey}" class="flex-1 text-xs text-muted-foreground">Max count</label>
							<input
								id="q-{quota.countKey}"
								type="number"
								min="0"
								max="1000000"
								value={instanceSettings[quota.countKey] ?? '0'}
								oninput={(e) => { const v = (e.target as HTMLInputElement).value; instanceSettings = { ...instanceSettings, [quota.countKey]: v }; }}
								onchange={(e) => { const v = (e.target as HTMLInputElement).value; const n = Number(v); if (Number.isFinite(n) && n >= 0 && n <= 1_000_000) saveInstanceSetting(quota.countKey, String(Math.floor(n))); }}
								class="w-24 rounded-lg border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
							/>
						</div>
						<div class="flex items-center gap-2">
							<label for="q-{quota.sizeKey}" class="flex-1 text-xs text-muted-foreground">Max total size</label>
							<input
								id="q-{quota.sizeKey}"
								type="number"
								min="0"
								max="1000000"
								value={instanceSettings[quota.sizeKey] ?? '0'}
								oninput={(e) => { const v = (e.target as HTMLInputElement).value; instanceSettings = { ...instanceSettings, [quota.sizeKey]: v }; }}
								onchange={(e) => { const v = (e.target as HTMLInputElement).value; const n = Number(v); if (Number.isFinite(n) && n >= 0 && n <= 1_000_000) saveInstanceSetting(quota.sizeKey, String(Math.floor(n))); }}
								class="w-24 rounded-lg border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
							/>
							<span class="w-12 text-xs text-muted-foreground">MiB</span>
						</div>
					</div>
				</div>
			{/each}
		</div>

		<!-- Import/export toggles pair naturally -->
		<div class="grid gap-3 sm:grid-cols-2">
			<ToggleSwitch
				label="Allow character import"
				description="Users can import character cards (PNG/JSON)."
				checked={(instanceSettings.allowCharacterImport ?? 'true') === 'true'}
				onchange={() => saveInstanceSetting('allowCharacterImport', (instanceSettings.allowCharacterImport ?? 'true') === 'true' ? 'false' : 'true')}
			/>
			<ToggleSwitch
				label="Allow character export"
				description="Users can export character cards from the app."
				checked={(instanceSettings.allowCharacterExport ?? 'true') === 'true'}
				onchange={() => saveInstanceSetting('allowCharacterExport', (instanceSettings.allowCharacterExport ?? 'true') === 'true' ? 'false' : 'true')}
			/>
		</div>

		<!-- Image Cache -->
		<div class="rounded-lg border border-border px-4 py-3 space-y-3">
			<div>
				<span class="block text-sm font-medium">Image cache</span>
				<span class="block text-xs text-muted-foreground">
					{#if cacheStatsLoading && !cacheStats}
						Loading…
					{:else if cacheStats}
						{cacheStats.fileCount} file{cacheStats.fileCount === 1 ? '' : 's'} · {formatBytes(cacheStats.totalBytes)}
					{:else}
						—
					{/if}
				</span>
			</div>
			<button
				type="button"
				onclick={() => (showClearCacheConfirm = true)}
				disabled={clearingCache || !cacheStats || cacheStats.fileCount === 0}
				class="rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
			>
				{clearingCache ? 'Clearing…' : 'Clear cache'}
			</button>
		</div>

		<!-- Disable Image Caching + Enforce character limits -->
		<div class="grid gap-3 sm:grid-cols-2">
			<ToggleSwitch
				label="Disable image caching"
				description="Serve remote images directly instead of caching them locally."
				checked={(instanceSettings.disableImageCaching ?? 'false') === 'true'}
				onchange={toggleImageCaching}
			/>
			<ToggleSwitch
				label="Enforce character limits"
				description="Cap text fields at sensible lengths. When on, the UI highlights overflow in red and the server rejects oversized payloads. When off, all length caps are removed."
				checked={(instanceSettings.characterLimitsEnabled ?? 'true') === 'true'}
				onchange={() => saveInstanceSetting('characterLimitsEnabled', (instanceSettings.characterLimitsEnabled ?? 'true') === 'true' ? 'false' : 'true')}
			/>
		</div>
	{/if}
</div>

<ConfirmModal
	open={showClearCacheConfirm}
	title="Clear image cache"
	message="Delete all cached images? Remote images will need to be re-downloaded the next time they're accessed."
	confirmLabel="Clear cache"
	onconfirm={clearCache}
	oncancel={() => (showClearCacheConfirm = false)}
/>

<ConfirmModal
	open={showDisableCacheConfirm}
	title="Disable image caching"
	message="Disable image caching for this instance? Would you also like to delete the existing cached images?"
	confirmLabel="Disable & clear cache"
	secondaryLabel="Disable only"
	onconfirm={() => confirmDisableCaching(true)}
	onsecondary={() => confirmDisableCaching(false)}
	oncancel={() => (showDisableCacheConfirm = false)}
/>
