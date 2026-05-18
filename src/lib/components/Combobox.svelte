<script lang="ts">
	/**
	 * Themed combobox: native `<select>` replacement with type-to-filter,
	 * keyboard navigation, and an optional renderer for each option (so e.g.
	 * OpenRouter "~" link models can show a chain icon + cleaned label).
	 *
	 * Items can be plain strings or `{ value, label?, hint? }` objects.
	 * `value` binds via `$bindable`.
	 */
	import { onMount, tick, untrack, type Snippet } from 'svelte';
	import { ChevronDown, Loader2, Search, X } from 'lucide-svelte';
	import { tooltip } from '$lib/tooltip.js';

	export type ComboboxItem = {
		value: string;
		label?: string;
		hint?: string;
		disabled?: boolean;
	};

	type Props = {
		value: string | null;
		items: (ComboboxItem | string)[];
		placeholder?: string;
		emptyText?: string;
		searchPlaceholder?: string;
		disabled?: boolean;
		loading?: boolean;
		allowClear?: boolean;
		fallbackLabel?: string;
		id?: string;
		class?: string;
		/** Custom renderer for each row (overrides default label rendering). */
		renderItem?: Snippet<[ComboboxItem]>;
		/** Called when value changes (in addition to bind). */
		onchange?: (value: string) => void;
	};

	let {
		value = $bindable(),
		items,
		placeholder = 'Select…',
		emptyText = 'No options',
		searchPlaceholder = 'Search…',
		disabled = false,
		loading = false,
		allowClear = false,
		fallbackLabel,
		id,
		class: className = '',
		renderItem,
		onchange,
	}: Props = $props();

	function normalize(it: ComboboxItem | string): ComboboxItem {
		return typeof it === 'string' ? { value: it } : it;
	}

	const normalized = $derived(items.map(normalize));

	const selected = $derived.by(() => {
		if (value == null || value === '') return null;
		const hit = normalized.find(i => i.value === value);
		if (hit) return hit;
		// Value isn't in the list (e.g., model removed from provider) — show
		// it anyway so the user can see what's currently saved.
		return { value, label: fallbackLabel ?? value };
	});

	let open = $state(false);
	let query = $state('');
	let activeIdx = $state(0);
	let triggerEl: HTMLButtonElement | null = $state(null);
	let inputEl: HTMLInputElement | null = $state(null);
	let listEl: HTMLDivElement | null = $state(null);
	let popupEl: HTMLDivElement | null = $state(null);
	let popupStyle = $state('');
	// Stable id so aria-controls / aria-activedescendant can reference the
	// listbox + active option even when consumers don't pass an `id` prop.
	const listboxId = `cb-listbox-${Math.random().toString(36).slice(2, 9)}`;

	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return normalized;
		return normalized.filter(i => {
			const label = (i.label ?? i.value).toLowerCase();
			return label.includes(q) || i.value.toLowerCase().includes(q);
		});
	});

	function positionPopup() {
		if (!triggerEl || !popupEl) return;
		const r = triggerEl.getBoundingClientRect();
		const vh = window.innerHeight;
		const popupMaxH = 320;
		const spaceBelow = vh - r.bottom;
		const spaceAbove = r.top;
		const openUp = spaceBelow < popupMaxH && spaceAbove > spaceBelow;
		const top = openUp ? r.top - 4 : r.bottom + 4;
		popupStyle =
			`position: fixed; left: ${r.left}px; top: ${top}px; ` +
			`width: ${r.width}px; ` +
			`max-height: ${Math.min(popupMaxH, openUp ? spaceAbove - 8 : spaceBelow - 8)}px; ` +
			`transform: ${openUp ? 'translateY(-100%)' : 'none'};`;
	}

	async function openMenu() {
		if (disabled) return;
		open = true;
		query = '';
		// Default highlight to the currently-selected item
		const idx = selected ? filtered.findIndex(i => i.value === selected.value) : -1;
		activeIdx = idx >= 0 ? idx : 0;
		await tick();
		positionPopup();
		inputEl?.focus();
		scrollActiveIntoView();
	}

	function closeMenu(returnFocus = true) {
		if (!open) return;
		open = false;
		query = '';
		if (returnFocus) triggerEl?.focus();
	}

	function pick(it: ComboboxItem) {
		if (it.disabled) return;
		value = it.value;
		onchange?.(it.value);
		closeMenu();
	}

	function clear(e: MouseEvent) {
		e.stopPropagation();
		value = '';
		onchange?.('');
	}

	function onKey(e: KeyboardEvent) {
		if (!open) {
			if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				openMenu();
			}
			return;
		}
		if (e.key === 'Escape') { e.preventDefault(); closeMenu(); }
		else if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(filtered.length - 1, activeIdx + 1); scrollActiveIntoView(); }
		else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = Math.max(0, activeIdx - 1); scrollActiveIntoView(); }
		else if (e.key === 'Home') { e.preventDefault(); activeIdx = 0; scrollActiveIntoView(); }
		else if (e.key === 'End') { e.preventDefault(); activeIdx = filtered.length - 1; scrollActiveIntoView(); }
		else if (e.key === 'Enter') {
			e.preventDefault();
			const it = filtered[activeIdx];
			if (it) pick(it);
		}
	}

	function scrollActiveIntoView() {
		if (!listEl) return;
		const el = listEl.querySelector(`[data-cb-idx="${activeIdx}"]`) as HTMLElement | null;
		el?.scrollIntoView({ block: 'nearest' });
	}

	$effect(() => {
		// Reset active index when filter changes
		void query;
		untrack(() => { activeIdx = 0; });
	});

	function onWindowScroll() {
		if (open) positionPopup();
	}
	function onWindowResize() {
		if (open) positionPopup();
	}
	function onDocPointerDown(e: PointerEvent) {
		if (!open) return;
		const t = e.target as Node;
		if (popupEl?.contains(t) || triggerEl?.contains(t)) return;
		closeMenu(false);
	}

	onMount(() => {
		window.addEventListener('scroll', onWindowScroll, true);
		window.addEventListener('resize', onWindowResize);
		document.addEventListener('pointerdown', onDocPointerDown, true);
		return () => {
			window.removeEventListener('scroll', onWindowScroll, true);
			window.removeEventListener('resize', onWindowResize);
			document.removeEventListener('pointerdown', onDocPointerDown, true);
		};
	});
