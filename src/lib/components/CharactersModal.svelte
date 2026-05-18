<script lang="ts">
	import { Plus, Pencil, Trash2, MessageSquare, Users, X, Upload, Download, Loader2, Smartphone, Search, ArrowUpDown, BookOpen, Palette, Globe, LayoutGrid, List, Sparkles } from 'lucide-svelte';
	import { staggerOnMount } from '$lib/utils/staggerOnMount';
	import { createModalState, createModalGestures } from '$lib/modal.svelte.js';
	import { focusTrap } from '$lib/focusTrap.js';
	import ConfirmModal from '$lib/components/ConfirmModal.svelte';
	import Combobox from '$lib/components/Combobox.svelte';
	import CharacterEditModal from '$lib/components/CharacterEditModal.svelte';
	import ImageModal from '$lib/components/ImageModal.svelte';
	import LorebookEditModal from '$lib/components/LorebookEditModal.svelte';
	import ChubBrowseModal from '$lib/components/ChubBrowseModal.svelte';
	import { haptic } from '$lib/utils/haptics.js';
	import { charactersStore } from '$lib/stores/characters.svelte.js';
	import { settingsStore } from '$lib/stores/settings.svelte.js';
	import { pickCharacterTheme, characterHasAnyTheme } from '$lib/theme/characterTheme.js';
	import { tooltip } from '$lib/tooltip.js';

	interface Props {
		open: boolean;
		embedded?: boolean;
		selectedId?: number | null;
		lorebooks: any[];
		alwaysUseCharacterThemes?: boolean;
		colorCharacterCards?: boolean;
		onclose: () => void;
		onnavigate?: (chatId: number, chat?: any) => void;
		onselect?: (id: number | null, edit?: boolean) => void;
		onaicreate?: (seed: { name: string; description: string }) => void;
	}

	let { open, embedded = false, selectedId = null, lorebooks, alwaysUseCharacterThemes = false, colorCharacterCards = false, onclose: _onclose, onnavigate, onselect, onaicreate }: Props = $props();

	// Read from the central store so additions / edits / deletions reflect
	// instantly without an invalidateAll() round-trip.
	const characters = $derived(charactersStore.characters);

	function onclose() {
		saveScrollPosition();
		_onclose();
	}
	let searchQuery = $state('');
	let debouncedSearch = $state('');
	let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	let selectedTags = $state<string[]>([]);
	let sortBy = $state<'alpha' | 'newest' | 'oldest'>((
		typeof window !== 'undefined' && localStorage.getItem('skald-char-sort') as any
	) || 'alpha');

	function setSortBy(value: 'alpha' | 'newest' | 'oldest') {
		sortBy = value;
		localStorage.setItem('skald-char-sort', value);
	}

	let viewMode = $state<'list' | 'grid'>((
		typeof window !== 'undefined' && localStorage.getItem('skald-char-view') as any
	) || 'list');

	function setViewMode(value: 'list' | 'grid') {
		viewMode = value;
		localStorage.setItem('skald-char-view', value);
	}

	let showCreateForm = $state(false);
	let chubOpen = $state(false);
	let importing = $state(false);
	let importTotal = $state(0);
	let importDone = $state(0);
	let importFailed = $state(0);
	let importErrors: string[] = $state([]);
	let fileInput: HTMLInputElement | undefined = $state();
	let confirmDeleteId: number | null = $state(null);
	let confirmDeleteName = $state('');
	let confirmDeleteHasLorebook = $state(false);
	let editCharacter: any = $state(null);
	let enlargedImage: string | null = $state(null);
	let popupCharacter: any = $state(null);
	let popupType: 'description' | 'tags' | null = $state(null);
	let editLorebookId: number | null = $state(null);
	let scrollContainer: HTMLElement | undefined = $state();

	// Character context menu
	let ctxMenuCharId: number | null = $state(null);
	let ctxMenuPos: { x: number; y: number; flipUp: boolean } | null = $state(null);
	const CTX_W = 192;
	const CTX_H = 220;
	let ctxLongPressTimer: ReturnType<typeof setTimeout> | null = null;
	let ctxLongPressStart = { x: 0, y: 0 };
	let ctxLongPressFired = false;
	let ctxSuppressClick = false;

	function openCharMenu(charId: number, e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		const winW = window.innerWidth;
		const winH = window.innerHeight;
		let anchorX = e.clientX;
		let anchorY = e.clientY;
		const flipUp = anchorY + CTX_H > winH;
		const x = Math.max(8, Math.min(winW - CTX_W - 8, anchorX - CTX_W / 2));
		const y = flipUp
			? Math.max(CTX_H + 8, Math.min(winH - 8, anchorY - 8))
			: Math.max(8, Math.min(winH - CTX_H - 8, anchorY + 8));
		ctxMenuPos = { x, y, flipUp };
		ctxMenuCharId = charId;
	}
	function openCharMenuAtPoint(charId: number, clientX: number, clientY: number) {
		const winW = window.innerWidth;
		const winH = window.innerHeight;
		const x = Math.max(8, Math.min(winW - CTX_W - 8, clientX - CTX_W / 2));
		const flipUp = clientY + CTX_H > winH;
		const rawY = flipUp ? clientY - 8 : clientY + 8;
		const y = flipUp
			? Math.max(CTX_H + 8, Math.min(winH - 8, rawY))
			: Math.max(8, Math.min(winH - CTX_H - 8, rawY));
		ctxMenuPos = { x, y, flipUp };
		ctxMenuCharId = charId;
	}
	function startCharLongPress(charId: number, e: TouchEvent) {
		e.preventDefault();
		const t = e.touches[0];
		ctxLongPressStart = { x: t.clientX, y: t.clientY };
		ctxLongPressFired = false;
		if (ctxLongPressTimer) clearTimeout(ctxLongPressTimer);
		ctxLongPressTimer = setTimeout(() => {
			ctxLongPressTimer = null;
			ctxLongPressFired = true;
			haptic('medium');
			openCharMenuAtPoint(charId, ctxLongPressStart.x, ctxLongPressStart.y);
		}, 500);
	}
	function moveCharLongPress(e: TouchEvent) {
		if (!ctxLongPressTimer) return;
		const t = e.touches[0];
		if (Math.abs(t.clientX - ctxLongPressStart.x) > 10 || Math.abs(t.clientY - ctxLongPressStart.y) > 10) {
			clearTimeout(ctxLongPressTimer);
			ctxLongPressTimer = null;
		}
	}
	function endCharLongPress() {
		if (ctxLongPressTimer) { clearTimeout(ctxLongPressTimer); ctxLongPressTimer = null; }
		if (ctxLongPressFired) {
			ctxSuppressClick = true;
			setTimeout(() => { ctxSuppressClick = false; ctxLongPressFired = false; }, 500);
		}
	}
	function closeCharMenu() { ctxMenuCharId = null; ctxMenuPos = null; }
	$effect(() => {
		if (ctxMenuCharId === null) return;
		const onClick = (e: MouseEvent) => {
			if (ctxSuppressClick) { ctxSuppressClick = false; return; }
			if (!(e.target as HTMLElement).closest('[data-char-menu]')) closeCharMenu();
		};
		const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeCharMenu(); };
		const onScroll = () => closeCharMenu();
		setTimeout(() => document.addEventListener('click', onClick), 0);
		document.addEventListener('keydown', onKey);
		document.addEventListener('scroll', onScroll, true);
		return () => {
			document.removeEventListener('click', onClick);
			document.removeEventListener('keydown', onKey);
			document.removeEventListener('scroll', onScroll, true);
		};
	});

	// Persist scroll position across modal opens (for 5 minutes)
	// Stored in sessionStorage because the component is destroyed when the modal closes
	const SCROLL_KEY = 'skald-char-scroll';
	const SCROLL_TTL = 5 * 60 * 1000;

	function saveScrollPosition() {
		if (scrollContainer && scrollContainer.scrollTop > 0) {
			sessionStorage.setItem(SCROLL_KEY, JSON.stringify({
				top: scrollContainer.scrollTop,
				time: Date.now()
			}));
		}
	}

	function restoreScrollPosition(el: HTMLElement) {
		try {
			const raw = sessionStorage.getItem(SCROLL_KEY);
			if (!raw) return;
			const { top, time } = JSON.parse(raw);
			if (top > 0 && (Date.now() - time) < SCROLL_TTL) {
				requestAnimationFrame(() => { el.scrollTop = top; });
			}
		} catch {
			// ignore
		}
	}

	$effect(() => {
		if (open && scrollContainer) {
			restoreScrollPosition(scrollContainer);
		}
	});

	// Create form state
	let name = $state('');
	let description = $state('');
	let personality = $state('');
	let firstMessage = $state('');
	let scenario = $state('');
	let systemPrompt = $state('');
	let creatorNotes = $state('');
	let tags = $state('');

	function resetForm() {
		name = '';
		description = '';
		personality = '';
		firstMessage = '';
		scenario = '';
		systemPrompt = '';
		creatorNotes = '';
		tags = '';
	}

	async function createCharacter() {
		if (!name.trim()) return;

		const res = await fetch('/api/characters', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				name,
				description,
				personality,
				firstMessage,
				scenario,
				systemPrompt,
				creatorNotes,
				tags
			})
		});

		if (res.ok) {
			const created = await res.json();
			showCreateForm = false;
			resetForm();
			if (created?.light) charactersStore.add(created.light);
			else if (created?.id) charactersStore.add(created);
			if (embedded && created?.id) onselect?.(created.id, true);
		}
	}

	async function deleteCharacter(id: number, keepLorebook = false) {
		const url = keepLorebook ? `/api/characters/${id}?keepLorebook=true` : `/api/characters/${id}`;
		const res = await fetch(url, { method: 'DELETE' });
		if (res.ok) {
			if (selectedId === id) onselect?.(null);
			charactersStore.remove(id);
		}
	}

	function askDeleteCharacter(id: number, name: string) {
		confirmDeleteId = id;
		confirmDeleteName = name;
		confirmDeleteHasLorebook = lorebooks.some((l: any) => l.characterId === id);
	}

	async function confirmDelete() {
		if (confirmDeleteId !== null) {
			await deleteCharacter(confirmDeleteId);
			confirmDeleteId = null;
			confirmDeleteName = '';
			confirmDeleteHasLorebook = false;
		}
	}

	async function confirmDeleteKeepLorebook() {
		if (confirmDeleteId !== null) {
			await deleteCharacter(confirmDeleteId, true);
			confirmDeleteId = null;
			confirmDeleteName = '';
			confirmDeleteHasLorebook = false;
		}
	}

	let loadingChatId: number | null = $state(null);
	let loadingChatMode: string | null = $state(null);

	// Theme prompt state
	let themePromptCharId: number | null = $state(null);
	let themePromptMode: 'story' | 'texting' = $state('story');
	let themePromptName = $state('');

	function characterHasTheme(characterId: number): boolean {
		const char = characters.find(c => c.id === characterId);
		if (!char) return false;
		if (char.backgroundPath) return true;
		return characterHasAnyTheme(char.theme);
	}

	const SAFE_CSS = /^[a-zA-Z0-9\s().,%#\-\/]+$/;
	function cardStyle(character: any): string {
		if (!colorCharacterCards) return '';
		const t = pickCharacterTheme(character.theme, settingsStore.effectiveMode);
		if (!t.primary && !t.background) return '';
		const styles: string[] = [];
		if (t.background && SAFE_CSS.test(t.background)) styles.push(`background: ${t.background}`);
		if (t.primary && SAFE_CSS.test(t.primary)) styles.push(`border-color: ${t.primary}40`);
		if (t.foreground && SAFE_CSS.test(t.foreground)) styles.push(`color: ${t.foreground}`);
		return styles.join('; ');
	}

	function requestStartChat(characterId: number, mode: 'story' | 'texting' = 'story') {
		if (loadingChatId) return;
		if (characterHasTheme(characterId) && !alwaysUseCharacterThemes) {
			const char = characters.find(c => c.id === characterId);
			themePromptCharId = characterId;
			themePromptMode = mode;
			themePromptName = char?.name ?? 'This character';
		} else {
			startChat(characterId, mode);
		}
	}

	async function startChat(characterId: number, mode: 'story' | 'texting' = 'story', useCharacterTheme?: boolean) {
		if (loadingChatId) return;
		themePromptCharId = null;
		loadingChatId = characterId;
		loadingChatMode = mode;
		try {
			const res = await fetch('/api/chats', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ characterId, mode, ...(useCharacterTheme === false ? { useCharacterTheme: false } : {}) })
			});

			if (res.ok) {
				const body = await res.json();
				onclose();
				if (onnavigate) {
					onnavigate(body.id, body.chat);
				}
			}
		} finally {
			loadingChatId = null;
			loadingChatMode = null;
		}
	}

	async function processFiles(files: File[] | FileList) {
		const arr = Array.from(files);
		if (arr.length === 0) return;
		importing = true;
		importTotal = arr.length;
		importDone = 0;
		importFailed = 0;
		const failed: string[] = [];
		try {
			for (const file of arr) {
				const formData = new FormData();
				formData.append('file', file);
				const res = await fetch('/api/characters/import', { method: 'POST', body: formData });
				if (res.ok) {
					// Show the new character in the library immediately rather than
					// waiting for the whole batch to finish.
					try {
						const body = await res.json();
						if (body?.light) charactersStore.upsert(body.light);
						else if (body?.id) charactersStore.upsert(body);
					} catch { /* ignore parse errors */ }
				} else {
					const err = await res.json().catch(() => ({}));
					failed.push(`${file.name}: ${err.error || 'Unknown error'}`);
					importFailed++;
				}
				importDone++;
			}
			if (failed.length > 0) {
				importErrors = failed;
			}
		} finally {
			importing = false;
		}
	}

	async function importCharacter() {
		if ('showOpenFilePicker' in window) {
			try {
				const handles = await (window as any).showOpenFilePicker({
					types: [{ description: 'Character Cards', accept: { 'image/png': ['.png'], 'application/json': ['.json'] } }],
					multiple: true,
				});
				const files: File[] = await Promise.all(handles.map((h: any) => h.getFile()));
				await processFiles(files);
				return;
			} catch (err: any) {
				if (err?.name === 'AbortError') return;
				// fall through to hidden input
			}
		}
		fileInput?.click();
	}

	async function handleFileSelect(e: Event) {
		const input = e.target as HTMLInputElement;
		const files = input.files ? Array.from(input.files) : [];
		input.value = '';
		if (files.length === 0) return;
		await processFiles(files);
	}

	async function exportCharacter(id: number, charName: string, format: 'png' | 'json') {
		const res = await fetch(`/api/characters/${id}/export?format=${format}`);
		if (!res.ok) return;
		const blob = await res.blob();
		const safeName = charName.replace(/[^a-zA-Z0-9_-]/g, '_');
		const fileName = format === 'png' ? `${safeName}.png` : `${safeName}.json`;
		if ('showSaveFilePicker' in window) {
			try {
				const handle = await (window as any).showSaveFilePicker({
					suggestedName: fileName,
					types: [{ description: format === 'png' ? 'PNG Image' : 'JSON File',
						accept: format === 'png' ? { 'image/png': ['.png'] } : { 'application/json': ['.json'] } }],
				});
				const writable = await handle.createWritable();
				await writable.write(blob);
				await writable.close();
				return;
			} catch (err: any) {
				if (err?.name === 'AbortError') return;
				// fall through to anchor download
			}
		}
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = fileName;
		a.click();
		URL.revokeObjectURL(url);
	}

	function parseTags(tagStr: string | null | undefined): string[] {
		if (!tagStr) return [];
		try {
			const parsed = JSON.parse(tagStr);
			if (Array.isArray(parsed)) return parsed;
		} catch { /* not JSON */ }
		return tagStr.split(',').map((t: string) => t.trim()).filter(Boolean);
	}

	let allTags = $derived.by(() => {
		const counts = new Map<string, number>();
		for (const c of characters) {
			for (const tag of parseTags(c.tags)) {
				counts.set(tag, (counts.get(tag) ?? 0) + 1);
			}
		}
		return [...counts.entries()]
			.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
			.map(([tag]) => tag);
	});

	function toggleTag(tag: string) {
		if (selectedTags.includes(tag)) {
			selectedTags = selectedTags.filter(t => t !== tag);
		} else {
			selectedTags = [...selectedTags, tag];
		}
	}

	let filteredCharacters = $derived.by(() => {
		let result = characters;
		const q = debouncedSearch.trim().toLowerCase();
		if (q) {
			result = result.filter((c: any) =>
				c.name.toLowerCase().includes(q) ||
				(c.creator && c.creator.toLowerCase().includes(q)) ||
				parseTags(c.tags).some(t => t.toLowerCase().includes(q))
			);
		}
		if (selectedTags.length > 0) {
			result = result.filter((c: any) => {
				const cTags = parseTags(c.tags);
				return selectedTags.every(t => cTags.includes(t));
			});
		}
		result = [...result].sort((a: any, b: any) => {
			if (sortBy === 'newest') return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
			if (sortBy === 'oldest') return (a.createdAt ?? '').localeCompare(b.createdAt ?? '');
			return a.name.localeCompare(b.name);
		});
		return result;
	});

	const modal = createModalState(() => open && !embedded);
	const gestures = createModalGestures({ onclose, modal });
