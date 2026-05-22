<script lang="ts">
	import { onMount } from 'svelte';
	import {
		Download, Upload, Package, MessageSquare, User, BookOpen, Search,
		AlertCircle, CheckCircle2, Loader2, ChevronDown, ChevronRight
	} from 'lucide-svelte';
	import { toasts } from '$lib/stores/toast.svelte.js';
	import { charactersStore } from '$lib/stores/characters.svelte.js';
	import { lorebooksStore } from '$lib/stores/lorebooks.svelte.js';
	import { chatsStore } from '$lib/stores/chats.svelte.js';
	import ImportResolverModal from '$lib/components/ImportResolverModal.svelte';

	interface Props {
		onchatimported?: (chatId: number) => void;
	}

	let { onchatimported }: Props = $props();

	const characters = $derived(charactersStore.characters);
	const lorebooks = $derived(lorebooksStore.lorebooks);

	// Sections collapse independently — defaults to "Everything" open since it's the
	// most common path. Each section is self-contained state.
	let openEverything = $state(true);
	let openCharacters = $state(false);
	let openLorebooks = $state(false);
	let openChats = $state(false);
	let openImport = $state(false);

	onMount(() => {
		void charactersStore.load();
		void lorebooksStore.load();
		void checkBackupStatus();
	});

	// ─── Everything (background job) ───────────────────────────────────────
	let includePersonas = $state(true);
	let includeSettings = $state(true);
	let includeThemes = $state(true);
	let includeProviders = $state(false);
	let backupReady = $state(false);
	let backupRunning = $state(false);

	const stamp = () => new Date().toISOString().slice(0, 10);

	async function checkBackupStatus() {
		try {
			const res = await fetch('/api/export/everything/status');
			if (!res.ok) return;
			const data = await res.json();
			backupReady = !!data.ready;
			backupRunning = !!data.running;
		} catch { /* ignore */ }
	}

	async function startEverything() {
		if (backupRunning) return;
		try {
			const res = await fetch('/api/export/everything', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					personas: includePersonas,
					settings: includeSettings,
					themes: includeThemes,
					providers: includeProviders
				})
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				if (body.reason === 'already_running') {
					toasts.info('A backup is already building — you\'ll get a notification when it\'s done.');
				} else {
					toasts.error('Failed to start backup');
				}
				return;
			}
			backupReady = false;
			backupRunning = true;
			toasts.info('Building backup in background — you\'ll get a notification when it\'s done.');
		} catch {
			toasts.error('Failed to start backup');
		}
	}

	async function downloadEverything() {
		try {
			const res = await fetch('/api/export/everything/download');
			if (!res.ok) {
				toasts.error('Backup file not found — try building a new one.');
				backupReady = false;
				return;
			}
			const blob = await res.blob();
			const link = document.createElement('a');
			link.href = URL.createObjectURL(blob);
			link.download = `skald-backup-${stamp()}.skald.zip`;
			link.click();
			URL.revokeObjectURL(link.href);
			toasts.success('Backup downloaded');
		} catch {
			toasts.error('Download failed');
		}
	}

	// React to background-export SSE events so the UI updates instantly when
	// the toast lands. The +layout dispatches `export:ready`/`export:failed`
	// as window events for any listeners (added below).
	function onExportReady() { backupReady = true; backupRunning = false; }
	function onExportFailed() { backupRunning = false; }
	$effect(() => {
		const ready = () => onExportReady();
		const failed = () => onExportFailed();
		window.addEventListener('skald-export-ready', ready);
		window.addEventListener('skald-export-failed', failed);
		return () => {
			window.removeEventListener('skald-export-ready', ready);
			window.removeEventListener('skald-export-failed', failed);
		};
	});

	// ─── Characters ────────────────────────────────────────────────────────
	let charSearch = $state('');
	let selectedCharIds = $state<Set<number>>(new Set());
	let charsIncludeChats = $state(true);
	let exportingChars = $state(false);

	const filteredChars = $derived(
		charSearch.trim()
			? characters.filter(c => c.name.toLowerCase().includes(charSearch.toLowerCase()))
			: characters
	);

	function toggleChar(id: number) {
		const next = new Set(selectedCharIds);
		if (next.has(id)) next.delete(id); else next.add(id);
		selectedCharIds = next;
	}
	function selectAllChars() { selectedCharIds = new Set(filteredChars.map(c => c.id)); }
	function clearChars() { selectedCharIds = new Set(); }

	async function exportCharacters() {
		if (exportingChars || selectedCharIds.size === 0) return;
		exportingChars = true;
		try {
			const res = await fetch('/api/export/characters', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					characterIds: Array.from(selectedCharIds),
					includeChats: charsIncludeChats
				})
			});
			if (!res.ok) {
				toasts.error('Character export failed');
				return;
			}
			await downloadResponse(res, `skald-characters-${stamp()}.skald.zip`);
			toasts.success(`Exported ${selectedCharIds.size} character${selectedCharIds.size === 1 ? '' : 's'}`);
		} catch {
			toasts.error('Character export failed');
		} finally {
			exportingChars = false;
		}
	}

	// ─── Lorebooks ─────────────────────────────────────────────────────────
	let lorebookSearch = $state('');
	let selectedLorebookIds = $state<Set<number>>(new Set());
	let exportingLorebooks = $state(false);

	const filteredLorebooks = $derived(
		lorebookSearch.trim()
			? lorebooks.filter(l => l.name.toLowerCase().includes(lorebookSearch.toLowerCase()))
			: lorebooks
	);

	function toggleLorebook(id: number) {
		const next = new Set(selectedLorebookIds);
		if (next.has(id)) next.delete(id); else next.add(id);
		selectedLorebookIds = next;
	}
	function selectAllLorebooks() { selectedLorebookIds = new Set(filteredLorebooks.map(l => l.id)); }
	function clearLorebooks() { selectedLorebookIds = new Set(); }

	async function exportLorebooks() {
		if (exportingLorebooks || selectedLorebookIds.size === 0) return;
		exportingLorebooks = true;
		try {
			const res = await fetch('/api/export/lorebooks', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ lorebookIds: Array.from(selectedLorebookIds) })
			});
			if (!res.ok) {
				toasts.error('Lorebook export failed');
				return;
			}
			await downloadResponse(res, `skald-lorebooks-${stamp()}.skald.zip`);
			toasts.success(`Exported ${selectedLorebookIds.size} lorebook${selectedLorebookIds.size === 1 ? '' : 's'}`);
		} catch {
			toasts.error('Lorebook export failed');
		} finally {
			exportingLorebooks = false;
		}
	}

	// ─── Chats ─────────────────────────────────────────────────────────────
	interface ChatPickerRow {
		id: number;
		title: string | null;
		characterId: number;
		characterName: string | null;
		characterAvatar: string | null;
		updatedAt: string | null;
	}
	let chatList = $state<ChatPickerRow[]>([]);
	let chatsLoading = $state(false);
	let chatSearch = $state('');
	let selectedChatIds = $state<Set<number>>(new Set());
	let chatsIncludeCard = $state(true);
	let exportingChats = $state(false);

	async function loadChatList() {
		if (chatsLoading) return;
		chatsLoading = true;
		try {
			const res = await fetch('/api/export/chats');
			if (!res.ok) return;
			const data = await res.json();
			chatList = data.chats ?? [];
		} finally {
			chatsLoading = false;
		}
	}

	// Lazy-load the chat list the first time the section is opened.
	let chatsLoaded = $state(false);
	$effect(() => {
		if (openChats && !chatsLoaded) {
			chatsLoaded = true;
			void loadChatList();
		}
	});

	const filteredChats = $derived(
		chatSearch.trim()
			? chatList.filter(c => {
				const q = chatSearch.toLowerCase();
				return (c.title ?? '').toLowerCase().includes(q)
					|| (c.characterName ?? '').toLowerCase().includes(q);
			})
			: chatList
	);

	function toggleChat(id: number) {
		const next = new Set(selectedChatIds);
		if (next.has(id)) next.delete(id); else next.add(id);
		selectedChatIds = next;
	}
	function selectAllChats() { selectedChatIds = new Set(filteredChats.map(c => c.id)); }
	function clearChats() { selectedChatIds = new Set(); }

	async function exportChats() {
		if (exportingChats || selectedChatIds.size === 0) return;
		exportingChats = true;
		try {
			const res = await fetch('/api/export/chats', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					chatIds: Array.from(selectedChatIds),
					includeCharacterCard: chatsIncludeCard
				})
			});
			if (!res.ok) {
				toasts.error('Chat export failed');
				return;
			}
			await downloadResponse(res, `skald-chats-${stamp()}.skald.zip`);
			toasts.success(`Exported ${selectedChatIds.size} chat${selectedChatIds.size === 1 ? '' : 's'}`);
		} catch {
			toasts.error('Chat export failed');
		} finally {
			exportingChats = false;
		}
	}

	async function downloadResponse(res: Response, fallbackName: string) {
		const blob = await res.blob();
		const link = document.createElement('a');
		link.href = URL.createObjectURL(blob);
		const cd = res.headers.get('content-disposition') ?? '';
		const m = cd.match(/filename="([^"]+)"/);
		link.download = m ? m[1] : fallbackName;
		link.click();
		URL.revokeObjectURL(link.href);
	}

	// ─── Unified import ────────────────────────────────────────────────────
	let importInput: HTMLInputElement | null = $state(null);
	let importing = $state(false);
	let importProgress = $state(0);
	let dragOver = $state(false);
	let importSummary = $state<{ counts: Record<string, number>; providersWarning: boolean; warnings?: string[] } | null>(null);
	let showProvidersWarning = $state(false);

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
		} catch { /* not JSON — fall through to chat (jsonl) */ }
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
			await lorebooksStore.load(true);
			await chatsStore.load(true);
			importSummary = { counts: data.counts, providersWarning: !!data.providersWarning, warnings: Array.isArray(data.warnings) ? data.warnings : [] };
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

	// Helper to format the count summary inside section button text.
	function pluralize(n: number, word: string) {
		return `${n} ${word}${n === 1 ? '' : 's'}`;
	}
