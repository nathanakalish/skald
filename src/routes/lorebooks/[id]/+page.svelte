<script lang="ts">
	import { Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-svelte';
	import { slide } from 'svelte/transition';
	import { untrack } from 'svelte';

	let expandedEntries = $state(new Set<number>());

	let { data } = $props();

	interface Entry {
		id: number;
		keywords: string;
		content: string;
		insertionOrder: number;
		enabled: boolean;
		caseSensitive: boolean;
		constant: boolean;
	}

	let entries: Entry[] = $state(
		untrack(() => (data.entries ?? []).map((e) => ({
			...e,
			insertionOrder: e.insertionOrder ?? 0,
			enabled: e.enabled ?? true,
			caseSensitive: e.caseSensitive ?? false,
			constant: e.constant ?? false
		})))
	);
	let lorebookName = $state(untrack(() => data.lorebook.name));
	let lorebookDesc = $state(untrack(() => data.lorebook.description ?? ''));

	async function saveLorebook() {
		await fetch(`/api/lorebooks/${data.lorebook.id}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: lorebookName, description: lorebookDesc })
		});
	}

	async function addEntry() {
		const res = await fetch(`/api/lorebooks/${data.lorebook.id}/entries`, {
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
		await fetch(`/api/lorebooks/${data.lorebook.id}/entries/${entry.id}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(entry)
		});
	}

	async function deleteEntry(id: number) {
		const res = await fetch(`/api/lorebooks/${data.lorebook.id}/entries/${id}`, {
			method: 'DELETE'
		});
		if (res.ok) {
			entries = entries.filter((e) => e.id !== id);
		}
	}
</script>

<div class="flex h-full flex-col">
	<header class="flex h-14 items-center justify-between border-b border-border px-6">
		<div class="flex items-center gap-3">
			<input
				bind:value={lorebookName}
				onblur={saveLorebook}
				class="bg-transparent text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-ring rounded px-1"
			/>
		</div>
		<button
			onclick={addEntry}
			class="flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
		>
			<Plus class="h-4 w-4" />
			Add Entry
		</button>
	</header>

	<div class="flex-1 overflow-y-auto p-6">
		<div class="mx-auto max-w-4xl space-y-4">
			<!-- Lorebook description -->
			<div class="mb-6">
				<label for="lb-edit-desc" class="mb-1 block text-sm font-medium text-muted-foreground"
					>Description</label
				>
				<input
					id="lb-edit-desc"
					bind:value={lorebookDesc}
					onblur={saveLorebook}
					class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
					placeholder="Lorebook description"
				/>
			</div>

			{#if entries.length === 0}
				<div class="flex flex-col items-center justify-center py-12 text-muted-foreground">
					<p>No entries yet. Add an entry to get started.</p>
				</div>
			{:else}
				{#each entries as entry (entry.id)}
					{@const isExpanded = expandedEntries.has(entry.id)}
					<div class="rounded-xl border border-border bg-card transition-colors {!entry.enabled ? 'opacity-60' : ''}">
						<!-- Collapsed header (always visible) -->
						<button
							type="button"
							class="flex w-full items-center gap-3 p-4 text-left"
							onclick={() => { if (isExpanded) expandedEntries.delete(entry.id); else expandedEntries.add(entry.id); expandedEntries = new Set(expandedEntries); }}
						>
							{#if isExpanded}<ChevronDown class="h-4 w-4 shrink-0 text-muted-foreground" />{:else}<ChevronRight class="h-4 w-4 shrink-0 text-muted-foreground" />{/if}
							<div class="min-w-0 flex-1">
								<span class="text-sm font-medium">{entry.keywords || 'No keywords'}</span>
								{#if !isExpanded && entry.content}
									<p class="mt-0.5 truncate text-xs text-muted-foreground">{entry.content.slice(0, 120)}</p>
								{/if}
							</div>
							<div class="flex shrink-0 items-center gap-2">
								{#if entry.constant}<span class="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">Always</span>{/if}
								{#if entry.caseSensitive}<span class="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Aa</span>{/if}
								<span class="text-xs text-muted-foreground">#{entry.insertionOrder}</span>
							</div>
						</button>

						<!-- Expanded content -->
						{#if isExpanded}
							<div class="border-t border-border px-4 pb-4 pt-3" transition:slide={{ duration: 150 }}>
								<div class="mb-3 flex items-center justify-between">
									<div class="flex items-center gap-3">
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
											>Keywords (comma-separated)</label
										>
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
											>Insertion Order</label
										>
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
										class="mb-1 block text-xs font-medium text-muted-foreground">Content</label
									>
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
						{/if}
					</div>
				{/each}
			{/if}
		</div>
	</div>
</div>
