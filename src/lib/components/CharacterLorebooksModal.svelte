<script lang="ts">
	import { tooltip } from '$lib/tooltip.js';
	import { X, BookMarked, BookOpen, ChevronDown, ChevronRight, Tag, Pin, Loader2, Plus, Trash2, Lock, Search, ArrowUpDown, RotateCcw } from 'lucide-svelte';
	import { untrack } from 'svelte';
	import { createModalState, createModalGestures } from '$lib/modal.svelte.js';
	import { focusTrap } from '$lib/focusTrap.js';

	interface Entry {
		id: number;
		keywords: string;
		content: string;
		insertionOrder: number;
		enabled: boolean;
		caseSensitive: boolean;
		constant: boolean;
		defaultEnabled: boolean;
		defaultConstant: boolean;
		enabledOverridden: boolean;
		constantOverridden: boolean;
	}

	interface Lorebook {
		id: number;
		name: string;
		description: string;
		characterId: number | null;
		enabled: boolean;
		iconUrl?: string | null;
		characterAvatarPath?: string | null;
		entries: Entry[];
		isCharacterLorebook: boolean;
	}

	interface AvailableLorebook {
		id: number;
		name: string;
		description: string;
		characterId: number | null;
		iconUrl?: string | null;
	}

	interface Props {
		open: boolean;
		chatId: number;
		characterName: string;
		allLorebooks: AvailableLorebook[];
		onclose: () => void;
	}

	let { open, chatId, characterName, allLorebooks, onclose }: Props = $props();

	let lorebooks: Lorebook[] = $state([]);
	let loading = $state(false);
	let expanded: Record<number, boolean> = $state({});
	let showAddModal = $state(false);
	let addSearch = $state('');
	let addSort = $state<'alpha' | 'newest'>('alpha');

	$effect(() => {
		if (open) {
			untrack(() => loadLorebooks());
		}
	});

	async function loadLorebooks() {
		loading = true;
		try {
			const res = await fetch(`/api/chats/${chatId}/lorebooks`);
			if (res.ok) {
				lorebooks = await res.json();
				expanded = {};
				// Expand all if only one lorebook, collapse all if multiple
				if (lorebooks.length === 1) {
					expanded[lorebooks[0].id] = true;
				}
			}
		} catch {
			// silent
		} finally {
			loading = false;
		}
	}

	async function addLorebook(lorebookId: number) {
		await fetch(`/api/chats/${chatId}/lorebooks`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ lorebookId })
		});
		await loadLorebooks();
	}

	async function removeLorebook(lorebookId: number) {
		await fetch(`/api/chats/${chatId}/lorebooks`, {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ lorebookId })
		});
		await loadLorebooks();
	}

	// Patch a single override field (enabled or constant) on an entry. Pass
	// `null` to clear that field; pass a boolean to set it. The server
	// drops the row entirely if both fields end up cleared.
	async function patchEntryOverride(entry: Entry, patch: { enabled?: boolean | null; constant?: boolean | null }) {
		// Optimistic update
		const prev = { enabled: entry.enabled, constant: entry.constant, eOv: entry.enabledOverridden, cOv: entry.constantOverridden };
		if ('enabled' in patch) {
			entry.enabled = patch.enabled === null ? entry.defaultEnabled : (patch.enabled ?? entry.enabled);
			entry.enabledOverridden = patch.enabled !== null && patch.enabled !== undefined;
		}
		if ('constant' in patch) {
			entry.constant = patch.constant === null ? entry.defaultConstant : (patch.constant ?? entry.constant);
			entry.constantOverridden = patch.constant !== null && patch.constant !== undefined;
		}
		try {
			const res = await fetch(`/api/chats/${chatId}/lorebooks/entries/${entry.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(patch)
			});
			if (!res.ok) throw new Error(String(res.status));
		} catch {
			// Roll back optimistic changes on failure
			entry.enabled = prev.enabled;
			entry.constant = prev.constant;
			entry.enabledOverridden = prev.eOv;
			entry.constantOverridden = prev.cOv;
		}
	}

	async function resetEntryOverride(entry: Entry) {
		const prev = { enabled: entry.enabled, constant: entry.constant, eOv: entry.enabledOverridden, cOv: entry.constantOverridden };
		entry.enabled = entry.defaultEnabled;
		entry.constant = entry.defaultConstant;
		entry.enabledOverridden = false;
		entry.constantOverridden = false;
		try {
			const res = await fetch(`/api/chats/${chatId}/lorebooks/entries/${entry.id}`, { method: 'DELETE' });
			if (!res.ok) throw new Error(String(res.status));
		} catch {
			entry.enabled = prev.enabled;
			entry.constant = prev.constant;
			entry.enabledOverridden = prev.eOv;
			entry.constantOverridden = prev.cOv;
		}
	}

	function toggleExpand(id: number) {
		expanded[id] = !expanded[id];
		expanded = { ...expanded };
	}

	const enabledEntries = (entries: Entry[]) => entries.filter(e => e.enabled);
	const activeIds = $derived(new Set(lorebooks.map(lb => lb.id)));
	const availableToAdd = $derived(
		allLorebooks.filter(lb => !activeIds.has(lb.id))
	);

	const filteredAvailable = $derived.by(() => {
		let list = availableToAdd;
		const q = addSearch.trim().toLowerCase();
		if (q) {
			list = list.filter(lb =>
				lb.name.toLowerCase().includes(q) ||
				(lb.description && lb.description.toLowerCase().includes(q))
			);
		}
		list = [...list].sort((a, b) => {
			if (addSort === 'alpha') return a.name.localeCompare(b.name);
			return (b.id ?? 0) - (a.id ?? 0); // newest first by id
		});
		return list;
	});

	function openAddModal() {
		addSearch = '';
		showAddModal = true;
	}

	const modal = createModalState(() => open);
	const gestures = createModalGestures({ onclose: () => onclose(), modal });
</script>

{#if modal.visible}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div class="fixed inset-0 z-[60] flex items-end justify-center p-0 sm:items-center sm:p-4 bg-black/60 {modal.closing ? 'backdrop-exit' : 'backdrop-enter'}" role="dialog" aria-modal="true" aria-label="Character Lorebooks" tabindex="-1" use:focusTrap onclick={onclose}>
		<div
			class="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-2xl sm:rounded-2xl {modal.closing ? 'modal-exit' : 'modal-enter'}"
			ontouchstart={gestures.handlers.onTouchStart}
			ontouchmove={gestures.handlers.onTouchMove}
			ontouchend={gestures.handlers.onTouchEnd}
			style={gestures.panelStyle}
			onclick={(e) => e.stopPropagation()}
		>
			<!-- Header -->
			<div class="flex items-center justify-between border-b border-border px-5 py-3">
				<div class="flex items-center gap-2">
					<BookMarked class="h-5 w-5 text-primary" />
					<h2 class="text-lg font-semibold">Lorebooks</h2>
					<span class="text-sm text-muted-foreground">— {characterName}</span>
				</div>
				<div class="flex items-center gap-1">
					{#if availableToAdd.length > 0}
						<button
							onclick={openAddModal}
							class="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
							use:tooltip={'Add lorebook'}
						>
							<Plus class="h-5 w-5" />
						</button>
					{/if}
					<button onclick={onclose} class="rounded-lg p-1.5 text-muted-foreground hover:bg-accent" aria-label="Close"><X class="h-5 w-5" /></button>
				</div>
			</div>

			<!-- Content -->
			<div class="flex-1 overflow-y-auto p-4">
				{#if loading}
					<div class="flex items-center justify-center py-12">
						<Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
					</div>
				{:else if lorebooks.length === 0}
					<div class="flex flex-col items-center justify-center py-12 text-muted-foreground">
						<BookMarked class="mb-3 h-10 w-10 opacity-40" />
						<p class="text-sm">No lorebooks associated with this character</p>
						{#if availableToAdd.length > 0}
							<p class="mt-1 text-xs">Click + to add a lorebook to this chat</p>
						{/if}
					</div>
				{:else}
					<div class="space-y-3">
						{#each lorebooks as lb (lb.id)}
							<div class="rounded-xl border border-border bg-background">
								<!-- Lorebook header -->
								<div class="flex items-center">
									<button
										onclick={() => toggleExpand(lb.id)}
										class="flex flex-1 items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50"
									>
										{#if expanded[lb.id]}
											<ChevronDown class="h-4 w-4 text-muted-foreground" />
										{:else}
											<ChevronRight class="h-4 w-4 text-muted-foreground" />
										{/if}
										{#if lb.iconUrl}
											<img src={lb.iconUrl} alt="" class="h-9 w-9 shrink-0 rounded-md object-cover" referrerpolicy="no-referrer" onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
										{:else if lb.characterAvatarPath}
											<img src={lb.characterAvatarPath} alt="" loading="lazy" decoding="async" class="h-9 w-9 shrink-0 rounded-md object-cover" />
										{:else}
											<div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent/60 text-muted-foreground">
												<BookOpen class="h-4.5 w-4.5" />
											</div>
										{/if}
										<div class="flex-1">
											<div class="flex items-center gap-2">
												<span class="font-medium">{lb.name}</span>
												{#if lb.isCharacterLorebook}
													<span class="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
														<Lock class="h-3 w-3" /> Built-in
													</span>
												{/if}
												{#if !lb.enabled}
													<span class="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Disabled</span>
												{/if}
											</div>
											{#if lb.description}
												<p class="mt-0.5 text-xs text-muted-foreground">{lb.description}</p>
											{/if}
										</div>
										<span class="text-xs text-muted-foreground">{enabledEntries(lb.entries).length}/{lb.entries.length} entries</span>
									</button>
									{#if !lb.isCharacterLorebook}
										<button
											onclick={() => removeLorebook(lb.id)}
											class="mr-2 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
											use:tooltip={'Remove from chat'}
										>
											<Trash2 class="h-4 w-4" />
										</button>
									{/if}
								</div>

								<!-- Entries -->
								{#if expanded[lb.id]}
									<div class="border-t border-border">
										{#if lb.entries.length === 0}
											<div class="px-4 py-3 text-sm text-muted-foreground">No entries</div>
										{:else}
											{#each lb.entries as entry (entry.id)}
												<div class="border-b border-border/50 px-4 py-3 last:border-b-0 {!entry.enabled ? 'opacity-40' : ''}">
													<div class="mb-1.5 flex flex-wrap items-center gap-2">
														{#if entry.constant}
															<span class="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-500">
																<Pin class="h-3 w-3" /> Always
															</span>
														{/if}
														{#if entry.keywords}
															{#each entry.keywords.split(',').map(k => k.trim()).filter(Boolean) as kw}
																<span class="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
																	<Tag class="h-3 w-3" /> {kw}
																</span>
															{/each}
														{/if}
													</div>
													<p class="whitespace-pre-wrap text-sm leading-relaxed text-foreground/80">{entry.content}</p>
													<!-- Per-chat override controls. Toggling sets an override
													     against the library default; the reset button clears
													     both overrides for this entry in this chat. -->
													<div class="mt-2 flex flex-wrap items-center gap-3 text-xs">
														<label class="inline-flex cursor-pointer items-center gap-1.5">
															<input
																type="checkbox"
																checked={entry.enabled}
																onchange={(e) => patchEntryOverride(entry, { enabled: (e.currentTarget as HTMLInputElement).checked })}
																class="h-3.5 w-3.5 rounded border-border"
															/>
															<span class={entry.enabledOverridden ? 'font-semibold text-primary' : 'text-muted-foreground'}>
																Enabled{entry.enabledOverridden ? '*' : ''}
															</span>
														</label>
														<label class="inline-flex cursor-pointer items-center gap-1.5">
															<input
																type="checkbox"
																checked={entry.constant}
																onchange={(e) => patchEntryOverride(entry, { constant: (e.currentTarget as HTMLInputElement).checked })}
																class="h-3.5 w-3.5 rounded border-border"
															/>
															<span class={entry.constantOverridden ? 'font-semibold text-primary' : 'text-muted-foreground'}>
																Always inject{entry.constantOverridden ? '*' : ''}
															</span>
														</label>
														{#if entry.enabledOverridden || entry.constantOverridden}
															<button
																type="button"
																onclick={() => resetEntryOverride(entry)}
																class="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
																use:tooltip={'Reset to library defaults'}
															>
																<RotateCcw class="h-3 w-3" /> Reset
															</button>
														{/if}
													</div>
												</div>
											{/each}
										{/if}
									</div>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</div>

	<!-- Add Lorebook Modal -->
	{#if showAddModal}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div class="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" onclick={() => { showAddModal = false; }}>
			<div
				class="flex max-h-[75vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
				onclick={(e) => e.stopPropagation()}
			>
				<!-- Header -->
				<div class="flex items-center justify-between border-b border-border px-5 py-3">
					<div class="flex items-center gap-2">
						<Plus class="h-5 w-5 text-primary" />
						<h2 class="text-lg font-semibold">Add Lorebook</h2>
					</div>
					<button onclick={() => { showAddModal = false; }} class="rounded-lg p-1.5 text-muted-foreground hover:bg-accent"><X class="h-5 w-5" /></button>
				</div>

				<!-- Search & Sort -->
				<div class="flex items-center gap-2 border-b border-border px-4 py-2">
					<div class="relative flex-1">
						<Search class="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
						<input
							type="text"
							bind:value={addSearch}
							placeholder="Search lorebooks..."
							class="w-full rounded-lg border border-border bg-background py-1.5 pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
						/>
					</div>
					<button
						onclick={() => { addSort = addSort === 'alpha' ? 'newest' : 'alpha'; }}
						class="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
						use:tooltip={'Toggle sort'}
					>
						<ArrowUpDown class="h-3.5 w-3.5" />
						{addSort === 'alpha' ? 'A–Z' : 'Newest'}
					</button>
				</div>

				<!-- List -->
				<div class="flex-1 overflow-y-auto p-2">
					{#if filteredAvailable.length === 0}
						<div class="flex flex-col items-center justify-center py-10 text-muted-foreground">
							<BookMarked class="mb-2 h-8 w-8 opacity-40" />
							<p class="text-sm">{addSearch ? 'No matching lorebooks' : 'No lorebooks available to add'}</p>
						</div>
					{:else}
						<div class="space-y-1">
							{#each filteredAvailable as lb (lb.id)}
								<button
									onclick={() => { addLorebook(lb.id); showAddModal = false; }}
									class="flex w-full items-start gap-3 rounded-xl px-4 py-3 text-left transition-colors hover:bg-accent"
								>
									{#if lb.iconUrl}
										<img src={lb.iconUrl} alt="" class="h-10 w-10 shrink-0 rounded-md object-cover" referrerpolicy="no-referrer" onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
									{:else}
										<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent/60 text-muted-foreground">
											<BookOpen class="h-5 w-5" />
										</div>
									{/if}
									<div class="flex-1 min-w-0">
										<span class="block text-sm font-medium">{lb.name}</span>
										{#if lb.description}
											<span class="block truncate text-xs text-muted-foreground">{lb.description}</span>
										{/if}
									</div>
									<Plus class="mt-0.5 h-4 w-4 shrink-0 text-primary" />
								</button>
							{/each}
						</div>
					{/if}
				</div>
			</div>
		</div>
	{/if}
{/if}