</script>

<div class="space-y-4">
	<div>
		<h3 class="text-base font-semibold">Import / Export</h3>
		<p class="text-sm text-muted-foreground">Back up your data, share characters and chats, or restore from a previous export.</p>
	</div>

	<!-- ── Export Everything ────────────────────────────────────────────── -->
	<section class="rounded-xl border border-border">
		<button
			type="button"
			onclick={() => (openEverything = !openEverything)}
			class="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50"
		>
			{#if openEverything}<ChevronDown class="h-4 w-4 text-muted-foreground" />{:else}<ChevronRight class="h-4 w-4 text-muted-foreground" />{/if}
			<Package class="h-5 w-5 text-muted-foreground" />
			<div class="flex-1">
				<p class="text-sm font-medium">Export Everything</p>
				<p class="text-xs text-muted-foreground">Full backup — runs in the background, you'll get a notification when it's ready.</p>
			</div>
			{#if backupRunning}
				<span class="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 class="h-3.5 w-3.5 animate-spin" /> Building…</span>
			{:else if backupReady}
				<span class="flex items-center gap-1 text-xs text-success"><CheckCircle2 class="h-3.5 w-3.5" /> Ready</span>
			{/if}
		</button>

		{#if openEverything}
			<div class="border-t border-border p-4 space-y-3">
				<div class="grid grid-cols-1 @xl:grid-cols-2 gap-2">
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
					<div class="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
						<AlertCircle class="mt-0.5 h-3.5 w-3.5 shrink-0" />
						<span>API keys are <strong>never</strong> included. Imported providers will arrive disabled — you'll need to re-enter their keys.</span>
					</div>
				{/if}

				<div class="flex flex-wrap items-center gap-2">
					<button
						type="button"
						onclick={startEverything}
						disabled={backupRunning}
						class="flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{#if backupRunning}
							<Loader2 class="h-4 w-4 animate-spin" /> Building in background…
						{:else}
							<Package class="h-4 w-4" /> Build backup
						{/if}
					</button>
					{#if backupReady}
						<button
							type="button"
							onclick={downloadEverything}
							class="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm transition-colors hover:bg-accent"
						>
							<Download class="h-4 w-4" /> Download ready backup
						</button>
					{/if}
				</div>
			</div>
		{/if}
	</section>

	<!-- ── Export Characters ────────────────────────────────────────────── -->
	<section class="rounded-xl border border-border">
		<button
			type="button"
			onclick={() => (openCharacters = !openCharacters)}
			class="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50"
		>
			{#if openCharacters}<ChevronDown class="h-4 w-4 text-muted-foreground" />{:else}<ChevronRight class="h-4 w-4 text-muted-foreground" />{/if}
			<User class="h-5 w-5 text-muted-foreground" />
			<div class="flex-1">
				<p class="text-sm font-medium">Export Characters</p>
				<p class="text-xs text-muted-foreground">Pick characters to bundle. Attached lorebooks are always included.</p>
			</div>
			{#if selectedCharIds.size > 0}
				<span class="text-xs text-muted-foreground">{selectedCharIds.size} selected</span>
			{/if}
		</button>

		{#if openCharacters}
			<div class="border-t border-border p-4 space-y-3">
				{#if characters.length === 0}
					<p class="py-4 text-center text-sm text-muted-foreground">You don't have any characters yet.</p>
				{:else}
					<div class="relative">
						<Search class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
						<input
							bind:value={charSearch}
							placeholder="Search characters…"
							class="w-full rounded-lg border border-input bg-background pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
						/>
					</div>

					<div class="flex items-center justify-between text-xs text-muted-foreground">
						<div class="flex gap-2">
							<button type="button" onclick={selectAllChars} class="hover:underline">Select all</button>
							<span>·</span>
							<button type="button" onclick={clearChars} class="hover:underline">Clear</button>
						</div>
						<span>{filteredChars.length} character{filteredChars.length === 1 ? '' : 's'}</span>
					</div>

					<div class="max-h-64 overflow-y-auto rounded-lg border border-border">
						{#each filteredChars as c (c.id)}
							<label class="flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0 hover:bg-accent/50 cursor-pointer">
								<input
									type="checkbox"
									checked={selectedCharIds.has(c.id)}
									onchange={() => toggleChar(c.id)}
									class="h-4 w-4 rounded border-border"
								/>
								{#if c.avatarPath}
									<img src={c.avatarPath} alt="" loading="lazy" decoding="async" class="h-8 w-8 rounded-full object-cover" />
								{:else}
									<div class="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{c.name[0]}</div>
								{/if}
								<span class="flex-1 truncate text-sm">{c.name}</span>
							</label>
						{:else}
							<p class="py-4 text-center text-sm text-muted-foreground">No matches.</p>
						{/each}
					</div>

					<label class="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent cursor-pointer">
						<input type="checkbox" bind:checked={charsIncludeChats} class="h-4 w-4 rounded border-border" />
						<span>Include chats with each character</span>
					</label>

					<button
						type="button"
						onclick={exportCharacters}
						disabled={exportingChars || selectedCharIds.size === 0}
						class="flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{#if exportingChars}<Loader2 class="h-4 w-4 animate-spin" />{:else}<Download class="h-4 w-4" />{/if}
						Export {pluralize(selectedCharIds.size, 'character')}
					</button>
				{/if}
			</div>
		{/if}
	</section>

	<!-- ── Export Lorebooks ─────────────────────────────────────────────── -->
	<section class="rounded-xl border border-border">
		<button
			type="button"
			onclick={() => (openLorebooks = !openLorebooks)}
			class="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50"
		>
			{#if openLorebooks}<ChevronDown class="h-4 w-4 text-muted-foreground" />{:else}<ChevronRight class="h-4 w-4 text-muted-foreground" />{/if}
			<BookOpen class="h-5 w-5 text-muted-foreground" />
			<div class="flex-1">
				<p class="text-sm font-medium">Export Lorebooks</p>
				<p class="text-xs text-muted-foreground">Pick lorebooks to bundle on their own.</p>
			</div>
			{#if selectedLorebookIds.size > 0}
				<span class="text-xs text-muted-foreground">{selectedLorebookIds.size} selected</span>
			{/if}
		</button>

		{#if openLorebooks}
			<div class="border-t border-border p-4 space-y-3">
				{#if lorebooks.length === 0}
					<p class="py-4 text-center text-sm text-muted-foreground">You don't have any lorebooks yet.</p>
				{:else}
					<div class="relative">
						<Search class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
						<input
							bind:value={lorebookSearch}
							placeholder="Search lorebooks…"
							class="w-full rounded-lg border border-input bg-background pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
						/>
					</div>

					<div class="flex items-center justify-between text-xs text-muted-foreground">
						<div class="flex gap-2">
							<button type="button" onclick={selectAllLorebooks} class="hover:underline">Select all</button>
							<span>·</span>
							<button type="button" onclick={clearLorebooks} class="hover:underline">Clear</button>
						</div>
						<span>{filteredLorebooks.length} lorebook{filteredLorebooks.length === 1 ? '' : 's'}</span>
					</div>

					<div class="max-h-64 overflow-y-auto rounded-lg border border-border">
						{#each filteredLorebooks as lb (lb.id)}
							{@const linked = lb.characterId ? characters.find(c => c.id === lb.characterId) : null}
							<label class="flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0 hover:bg-accent/50 cursor-pointer">
								<input
									type="checkbox"
									checked={selectedLorebookIds.has(lb.id)}
									onchange={() => toggleLorebook(lb.id)}
									class="h-4 w-4 rounded border-border"
								/>
								<BookOpen class="h-4 w-4 text-muted-foreground shrink-0" />
								<div class="min-w-0 flex-1">
									<p class="truncate text-sm">{lb.name}</p>
									{#if linked}
										<p class="truncate text-xs text-muted-foreground">Attached to {linked.name}</p>
									{/if}
								</div>
							</label>
						{:else}
							<p class="py-4 text-center text-sm text-muted-foreground">No matches.</p>
						{/each}
					</div>

					<button
						type="button"
						onclick={exportLorebooks}
						disabled={exportingLorebooks || selectedLorebookIds.size === 0}
						class="flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{#if exportingLorebooks}<Loader2 class="h-4 w-4 animate-spin" />{:else}<Download class="h-4 w-4" />{/if}
						Export {pluralize(selectedLorebookIds.size, 'lorebook')}
					</button>
				{/if}
			</div>
		{/if}
	</section>

	<!-- ── Export Chats ─────────────────────────────────────────────────── -->
	<section class="rounded-xl border border-border">
		<button
			type="button"
			onclick={() => (openChats = !openChats)}
			class="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50"
		>
			{#if openChats}<ChevronDown class="h-4 w-4 text-muted-foreground" />{:else}<ChevronRight class="h-4 w-4 text-muted-foreground" />{/if}
			<MessageSquare class="h-5 w-5 text-muted-foreground" />
			<div class="flex-1">
				<p class="text-sm font-medium">Export Chats</p>
				<p class="text-xs text-muted-foreground">Pick chats to export. Optionally bundle the character card with them.</p>
			</div>
			{#if selectedChatIds.size > 0}
				<span class="text-xs text-muted-foreground">{selectedChatIds.size} selected</span>
			{/if}
		</button>

		{#if openChats}
			<div class="border-t border-border p-4 space-y-3">
				{#if chatsLoading}
					<div class="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
						<Loader2 class="h-4 w-4 animate-spin" /> Loading chats…
					</div>
				{:else if chatList.length === 0}
					<p class="py-4 text-center text-sm text-muted-foreground">You don't have any chats yet.</p>
				{:else}
					<div class="relative">
						<Search class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
						<input
							bind:value={chatSearch}
							placeholder="Search chats…"
							class="w-full rounded-lg border border-input bg-background pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
						/>
					</div>

					<div class="flex items-center justify-between text-xs text-muted-foreground">
						<div class="flex gap-2">
							<button type="button" onclick={selectAllChats} class="hover:underline">Select all</button>
							<span>·</span>
							<button type="button" onclick={clearChats} class="hover:underline">Clear</button>
						</div>
						<span>{filteredChats.length} chat{filteredChats.length === 1 ? '' : 's'}</span>
					</div>

					<div class="max-h-72 overflow-y-auto rounded-lg border border-border">
						{#each filteredChats as c (c.id)}
							<label class="flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0 hover:bg-accent/50 cursor-pointer">
								<input
									type="checkbox"
									checked={selectedChatIds.has(c.id)}
									onchange={() => toggleChat(c.id)}
									class="h-4 w-4 rounded border-border"
								/>
								{#if c.characterAvatar}
									<img src={c.characterAvatar} alt="" loading="lazy" decoding="async" class="h-8 w-8 rounded-full object-cover" />
								{:else}
									<div class="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{(c.characterName ?? '?')[0]}</div>
								{/if}
								<div class="min-w-0 flex-1">
									<p class="truncate text-sm">{c.title || `Chat #${c.id}`}</p>
									<p class="truncate text-xs text-muted-foreground">{c.characterName ?? 'Unknown character'}</p>
								</div>
							</label>
						{:else}
							<p class="py-4 text-center text-sm text-muted-foreground">No matches.</p>
						{/each}
					</div>

					<label class="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent cursor-pointer">
						<input type="checkbox" bind:checked={chatsIncludeCard} class="h-4 w-4 rounded border-border" />
						<span>Include character card(s) with chats</span>
					</label>

					<button
						type="button"
						onclick={exportChats}
						disabled={exportingChats || selectedChatIds.size === 0}
						class="flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{#if exportingChats}<Loader2 class="h-4 w-4 animate-spin" />{:else}<Download class="h-4 w-4" />{/if}
						Export {pluralize(selectedChatIds.size, 'chat')}
					</button>
				{/if}
			</div>
		{/if}
	</section>

	<!-- ── Import ───────────────────────────────────────────────────────── -->
	<section class="rounded-xl border border-border">
		<button
			type="button"
			onclick={() => (openImport = !openImport)}
			class="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50"
		>
			{#if openImport}<ChevronDown class="h-4 w-4 text-muted-foreground" />{:else}<ChevronRight class="h-4 w-4 text-muted-foreground" />{/if}
			<Upload class="h-5 w-5 text-muted-foreground" />
			<div class="flex-1">
				<p class="text-sm font-medium">Import</p>
				<p class="text-xs text-muted-foreground">Restore any Skald export, or load a character card or chat file.</p>
			</div>
		</button>

		{#if openImport}
			<div class="border-t border-border p-4 space-y-3">
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
						<p class="text-xs text-muted-foreground">Character cards (.png/.json), chats (.json/.jsonl), or Skald bundles (.skald.zip)</p>
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
		{/if}
	</section>
</div>

<!-- Import summary modal -->
{#if importSummary}
	<div class="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4">
		<div class="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-xl">
			<div class="flex items-start gap-3">
				<CheckCircle2 class="mt-0.5 h-6 w-6 shrink-0 text-success" />
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
						<div class="mt-3 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
							<AlertCircle class="mt-0.5 h-3.5 w-3.5 shrink-0" />
							<span>Imported providers are disabled — re-enter API keys in <strong>Settings → Providers</strong> to enable them.</span>
						</div>
					{/if}
					{#if importSummary.warnings && importSummary.warnings.length > 0}
						{#each importSummary.warnings as warning}
							<div class="mt-3 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
								<AlertCircle class="mt-0.5 h-3.5 w-3.5 shrink-0" />
								<span>{warning}</span>
							</div>
						{/each}
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
