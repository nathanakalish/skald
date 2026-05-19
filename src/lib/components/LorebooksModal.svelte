<script lang="ts">
	import { tooltip } from '$lib/tooltip.js';
	import { Plus, BookOpen, Pencil, Trash2, X, Upload, Search, ArrowUpDown, Globe } from 'lucide-svelte';
	import { staggerOnMount } from '$lib/utils/staggerOnMount';
	import { createModalState, createModalGestures } from '$lib/modal.svelte.js';
	import { focusTrap } from '$lib/focusTrap.js';
	import LorebookEditModal from '$lib/components/LorebookEditModal.svelte';
	import ConfirmModal from '$lib/components/ConfirmModal.svelte';
	import { lorebooksStore } from '$lib/stores/lorebooks.svelte.js';
	import ChubBrowseModal from '$lib/components/ChubBrowseModal.svelte';
	import { toasts } from '$lib/stores/toast.svelte.js';
	import LimitedInput from '$lib/components/LimitedInput.svelte';
	import LimitedTextarea from '$lib/components/LimitedTextarea.svelte';
	import { checkFieldLimits } from '$lib/limitCheck.js';
	import { FIELD_LIMITS } from '$lib/fieldLimits.js';

	interface Props {
		open: boolean;
		embedded?: boolean;
		selectedId?: number | null;
		characters?: any[];
		onclose: () => void;
		onselect?: (id: number | null) => void;
	}

	let { open, embedded = false, selectedId = null, characters = [], onclose, onselect }: Props = $props();

	// Lorebooks read from the central store — add/edit/delete reflect
	// instantly without an invalidateAll() round-trip.
	const lorebooks = $derived(lorebooksStore.lorebooks);

	const characterMap = $derived(new Map(characters.map((c: any) => [c.id, c])));
	let showCreateForm = $state(false);
	let name = $state('');
	let description = $state('');
	let fileInput: HTMLInputElement | undefined = $state();
	let importing = $state(false);
	let chubOpen = $state(false);
	let editLorebookId: number | null = $state(null);
	let searchQuery = $state('');
	let sortBy = $state<'alpha' | 'newest'>('alpha');
	let confirmDeleteLbId: number | null = $state(null);
	let confirmDeleteLbName = $state('');
	let confirmDeleteLbUsedBy = $state<string[]>([]);

	const filteredLorebooks = $derived.by(() => {
		let list = lorebooks;
		const q = searchQuery.trim().toLowerCase();
		if (q) {
			list = list.filter(lb =>
				lb.name.toLowerCase().includes(q) ||
				(lb.description && lb.description.toLowerCase().includes(q))
			);
		}
		list = [...list].sort((a: any, b: any) => {
			if (sortBy === 'alpha') return a.name.localeCompare(b.name);
			return (b.id ?? 0) - (a.id ?? 0);
		});
		return list;
	});

	async function createLorebook() {
		if (!name.trim()) return;
		const ok = await checkFieldLimits([
			{ label: 'Name', value: name, limit: FIELD_LIMITS.name, trim: (v) => (name = v) },
			{ label: 'Description', value: description, limit: FIELD_LIMITS.description, trim: (v) => (description = v) },
		]);
		if (!ok) return;
		// Optimistic insert with a temp negative ID so the new card shows
		// instantly. Swap to the real ID on success, drop on failure.
		const tempId = -Date.now();
		const payload = { name: name.trim(), description };
		const placeholder: any = { id: tempId, name: payload.name, description, characterId: null };
		lorebooksStore.add(placeholder);
		showCreateForm = false;
		name = '';
		description = '';
		try {
			const res = await fetch('/api/lorebooks', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});
			if (!res.ok) throw new Error(String(res.status));
			const body = await res.json();
			lorebooksStore.remove(tempId);
			if (body?.id) lorebooksStore.add(body);
		} catch {
			lorebooksStore.remove(tempId);
			toasts.error('Failed to create lorebook');
		}
	}

	async function deleteLorebook(id: number) {
		const snapshot = lorebooks.find((l: any) => l.id === id);
		if (!snapshot) return;
		const wasSelected = selectedId === id;
		lorebooksStore.remove(id);
		if (wasSelected) onselect?.(null);
		try {
			const res = await fetch(`/api/lorebooks/${id}`, { method: 'DELETE' });
			if (!res.ok) throw new Error(String(res.status));
		} catch {
			lorebooksStore.add(snapshot);
			if (wasSelected) onselect?.(id);
			toasts.error('Failed to delete lorebook');
		}
	}

	function askDeleteLorebook(id: number, name: string) {
		confirmDeleteLbId = id;
		confirmDeleteLbName = name;
		// Find the character that "owns" this lorebook
		const lb = lorebooks.find((l: any) => l.id === id);
		const usedBy: string[] = [];
		if (lb?.characterId) {
			const char = characterMap.get(lb.characterId);
			if (char) usedBy.push(char.name);
		}
		confirmDeleteLbUsedBy = usedBy;
	}

	async function confirmDeleteLb() {
		if (confirmDeleteLbId !== null) {
			await deleteLorebook(confirmDeleteLbId);
			confirmDeleteLbId = null;
			confirmDeleteLbName = '';
			confirmDeleteLbUsedBy = [];
		}
	}

	async function importFile(file: File) {
		importing = true;
		try {
			const formData = new FormData();
			formData.append('file', file);
			const res = await fetch('/api/lorebooks/import', { method: 'POST', body: formData });
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				toasts.error(`Import failed: ${err.error || 'Unknown error'}`);
			} else {
				const body = await res.json();
				if (body?.lorebook) lorebooksStore.add(body.lorebook);
				else await lorebooksStore.load(true);
			}
		} finally {
			importing = false;
		}
	}

	async function triggerImport() {
		if ('showOpenFilePicker' in window) {
			try {
				const [handle] = await (window as any).showOpenFilePicker({
					types: [{ description: 'Lorebook JSON', accept: { 'application/json': ['.json'] } }],
					multiple: false,
				});
				const file: File = await handle.getFile();
				await importFile(file);
				return;
			} catch (err: any) {
				if (err?.name === 'AbortError') return;
				// fall through to hidden input
			}
		}
		fileInput?.click();
	}

	async function handleImportFile(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) { input.value = ''; return; }
		input.value = '';
		await importFile(file);
	}

	const modal = createModalState(() => open && !embedded);
	const gestures = createModalGestures({ onclose: () => onclose(), modal });