</script>

<button
	{id}
	type="button"
	bind:this={triggerEl}
	{disabled}
	onclick={() => (open ? closeMenu() : openMenu())}
	onkeydown={onKey}
	role="combobox"
	aria-haspopup="listbox"
	aria-expanded={open}
	aria-controls={listboxId}
	aria-activedescendant={open && filtered[activeIdx] ? `${listboxId}-opt-${activeIdx}` : undefined}
	class="group flex w-full items-center justify-between gap-2 rounded-lg border border-input bg-background px-3 py-2 text-left text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 {className}"
>
	<span class="flex min-w-0 flex-1 items-center gap-2 truncate">
		{#if selected}
			<span class="truncate">{selected.label ?? selected.value}</span>
			{#if selected.hint}
				<span class="truncate text-xs text-muted-foreground">{selected.hint}</span>
			{/if}
		{:else}
			<span class="truncate text-muted-foreground">{placeholder}</span>
		{/if}
	</span>
	<span class="flex shrink-0 items-center gap-1">
		{#if allowClear && selected && !disabled}
			<!-- svelte-ignore a11y_consider_explicit_label -->
			<span
				role="button"
				tabindex="-1"
				onclick={clear}
				onkeydown={(e) => { if (e.key === 'Enter') clear(e as unknown as MouseEvent); }}
				class="rounded p-0.5 text-muted-foreground/70 hover:bg-muted hover:text-foreground"
				use:tooltip={'Clear'}
			>
				<X class="h-3.5 w-3.5" />
			</span>
		{/if}
		{#if loading}
			<Loader2 class="h-4 w-4 animate-spin text-muted-foreground" />
		{:else}
			<ChevronDown class="h-4 w-4 text-muted-foreground transition-transform {open ? 'rotate-180' : ''}" />
		{/if}
	</span>
</button>

{#if open}
	<div
		bind:this={popupEl}
		role="listbox"
		id={listboxId}
		style={popupStyle}
		class="z-[100] flex flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-xl"
	>
		<div class="flex items-center gap-2 border-b border-border/60 px-2.5 py-2">
			<Search class="h-4 w-4 shrink-0 text-muted-foreground" />
			<input
				bind:this={inputEl}
				bind:value={query}
				onkeydown={onKey}
				placeholder={searchPlaceholder}
				class="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
			/>
		</div>
		<div bind:this={listEl} class="flex-1 overflow-y-auto py-1">
			{#if filtered.length === 0}
				<div class="px-3 py-4 text-center text-sm text-muted-foreground">{emptyText}</div>
			{:else}
				{#each filtered as it, i (it.value)}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						data-cb-idx={i}
						id={`${listboxId}-opt-${i}`}
						role="option"
						tabindex="-1"
						aria-selected={selected?.value === it.value}
						onpointerenter={() => (activeIdx = i)}
						onclick={() => pick(it)}
						class="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm
							{i === activeIdx ? 'bg-accent text-accent-foreground' : ''}
							{selected?.value === it.value ? 'font-medium' : ''}
							{it.disabled ? 'cursor-not-allowed opacity-40' : ''}"
					>
						{#if renderItem}
							{@render renderItem(it)}
						{:else}
							<span class="min-w-0 flex-1 truncate">{it.label ?? it.value}</span>
							{#if it.hint}
								<span class="shrink-0 text-xs text-muted-foreground">{it.hint}</span>
							{/if}
						{/if}
					</div>
				{/each}
			{/if}
		</div>
	</div>
{/if}
