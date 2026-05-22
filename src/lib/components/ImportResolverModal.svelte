<script lang="ts">
	import { X, Upload, Link2, Plus, AlertCircle, Check, Loader2 } from 'lucide-svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import IconButton from '$lib/components/ui/IconButton.svelte';
	import { toasts } from '$lib/stores/toast.svelte.js';
	import { charactersStore } from '$lib/stores/characters.svelte.js';

	interface Item {
		zipPath: string;
		title: string;
		characterName: string;
		characterFingerprint: string | null;
		messageCount: number;
		rawJson: string;
	}

	interface Props {
		open: boolean;
		items: Item[];
		characters: Array<{ id: number; name: string; avatarPath: string | null }>;
		onclose: () => void;
		onresolve: (detail: { rawJson: string; characterId: number }) => Promise<void>;
		oncharacterimported?: () => void;
	}

	let { open, items, characters, onclose, onresolve, oncharacterimported }: Props = $props();

	let workingIdx = $state(0);
	let resolving = $state(false);
	let importingChar = $state(false);
	let charFileInput: HTMLInputElement | null = $state(null);
	let stubName = $state('');
	let creatingStub = $state(false);

	const current = $derived(items[workingIdx] ?? null);

	$effect(() => {
		if (open) {
			workingIdx = 0;
			stubName = current?.characterName ?? '';
		}
	});

	$effect(() => {
		// When the working item changes, reset the stub name to its character name
		if (current) stubName = current.characterName;
	});

	async function pickExisting(characterId: number) {
		if (!current || resolving) return;
		resolving = true;
		try {
			await onresolve({ rawJson: current.rawJson, characterId });
			advance();
		} finally {
			resolving = false;
		}
	}

	async function importCharacterFile(e: Event) {
		const file = (e.currentTarget as HTMLInputElement).files?.[0];
		(e.currentTarget as HTMLInputElement).value = '';
		if (!file || importingChar) return;
		importingChar = true;
		try {
			const fd = new FormData();
			fd.append('file', file);
			const res = await fetch('/api/characters/import', { method: 'POST', body: fd });
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				toasts.error(data.error || 'Character import failed');
				return;
			}
			await charactersStore.load(true);
			oncharacterimported?.();
			const newId = data.id ?? data.character?.id;
			if (newId) await pickExisting(newId);
			else toasts.error('Imported but could not link to chat');
		} finally {
			importingChar = false;
		}
	}

	async function createStub() {
		if (!current || creatingStub) return;
		const name = stubName.trim();
		if (!name) { toasts.error('Name is required'); return; }
		creatingStub = true;
		try {
			const res = await fetch('/api/characters', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name, description: '(placeholder — created during chat import)' })
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				toasts.error(data.error || 'Could not create placeholder');
				return;
			}
			await charactersStore.load(true);
			oncharacterimported?.();
			const newId = data.id ?? data.light?.id;
			if (newId) await pickExisting(newId);
		} finally {
			creatingStub = false;
		}
	}

	function skip() { advance(); }

	function advance() {
		if (workingIdx < items.length - 1) {
			workingIdx++;
		} else {
			onclose();
		}
	}

	let charSearch = $state('');
	const filteredChars = $derived(
		charSearch.trim()
			? characters.filter(c => c.name.toLowerCase().includes(charSearch.toLowerCase()))
			: characters
	);
</script>