</script>

{#if embedded && open}
	<!-- Embedded mode: sidebar list for desktop two-card layout -->
	<div class="flex h-14 items-center justify-between px-5">
		<h1 class="text-2xl font-extrabold tracking-tight text-primary md:text-foreground">Lorebooks</h1>
		<div class="flex items-center gap-1">
			<input bind:this={fileInput} type="file" accept=".json" class="hidden" onchange={handleImportFile} />
			<button
				onclick={() => (chubOpen = true)}
				class="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
				use:tooltip={'Browse CHUB'}
				aria-label="Browse CHUB"
			>
				<Globe class="h-4 w-4" />
			</button>
			<button
				onclick={triggerImport}
				disabled={importing}
				class="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground disabled:opacity-50"
				use:tooltip={importing ? 'Importing...' : 'Import'}
				aria-label="Import lorebook"
			>
				<Upload class="h-4 w-4" />
			</button>
			<button
				onclick={() => (showCreateForm = !showCreateForm)}
				class="flex h-9 w-9 items-center justify-center rounded-full bg-accent/60 text-foreground transition-colors hover:bg-accent"
				use:tooltip={'Create lorebook'}
				aria-label="Create lorebook"
			>
				<Plus class="h-4 w-4" />
			</button>
		</div>
	</div>

	<!-- Search & Sort -->
	<div class="flex items-center gap-2 px-3 pt-1 pb-2">
		<div class="relative flex-1">
			<Search class="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
			<input
				type="text"
				bind:value={searchQuery}
				placeholder="Search lorebooks..."
				class="w-full rounded-full border border-transparent bg-accent/40 py-2 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:border-primary/30 focus:bg-background focus:outline-none focus:ring-2 focus:ring-ring/40"
			/>
		</div>
		<button
			onclick={() => { sortBy = sortBy === 'alpha' ? 'newest' : 'alpha'; }}
			class="flex items-center gap-1 rounded-full border border-transparent bg-accent/40 px-2.5 py-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
			use:tooltip={'Toggle sort'}
		>
			<ArrowUpDown class="h-3.5 w-3.5" />
			{sortBy === 'alpha' ? 'A–Z' : 'New'}
		</button>
	</div>

	<!-- Create form -->
	{#if showCreateForm}
		<div class="mx-3 mb-2 rounded-xl border border-primary/20 bg-card p-3">
			<div class="space-y-2">
				<LimitedInput
					bind:value={name}
					limit={FIELD_LIMITS.name}
					class="w-full rounded-lg border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
					placeholder="Lorebook name *"
				/>
				<LimitedTextarea
					bind:value={description}
					rows={2}
					limit={FIELD_LIMITS.description}
					class="w-full rounded-lg border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
					placeholder="Description (optional)"
				/>
				<div class="flex justify-end gap-2">
					<button onclick={() => (showCreateForm = false)} class="rounded-lg border border-border px-3 py-1 text-xs hover:bg-accent">Cancel</button>
					<button onclick={createLorebook} disabled={!name.trim()} class="rounded-lg bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">Create</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Lorebook list -->
	<nav class="flex-1 overflow-y-auto px-2 py-2">
		{#if filteredLorebooks.length === 0 && !showCreateForm}
			<div class="flex flex-col items-center justify-center py-12 text-muted-foreground">
				<BookOpen class="mb-3 h-8 w-8 opacity-30" />
				<p class="text-sm">No lorebooks yet</p>
			</div>
		{:else}
			<div class="flex flex-col gap-1.5">
				{#each filteredLorebooks as lorebook, i}
					{@const char = lorebook.characterId ? characterMap.get(lorebook.characterId) : null}
					<div
						use:staggerOnMount={{ index: i }}
						class="group flex items-center gap-1 rounded-xl text-sm transition-colors
							{selectedId === lorebook.id
								? 'bg-primary/10 ring-1 ring-primary/30'
								: 'bg-accent/30 hover:bg-accent/60'}"
					>
						<button
							onclick={() => onselect?.(lorebook.id)}
							class="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left"
						>
							{#if typeof lorebook.iconUrl === 'string' && lorebook.iconUrl}
								<img src={lorebook.iconUrl} alt="" class="h-10 w-10 shrink-0 rounded-md object-cover" referrerpolicy="no-referrer" onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
							{:else if char?.avatarPath}
								<img src={char.avatarPath} alt={char.name} loading="lazy" decoding="async" class="h-10 w-10 shrink-0 rounded-md object-cover" />
							{:else if char}
								<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-xs font-bold text-primary">{char.name[0]}</div>
							{:else}
								<BookOpen class="h-4.5 w-4.5 shrink-0 text-muted-foreground" />
							{/if}
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									<span class="truncate font-medium">{lorebook.name}</span>
									{#if !lorebook.enabled}
										<span class="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">Off</span>
									{/if}
								</div>
								{#if lorebook.description}
									<p class="truncate text-xs text-muted-foreground">{lorebook.description}</p>
								{/if}
							</div>
						</button>
						<button
							onclick={(e) => { e.stopPropagation(); askDeleteLorebook(lorebook.id, lorebook.name); }}
							class="mr-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-all hover:bg-destructive/20 hover:text-destructive group-hover:opacity-100"
							use:tooltip={'Delete lorebook'}
							aria-label="Delete lorebook"
						>
							<Trash2 class="h-3.5 w-3.5" />
						</button>
					</div>
				{/each}
			</div>
		{/if}
	</nav>
{:else if modal.visible}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4 bg-black/60 {modal.closing ? 'backdrop-exit' : 'backdrop-enter'}"
		role="dialog" aria-modal="true" aria-label="Lorebooks" tabindex="-1" use:focusTrap
		onkeydown={(e) => e.key === 'Escape' && onclose()}
	>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div class="absolute inset-0" onclick={onclose}></div>
		<div
			class="relative z-10 flex max-h-[85vh] w-full max-w-3xl flex-col rounded-t-2xl border border-border bg-card shadow-xl sm:rounded-xl {modal.closing ? 'modal-exit' : 'modal-enter'}"
			ontouchstart={gestures.handlers.onTouchStart}
			ontouchmove={gestures.handlers.onTouchMove}
			ontouchend={gestures.handlers.onTouchEnd}
			style={gestures.panelStyle}
		>
			<!-- Header -->
			<div class="flex items-center justify-between border-b border-border px-6 py-4">
				<h2 class="text-lg font-semibold">Lorebooks</h2>
				<div class="flex items-center gap-2">
					<input bind:this={fileInput} type="file" accept=".json" class="hidden" onchange={handleImportFile} />
					<button
						onclick={triggerImport}
						disabled={importing}
						class="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50"
					>
						<Upload class="h-4 w-4" />
						{importing ? 'Importing...' : 'Import'}
					</button>
					<button
						onclick={() => (showCreateForm = !showCreateForm)}
						class="flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
					>
						<Plus class="h-4 w-4" />
						Create
					</button>
					<button
						onclick={onclose}
						aria-label="Close"
						class="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent"
					>
						<X class="h-4 w-4" />
					</button>
				</div>
			</div>

			<!-- Search & Sort -->
			<div class="flex items-center gap-2 border-b border-border px-6 py-2">
				<div class="relative flex-1">
					<Search class="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
					<input
						type="text"
						bind:value={searchQuery}
						placeholder="Search lorebooks..."
						class="w-full rounded-lg border border-border bg-background py-1.5 pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
					/>
				</div>
				<button
					onclick={() => { sortBy = sortBy === 'alpha' ? 'newest' : 'alpha'; }}
					class="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
					use:tooltip={'Toggle sort'}
				>
					<ArrowUpDown class="h-3.5 w-3.5" />
					{sortBy === 'alpha' ? 'A–Z' : 'Newest'}
				</button>
			</div>

			<!-- Body -->
			<div class="flex-1 overflow-y-auto p-6">
				{#if showCreateForm}
					<div class="mb-6 rounded-xl border border-primary/20 bg-card p-4">
						<h3 class="mb-4 text-sm font-semibold">New Lorebook</h3>
						<div class="space-y-3">
							<div>
								<label for="ml-name" class="mb-1 block text-xs font-medium text-muted-foreground">Name *</label>
								<LimitedInput
									id="ml-name"
									bind:value={name}
									limit={FIELD_LIMITS.name}
									class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
									placeholder="Lorebook name"
								/>
							</div>
							<div>
								<label for="ml-desc" class="mb-1 block text-xs font-medium text-muted-foreground">Description</label>
								<LimitedTextarea
									id="ml-desc"
									bind:value={description}
									rows={3}
									limit={FIELD_LIMITS.description}
									class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
									placeholder="What is this lorebook about?"
								/>
							</div>
							<div class="flex justify-end gap-3 pt-1">
								<button
									onclick={() => (showCreateForm = false)}
									class="rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-accent"
								>
									Cancel
								</button>
								<button
									onclick={createLorebook}
									disabled={!name.trim()}
									class="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
								>
									Create
								</button>
							</div>
						</div>
					</div>
				{/if}

				{#if filteredLorebooks.length === 0 && !showCreateForm}
					<div class="flex flex-col items-center justify-center py-12 text-muted-foreground">
						<BookOpen class="mb-4 h-12 w-12 opacity-30" />
						<p class="text-lg">No lorebooks yet</p>
						<p class="mt-1 text-sm">Create a lorebook to add world info to your chats</p>
					</div>
				{:else}
					<div class="grid gap-3">
						{#each filteredLorebooks as lorebook}
							{@const char = lorebook.characterId ? characterMap.get(lorebook.characterId) : null}
							<div
								class="flex items-center gap-3 rounded-lg border border-border bg-background p-4 transition-colors hover:border-primary/30"
							>
								{#if char?.avatarPath}
									<img src={char.avatarPath} alt={char.name} loading="lazy" decoding="async" class="h-10 w-10 shrink-0 rounded-full object-cover" />
								{:else if char}
									<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">{char.name[0]}</div>
								{:else}
									<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
										<BookOpen class="h-4 w-4 text-muted-foreground" />
									</div>
								{/if}
								<div class="min-w-0 flex-1">
									<div class="flex items-center gap-2">
										<h3 class="font-semibold">{lorebook.name}</h3>
										{#if !lorebook.enabled}
											<span class="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">Disabled</span>
										{/if}
									</div>
									{#if lorebook.description}
										<p class="mt-0.5 text-sm text-muted-foreground">{lorebook.description}</p>
									{/if}
								</div>
								<div class="flex items-center gap-2">
								<button
									onclick={() => { editLorebookId = lorebook.id; }}
									class="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
								>
									<Pencil class="h-4 w-4" />
								</button>
									<button
										onclick={() => askDeleteLorebook(lorebook.id, lorebook.name)}
										class="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/20 hover:text-destructive"
									>
										<Trash2 class="h-4 w-4" />
									</button>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

{#if !embedded}
<LorebookEditModal
	open={editLorebookId !== null}
	lorebookId={editLorebookId}
	onclose={() => { editLorebookId = null; }}
/>
{/if}

<ConfirmModal
	open={confirmDeleteLbId !== null}
	title="Delete Lorebook"
	message={confirmDeleteLbUsedBy.length > 0
		? `Delete "${confirmDeleteLbName}"? All entries will be permanently removed.\n\nThis lorebook is used by: ${confirmDeleteLbUsedBy.join(', ')}.`
		: `Delete "${confirmDeleteLbName}"? All entries will be permanently removed.`}
	onconfirm={confirmDeleteLb}
	oncancel={() => { confirmDeleteLbId = null; confirmDeleteLbName = ''; confirmDeleteLbUsedBy = []; }}
/>

<ChubBrowseModal
	open={chubOpen}
	initialType="lorebook"
	onclose={() => (chubOpen = false)}
	onimported={() => { void lorebooksStore.load(true); }}
/>