</script>

<input
	bind:this={fileInput}
	type="file"
	accept=".png,.json"
	multiple
	class="hidden"
	onchange={handleFileSelect}
/>

{#if embedded && open}
	<!-- Embedded mode: sidebar list for desktop two-card layout -->
	<div class="flex h-14 items-center justify-between px-5">
		<h1 class="text-2xl font-extrabold tracking-tight text-primary md:text-foreground">Characters</h1>
		<div class="flex items-center gap-1">
			<button
				onclick={() => (chubOpen = true)}
				class="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
				use:tooltip={'Browse CHUB'}
				aria-label="Browse CHUB"
			>
				<Globe class="h-4 w-4" />
			</button>
			<button
				onclick={() => fileInput?.click()}
				disabled={importing}
				class="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground disabled:opacity-50"
				use:tooltip={importing ? 'Importing...' : 'Import'}
				aria-label="Import character"
			>
				<Upload class="h-4 w-4" />
			</button>
			<button
				onclick={() => (showCreateForm = !showCreateForm)}
				class="flex h-9 w-9 items-center justify-center rounded-full bg-accent/60 text-foreground transition-colors hover:bg-accent"
				use:tooltip={'Create character'}
				aria-label="Create character"
			>
				<Plus class="h-4 w-4" />
			</button>
		</div>
	</div>

	{#if importing}
		<div class="mx-3 mb-2">
			<div class="h-1.5 overflow-hidden rounded-full bg-muted">
				<div class="h-full rounded-full bg-primary transition-all" style="width: {importTotal ? (importDone / importTotal) * 100 : 0}%"></div>
			</div>
			<p class="mt-1 text-center text-xs text-muted-foreground">{importDone}/{importTotal}{importFailed ? ` (${importFailed} failed)` : ''}</p>
		</div>
	{/if}

	<!-- Search & Sort -->
	<div class="flex items-center gap-2 px-3 pt-1 pb-2" data-no-sidebar-swipe>
		<div class="relative flex-1">
			<Search class="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
			<input
				type="text"
				bind:value={searchQuery}
				oninput={() => {
					if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
					if (!searchQuery) { debouncedSearch = ''; return; }
					searchDebounceTimer = setTimeout(() => { debouncedSearch = searchQuery; }, 150);
				}}
				placeholder="Search characters..."
				class="w-full rounded-full border border-transparent bg-accent/40 py-2 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:border-primary/30 focus:bg-background focus:outline-none focus:ring-2 focus:ring-ring/40"
			/>
		</div>
		<button
			onclick={() => { setSortBy(sortBy === 'alpha' ? 'newest' : sortBy === 'newest' ? 'oldest' : 'alpha'); }}
			class="flex items-center gap-1 rounded-full border border-transparent bg-accent/40 px-2.5 py-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
			use:tooltip={'Toggle sort'}
		>
			<ArrowUpDown class="h-3.5 w-3.5" />
			{sortBy === 'alpha' ? 'A–Z' : sortBy === 'newest' ? 'New' : 'Old'}
		</button>
		<button
			onclick={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')}
			class="flex h-9 w-9 items-center justify-center rounded-full border border-transparent bg-accent/40 text-muted-foreground hover:bg-accent hover:text-foreground active:scale-90 transition-transform"
			use:tooltip={viewMode === 'list' ? 'Switch to grid view' : 'Switch to list view'}
			aria-label="Toggle character view mode"
		>
			{#if viewMode === 'list'}
				<LayoutGrid class="h-4 w-4" />
			{:else}
				<List class="h-4 w-4" />
			{/if}
		</button>
	</div>

	<!-- Create form -->
	{#if showCreateForm}
		<div class="mx-3 mb-2 rounded-xl border border-primary/20 bg-card p-3">
			<div class="space-y-2">
				<input
					bind:value={name}
					class="w-full rounded-lg border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
					placeholder="Character name *"
				/>
				<textarea
					bind:value={description}
					rows={2}
					class="w-full rounded-lg border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
					placeholder="Description (optional)"
				></textarea>
				<div class="flex items-center justify-between gap-2">
					<button
						onclick={() => {
							const seed = { name: name.trim(), description: description.trim() };
							showCreateForm = false;
							resetForm();
							onaicreate?.(seed);
						}}
						class="flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
						use:tooltip={'Create with AI'}
						aria-label="Create with AI"
					>
						<Sparkles class="h-3.5 w-3.5" />
						<span class="hidden sm:inline">AI</span>
					</button>
					<div class="flex gap-2">
						<button onclick={() => { showCreateForm = false; resetForm(); }} class="rounded-lg border border-border px-3 py-1 text-xs hover:bg-accent">Cancel</button>
						<button onclick={createCharacter} disabled={!name.trim()} class="rounded-lg bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">Create</button>
					</div>
				</div>
			</div>
		</div>
	{/if}

	<!-- Character list -->
	<nav bind:this={scrollContainer} class="flex-1 overflow-y-auto px-2 py-2" style="overscroll-behavior: contain;">
		{#if filteredCharacters.length === 0 && !showCreateForm}
			<div class="flex flex-col items-center justify-center py-12 text-muted-foreground">
				<Users class="mb-3 h-8 w-8 opacity-30" />
				<p class="text-sm">No characters yet</p>
			</div>
		{:else if viewMode === 'grid'}
			<div class="grid grid-cols-2 gap-2">
				{#each filteredCharacters as character, i (character.id)}
					<div
						use:staggerOnMount={{ enabled: !debouncedSearch && i < 12, index: i }}
						class="char-card group relative select-none overflow-hidden rounded-xl text-sm transition-colors
							{selectedId === character.id
								? 'ring-2 ring-primary'
								: 'ring-1 ring-border/40 hover:ring-border'}"
						style="-webkit-touch-callout: none;"
					>
						<button
							onclick={() => { if (!ctxLongPressFired) onselect?.(character.id); }}
							oncontextmenu={(e) => openCharMenu(character.id, e)}
							ontouchstart={(e) => startCharLongPress(character.id, e)}
							ontouchmove={(e) => moveCharLongPress(e)}
							ontouchend={() => endCharLongPress()}
							ontouchcancel={() => endCharLongPress()}
							class="block w-full text-left"
						>
							<div class="relative aspect-[3/4] w-full overflow-hidden bg-muted">
								{#if character.avatarPath}
									<img src={character.avatarPath} alt={character.name} loading="eager" decoding="async" fetchpriority={i < 8 ? 'high' : 'auto'} class="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
								{:else}
									<div class="absolute inset-0 flex items-center justify-center bg-primary/10 text-4xl font-bold text-primary">{character.name[0]}</div>
								{/if}
								<!-- Gradient + name overlay -->
								<div class="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-2.5 pb-2 pt-8">
									<p class="truncate text-sm font-semibold text-white drop-shadow">{character.name}</p>
									{#if character.creator}
										<p class="truncate text-[10px] text-white/70">by {character.creator}</p>
									{/if}
								</div>
							</div>
						</button>
					</div>
				{/each}
			</div>
		{:else}
			<div class="flex flex-col gap-2">
				{#each filteredCharacters as character, i (character.id)}
					<div
						use:staggerOnMount={{ enabled: !debouncedSearch && i < 12, index: i }}
						class="char-card group select-none rounded-xl text-sm transition-colors
							{selectedId === character.id
								? 'bg-primary/10 ring-1 ring-primary/30'
								: 'bg-accent/30 hover:bg-accent/60'}"
						style="-webkit-touch-callout: none;"
					>
						<div class="flex min-w-0 w-full items-start gap-3 px-3 py-3">
							{#if character.avatarPath}
								<button
									type="button"
									class="group/avatar relative shrink-0 overflow-hidden rounded-xl"
									use:tooltip={'View avatar'}
									aria-label="View avatar"
									onclick={(e) => { e.stopPropagation(); enlargedImage = character.avatarPath?.replace('/avatars/', '/avatars/original/') ?? null; }}
								>
									<img src={character.avatarPath} alt={character.name} width="56" height="56" loading="eager" decoding="async" fetchpriority={i < 8 ? 'high' : 'auto'} class="h-14 w-14 shrink-0 rounded-xl object-cover transition-[filter] duration-150 group-hover/avatar:brightness-75" />
								</button>
							{:else}
								<div class="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-lg font-bold text-primary">{character.name[0]}</div>
							{/if}
						<button
							onclick={() => { if (!ctxLongPressFired) onselect?.(character.id); }}
							oncontextmenu={(e) => openCharMenu(character.id, e)}
							ontouchstart={(e) => startCharLongPress(character.id, e)}
							ontouchmove={(e) => moveCharLongPress(e)}
							ontouchend={() => endCharLongPress()}
							ontouchcancel={() => endCharLongPress()}
							class="flex min-w-0 flex-1 items-start text-left"
						>
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									<span class="truncate font-semibold text-foreground">{character.name}</span>
									{#if character.creator}
										<span class="shrink-0 text-xs text-muted-foreground">by {character.creator}</span>
									{/if}
								</div>
								{#if character.tags}
									{@const tagList = parseTags(character.tags)}
									{#if tagList.length}
										<div class="mt-1 flex flex-wrap gap-1">
											{#each tagList.slice(0, 4) as tag}
												<span class="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{tag}</span>
											{/each}
											{#if tagList.length > 4}
												<span class="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">+{tagList.length - 4}</span>
											{/if}
										</div>
									{/if}
								{/if}
								{#if character.description}
									<p class="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">{character.description.replace(/###?\s/g, '').replace(/\n\s*\n/g, ' ').replace(/\n/g, ' ').trim()}</p>
								{/if}
							</div>
						</button>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</nav>
{:else if modal.visible}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4 bg-black/60 {modal.closing ? 'backdrop-exit' : 'backdrop-enter'}"
		role="dialog" aria-modal="true" aria-label="Characters" tabindex="-1" use:focusTrap
		onkeydown={(e) => e.key === 'Escape' && onclose()}
	>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div class="absolute inset-0" onclick={onclose}></div>
		<div
			class="relative z-10 flex max-h-[85vh] w-full max-w-5xl flex-col rounded-t-2xl border border-border bg-card shadow-xl sm:rounded-xl {modal.closing ? 'modal-exit' : 'modal-enter'}"
			ontouchstart={gestures.handlers.onTouchStart}
			ontouchmove={gestures.handlers.onTouchMove}
			ontouchend={gestures.handlers.onTouchEnd}
			style={gestures.panelStyle}
		>
			<!-- Header -->
			<div class="flex items-center justify-between border-b border-border px-6 py-4">
				<h2 class="text-lg font-semibold">Characters</h2>
				<div class="flex items-center gap-2">
					<button
						onclick={() => (chubOpen = true)}
						class="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
						use:tooltip={'Browse CHUB'}
					>
						<Globe class="h-4 w-4" />
						<span class="hidden sm:inline">CHUB</span>
					</button>
					<button
						onclick={importCharacter}
						disabled={importing}
						class="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50"
					>
						<Upload class="h-4 w-4" />
						{importing ? `Importing ${importDone}/${importTotal}...` : 'Import'}
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
						class="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent"
					>
						<X class="h-4 w-4" />
					</button>
				</div>
			</div>

			{#if importing}
				<!-- Import progress bar -->
				<div class="border-b border-border px-6 py-3">
					<div class="flex items-center justify-between text-sm text-muted-foreground mb-1.5">
						<span>Importing characters... {importDone}/{importTotal}{importFailed > 0 ? ` (${importFailed} failed)` : ''}</span>
						<span>{Math.round((importDone / importTotal) * 100)}%</span>
					</div>
					<div class="h-2 w-full rounded-full bg-muted overflow-hidden">
						<div
							class="h-full rounded-full bg-primary transition-all duration-300"
							style="width: {(importDone / importTotal) * 100}%"
						></div>
					</div>
				</div>
			{/if}

			<!-- Search & Tag Filter -->
			<div class="space-y-3 border-b border-border px-6 py-3">
				<div class="flex gap-2">
					<div class="relative flex-1">
						<Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
						<input
							bind:value={searchQuery}
							placeholder="Search by name, author, or tag..."
							class="w-full rounded-lg border border-input bg-background py-2 pl-10 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
						/>
					</div>
					<div class="relative w-40">
						<Combobox
							value={sortBy}
							items={[
								{ value: 'alpha', label: 'A–Z' },
								{ value: 'newest', label: 'Newest first' },
								{ value: 'oldest', label: 'Oldest first' },
							]}
							onchange={(v) => setSortBy(v as any)}
						/>
					</div>
				</div>
				{#if allTags.length > 0}
					<div class="flex max-h-[4.5rem] flex-wrap gap-1.5 overflow-hidden">
						{#each allTags as tag}
							<button
								onclick={() => toggleTag(tag)}
								class="rounded-md px-2 py-0.5 text-xs transition-colors {selectedTags.includes(tag)
									? 'bg-primary text-primary-foreground'
									: 'bg-secondary text-muted-foreground hover:bg-secondary/80'}"
							>
								{tag}
							</button>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Body -->
			<div bind:this={scrollContainer} class="flex-1 overflow-y-auto p-6" style="overscroll-behavior: contain;">
				{#if showCreateForm}
					<div class="mb-6 rounded-xl border border-primary/20 bg-card p-4">
						<h3 class="mb-4 text-sm font-semibold">New Character</h3>
						<div class="space-y-3">
							<div>
								<label for="mc-name" class="mb-1 block text-xs font-medium text-muted-foreground">Name *</label>
								<input
									id="mc-name"
									bind:value={name}
									class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
									placeholder="Character name"
								/>
							</div>
							<div>
								<label for="mc-desc" class="mb-1 block text-xs font-medium text-muted-foreground">Description</label>
								<textarea
									id="mc-desc"
									bind:value={description}
									rows={2}
									class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
									placeholder="A brief description"
								></textarea>
							</div>
							<div class="grid gap-3 sm:grid-cols-2">
								<div>
									<label for="mc-personality" class="mb-1 block text-xs font-medium text-muted-foreground">Personality</label>
									<textarea
										id="mc-personality"
										bind:value={personality}
										rows={2}
										class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
										placeholder="Personality traits"
									></textarea>
								</div>
								<div>
									<label for="mc-first" class="mb-1 block text-xs font-medium text-muted-foreground">First Message</label>
									<textarea
										id="mc-first"
										bind:value={firstMessage}
										rows={2}
										class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
										placeholder="Opening message"
									></textarea>
								</div>
							</div>
							<div>
								<label for="mc-scenario" class="mb-1 block text-xs font-medium text-muted-foreground">Scenario</label>
								<textarea
									id="mc-scenario"
									bind:value={scenario}
									rows={2}
									class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
									placeholder="The setting or scenario"
								></textarea>
							</div>
							<div>
								<label for="mc-system" class="mb-1 block text-xs font-medium text-muted-foreground">System Prompt (optional)</label>
								<textarea
									id="mc-system"
									bind:value={systemPrompt}
									rows={2}
									class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
									placeholder="Custom system prompt"
								></textarea>
							</div>
							<div>
								<label for="mc-tags" class="mb-1 block text-xs font-medium text-muted-foreground">Tags</label>
								<input
									id="mc-tags"
									bind:value={tags}
									class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
									placeholder="fantasy, sci-fi (comma-separated)"
								/>
							</div>
							<div class="flex justify-end gap-3 pt-1">
								<button
									onclick={() => {
										showCreateForm = false;
										resetForm();
									}}
									class="rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-accent"
								>
									Cancel
								</button>
								<button
									onclick={createCharacter}
									disabled={!name.trim()}
									class="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
								>
									Create
								</button>
							</div>
						</div>
					</div>
				{/if}

				{#if filteredCharacters.length === 0 && !showCreateForm}
					<div class="flex flex-col items-center justify-center py-12 text-muted-foreground">
						<Users class="mb-4 h-12 w-12 opacity-30" />
						{#if characters.length === 0}
							<p class="text-lg">No characters yet</p>
							<p class="mt-1 text-sm">Create a character or import a PNG/JSON card</p>
						{:else}
							<p class="text-lg">No matching characters</p>
							<p class="mt-1 text-sm">Try a different search or clear your filters</p>
						{/if}
					</div>
				{:else}
					<div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
						{#each filteredCharacters as character}
							{@const characterLorebook = lorebooks.find((l: any) => l.characterId === character.id)}
							<div
								class="group relative flex select-none overflow-hidden rounded-xl border border-border bg-background transition-all duration-200 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-0.5"
								style="{cardStyle(character)}; -webkit-touch-callout: none;"
								oncontextmenu={(e) => openCharMenu(character.id, e)}
								ontouchstart={(e) => startCharLongPress(character.id, e)}
								ontouchmove={(e) => moveCharLongPress(e)}
								ontouchend={() => endCharLongPress()}
								ontouchcancel={() => endCharLongPress()}
							>
								{#if colorCharacterCards && character.backgroundPath}
									<div
										class="pointer-events-none absolute inset-0 z-0 bg-cover bg-center bg-no-repeat opacity-[0.08]"
										style="background-image: url({character.backgroundPath})"
									></div>
								{/if}
								<!-- Character image -->
								{#if character.avatarPath}
									<button type="button" class="relative z-[1] h-full w-28 shrink-0 cursor-pointer" onclick={() => (enlargedImage = character.avatarPath?.replace('/avatars/', '/avatars/original/') ?? null)}>
										<img
											src={character.avatarPath}
											alt={character.name}
											loading="eager"
											decoding="async"
											fetchpriority="auto"
											class="h-full w-full rounded-l-xl object-cover"
										/>
									</button>
								{:else}
									<div
										class="relative z-[1] flex h-full w-28 shrink-0 items-center justify-center rounded-l-xl bg-primary/10 text-3xl font-bold text-primary"
									>
										{character.name[0]}
									</div>
								{/if}

								<!-- Card content -->
								<div class="relative z-[1] flex min-w-0 flex-1 flex-col p-4">
									<div class="mb-1 flex items-start justify-between gap-2">
										<div class="min-w-0">
											<div class="flex items-center gap-1.5">
												<h3 class="truncate text-base font-semibold">{character.name}</h3>
												{#if characterHasTheme(character.id)}
													<span use:tooltip={'Has custom theme'}><Palette class="h-3.5 w-3.5 shrink-0 text-primary" /></span>
												{/if}
											</div>
											{#if character.creator}
												<p class="text-xs text-muted-foreground">by {character.creator}</p>
											{/if}
										</div>
										<div class="flex shrink-0 items-center gap-0.5">
											<button
												onclick={() => exportCharacter(character.id, character.name, 'png')}
												class="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
												use:tooltip={'Export as PNG'}
											>
												<Download class="h-3.5 w-3.5" />
											</button>
											<button
												onclick={() => { if (characterLorebook) editLorebookId = characterLorebook.id; }}
												class="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
												use:tooltip={characterLorebook ? 'Edit lorebook' : 'No lorebook'}
												disabled={!characterLorebook}
											>
												<BookOpen class="h-3.5 w-3.5" />
											</button>
											<button
												onclick={() => { editCharacter = character; }}
												class="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
												use:tooltip={'Edit character'}
											>
												<Pencil class="h-3.5 w-3.5" />
											</button>
											<button
												onclick={() => askDeleteCharacter(character.id, character.name)}
												class="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-destructive/20 hover:text-destructive"
											>
												<Trash2 class="h-3.5 w-3.5" />
											</button>
										</div>
									</div>

<button
									type="button"
									class="mb-2 min-h-[5.75rem] max-h-[5.75rem] flex flex-wrap gap-1 content-start overflow-hidden text-left cursor-pointer rounded-lg transition-colors hover:bg-accent/50"
									onclick={() => { if (character.tags && parseTags(character.tags).length) { popupCharacter = character; popupType = 'tags'; } }}
								>
									{#if character.tags}
										{#each parseTags(character.tags) as tag}
											<span class="rounded-md bg-secondary px-1.5 py-0.5 text-xs leading-4 text-muted-foreground">
												{tag}
											</span>
										{/each}
									{/if}
								</button>

									{#if character.description}
									<button
										type="button"
										class="mb-3 max-h-[6.25rem] overflow-hidden whitespace-pre-wrap text-left text-sm text-muted-foreground cursor-pointer rounded-lg transition-colors hover:bg-accent/50"
										onclick={() => { popupCharacter = character; popupType = 'description'; }}
									>
										{character.description.replace(/###?\s/g, '').replace(/\n\s*\n/g, '\n').trim().substring(0, 300)}
									</button>
									{/if}

									<div class="mt-auto flex items-center gap-2">
										<button
										onclick={() => requestStartChat(character.id, 'story')}
											disabled={loadingChatId !== null}
											class="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
										>
											{#if loadingChatId === character.id && loadingChatMode === 'story'}
												<Loader2 class="h-3.5 w-3.5 animate-spin" />
											{:else}
												<MessageSquare class="h-3.5 w-3.5" />
											{/if}
											Story
										</button>
										<button
										onclick={() => requestStartChat(character.id, 'texting')}
											disabled={loadingChatId !== null}
											class="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-500/10 px-3 py-1.5 text-sm font-medium text-emerald-500 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
										>
											{#if loadingChatId === character.id && loadingChatMode === 'texting'}
												<Loader2 class="h-3.5 w-3.5 animate-spin" />
											{:else}
												<Smartphone class="h-3.5 w-3.5" />
											{/if}
											Text
										</button>
									</div>
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
<CharacterEditModal
	open={editCharacter !== null}
	character={editCharacter}
	onclose={() => { editCharacter = null; }}
	onaiedit={(id) => {
		const seed = editCharacter;
		editCharacter = null;
		onaicreate?.({ name: seed?.name ?? '', description: seed?.description ?? '' });
		void id;
	}}
/>

<LorebookEditModal
	open={editLorebookId !== null}
	lorebookId={editLorebookId}
	onclose={() => { editLorebookId = null; }}
/>
{/if}

<!-- ImageModal renders in both modes — embedded list/grid clicks need it too. -->
<ImageModal src={enlargedImage} onclose={() => (enlargedImage = null)} />

{#if popupCharacter && popupType}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
		onclick={() => { popupCharacter = null; popupType = null; }}
		onkeydown={(e) => { if (e.key === 'Escape') { popupCharacter = null; popupType = null; } }}
	>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="max-h-[70vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-background p-6 shadow-xl"
			onclick={(e) => e.stopPropagation()}
			onkeydown={() => {}}
		>
			<div class="mb-4 flex items-center justify-between">
				<h3 class="text-lg font-semibold">
					{popupCharacter.name} — {popupType === 'description' ? 'Description' : 'Tags'}
				</h3>
				<button
					onclick={() => { popupCharacter = null; popupType = null; }}
					class="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
				>
					<X class="h-5 w-5" />
				</button>
			</div>
			{#if popupType === 'description'}
				<p class="whitespace-pre-wrap text-sm text-muted-foreground">{popupCharacter.description}</p>
			{:else}
				<div class="flex flex-wrap gap-2">
					{#each parseTags(popupCharacter.tags) as tag}
						<span class="rounded-md bg-secondary px-2 py-1 text-sm text-muted-foreground">{tag}</span>
					{/each}
				</div>
			{/if}
		</div>
	</div>
{/if}

<ConfirmModal
	open={confirmDeleteId !== null}
	title="Delete Character"
	message={confirmDeleteHasLorebook
		? `Delete "${confirmDeleteName}"? All related chats and data will be permanently removed.\n\nThis character has an associated lorebook. "Delete" will also remove the lorebook. "Keep Lorebook" will keep it as a standalone lorebook.`
		: `Delete "${confirmDeleteName}"? All related chats and data will be permanently removed.`}
	confirmLabel={confirmDeleteHasLorebook ? 'Delete All' : 'Delete'}
	secondaryLabel={confirmDeleteHasLorebook ? 'Keep Lorebook' : ''}
	onsecondary={confirmDeleteKeepLorebook}
	onconfirm={confirmDelete}
	oncancel={() => { confirmDeleteId = null; confirmDeleteName = ''; confirmDeleteHasLorebook = false; }}
/>

<ConfirmModal
	open={importErrors.length > 0}
	title={importErrors.length === 1 ? 'Import Failed' : `${importErrors.length} Imports Failed`}
	message={importErrors.join('\n')}
	confirmLabel="OK"
	cancelLabel=""
	variant="info"
	onconfirm={() => { importErrors = []; }}
	oncancel={() => { importErrors = []; }}
/>

{#if themePromptCharId !== null}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4"
		onkeydown={(e) => { if (e.key === 'Escape') { themePromptCharId = null; } }}
	>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div class="absolute inset-0" onclick={() => { themePromptCharId = null; }}></div>
		<div class="relative z-10 w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-xl">
			<h3 class="mb-2 text-base font-semibold">Character Theme</h3>
			<p class="mb-3 text-sm text-muted-foreground">
				<span class="font-medium text-foreground">{themePromptName}</span> has a custom theme. Apply it to this chat?
			</p>
			<p class="mb-5 text-xs text-muted-foreground">Colors are derived from the character's avatar. You can disable the theme later in chat settings.</p>
			<div class="flex items-center justify-end gap-3">
				<button
					onclick={() => startChat(themePromptCharId!, themePromptMode, false)}
					class="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
				>
					No thanks
				</button>
				<button
					onclick={() => startChat(themePromptCharId!, themePromptMode)}
					class="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
				>
					Apply theme
				</button>
			</div>
		</div>
	</div>
{/if}

{#if ctxMenuCharId !== null && ctxMenuPos}
	{@const menuChar = characters.find((c: any) => c.id === ctxMenuCharId)}
	{#if menuChar}
		<div data-char-menu class="popup-menu fixed z-[100] w-48 rounded-xl border border-border bg-popover py-1 shadow-2xl" style="--popup-origin: {ctxMenuPos.flipUp ? 'bottom' : 'top'} center; left: {ctxMenuPos.x}px; {ctxMenuPos.flipUp ? `bottom: ${window.innerHeight - ctxMenuPos.y}px` : `top: ${ctxMenuPos.y}px`}">
			<button
				onclick={() => { const id = ctxMenuCharId!; closeCharMenu(); requestStartChat(id, 'story'); }}
				class="flex w-full items-center gap-3 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
			>
				<MessageSquare class="h-4 w-4 text-muted-foreground" />
				Story
			</button>
			<button
				onclick={() => { const id = ctxMenuCharId!; closeCharMenu(); requestStartChat(id, 'texting'); }}
				class="flex w-full items-center gap-3 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
			>
				<Smartphone class="h-4 w-4 text-muted-foreground" />
				Text
			</button>
			<div class="my-1 h-px bg-border"></div>
			<button
				onclick={() => { if (embedded) { onselect?.(menuChar.id, true); } else { editCharacter = menuChar; } closeCharMenu(); }}
				class="flex w-full items-center gap-3 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
			>
				<Pencil class="h-4 w-4 text-muted-foreground" />
				Edit
			</button>
			<button
				onclick={() => { askDeleteCharacter(menuChar.id, menuChar.name); closeCharMenu(); }}
				class="flex w-full items-center gap-3 px-3 py-2 text-sm text-destructive transition-colors hover:bg-destructive/10"
			>
				<Trash2 class="h-4 w-4" />
				Delete
			</button>
		</div>
	{/if}
{/if}

<ChubBrowseModal
	open={chubOpen}
	initialType="character"
	onclose={() => (chubOpen = false)}
/>
