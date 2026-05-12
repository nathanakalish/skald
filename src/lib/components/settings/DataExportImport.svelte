<script lang="ts">
	import { Download, Upload, Package, MessageSquare, User, Search, AlertCircle, CheckCircle2, X, Loader2 } from 'lucide-svelte';
	import { toasts } from '$lib/stores/toast.svelte.js';
	import { charactersStore } from '$lib/stores/characters.svelte.js';
	import { chatsStore } from '$lib/stores/chats.svelte.js';
	import ImportResolverModal from '$lib/components/ImportResolverModal.svelte';

	interface Props {
		activeChatId: number | null;
		onchatimported?: (chatId: number) => void;
	}

	let { activeChatId, onchatimported }: Props = $props();

	const characters = $derived(charactersStore.characters);
	const activeChat = $derived(activeChatId != null ? chatsStore.chats.find(c => c.id === activeChatId) ?? null : null);

	// ── Export "this chat" ─────────────────────────────────────────────────
	let exportingChat = $state(false);
	async function exportActiveChat(format: 'md' | 'json') {
		if (!activeChatId || exportingChat) return;
		exportingChat = true;
		try {
			const url = `/api/chats/${activeChatId}/export?format=${format}`;
			const res = await fetch(url);
			if (!res.ok) {
				toasts.error('Could not export chat');
				return;
			}
			const blob = await res.blob();
			const link = document.createElement('a');
			link.href = URL.createObjectURL(blob);
			const cd = res.headers.get('content-disposition') ?? '';
			const m = cd.match(/filename="([^"]+)"/);
			link.download = m ? m[1] : `chat.${format}`;
			link.click();
			URL.revokeObjectURL(link.href);
		} catch {
			toasts.error('Export failed');
		} finally {
			exportingChat = false;
		}
	}

	// ── Export character + chats ───────────────────────────────────────────
	let exportingCharacter = $state(false);
	let charPickerOpen = $state(false);
	let charSearch = $state('');
	const filteredCharacters = $derived(
		charSearch.trim()
			? characters.filter(c => c.name.toLowerCase().includes(charSearch.toLowerCase()))
			: characters
	);

	async function exportCharacterBundle(id: number) {
		if (exportingCharacter) return;
		exportingCharacter = true;
		try {
			const res = await fetch(`/api/export/character/${id}`);
			if (!res.ok) {
				toasts.error('Could not export character');
				return;
			}
			const blob = await res.blob();
			const link = document.createElement('a');
			link.href = URL.createObjectURL(blob);
			const cd = res.headers.get('content-disposition') ?? '';
			const m = cd.match(/filename="([^"]+)"/);
			link.download = m ? m[1] : `character.skald.zip`;
			link.click();
			URL.revokeObjectURL(link.href);
			charPickerOpen = false;
			toasts.success('Character bundle downloaded');
		} catch {
			toasts.error('Export failed');
		} finally {
			exportingCharacter = false;
		}
	}

	// ── Export everything ──────────────────────────────────────────────────
	let exportingEverything = $state(false);
	let exportProgress = $state(0); // 0..100, indeterminate when -1
	let includePersonas = $state(true);
	let includeSettings = $state(true);
	let includeThemes = $state(true);
	let includeProviders = $state(false);
	let showProvidersWarning = $state(false);

	async function exportEverything() {
		if (exportingEverything) return;
		exportingEverything = true;
		exportProgress = 5;
		// Simulate progress while the server builds the zip — we don't get real progress,
		// but a moving bar feels better than a spinner for a long-ish operation.
		const tick = setInterval(() => {
			if (exportProgress < 90) exportProgress = Math.min(90, exportProgress + Math.random() * 12);
		}, 250);
		try {
			const params = new URLSearchParams({
				personas: String(includePersonas),
				settings: String(includeSettings),
				themes: String(includeThemes),
				providers: String(includeProviders)
			});
			const res = await fetch(`/api/export/everything?${params}`);
			if (!res.ok) {
				toasts.error('Backup export failed');
				return;
			}
			exportProgress = 95;
			const blob = await res.blob();
			exportProgress = 100;
			const link = document.createElement('a');
			link.href = URL.createObjectURL(blob);
			const stamp = new Date().toISOString().slice(0, 10);
			link.download = `skald-backup-${stamp}.skald.zip`;
			link.click();
			URL.revokeObjectURL(link.href);
			toasts.success('Backup downloaded');
		} catch {
			toasts.error('Backup failed');
		} finally {
			clearInterval(tick);
			exportingEverything = false;
			setTimeout(() => { exportProgress = 0; }, 800);
		}
	}

	// ── Unified import ─────────────────────────────────────────────────────
	let importInput: HTMLInputElement | null = $state(null);
	let importing = $state(false);
	let importProgress = $state(0);
	let dragOver = $state(false);
	let importSummary = $state<{ counts: Record<string, number>; providersWarning: boolean } | null>(null);

	let resolverOpen = $state(false);
	let resolverItems = $state<Array<{ zipPath: string; title: string; characterName: string; characterFingerprint: string | null; messageCount: number; rawJson: string }>>([]);

	function detectKind(file: File): 'png' | 'zip' | 'jsonl' | 'json' | 'unknown' {
		const name = file.name.toLowerCase();
		if (name.endsWith('.png')) return 'png';
		if (name.endsWith('.zip') || name.endsWith('.skald.zip')) return 'zip';
		if (name.endsWith('.jsonl')) return 'jsonl';
		if (name.endsWith('.json')) return 'json';
		return 'unknown';
	}

	async function handleImportFile(file: File) {
		if (importing) return;
		importing = true;
		importProgress = 10;
		try {
			const kind = detectKind(file);
			if (kind === 'png') {
				await importCharacterFile(file);
			} else if (kind === 'zip') {
				await importBundleFile(file);
			} else if (kind === 'jsonl' || kind === 'json') {
				await importChatOrCharacterJson(file);
			} else {
				toasts.error('Unrecognized file type. Use .png, .json, .jsonl, or .skald.zip');
			}
		} finally {
			importing = false;
			importProgress = 0;
		}
	}

	async function importCharacterFile(file: File) {
		importProgress = 50;
		const fd = new FormData();
		fd.append('file', file);
		const res = await fetch('/api/characters/import', { method: 'POST', body: fd });
		const data = await res.json().catch(() => ({}));
		if (!res.ok) {
			toasts.error(data.error || 'Character import failed');
			return;
		}
		await charactersStore.load(true);
		importSummary = { counts: { characters: 1, chats: 0, lorebooks: 0, personas: 0, providers: 0, themes: 0 }, providersWarning: false };
	}

	async function importChatOrCharacterJson(file: File) {
		const text = await file.text();
		// JSON could be a character card OR a chat export. Distinguish by shape.
		try {
			const parsed = JSON.parse(text);
			const looksLikeCharacter = parsed && (parsed.spec === 'chara_card_v2' || parsed.spec === 'chara_card_v3' || parsed.data?.name);
			if (looksLikeCharacter) {
				const fd = new FormData();
				fd.append('file', new File([text], file.name, { type: 'application/json' }));
				const res = await fetch('/api/characters/import', { method: 'POST', body: fd });
				const data = await res.json().catch(() => ({}));
				if (!res.ok) { toasts.error(data.error || 'Character import failed'); return; }
				await charactersStore.load(true);
				importSummary = { counts: { characters: 1, chats: 0, lorebooks: 0, personas: 0, providers: 0, themes: 0 }, providersWarning: false };
				return;
			}
		} catch { /* not JSON, fall through to chat (jsonl) */ }
		await importChat(text);
	}

	async function importChat(content: string, characterId?: number) {
		importProgress = 60;
		const res = await fetch('/api/chats/import', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ content, ...(characterId ? { characterId } : {}) })
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok) {
			if (data.error === 'character_not_found') {
				resolverItems = [{
					zipPath: 'imported-chat',
					title: '',
					characterName: data.characterName,
					characterFingerprint: data.characterFingerprint ?? null,
					messageCount: 0,
					rawJson: content
				}];
				resolverOpen = true;
				return;
			}
			toasts.error(data.error || 'Chat import failed');
			return;
		}
		toasts.success(`Imported ${data.messageCount} messages`);
		if (data.id && onchatimported) onchatimported(data.id);
	}

	async function importBundleFile(file: File) {
		const fd = new FormData();
		fd.append('file', file);
		// Indeterminate-ish progress while server processes
		const tick = setInterval(() => {
			if (importProgress < 85) importProgress = Math.min(85, importProgress + Math.random() * 8);
		}, 300);
		try {
			const res = await fetch('/api/import/bundle', { method: 'POST', body: fd });
			const data = await res.json().catch(() => ({}));
			clearInterval(tick);
			importProgress = 95;
			if (!res.ok) {
				toasts.error(data.error || 'Bundle import failed');
				return;
			}
			await charactersStore.load(true);
			importSummary = { counts: data.counts, providersWarning: !!data.providersWarning };
			showProvidersWarning = !!data.providersWarning;
			if (Array.isArray(data.unresolvedChats) && data.unresolvedChats.length > 0) {
				resolverItems = data.unresolvedChats.map((u: any, i: number) => ({
					...u,
					rawJson: data.unresolvedChatPayloads?.[i]?.bytes ?? ''
				}));
				resolverOpen = true;
			}
			importProgress = 100;
		} finally {
			clearInterval(tick);
		}
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		dragOver = false;
		const f = e.dataTransfer?.files?.[0];
		if (f) void handleImportFile(f);
	}
	function onDragOver(e: DragEvent) { e.preventDefault(); dragOver = true; }
	function onDragLeave() { dragOver = false; }

	function onPickFile(e: Event) {
		const f = (e.currentTarget as HTMLInputElement).files?.[0];
		if (f) void handleImportFile(f);
		(e.currentTarget as HTMLInputElement).value = '';
	}

	async function onResolve(detail: { rawJson: string; characterId: number }) {
		await importChat(detail.rawJson, detail.characterId);
	}
