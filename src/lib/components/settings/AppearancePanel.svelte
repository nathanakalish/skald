<script lang="ts">
	import { Check, Plus, Copy, Pencil, Trash2 } from 'lucide-svelte';
	import { toasts } from '$lib/stores/toast.svelte.js';
	import { tooltip } from '$lib/tooltip.js';
	import ToggleSwitch from '$lib/components/settings/ToggleSwitch.svelte';
	import SettingRow from '$lib/components/settings/SettingRow.svelte';
	import ThemeEditModal from '$lib/components/ThemeEditModal.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte.js';
	import { themesStore } from '$lib/stores/themes.svelte.js';

	const s = $derived(settingsStore.settings);
	const themeList = $derived<any[]>(themesStore.themes ?? []);
	const darkThemes = $derived(themeList.filter((t: any) => t.mode === 'dark'));
	const lightThemes = $derived(themeList.filter((t: any) => t.mode === 'light'));

	let localColorMode = $state<'light' | 'dark' | 'system'>((settingsStore.settings.colorMode as 'light' | 'dark' | 'system') ?? 'dark');
	let darkDropdownOpen = $state(false);
	let lightDropdownOpen = $state(false);
	let themeEditOpen = $state(false);
	let themeEditMode = $state<'create' | 'edit'>('edit');
	let themeEditTarget: any = $state(null);
	let themeEditInitialMode = $state<'dark' | 'light'>('dark');
	// Track which slot a freshly-created theme should auto-select.
	let pendingCreateSlot: 'dark' | 'light' | null = $state(null);

	$effect(() => {
		localColorMode = (settingsStore.settings.colorMode as 'light' | 'dark' | 'system') ?? 'dark';
	});

	async function save(key: string, value: string | boolean | number) {
		const ok = await settingsStore.save(key as any, value);
		if (ok) toasts.success('Setting saved');
	}

	async function toggle(key: keyof typeof s) {
		await save(String(key), !s[key]);
	}

	function getThemeColors(theme: any): Record<string, string> {
		if (!theme) return {};
		return typeof theme.colors === 'string' ? JSON.parse(theme.colors) : theme.colors;
	}

	async function saveColorMode(mode: 'light' | 'dark' | 'system') {
		localColorMode = mode;
		settingsStore.patch({ colorMode: mode });
		await fetch('/api/themes/color-mode', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ colorMode: mode })
		});
		location.reload();
	}

	async function setSlotTheme(slot: 'dark' | 'light', id: number) {
		const theme = themeList.find((t: any) => t.id === id) ?? null;
		const key = slot === 'dark' ? 'systemDarkThemeId' : 'systemLightThemeId';
		if (slot === 'dark') settingsStore.setSystemDarkTheme(theme);
		else settingsStore.setSystemLightTheme(theme);
		await settingsStore.save(key, id);
		if (slot === 'dark') darkDropdownOpen = false;
		else lightDropdownOpen = false;
		location.reload();
	}

	function openEdit(theme: any) {
		themeEditMode = 'edit';
		themeEditTarget = theme;
		themeEditOpen = true;
		darkDropdownOpen = false;
		lightDropdownOpen = false;
	}

	function openCreate(slot: 'dark' | 'light') {
		themeEditMode = 'create';
		themeEditTarget = null;
		themeEditInitialMode = slot;
		pendingCreateSlot = slot;
		themeEditOpen = true;
		darkDropdownOpen = false;
		lightDropdownOpen = false;
	}

	async function duplicateTheme(theme: any) {
		const colors = getThemeColors(theme);
		const res = await fetch('/api/themes', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				name: `${theme.name} (Copy)`,
				mode: theme.mode,
				colors
			})
		});
		if (res.ok) {
			const body = await res.json().catch(() => null);
			if (body?.id) themesStore.add(body);
			else await themesStore.load(true);
			toasts.success('Theme duplicated');
		}
	}

	async function deleteTheme(theme: any) {
		// Refuse to delete the last theme of either mode — there'd be nothing
		// for the slot to fall back to and the dropdown would render empty.
		const sameModeThemes = themesStore.themes.filter((t: any) => t.mode === theme.mode);
		if (sameModeThemes.length <= 1) {
			toasts.error(`Can't delete the last ${theme.mode} theme`);
			return;
		}
		const res = await fetch(`/api/themes/${theme.id}`, { method: 'DELETE' });
		if (!res.ok) {
			toasts.error('Failed to delete theme');
			return;
		}
		themesStore.remove(theme.id);
		// If this theme was filling a slot, drop back to the first builtin of
		// the same mode (or the first remaining one of that mode).
		const slotKey = theme.mode === 'dark' ? 'systemDarkThemeId' : 'systemLightThemeId';
		const currentSlotId = settingsStore.settings[slotKey] as number | null;
		if (currentSlotId === theme.id) {
			const fallback = themesStore.themes.find((t: any) => t.isBuiltin && t.mode === theme.mode)
				?? themesStore.themes.find((t: any) => t.mode === theme.mode)
				?? null;
			if (fallback) {
				await setSlotTheme(theme.mode, fallback.id);
			}
		}
		toasts.success('Theme deleted');
	}

	function onThemeCreated(created: any) {
		if (pendingCreateSlot && created?.id) {
			setSlotTheme(pendingCreateSlot, created.id);
		}
		pendingCreateSlot = null;
	}