{#if open && current}
<div class="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4">
	<div class="w-full max-w-lg max-h-[90vh] flex flex-col rounded-xl border border-border bg-card shadow-xl">
		<div class="flex items-center justify-between border-b border-border px-4 py-3">
			<div class="min-w-0">
				<h3 class="truncate text-base font-semibold">Link chat to a character</h3>
				<p class="truncate text-xs text-muted-foreground">{workingIdx + 1} of {items.length} unresolved</p>
			</div>
			<IconButton icon={X} ariaLabel="Close" size="sm" onclick={onclose} />
		</div>

		<div class="flex-1 overflow-y-auto p-4 space-y-4">
			<div class="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-warning">
				<AlertCircle class="mt-0.5 h-4 w-4 shrink-0" />
				<div class="flex-1">
					<p>This chat is for character <strong>"{current.characterName}"</strong>, but no matching character exists in your library.</p>
					{#if current.messageCount > 0}
						<p class="mt-1 text-xs opacity-80">{current.messageCount} message{current.messageCount === 1 ? '' : 's'}{current.title ? ` · "${current.title}"` : ''}</p>
					{/if}
				</div>
			</div>

			<!-- Option 1: Link to existing -->
			<div class="rounded-lg border border-border p-3">
				<div class="mb-2 flex items-center gap-2">
					<Link2 class="h-4 w-4 text-muted-foreground" />
					<p class="text-sm font-medium">Link to an existing character</p>
				</div>
				<input
					bind:value={charSearch}
					placeholder="Search your library…"
					class="mb-2 w-full rounded-lg border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
				/>
				<div class="max-h-48 overflow-y-auto rounded-md border border-border">
					{#if filteredChars.length === 0}
						<p class="p-3 text-center text-xs text-muted-foreground">No characters yet.</p>
					{:else}
						{#each filteredChars as c (c.id)}
							<button
								onclick={() => pickExisting(c.id)}
								disabled={resolving}
								class="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-accent disabled:opacity-50"
							>
								{#if c.avatarPath}
									<img src={c.avatarPath} alt="" loading="lazy" decoding="async" class="h-7 w-7 rounded-full object-cover" />
								{:else}
									<div class="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{c.name[0]}</div>
								{/if}
								<span class="flex-1 truncate text-sm">{c.name}</span>
								{#if resolving}
									<Loader2 class="h-3.5 w-3.5 animate-spin text-muted-foreground" />
								{:else}
									<Check class="h-3.5 w-3.5 text-muted-foreground" />
								{/if}
							</button>
						{/each}
					{/if}
				</div>
			</div>

			<!-- Option 2: Import character file -->
			<div class="rounded-lg border border-border p-3">
				<div class="mb-2 flex items-center gap-2">
					<Upload class="h-4 w-4 text-muted-foreground" />
					<p class="text-sm font-medium">Import a character file</p>
				</div>
				<p class="mb-2 text-xs text-muted-foreground">Upload a .png card or .json — we'll import it and link this chat to it.</p>
				<Button
					size="sm"
					icon={importingChar ? undefined : Upload}
					loading={importingChar}
					onclick={() => charFileInput?.click()}
					disabled={importingChar}
				>
					{importingChar ? 'Importing…' : 'Choose file…'}
				</Button>
				<input bind:this={charFileInput} type="file" accept=".png,.json" class="hidden" onchange={importCharacterFile} />
			</div>

			<!-- Option 3: Create stub -->
			<div class="rounded-lg border border-border p-3">
				<div class="mb-2 flex items-center gap-2">
					<Plus class="h-4 w-4 text-muted-foreground" />
					<p class="text-sm font-medium">Create a placeholder character</p>
				</div>
				<p class="mb-2 text-xs text-muted-foreground">Make an empty character with this name so the chat has somewhere to live. Fill out the details later.</p>
				<div class="flex gap-2">
					<input
						bind:value={stubName}
						class="flex-1 rounded-lg border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
					/>
					<Button
						variant="primary"
						size="sm"
						icon={creatingStub ? undefined : Plus}
						loading={creatingStub}
						onclick={createStub}
						disabled={creatingStub || !stubName.trim()}
					>
						Create
					</Button>
				</div>
			</div>
		</div>

		<div class="flex justify-end gap-2 border-t border-border px-4 py-3">
			<Button size="sm" onclick={skip}>Skip this chat</Button>
		</div>
	</div>
</div>
{/if}