</script>

<div class="space-y-6">
	<div>
		<h3 class="text-base font-semibold">Data</h3>
		<p class="text-sm text-muted-foreground">Export your data for backup or move it between installations.</p>
	</div>

	<!-- ── Export Tiers ───────────────────────────────────────────────────── -->
	<div class="space-y-3">
		<h4 class="text-sm font-semibold">Export</h4>

		<!-- This Chat -->
		<div class="rounded-lg border border-border p-4">
			<div class="flex items-start gap-3">
				<MessageSquare class="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
				<div class="flex-1 min-w-0">
					<p class="text-sm font-medium">This chat</p>
					{#if activeChat}
						<div class="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
							{#if activeChat.characterAvatar}
								<img src={activeChat.characterAvatar} alt="" loading="lazy" decoding="async" class="h-5 w-5 rounded-full object-cover" />
							{/if}
							<span class="truncate">{activeChat.title || activeChat.characterName || `Chat #${activeChat.id}`}</span>
						</div>
					{:else}
						<p class="mt-1 text-xs text-muted-foreground">Open a chat first, then come back here to download it.</p>
					{/if}
					<p class="mt-1 text-xs text-muted-foreground">JSON preserves branches and swipes. Markdown is a flat transcript.</p>
				</div>
			</div>
			<div class="mt-3 flex flex-wrap gap-2">
				<button
					type="button"
					onclick={() => exportActiveChat('json')}
					disabled={!activeChatId || exportingChat}
					class="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
				>
					<Download class="h-4 w-4" /> JSON
				</button>
				<button
					type="button"
					onclick={() => exportActiveChat('md')}
					disabled={!activeChatId || exportingChat}
					class="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
				>
					<Download class="h-4 w-4" /> Markdown
				</button>
			</div>
		</div>

		<!-- A character (+ chats + lorebook) -->
		<div class="rounded-lg border border-border p-4">
			<div class="flex items-start gap-3">
				<User class="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
				<div class="flex-1">
					<p class="text-sm font-medium">A character (+ chats &amp; lorebook)</p>
					<p class="mt-1 text-xs text-muted-foreground">Bundle one character with all its chats and any attached lorebook into a single .skald.zip.</p>
				</div>
			</div>
			<div class="mt-3 flex flex-wrap gap-2">
				<button
					type="button"
					onclick={() => { charPickerOpen = true; charSearch = ''; }}
					disabled={exportingCharacter || characters.length === 0}
					class="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
				>
					<Download class="h-4 w-4" /> Pick character…
				</button>
				{#if characters.length === 0}
					<span class="self-center text-xs text-muted-foreground">No characters yet.</span>
				{/if}
			</div>
		</div>

		<!-- Everything -->
		<div class="rounded-lg border border-border p-4">
			<div class="flex items-start gap-3">
				<Package class="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
				<div class="flex-1">
					<p class="text-sm font-medium">Everything</p>
					<p class="mt-1 text-xs text-muted-foreground">A complete backup: characters, chats (with branches), lorebooks, and any optional extras you select below.</p>
				</div>
			</div>

			<div class="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
				<label class="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent cursor-pointer">
					<input type="checkbox" bind:checked={includePersonas} class="h-4 w-4 rounded border-border" />
					<span>Personas</span>
				</label>
				<label class="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent cursor-pointer">
					<input type="checkbox" bind:checked={includeThemes} class="h-4 w-4 rounded border-border" />
					<span>Custom themes</span>
				</label>
				<label class="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent cursor-pointer">
					<input type="checkbox" bind:checked={includeSettings} class="h-4 w-4 rounded border-border" />
					<span>Settings</span>
				</label>
				<label class="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent cursor-pointer">
					<input type="checkbox" bind:checked={includeProviders} class="h-4 w-4 rounded border-border" />
					<span>Provider configs</span>
				</label>
			</div>

			{#if includeProviders}
				<div class="mt-2 flex items-start gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/5 px-3 py-2 text-xs text-yellow-600 dark:text-yellow-400">
					<AlertCircle class="mt-0.5 h-3.5 w-3.5 shrink-0" />
					<span>API keys are <strong>never</strong> included. Imported providers will arrive disabled — you'll need to re-enter their keys.</span>
				</div>
			{/if}

			<div class="mt-3 flex flex-wrap items-center gap-3">
				<button
					type="button"
					onclick={exportEverything}
					disabled={exportingEverything}
					class="flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
				>
					<Download class="h-4 w-4" /> {exportingEverything ? 'Building backup…' : 'Download backup'}
				</button>
			</div>
			{#if exportingEverything || exportProgress > 0}
				<div class="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
					<div class="h-full bg-primary transition-all duration-200" style="width: {exportProgress}%"></div>
				</div>
			{/if}
		</div>
	</div>

	<!-- ── Import ─────────────────────────────────────────────────────────── -->
	<div class="space-y-3">
		<h4 class="text-sm font-semibold">Import</h4>

		<!-- Dropzone -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			role="button"
			tabindex="0"
			class="rounded-lg border-2 border-dashed p-6 transition-colors {dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'}"
			ondrop={onDrop}
			ondragover={onDragOver}
			ondragleave={onDragLeave}
			onclick={() => importInput?.click()}
			onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); importInput?.click(); } }}
		>
			<div class="flex flex-col items-center gap-2 text-center">
				<Upload class="h-6 w-6 text-muted-foreground" />
				<p class="text-sm font-medium">Drop a file or click to browse</p>
				<p class="text-xs text-muted-foreground">Character cards (.png/.json), chats (.json/.jsonl), or full backups (.skald.zip)</p>
			</div>
			{#if importing}
				<div class="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-muted">
					<div class="h-full bg-primary transition-all duration-200" style="width: {importProgress}%"></div>
				</div>
			{/if}
		</div>
		<input
			bind:this={importInput}
			type="file"
			accept=".png,.json,.jsonl,.zip"
			class="hidden"
			onchange={onPickFile}
		/>
	</div>
</div>

<!-- Character picker modal (export bundle) -->
{#if charPickerOpen}
	<div class="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4">
		<div class="w-full max-w-md rounded-xl border border-border bg-card shadow-xl flex flex-col max-h-[80vh]">
			<div class="flex items-center justify-between border-b border-border px-4 py-3">
				<h3 class="text-base font-semibold">Pick a character to export</h3>
				<button onclick={() => (charPickerOpen = false)} class="rounded-lg p-1 text-muted-foreground hover:bg-accent" aria-label="Close"><X class="h-4 w-4" /></button>
			</div>
			<div class="border-b border-border p-3">
				<div class="relative">
					<Search class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
					<input
						bind:value={charSearch}
						placeholder="Search…"
						class="w-full rounded-lg border border-input bg-background pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
					/>
				</div>
			</div>
			<div class="flex-1 overflow-y-auto p-2">
				{#if filteredCharacters.length === 0}
					<p class="py-6 text-center text-sm text-muted-foreground">No matches.</p>
				{:else}
					{#each filteredCharacters as c (c.id)}
						<button
							onclick={() => exportCharacterBundle(c.id)}
							disabled={exportingCharacter}
							class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent disabled:opacity-50"
						>
							{#if c.avatarPath}
								<img src={c.avatarPath} alt="" loading="lazy" decoding="async" class="h-9 w-9 rounded-full object-cover" />
							{:else}
								<div class="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">{c.name[0]}</div>
							{/if}
							<span class="flex-1 truncate text-sm">{c.name}</span>
							{#if exportingCharacter}
								<Loader2 class="h-4 w-4 animate-spin text-muted-foreground" />
							{:else}
								<Download class="h-4 w-4 text-muted-foreground" />
							{/if}
						</button>
					{/each}
				{/if}
			</div>
		</div>
	</div>
{/if}

<!-- Import summary modal -->
{#if importSummary}
	<div class="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4">
		<div class="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-xl">
			<div class="flex items-start gap-3">
				<CheckCircle2 class="mt-0.5 h-6 w-6 shrink-0 text-emerald-500" />
				<div class="flex-1">
					<h3 class="text-base font-semibold">Import complete</h3>
					<ul class="mt-2 space-y-1 text-sm text-muted-foreground">
						{#if importSummary.counts.characters} <li>{importSummary.counts.characters} character{importSummary.counts.characters === 1 ? '' : 's'}</li> {/if}
						{#if importSummary.counts.chats} <li>{importSummary.counts.chats} chat{importSummary.counts.chats === 1 ? '' : 's'}</li> {/if}
						{#if importSummary.counts.lorebooks} <li>{importSummary.counts.lorebooks} lorebook{importSummary.counts.lorebooks === 1 ? '' : 's'}</li> {/if}
						{#if importSummary.counts.personas} <li>{importSummary.counts.personas} persona{importSummary.counts.personas === 1 ? '' : 's'}</li> {/if}
						{#if importSummary.counts.themes} <li>{importSummary.counts.themes} theme{importSummary.counts.themes === 1 ? '' : 's'}</li> {/if}
						{#if importSummary.counts.providers} <li>{importSummary.counts.providers} provider{importSummary.counts.providers === 1 ? '' : 's'} (disabled)</li> {/if}
					</ul>
					{#if showProvidersWarning}
						<div class="mt-3 flex items-start gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/5 px-3 py-2 text-xs text-yellow-600 dark:text-yellow-400">
							<AlertCircle class="mt-0.5 h-3.5 w-3.5 shrink-0" />
							<span>Imported providers are disabled — re-enter API keys in <strong>Settings → Providers</strong> to enable them.</span>
						</div>
					{/if}
				</div>
			</div>
			<div class="mt-4 flex justify-end">
				<button onclick={() => { importSummary = null; showProvidersWarning = false; }} class="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">Done</button>
			</div>
		</div>
	</div>
{/if}

<ImportResolverModal
	open={resolverOpen}
	items={resolverItems}
	{characters}
	onclose={() => { resolverOpen = false; resolverItems = []; }}
	onresolve={onResolve}
	oncharacterimported={() => charactersStore.load(true)}
/>
