<script lang="ts">
	import { Save, X, Plus } from 'lucide-svelte';
	import { createModalState } from '$lib/modal.svelte.js';
	import { focusTrap } from '$lib/focusTrap.js';
	import { themesStore } from '$lib/stores/themes.svelte.js';
	import { settingsStore } from '$lib/stores/settings.svelte.js';
	import { toasts } from '$lib/stores/toast.svelte.js';
	import LimitedInput from '$lib/components/LimitedInput.svelte';
	import { checkFieldLimits } from '$lib/limitCheck.js';
	import { FIELD_LIMITS } from '$lib/fieldLimits.js';

	interface Props {
		open: boolean;
		// 'create' starts a blank theme; 'edit' loads an existing one.
		mode: 'create' | 'edit';
		// Required in 'edit' mode; ignored in 'create'.
		theme?: { id: number; name: string; mode: 'dark' | 'light'; colors: any; isBuiltin?: boolean } | null;
		// In 'create' mode, which slot the new theme should default to.
		initialMode?: 'dark' | 'light';
		onclose: () => void;
		oncreated?: (theme: any) => void;
	}

	let { open, mode, theme = null, initialMode = 'dark', onclose, oncreated }: Props = $props();

	const colorKeys = [
		'background', 'foreground', 'card', 'card-foreground',
		'popover', 'popover-foreground', 'primary', 'primary-foreground',
		'secondary', 'secondary-foreground', 'muted', 'muted-foreground',
		'accent', 'accent-foreground', 'destructive', 'destructive-foreground',
		'border', 'input', 'ring',
		'sidebar', 'sidebar-foreground', 'sidebar-border',
		'speech'
	] as const;

	const colorLabels: Record<string, string> = {
		background: 'Background', foreground: 'Foreground',
		card: 'Card', 'card-foreground': 'Card Text',
		popover: 'Popover', 'popover-foreground': 'Popover Text',
		primary: 'Primary', 'primary-foreground': 'Primary Text',
		secondary: 'Secondary', 'secondary-foreground': 'Secondary Text',
		muted: 'Muted', 'muted-foreground': 'Muted Text',
		accent: 'Accent', 'accent-foreground': 'Accent Text',
		destructive: 'Destructive', 'destructive-foreground': 'Destructive Text',
		border: 'Border', input: 'Input Border', ring: 'Focus Ring',
		sidebar: 'Sidebar', 'sidebar-foreground': 'Sidebar Text', 'sidebar-border': 'Sidebar Border',
		speech: 'Dialogue'
	};

	let name = $state('');
	let themeMode = $state<'dark' | 'light'>('dark');
	let colors = $state<Record<string, string>>({});
	let saving = $state(false);

	const isBuiltin = $derived(mode === 'edit' && !!theme?.isBuiltin);
	const readonly = $derived(isBuiltin);

	function parseColors(c: any): Record<string, string> {
		if (!c) return {};
		try {
			return typeof c === 'string' ? JSON.parse(c) : { ...c };
		} catch {
			return {};
		}
	}

	$effect(() => {
		if (!open) return;
		if (mode === 'edit' && theme) {
			name = theme.name;
			themeMode = theme.mode;
			colors = parseColors(theme.colors);
		} else {
			name = '';
			themeMode = initialMode;
			// Seed from current effective theme so created themes look reasonable.
			const seed = themeMode === 'dark' ? settingsStore.systemDarkTheme : settingsStore.systemLightTheme;
			colors = parseColors(seed?.colors);
		}
	});

	const modal = createModalState(() => open);

	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return { destroy() { node.remove(); } };
	}

	function updateColor(key: string, value: string) {
		colors = { ...colors, [key]: value };
	}

	async function save() {
		if (saving) return;
		const trimmed = name.trim();
		if (!trimmed) {
			toasts.error('Name is required');
			return;
		}
		const colorChecks = Object.entries(colors).map(([k, v]) => ({
			label: `Color: ${k}`,
			value: v ?? '',
			limit: FIELD_LIMITS.colorValue,
			trim: (next: string) => { colors = { ...colors, [k]: next }; },
		}));
		const ok = await checkFieldLimits([
			{ label: 'Name', value: name, limit: FIELD_LIMITS.name, trim: (v) => (name = v) },
			...colorChecks,
		]);
		if (!ok) return;
		saving = true;
		try {
			if (mode === 'edit' && theme) {
				const res = await fetch(`/api/themes/${theme.id}`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ name: trimmed, colors })
				});
				if (!res.ok) {
					toasts.error('Failed to save theme');
					return;
				}
				const body = await res.json().catch(() => null);
				if (body?.theme) themesStore.upsert(body.theme);
				toasts.success('Theme saved');
				onclose();
			} else {
				const res = await fetch('/api/themes', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ name: trimmed, mode: themeMode, colors })
				});
				if (!res.ok) {
					toasts.error('Failed to create theme');
					return;
				}
				const body = await res.json().catch(() => null);
				if (body?.id) {
					themesStore.add(body);
					oncreated?.(body);
				}
				toasts.success('Theme created');
				onclose();
			}
		} finally {
			saving = false;
		}
	}
