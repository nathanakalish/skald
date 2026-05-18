<script lang="ts">
	import { X, Plus, Trash2, GripVertical } from 'lucide-svelte';
	import { untrack } from 'svelte';
	import { createModalState, createModalGestures } from '$lib/modal.svelte.js';
	import { focusTrap } from '$lib/focusTrap.js';
	import { lorebooksStore } from '$lib/stores/lorebooks.svelte.js';
	import { api } from '$lib/api.js';

	interface Props {
		open: boolean;
		embedded?: boolean;
		lorebookId: number | null;
		onclose: () => void;
	}

	let { open, embedded = false, lorebookId, onclose }: Props = $props();

	interface Entry {
		id: number;
		keywords: string;
		content: string;
		insertionOrder: number;
		enabled: boolean;
		caseSensitive: boolean;
		constant: boolean;
	}

	let lorebookName = $state('');
	let lorebookDesc = $state('');
	let entries: Entry[] = $state([]);
	let loading = $state(false);
	let loadedId: number | null = $state(null);

	$effect(() => {
		if (open && lorebookId !== null && lorebookId !== loadedId) {
			untrack(() => loadLorebook(lorebookId));
		}
		if (!open) {
			untrack(() => { loadedId = null; });
		}
	});

	async function loadLorebook(id: number) {
		loading = true;
		try {
			const data = await api<any>(`/api/lorebooks/${id}`, { errorLabel: 'Failed to load lorebook' });
			if (data) {
				lorebookName = data.name;
				lorebookDesc = data.description ?? '';
				entries = (data.entries ?? []).map((e: any) => ({
					...e,
					enabled: e.enabled ?? true,
					caseSensitive: e.caseSensitive ?? false,
					constant: e.constant ?? false
				}));
				loadedId = id;
			}
		} finally {
			loading = false;
		}
	}

	async function saveLorebook() {
		if (lorebookId === null) return;
		const body = await api<any>(`/api/lorebooks/${lorebookId}`, {
			method: 'PUT',
			json: { name: lorebookName, description: lorebookDesc },
			errorLabel: 'Failed to save lorebook'
		});
		if (body) {
			if (body.lorebook) lorebooksStore.upsert(body.lorebook);
			else lorebooksStore.update(lorebookId, { name: lorebookName, description: lorebookDesc });
		}
	}

	async function addEntry() {
		if (lorebookId === null) return;
		const res = await fetch(`/api/lorebooks/${lorebookId}/entries`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				keywords: '',
				content: '',
				insertionOrder: entries.length * 10 + 100
			})
		});
		if (res.ok) {
			const entry = await res.json();
			entries = [
				...entries,
				{
					...entry,
					enabled: entry.enabled ?? true,
					caseSensitive: entry.caseSensitive ?? false,
					constant: entry.constant ?? false
				}
			];
		}
	}

	async function saveEntry(entry: Entry) {
		if (lorebookId === null) return;
		await fetch(`/api/lorebooks/${lorebookId}/entries/${entry.id}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(entry)
		});
	}

	async function deleteEntry(id: number) {
		if (lorebookId === null) return;
		const res = await fetch(`/api/lorebooks/${lorebookId}/entries/${id}`, {
			method: 'DELETE'
		});
		if (res.ok) {
			entries = entries.filter((e) => e.id !== id);
		}
	}

	function close() {
		onclose();
	}

	const modal = createModalState(() => open && lorebookId !== null && !embedded);
	const gestures = createModalGestures({ onclose: close, modal });
</script>

{#if embedded && open && lorebookId !== null}
	<!-- Embedded mode: content-only for desktop two-card layout -->
	<div class="flex min-h-0 flex-1 flex-col overflow-hidden md:rounded-2xl md:bg-background">
		<!-- Header -->
		<div class="flex h-14 shrink-0 items-center justify-between border-b border-border/50 px-4">
			<div class="flex items-center gap-2 min-w-0">
				<h2 class="truncate text-base font-semibold">
					{lorebookName.toLowerCase().includes('lorebook') ? lorebookName : `${lorebookName} Lorebook`}
				</h2>
			</div>
			<button
				onclick={addEntry}
				class="flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
			>
				<Plus class="h-4 w-4" />
				Add Entry
			</button>
		</div>

		<div class="flex-1 overflow-y-auto p-6">
			{#if loading}
				<div class="flex items-center justify-center py-12 text-muted-foreground">
					<div class="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
				</div>
			{:else}
				<div class="mx-auto max-w-4xl space-y-4">
					<!-- Name & Description -->
					<div class="mb-6 space-y-3">
						<div>
							<label for="lbe-emb-name" class="mb-1 block text-sm font-medium text-muted-foreground">Name</label>
							<input
								id="lbe-emb-name"
								bind:value={lorebookName}
								onblur={saveLorebook}
								class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
								placeholder="Lorebook name"
							/>
						</div>
						<div>
							<label for="lbe-emb-desc" class="mb-1 block text-sm font-medium text-muted-foreground">Description</label>
							<input
								id="lbe-emb-desc"
								bind:value={lorebookDesc}
								onblur={saveLorebook}
								class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
								placeholder="Lorebook description"
							/>
						</div>
					</div>

					{#if entries.length === 0}
						<div class="flex flex-col items-center justify-center py-12 text-muted-foreground">
							<p>No entries yet. Add an entry to get started.</p>
						</div>
					{:else}
						{#each entries as entry (entry.id)}
							<div class="rounded-xl border border-border bg-background p-4">
								<div class="mb-3 flex items-center justify-between">
									<div class="flex items-center gap-3">
										<GripVertical class="h-4 w-4 text-muted-foreground" />
										<label class="flex items-center gap-2 text-sm">
											<input type="checkbox" bind:checked={entry.enabled} onchange={() => saveEntry(entry)} class="rounded border-input" />
											Enabled
										</label>
										<label class="flex items-center gap-2 text-sm text-muted-foreground">
											<input type="checkbox" bind:checked={entry.constant} onchange={() => saveEntry(entry)} class="rounded border-input" />
											Always inject
										</label>
										<label class="flex items-center gap-2 text-sm text-muted-foreground">
											<input type="checkbox" bind:checked={entry.caseSensitive} onchange={() => saveEntry(entry)} class="rounded border-input" />
											Case sensitive
										</label>
									</div>
									<button
										onclick={() => deleteEntry(entry.id)}
										class="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/20 hover:text-destructive"
									>
										<Trash2 class="h-4 w-4" />
									</button>
								</div>
								<div class="grid gap-3 sm:grid-cols-2">
									<div>
										<label for="emb-entry-kw-{entry.id}" class="mb-1 block text-xs font-medium text-muted-foreground">Keywords (comma-separated)</label>
										<input id="emb-entry-kw-{entry.id}" bind:value={entry.keywords} onblur={() => saveEntry(entry)} class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" placeholder="keyword1, keyword2" />
									</div>
									<div>
										<label for="emb-entry-order-{entry.id}" class="mb-1 block text-xs font-medium text-muted-foreground">Insertion Order</label>
										<input id="emb-entry-order-{entry.id}" type="number" bind:value={entry.insertionOrder} onblur={() => saveEntry(entry)} class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
									</div>
								</div>
								<div class="mt-3">
									<label for="emb-entry-content-{entry.id}" class="mb-1 block text-xs font-medium text-muted-foreground">Content</label>
									<textarea id="emb-entry-content-{entry.id}" bind:value={entry.content} onblur={() => saveEntry(entry)} rows={3} class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" placeholder="The content to inject when keywords match..."></textarea>
								</div>
							</div>
						{/each}
					{/if}
				</div>
			{/if}
		</div>
	</div>
{:else if modal.visible}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-[60] flex items-end justify-center p-0 sm:items-center sm:p-4 bg-black/60 {modal.closing ? 'backdrop-exit' : 'backdrop-enter'}"
		role="dialog" aria-modal="true" aria-label="Edit Lorebook" tabindex="-1" use:focusTrap
		onkeydown={(e) => e.key === 'Escape' && close()}
	>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div class="absolute inset-0" onclick={close}></div>
		<div
			class="relative z-10 flex max-h-[85vh] w-full max-w-4xl flex-col rounded-t-2xl border border-border bg-card shadow-xl sm:rounded-xl {modal.closing ? 'modal-exit' : 'modal-enter'}"
			ontouchstart={gestures.handlers.onTouchStart}
			ontouchmove={gestures.handlers.onTouchMove}
			ontouchend={gestures.handlers.onTouchEnd}
			style={gestures.panelStyle}
		>
			<!-- Header -->
			<div class="flex items-center justify-between border-b border-border px-6 py-4">
				<div class="flex items-center gap-1">
					<h2 class="text-lg font-semibold">
						{lorebookName.toLowerCase().includes('lorebook') ? lorebookName : `${lorebookName} Lorebook`}
					</h2>
				</div>
				<div class="flex items-center gap-2">
					<button
						onclick={addEntry}
						class="flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
					>
						<Plus class="h-4 w-4" />
						Add Entry
					</button>
					<button
						onclick={close}
						class="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent"
					>
						<X class="h-4 w-4" />
					</button>
				</div>
			</div>

			<!-- Body -->
			<div class="flex-1 overflow-y-auto p-6">
				{#if loading}
					<div class="flex items-center justify-center py-12 text-muted-foreground">
						<p>Loading...</p>
					</div>
				{:else}
					<div class="mx-auto max-w-4xl space-y-4">
						<!-- Name & Description -->
						<div class="mb-6 space-y-3">
							<div>
								<label for="lbe-name" class="mb-1 block text-sm font-medium text-muted-foreground">Name</label>
								<input
									id="lbe-name"
									bind:value={lorebookName}
									onblur={saveLorebook}
									class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
									placeholder="Lorebook name"
								/>
							</div>
							<div>
								<label for="lbe-desc" class="mb-1 block text-sm font-medium text-muted-foreground">Description</label>
								<input
									id="lbe-desc"
									bind:value={lorebookDesc}
									onblur={saveLorebook}
									class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
									placeholder="Lorebook description"
								/>
							</div>
						</div>

						{#if entries.length === 0}
							<div class="flex flex-col items-center justify-center py-12 text-muted-foreground">
								<p>No entries yet. Add an entry to get started.</p>
							</div>
						{:else}
							{#each entries as entry (entry.id)}
								<div class="rounded-xl border border-border bg-background p-4">
									<div class="mb-3 flex items-center justify-between">
										<div class="flex items-center gap-3">
											<GripVertical class="h-4 w-4 text-muted-foreground" />
											<label class="flex items-center gap-2 text-sm">
												<input
													type="checkbox"
													bind:checked={entry.enabled}
													onchange={() => saveEntry(entry)}
													class="rounded border-input"
												/>
												Enabled
											</label>
											<label class="flex items-center gap-2 text-sm text-muted-foreground">
												<input
													type="checkbox"
													bind:checked={entry.constant}
													onchange={() => saveEntry(entry)}
													class="rounded border-input"
												/>
												Always inject
											</label>
											<label class="flex items-center gap-2 text-sm text-muted-foreground">
												<input
													type="checkbox"
													bind:checked={entry.caseSensitive}
													onchange={() => saveEntry(entry)}
													class="rounded border-input"
												/>
												Case sensitive
											</label>
										</div>
										<button
											onclick={() => deleteEntry(entry.id)}
											class="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/20 hover:text-destructive"
										>
											<Trash2 class="h-4 w-4" />
										</button>
									</div>

									<div class="grid gap-3 sm:grid-cols-2">
										<div>
											<label
												for="entry-kw-{entry.id}"
												class="mb-1 block text-xs font-medium text-muted-foreground"
											>Keywords (comma-separated)</label>
											<input
												id="entry-kw-{entry.id}"
												bind:value={entry.keywords}
												onblur={() => saveEntry(entry)}
												class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
												placeholder="keyword1, keyword2"
											/>
										</div>
										<div>
											<label
												for="entry-order-{entry.id}"
												class="mb-1 block text-xs font-medium text-muted-foreground"
											>Insertion Order</label>
											<input
												id="entry-order-{entry.id}"
												type="number"
												bind:value={entry.insertionOrder}
												onblur={() => saveEntry(entry)}
												class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
											/>
										</div>
									</div>

									<div class="mt-3">
										<label
											for="entry-content-{entry.id}"
											class="mb-1 block text-xs font-medium text-muted-foreground"
										>Content</label>
										<textarea
											id="entry-content-{entry.id}"
											bind:value={entry.content}
											onblur={() => saveEntry(entry)}
											rows={3}
											class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
											placeholder="The content to inject when keywords match..."
										></textarea>
									</div>
								</div>
							{/each}
						{/if}
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}