</script>

<div class="space-y-6">
	<div>
		<h3 class="text-base font-semibold">Appearance</h3>
		<p class="text-sm text-muted-foreground">Customize the look and feel of Skald</p>
	</div>

	<!-- Character Themes -->
	<SettingRow label="Character Themes">
		<div class="grid gap-3 @xl:grid-cols-2">
			<ToggleSwitch
				label="Always apply character themes"
				description="Skip the prompt when starting a new chat. Can still be overridden per-conversation."
				checked={s.alwaysUseCharacterThemes}
				onchange={() => toggle('alwaysUseCharacterThemes')}
			/>
			<ToggleSwitch
				label="Color character cards"
				description="Tint character cards in the character list with their extracted theme colors."
				checked={s.colorCharacterCards}
				onchange={() => toggle('colorCharacterCards')}
			/>
		</div>
		<p class="text-xs text-muted-foreground">Theme colors are automatically derived from the character's avatar. Background images are provided by the character's creator. Themes can be disabled per-chat in chat settings.</p>
	</SettingRow>

	<!-- External Content -->
	<SettingRow label="External Content">
		<ToggleSwitch
			label="Load external content"
			description="Allow remote images, fonts, and other external resources to load. When disabled, only locally cached images are shown."
			checked={s.allowExternalCreatorNotes}
			onchange={() => toggle('allowExternalCreatorNotes')}
		/>
		<p class="text-xs text-muted-foreground">Disabling this blocks all external requests — images in chats and creator notes will only display if they were cached by the server. Useful for privacy and for verifying image caching is working.</p>
	</SettingRow>

	<!-- Font Size + Compact/Motion: pair them on wider viewports -->
	<div class="grid gap-4 @xl:grid-cols-2">
		<SettingRow label="Font size">
			<div class="flex gap-2">
				{#each [{ value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' }] as opt}
					<button
						onclick={() => save('fontSize', opt.value)}
						class="flex-1 rounded-lg border px-3 py-1.5 text-sm {s.fontSize === opt.value ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-accent'}"
					>{opt.label}</button>
				{/each}
			</div>
		</SettingRow>
		<div class="space-y-3">
			<ToggleSwitch
				label="Compact mode"
				description="Reduce spacing between messages for a denser layout."
				checked={s.compactMode}
				onchange={() => toggle('compactMode')}
			/>
			<ToggleSwitch
				label="Reduce motion"
				description="Minimize animations and transitions. Streaming text appears all at once instead of token-by-token."
				checked={s.reduceMotion}
				onchange={() => toggle('reduceMotion')}
			/>
			<ToggleSwitch
				label="Dismiss keyboard on scroll (Mobile)"
				description="Scrolling the message list blurs the textarea so the soft keyboard slides away. Only applies on mobile."
				checked={s.dismissKeyboardOnScroll}
				onchange={() => toggle('dismissKeyboardOnScroll')}
			/>
			<ToggleSwitch
				label="Context usage ring"
				description="Show a ring around the chat header pill indicating how much of the model's context window is in use. Individual chats can override this in their settings."
				checked={s.showTokenRing}
				onchange={() => toggle('showTokenRing')}
			/>
		</div>
	</div>

	<!-- Theme Selection -->
	<div class="space-y-3">
		<!-- Color mode selector -->
		<SettingRow label="Color Mode">
			<div class="flex gap-1 rounded-xl border border-border p-1">
				<button
					onclick={() => saveColorMode('light')}
					class="flex-1 rounded-lg px-3 py-1.5 text-sm transition-colors {localColorMode === 'light' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}"
				>Light</button>
				<button
					onclick={() => saveColorMode('dark')}
					class="flex-1 rounded-lg px-3 py-1.5 text-sm transition-colors {localColorMode === 'dark' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}"
				>Dark</button>
				<button
					onclick={() => saveColorMode('system')}
					class="flex-1 rounded-lg px-3 py-1.5 text-sm transition-colors {localColorMode === 'system' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}"
				>System</button>
			</div>
			{#if localColorMode === 'system'}
				<p class="text-xs text-muted-foreground">Follows your OS dark/light preference automatically.</p>
			{/if}
		</SettingRow>

		{#snippet themeSlot(slot: 'dark' | 'light', list: any[], selectedId: number | null | undefined, isOpen: boolean, setOpen: (v: boolean) => void)}
			{@const selected = list.find((t: any) => t.id === selectedId) ?? list[0] ?? null}
			{@const selectedColors = getThemeColors(selected)}
			{@const canDelete = !!selected && !selected.isBuiltin && list.length > 1}
			<div class="space-y-2">
				<span class="block text-xs font-medium uppercase tracking-wide text-muted-foreground">{slot === 'dark' ? 'Dark Theme' : 'Light Theme'}</span>
				<div class="flex gap-1">
					<div class="relative min-w-0 flex-1">
						<button
							type="button"
							onclick={() => setOpen(!isOpen)}
							class="flex h-full w-full items-center gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:bg-accent/50 {isOpen ? 'ring-1 ring-primary/30' : ''}"
						>
							{#if selected}
								<div class="flex shrink-0 -space-x-1.5">
									<span class="h-6 w-6 rounded-full border-2 border-background" style="background-color: {selectedColors.background}"></span>
									<span class="h-6 w-6 rounded-full border-2 border-background" style="background-color: {selectedColors.primary}"></span>
									<span class="h-6 w-6 rounded-full border-2 border-background" style="background-color: {selectedColors.secondary}"></span>
									<span class="h-6 w-6 rounded-full border-2 border-background" style="background-color: {selectedColors.accent}"></span>
								</div>
								<div class="min-w-0 flex-1">
									<span class="block truncate text-sm font-medium">{selected.name}</span>
									<span class="block text-xs text-muted-foreground">{selected.isBuiltin ? 'Built-in' : 'Custom'}</span>
								</div>
							{:else}
								<span class="flex-1 text-sm text-muted-foreground">No theme</span>
							{/if}
							<svg class="h-4 w-4 shrink-0 text-muted-foreground transition-transform {isOpen ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
						</button>
						{#if isOpen}
							<button
								type="button"
								aria-label="Close dropdown"
								tabindex="-1"
								class="fixed inset-0 z-10 cursor-default"
								onclick={() => setOpen(false)}
							></button>
							<!-- Open upward: the slots sit near the bottom of the modal,
							     so opening down would clip past the modal's overflow. -->
							<div class="absolute bottom-[calc(100%+4px)] left-0 right-0 z-20 max-h-72 overflow-y-auto rounded-xl border border-border bg-popover shadow-lg">
								{#each list as theme (theme.id)}
									{@const colors = getThemeColors(theme)}
									{@const isSelected = theme.id === selected?.id}
									<button
										type="button"
										onclick={() => setSlotTheme(slot, theme.id)}
										class="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors {isSelected ? 'bg-primary/10' : 'hover:bg-accent'}"
									>
										<div class="flex shrink-0 -space-x-1.5">
											<span class="h-5 w-5 rounded-full border-2 border-background" style="background-color: {colors.background}"></span>
											<span class="h-5 w-5 rounded-full border-2 border-background" style="background-color: {colors.primary}"></span>
											<span class="h-5 w-5 rounded-full border-2 border-background" style="background-color: {colors.secondary}"></span>
											<span class="h-5 w-5 rounded-full border-2 border-background" style="background-color: {colors.accent}"></span>
										</div>
										<div class="min-w-0 flex-1">
											<span class="block truncate text-sm">{theme.name}</span>
											<span class="block text-xs text-muted-foreground">{theme.isBuiltin ? 'Built-in' : 'Custom'}</span>
										</div>
										{#if isSelected}
											<Check class="h-4 w-4 shrink-0 text-primary" />
										{/if}
									</button>
								{/each}
								<button
									type="button"
									onclick={() => openCreate(slot)}
									class="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-sm text-primary transition-colors hover:bg-accent"
								>
									<Plus class="h-4 w-4" />
									New {slot} theme
								</button>
							</div>
						{/if}
					</div>
					{#if selected}
						<button
							type="button"
							onclick={() => duplicateTheme(selected)}
							class="flex shrink-0 items-center justify-center rounded-xl border border-border px-3 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
							use:tooltip={'Duplicate theme'}
						><Copy class="h-4 w-4" /></button>
						<button
							type="button"
							onclick={() => openEdit(selected)}
							class="flex shrink-0 items-center justify-center rounded-xl border border-border px-3 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
							use:tooltip={selected.isBuiltin ? 'View colors' : 'Edit colors'}
						><Pencil class="h-4 w-4" /></button>
						{#if canDelete}
							<button
								type="button"
								onclick={() => deleteTheme(selected)}
								class="flex shrink-0 items-center justify-center rounded-xl border border-border px-3 text-muted-foreground transition-colors hover:bg-destructive/20 hover:text-destructive"
								use:tooltip={'Delete theme'}
							><Trash2 class="h-4 w-4" /></button>
						{/if}
					{/if}
				</div>
			</div>
		{/snippet}

		<SettingRow label="Themes" description="Choose a theme for each color mode. The active theme follows your system or color-mode preference above.">
			<div class="grid grid-cols-1 gap-4 @2xl:grid-cols-2">
				{@render themeSlot('dark', darkThemes, settingsStore.systemDarkTheme?.id ?? settingsStore.settings.systemDarkThemeId, darkDropdownOpen, (v: boolean) => (darkDropdownOpen = v))}
				{@render themeSlot('light', lightThemes, settingsStore.systemLightTheme?.id ?? settingsStore.settings.systemLightThemeId, lightDropdownOpen, (v: boolean) => (lightDropdownOpen = v))}
			</div>
		</SettingRow>
	</div>
</div>

<ThemeEditModal
	open={themeEditOpen}
	mode={themeEditMode}
	theme={themeEditTarget}
	initialMode={themeEditInitialMode}
	onclose={() => { themeEditOpen = false; pendingCreateSlot = null; }}
	oncreated={onThemeCreated}
/>