</script>

{#if modal.visible}
<div use:portal>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 {modal.closing ? 'backdrop-exit' : 'backdrop-enter'}"
		role="dialog" aria-modal="true" aria-label="Edit theme" tabindex="-1" use:focusTrap
		onkeydown={(e) => e.key === 'Escape' && onclose()}
	>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div class="absolute inset-0" onclick={onclose}></div>
		<div class="relative z-10 flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-card shadow-xl {modal.closing ? 'modal-exit' : 'modal-enter'}">
			<div class="flex items-center justify-between border-b border-border px-5 py-3">
				<h3 class="text-base font-semibold">
					{#if mode === 'create'}New theme{:else if isBuiltin}{name} (built-in){:else}Edit {name}{/if}
				</h3>
				<button onclick={onclose} class="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Close">
					<X class="h-4 w-4" />
				</button>
			</div>

			<div class="@container flex-1 space-y-4 overflow-y-auto px-5 py-4">
				<div class="grid gap-3 @xl:grid-cols-2">
					<div>
						<label for="theme-name" class="mb-1 block text-xs font-medium text-muted-foreground">Name</label>
						<LimitedInput
							id="theme-name"
							bind:value={name}
							disabled={readonly}
							limit={FIELD_LIMITS.name}
							class="field-input disabled:opacity-50"
							placeholder="My Custom Theme"
						/>
					</div>
					{#if mode === 'create'}
						<div>
							<span class="mb-1 block text-xs font-medium text-muted-foreground">Mode</span>
							<div class="flex gap-2">
								<button
									type="button"
									onclick={() => (themeMode = 'dark')}
									class="flex-1 rounded-lg border px-3 py-2 text-sm {themeMode === 'dark' ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-accent'}"
								>Dark</button>
								<button
									type="button"
									onclick={() => (themeMode = 'light')}
									class="flex-1 rounded-lg border px-3 py-2 text-sm {themeMode === 'light' ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-accent'}"
								>Light</button>
							</div>
						</div>
					{:else}
						<div>
							<span class="mb-1 block text-xs font-medium text-muted-foreground">Mode</span>
							<div class="rounded-lg border border-border bg-muted px-3 py-2 text-sm capitalize text-muted-foreground">{themeMode}</div>
						</div>
					{/if}
				</div>

				<div>
					<span class="mb-2 block text-xs font-medium text-muted-foreground">
						Colors{#if readonly} (read-only — duplicate to customize){/if}
					</span>
					<div class="grid grid-cols-2 gap-x-4 gap-y-3 @xl:grid-cols-3">
						{#each colorKeys as key}
							<div class="flex items-center gap-2">
								<span
									class="h-6 w-6 shrink-0 rounded border border-border"
									style="background-color: {colors[key] ?? 'transparent'}"
								></span>
								<div class="min-w-0 flex-1">
									<span class="block truncate text-xs text-muted-foreground">{colorLabels[key]}</span>
									<input
										type="text"
										value={colors[key] ?? ''}
										oninput={(e) => updateColor(key, (e.target as HTMLInputElement).value)}
										disabled={readonly}
										maxlength={64}
										class="w-full border-0 bg-transparent p-0 text-xs font-mono focus:outline-none focus:ring-0 disabled:opacity-50"
										placeholder="oklch(0.5 0.1 250)"
									/>
								</div>
							</div>
						{/each}
					</div>
				</div>
			</div>

			<div class="flex justify-end gap-2 border-t border-border px-5 py-3">
				<button
					type="button"
					onclick={onclose}
					class="rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent"
				>Cancel</button>
				{#if !readonly}
					<button
						type="button"
						onclick={save}
						disabled={saving || !name.trim()}
						class="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
					>
						{#if mode === 'create'}<Plus class="h-3.5 w-3.5" />Create{:else}<Save class="h-3.5 w-3.5" />Save{/if}
					</button>
				{/if}
			</div>
		</div>
	</div>
</div>
{/if}
