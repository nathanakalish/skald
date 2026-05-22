<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { Search, X, Loader2, Globe, BookOpen, Users, Download, AlertTriangle, ArrowLeft, Link2, SlidersHorizontal, Plus, ChevronDown, Check } from 'lucide-svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import IconButton from '$lib/components/ui/IconButton.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { createModalState, createModalGestures } from '$lib/modal.svelte.js';
	import { focusTrap } from '$lib/focusTrap.js';
	import ImageModal from '$lib/components/ImageModal.svelte';
	import { charactersStore } from '$lib/stores/characters.svelte.js';
	import { lorebooksStore } from '$lib/stores/lorebooks.svelte.js';
	import { toasts } from '$lib/stores/toast.svelte.js';
	import { tooltip } from '$lib/tooltip.js';

	type ChubType = 'character' | 'lorebook';

	interface ChubCard {
		id: number;
		fullPath: string;
		name: string;
		tagline: string;
		description: string;
		avatar_url: string | null;
		max_res_url: string | null;
		creator: string;
		tags: string[];
		topics: string[];
		nsfw: boolean;
		starCount: number;
		nTokens: number;
		nMessages: number;
		nFavorites: number;
		rating: number;
		ratingCount: number;
		createdAt: string | null;
		lastActivityAt: string | null;
	}

	interface ChubPreview {
		type: ChubType;
		fullPath: string;
		name: string;
		creator: string;
		tagline: string;
		description: string;
		avatar_url: string | null;
		max_res_url: string | null;
		tags: string[];
		topics: string[];
		nsfw: boolean;
		starCount: number;
		nFavorites: number;
		nTokens: number;
		rating: number;
		ratingCount: number;
		createdAt: string | null;
		lastActivityAt: string | null;
		personality: string;
		scenario: string;
		first_message: string;
		example_dialogs: string;
		system_prompt: string;
		post_history_instructions: string;
		alternate_greetings: string[];
		creator_notes: string;
		lorebookEntryCount: number;
		lorebookEntries: { keys: string[]; content: string }[];
	}

	type SortKey = 'download_count' | 'last_activity_at' | 'created_at' | 'rating' | 'n_favorites';

	interface Props {
		open: boolean;
		initialType?: ChubType;
		onclose: () => void;
		onimported?: (type: ChubType) => void;
	}

	let { open, initialType = 'character', onclose: _onclose, onimported }: Props = $props();

	// initialType is only read once on mount — user picks a type via the toggle
	// after that, so capturing the initial value is intentional.
	// svelte-ignore state_referenced_locally
	let activeType = $state<ChubType>(initialType);
	let searchQuery = $state('');
	let debouncedSearch = $state('');
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let sortBy = $state<SortKey>('download_count');
	let sortOpen = $state(false);
	const SORT_OPTIONS: { k: SortKey; label: string }[] = [
		{ k: 'download_count', label: 'Top downloads' },
		{ k: 'n_favorites', label: 'Most favorited' },
		{ k: 'rating', label: 'Top rated' },
		{ k: 'created_at', label: 'Newest' },
		{ k: 'last_activity_at', label: 'Recently updated' },
	];

	// Three-state filter switches: 'show' includes the bucket, 'hide' excludes it,
	// 'only' restricts results to just that bucket. Setting any switch to 'only'
	// demotes any other row that was also 'only' back to 'show', so two rows
	// can't both claim exclusive focus at the same time.
	type SwitchMode = 'show' | 'hide' | 'only';
	let nsfwMode = $state<SwitchMode>('hide');
	let ownedMode = $state<SwitchMode>('show');

	function setSwitch(which: 'nsfw' | 'owned', mode: SwitchMode) {
		if (mode === 'only') {
			if (which !== 'nsfw' && nsfwMode === 'only') nsfwMode = 'show';
			if (which !== 'owned' && ownedMode === 'only') ownedMode = 'show';
		}
		if (which === 'nsfw') nsfwMode = mode;
		else ownedMode = mode;
	}

	// nsfw=false on the server gives SFW-only results; true returns the full pool
	// and we narrow to nsfw-only on the client when the switch is set to 'only'.
	const nsfwParam = $derived(nsfwMode !== 'hide');

	// Filter state — persisted to localStorage. Server-side filters trigger a
	// fresh search; library toggles are client-side and just hide cards.
	let tagsInclude = $state<string[]>([]);
	let tagsExclude = $state<string[]>([]);
	let minTokens = $state<number>(0);
	let includeForks = $state<boolean>(false);

	// Filters dialog open/closed.
	let filtersOpen = $state(false);

	// Tags harvested from results so we can offer suggestions without depending
	// on an undocumented CHUB tags endpoint. Kept per-type.
	let harvestedCharacterTags = $state<Map<string, number>>(new Map());
	let harvestedLorebookTags = $state<Map<string, number>>(new Map());

	let cards = $state<ChubCard[]>([]);
	let page = $state(1);
	let totalCount = $state(0);
	let loading = $state(false);
	let loadingMore = $state(false);
	let errorMsg = $state<string | null>(null);
	let importingPath = $state<string | null>(null);

	// Infinite scroll sentinel element.
	let sentinel = $state<HTMLElement | null>(null);
	let sentinelVisible = $state(false);

	$effect(() => {
		if (!sentinel) return;
		const obs = new IntersectionObserver(
			(entries) => { sentinelVisible = entries[0]?.isIntersecting ?? false; },
			{ rootMargin: '300px' }
		);
		obs.observe(sentinel);
		return () => obs.disconnect();
	});

	$effect(() => {
		if (sentinelVisible && hasMore && !loading && !loadingMore) {
			untrack(() => {
				page = page + 1;
				void loadPage(page, true);
			});
		}
	});

	// Preview pane state — opened by clicking a card.
	let previewCard = $state<ChubCard | null>(null);
	let preview = $state<ChubPreview | null>(null);
	let previewLoading = $state(false);
	let previewError = $state<string | null>(null);
	let previewReqId = 0;
	let enlargedImage = $state<string | null>(null);

	// Duplicate-detection: per-fullPath result from /api/chub/check.
	type DupMatch = { id: number; name: string; lastActivityAt?: string | null };
	type DupResult = { exact: DupMatch | null; byName: DupMatch[] };
	let dupes = $state<Record<string, DupResult>>({});

	// Confirm dialog when user tries to import something we already have.
	let dupConfirm = $state<{ card: ChubCard; result: DupResult } | null>(null);

	// "Link to existing" picker — opened from the preview pane to associate a
	// CHUB card with a local item the user imported by hand.
	interface LinkCandidate { id: number; name: string; avatarPath: string | null }
	let linkPicker = $state<{ card: ChubCard } | null>(null);
	let linkQuery = $state('');
	let linking = $state(false);
	let linkCandidates = $state<LinkCandidate[]>([]);

	const PAGE_SIZE = 24;

	// Persist preferences so they survive modal close.
	onMount(() => {
		try {
			const savedSort = localStorage.getItem('skald-chub-sort') as SortKey | null;
			if (savedSort) sortBy = savedSort;
			const savedFilters = localStorage.getItem('skald-chub-filters');
			if (savedFilters) {
				const isMode = (v: unknown): v is SwitchMode => v === 'show' || v === 'hide' || v === 'only';
				const f = JSON.parse(savedFilters) as Partial<{
					tagsInclude: string[]; tagsExclude: string[]; minTokens: number;
					includeForks: boolean;
					nsfwMode: SwitchMode; ownedMode: SwitchMode;
				}>;
				if (Array.isArray(f.tagsInclude)) tagsInclude = f.tagsInclude.filter((t) => typeof t === 'string').slice(0, 30);
				if (Array.isArray(f.tagsExclude)) tagsExclude = f.tagsExclude.filter((t) => typeof t === 'string').slice(0, 30);
				if (typeof f.minTokens === 'number' && f.minTokens >= 0) minTokens = Math.min(100_000, Math.floor(f.minTokens));
				if (typeof f.includeForks === 'boolean') includeForks = f.includeForks;
				if (isMode(f.nsfwMode)) nsfwMode = f.nsfwMode;
				if (isMode(f.ownedMode)) ownedMode = f.ownedMode;
			}
		} catch { /* localStorage may be unavailable */ }
	});

	$effect(() => {
		try { localStorage.setItem('skald-chub-sort', sortBy); } catch { /* ignore */ }
	});
	$effect(() => {
		void tagsInclude; void tagsExclude; void minTokens; void includeForks;
		void nsfwMode; void ownedMode;
		try {
			localStorage.setItem('skald-chub-filters', JSON.stringify({
				tagsInclude, tagsExclude, minTokens, includeForks,
				nsfwMode, ownedMode,
			}));
		} catch { /* ignore */ }
	});

	// Reset and reload when key search inputs change.
	$effect(() => {
		// touch reactive deps
		void debouncedSearch;
		void sortBy;
		void nsfwParam;
		void activeType;
		void open;
		void tagsInclude;
		void tagsExclude;
		void minTokens;
		void includeForks;
		untrack(() => {
			if (!open) return;
			page = 1;
			cards = [];
			totalCount = 0;
			errorMsg = null;
			dupes = {};
			void loadPage(1, false);
		});
	});

	$effect(() => {
		void searchQuery;
		untrack(() => {
			if (debounceTimer) clearTimeout(debounceTimer);
			debounceTimer = setTimeout(() => { debouncedSearch = searchQuery; }, 350);
		});
	});

	async function loadPage(p: number, append: boolean) {
		const myType = activeType;
		const myDebounced = debouncedSearch;
		const myNsfw = nsfwParam;
		const mySort = sortBy;
		const myInclude = tagsInclude.join(',');
		const myExclude = tagsExclude.join(',');
		const myMinTokens = minTokens;
		const myIncludeForks = includeForks;

		if (append) loadingMore = true; else loading = true;
		errorMsg = null;

		const params = new URLSearchParams();
		params.set('page', String(p));
		params.set('first', String(PAGE_SIZE));
		params.set('sort', mySort);
		params.set('nsfw', String(myNsfw));
		if (myDebounced.trim()) params.set('search', myDebounced.trim());
		if (myInclude) params.set('tags', myInclude);
		if (myExclude) params.set('exclude_tags', myExclude);
		if (myMinTokens > 0) params.set('min_tokens', String(myMinTokens));
		if (myIncludeForks) params.set('include_forks', 'true');
		const path = myType === 'character' ? '/api/chub/characters' : '/api/chub/lorebooks';

		try {
			const res = await fetch(`${path}?${params.toString()}`);
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				errorMsg = err.error || `Search failed (${res.status})`;
				return;
			}
			const data = await res.json() as { nodes: ChubCard[]; count: number };
			// Stale-response guard: if user changed inputs while we were fetching, drop the result.
			if (myType !== activeType || myDebounced !== debouncedSearch || myNsfw !== nsfwParam || mySort !== sortBy) return;
			if (myInclude !== tagsInclude.join(',') || myExclude !== tagsExclude.join(',') || myMinTokens !== minTokens || myIncludeForks !== includeForks) return;
			if (append) cards = [...cards, ...data.nodes];
			else cards = data.nodes;
			totalCount = data.count;
			harvestTags(data.nodes, myType);
			void checkDupes(data.nodes, myType);
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Search failed';
		} finally {
			if (append) loadingMore = false; else loading = false;
		}
	}



	async function checkDupes(newCards: ChubCard[], type: ChubType) {
		if (newCards.length === 0) return;
		try {
			const res = await fetch('/api/chub/check', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					type,
					cards: newCards.map((c) => ({ fullPath: c.fullPath, name: c.name, creator: c.creator })),
				}),
			});
			if (!res.ok) return;
			if (type !== activeType) return; // user switched tabs
			const data = await res.json() as { results: { fullPath: string; exact: DupMatch | null; byName: DupMatch[] }[] };
			const next = { ...dupes };
			for (const r of data.results ?? []) {
				next[r.fullPath] = { exact: r.exact, byName: r.byName ?? [] };
			}
			dupes = next;
		} catch {
			// best-effort; absence of dupes badge is acceptable
		}
	}

	function dupFor(card: ChubCard): DupResult | null {
		const d = dupes[card.fullPath];
		if (!d) return null;
		if (!d.exact && d.byName.length === 0) return null;
		return d;
	}

	// True when CHUB has a newer lastActivityAt than what we stamped on the
	// linked local row. Only meaningful for exact matches.
	function hasUpdate(card: ChubCard): boolean {
		const d = dupes[card.fullPath];
		if (!d?.exact) return false;
		const stored = d.exact.lastActivityAt;
		if (!stored || !card.lastActivityAt) return false;
		return card.lastActivityAt > stored;
	}

	// Accumulate tags seen in results so the filter dialog can offer suggestions.
	function harvestTags(newCards: ChubCard[], type: ChubType) {
		const map = type === 'character' ? new Map(harvestedCharacterTags) : new Map(harvestedLorebookTags);
		for (const c of newCards) {
			for (const tag of c.tags ?? []) {
				const t = String(tag).trim();
				if (!t || t.length > 64) continue;
				map.set(t, (map.get(t) ?? 0) + 1);
			}
		}
		if (type === 'character') harvestedCharacterTags = map;
		else harvestedLorebookTags = map;
	}

	const harvestedTags = $derived(activeType === 'character' ? harvestedCharacterTags : harvestedLorebookTags);

	// Top tag suggestions for the filter dialog: most-frequently-seen tags
	// minus ones already in either include or exclude.
	const tagSuggestions = $derived.by<string[]>(() => {
		const used = new Set([...tagsInclude, ...tagsExclude].map((t) => t.toLowerCase()));
		return [...harvestedTags.entries()]
			.filter(([t]) => !used.has(t.toLowerCase()))
			.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
			.slice(0, 24)
			.map(([t]) => t);
	});

	function addIncludeTag(raw: string) {
		const t = raw.trim();
		if (!t || tagsInclude.length >= 30) return;
		if (tagsInclude.some((x) => x.toLowerCase() === t.toLowerCase())) return;
		tagsInclude = [...tagsInclude.filter((x) => x.toLowerCase() !== t.toLowerCase()), t];
		tagsExclude = tagsExclude.filter((x) => x.toLowerCase() !== t.toLowerCase());
	}
	function addExcludeTag(raw: string) {
		const t = raw.trim();
		if (!t || tagsExclude.length >= 30) return;
		if (tagsExclude.some((x) => x.toLowerCase() === t.toLowerCase())) return;
		tagsExclude = [...tagsExclude.filter((x) => x.toLowerCase() !== t.toLowerCase()), t];
		tagsInclude = tagsInclude.filter((x) => x.toLowerCase() !== t.toLowerCase());
	}
	function removeIncludeTag(t: string) {
		tagsInclude = tagsInclude.filter((x) => x !== t);
	}
	function removeExcludeTag(t: string) {
		tagsExclude = tagsExclude.filter((x) => x !== t);
	}
	function clearAllFilters() {
		tagsInclude = [];
		tagsExclude = [];
		minTokens = 0;
		includeForks = false;
		nsfwMode = 'hide';
		ownedMode = 'show';
	}

	const activeFilterCount = $derived(
		(tagsInclude.length > 0 ? 1 : 0)
			+ (tagsExclude.length > 0 ? 1 : 0)
			+ (minTokens > 0 ? 1 : 0)
			+ (includeForks ? 1 : 0)
			+ (nsfwMode !== 'hide' ? 1 : 0)
			+ (ownedMode !== 'show' ? 1 : 0)
	);

	// Cards after the client-side library/nsfw filter.
	const visibleCards = $derived.by(() => {
		const noop = nsfwMode !== 'only' && ownedMode === 'show';
		if (noop) return cards;
		return cards.filter((c) => {
			if (nsfwMode === 'only' && !c.nsfw) return false;
			const d = dupes[c.fullPath];
			const owned = !!(d && d.exact);
			if (ownedMode === 'hide' && owned) return false;
			if (ownedMode === 'only' && !owned) return false;
			return true;
		});
	});

	// Free-text input in the filter dialog.
	let tagInputInclude = $state('');
	let tagInputExclude = $state('');

	async function attemptImport(card: ChubCard) {
		const d = dupFor(card);
		if (d) {
			dupConfirm = { card, result: d };
			return;
		}
		await importCard(card);
	}

	async function importCard(card: ChubCard) {
		if (importingPath) return;
		importingPath = card.fullPath;
		try {
			const res = await fetch('/api/chub/import', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					type: activeType,
					fullPath: card.fullPath,
					lastActivityAt: card.lastActivityAt ?? null,
					avatarUrl: card.avatar_url ?? null,
				}),
			});
			const text = await res.text();
			let payload: any = null;
			try { payload = JSON.parse(text); } catch { /* non-json */ }

			if (!res.ok) {
				const msg = payload?.error || payload?.message || `Import failed (${res.status})`;
				toasts.error(`${card.name}: ${msg}`);
				return;
			}

			toasts.success(`Imported ${card.name}`);
			if (activeType === 'character') {
				await charactersStore.load(true);
			} else {
				await lorebooksStore.load(true);
			}
			onimported?.(activeType);
			// Mark this fullPath as owned so the badge appears immediately.
			if (typeof payload?.id === 'number') {
				dupes = {
					...dupes,
					[card.fullPath]: {
						exact: { id: payload.id, name: card.name, lastActivityAt: card.lastActivityAt ?? null },
						byName: dupes[card.fullPath]?.byName ?? [],
					},
				};
			}
			// If we imported from the preview pane, close it on success.
			if (previewCard?.fullPath === card.fullPath) closePreview();
		} catch (err) {
			toasts.error(`Import failed: ${err instanceof Error ? err.message : 'Unknown'}`);
		} finally {
			importingPath = null;
		}
	}

	function openLinkPicker(card: ChubCard) {
		linkPicker = { card };
		linkQuery = card.name;
		if (activeType === 'character') void charactersStore.load();
		else void lorebooksStore.load();
		linkCandidates = currentLibrary();
	}

	function closeLinkPicker() {
		linkPicker = null;
		linkQuery = '';
		linkCandidates = [];
	}

	function currentLibrary(): LinkCandidate[] {
		if (activeType === 'character') {
			return charactersStore.characters.map((c) => ({ id: c.id, name: c.name, avatarPath: c.avatarPath }));
		}
		return lorebooksStore.lorebooks.map((l: any) => ({ id: l.id, name: l.name, avatarPath: null }));
	}

	// Re-rank library against the picker query: exact (case-insensitive) first,
	// then startsWith, then includes, then alphabetical for the rest.
	const filteredCandidates = $derived.by<LinkCandidate[]>(() => {
		if (!linkPicker) return [];
		const q = linkQuery.trim().toLowerCase();
		const all = linkCandidates.length > 0 ? linkCandidates : currentLibrary();
		if (!q) return [...all].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 100);
		const scored = all.map((c) => {
			const n = c.name.toLowerCase();
			let score = 999;
			if (n === q) score = 0;
			else if (n.startsWith(q)) score = 1;
			else if (n.includes(q)) score = 2;
			return { c, score };
		}).filter((s) => s.score < 999);
		scored.sort((a, b) => a.score - b.score || a.c.name.localeCompare(b.c.name));
		return scored.slice(0, 100).map((s) => s.c);
	});

	async function linkTo(existingId: number, existingName: string) {
		if (!linkPicker || linking) return;
		const card = linkPicker.card;
		linking = true;
		try {
			const res = await fetch('/api/chub/link', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					type: activeType,
					fullPath: card.fullPath,
					id: existingId,
					lastActivityAt: card.lastActivityAt ?? null,
				}),
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				toasts.error(err.error || `Link failed (${res.status})`);
				return;
			}
			dupes = {
				...dupes,
				[card.fullPath]: {
					exact: { id: existingId, name: existingName, lastActivityAt: card.lastActivityAt ?? null },
					byName: dupes[card.fullPath]?.byName ?? [],
				},
			};
			toasts.success(`Linked to ${existingName}`);
			closeLinkPicker();
		} catch (err) {
			toasts.error(`Link failed: ${err instanceof Error ? err.message : 'Unknown'}`);
		} finally {
			linking = false;
		}
	}

	async function replaceImport(card: ChubCard, existingId: number) {
		if (importingPath) return;
		importingPath = card.fullPath;
		try {
			const delPath = activeType === 'character'
				? `/api/characters/${existingId}`
				: `/api/lorebooks/${existingId}`;
			const delRes = await fetch(delPath, { method: 'DELETE' });
			if (!delRes.ok && delRes.status !== 404) {
				const err = await delRes.json().catch(() => ({}));
				toasts.error(`Couldn't remove existing: ${err.error || delRes.status}`);
				return;
			}
			// Clear stale dup state, then run a fresh import.
			dupes = { ...dupes, [card.fullPath]: { exact: null, byName: [] } };
		} finally {
			importingPath = null;
		}
		await importCard(card);
	}

	async function openPreview(card: ChubCard) {
		previewCard = card;
		preview = null;
		previewError = null;
		previewLoading = true;
		const myId = ++previewReqId;
		const myType = activeType;
		try {
			const params = new URLSearchParams({ type: myType, fullPath: card.fullPath });
			const res = await fetch(`/api/chub/preview?${params.toString()}`);
			if (myId !== previewReqId) return; // user clicked another card / closed
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				previewError = err.error || err.message || `Preview failed (${res.status})`;
				return;
			}
			preview = await res.json();
		} catch (err) {
			if (myId !== previewReqId) return;
			previewError = err instanceof Error ? err.message : 'Preview failed';
		} finally {
			if (myId === previewReqId) previewLoading = false;
		}
	}

	function closePreview() {
		previewReqId++; // invalidate in-flight request
		previewCard = null;
		preview = null;
		previewError = null;
		previewLoading = false;
	}

	function fmtCount(n: number): string {
		if (!n) return '0';
		if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
		if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
		return String(n);
	}

	function onclose() {
		_onclose();
	}

	const modal = createModalState(() => open);
	const gestures = createModalGestures({ onclose, modal });

	// Layered preview modal — sits on top of the browse modal so it can be
	// swiped down (or backdrop-tapped / Escape) to dismiss without losing
	// the user's place in the result list underneath.
	const previewModal = createModalState(() => previewCard !== null);
	const previewGestures = createModalGestures({ onclose: closePreview, modal: previewModal });

	const hasMore = $derived(cards.length < totalCount);

	// Portal to <body> so the modal isn't constrained by an ancestor with `transform`
	// (e.g. the mobile sidebar uses translateX, which creates a containing block for
	// our `position: fixed` overlay and otherwise makes the modal drawer-width).
	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return { destroy() { node.remove(); } };
	}
</script>

{#if modal.visible}
	<div use:portal>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-[60] flex items-end justify-center p-0 sm:items-center sm:p-4 bg-black/60 {modal.closing ? 'backdrop-exit' : 'backdrop-enter'}"
		role="dialog" aria-modal="true" aria-label="Browse CHUB" tabindex="-1" use:focusTrap
		onkeydown={(e) => {
			if (e.key !== 'Escape') return;
			if (sortOpen) sortOpen = false;
			else if (filtersOpen) filtersOpen = false;
			else if (linkPicker) closeLinkPicker();
			else if (dupConfirm) dupConfirm = null;
			else if (previewCard) closePreview();
			else onclose();
		}}
	>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div class="absolute inset-0" onclick={onclose}></div>
		<div
			class="relative z-10 flex h-[90dvh] w-full max-w-5xl flex-col rounded-t-2xl border border-border bg-card shadow-xl sm:h-auto sm:max-h-[90vh] sm:rounded-xl {modal.closing ? 'modal-exit' : 'modal-enter'}"
			ontouchstart={gestures.handlers.onTouchStart}
			ontouchmove={gestures.handlers.onTouchMove}
			ontouchend={gestures.handlers.onTouchEnd}
			style={gestures.panelStyle}
		>
			<!-- Header -->
			<div class="flex items-center justify-between border-b border-border px-5 py-3 sm:px-6 sm:py-4">
				<div class="flex items-center gap-2">
					<Globe class="h-5 w-5 text-primary" />
					<h2 class="text-lg font-semibold">Browse CHUB</h2>
				</div>
				<button
					onclick={onclose}
					class="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent"
					aria-label="Close"
				>
					<X class="h-4 w-4" />
				</button>
			</div>

			<!-- Controls -->
			<div class="flex flex-col gap-2 border-b border-border px-4 py-3 sm:px-6">
				<!-- Type tabs -->
				<div class="inline-flex w-fit rounded-lg border border-border bg-accent/30 p-0.5 text-xs">
					<button
						onclick={() => (activeType = 'character')}
						class="flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors {activeType === 'character' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}"
					>
						<Users class="h-3.5 w-3.5" /> Characters
					</button>
					<button
						onclick={() => (activeType = 'lorebook')}
						class="flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors {activeType === 'lorebook' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}"
					>
						<BookOpen class="h-3.5 w-3.5" /> Lorebooks
					</button>
				</div>

				<!-- Search + sort + nsfw -->
				<div class="flex flex-wrap items-center gap-2">
					<div class="relative min-w-0 flex-1">
						<Search class="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
						<input
							type="text"
							bind:value={searchQuery}
							placeholder={activeType === 'character' ? 'Search characters on CHUB…' : 'Search lorebooks on CHUB…'}
							class="w-full rounded-full border border-transparent bg-accent/40 py-2 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:border-primary/30 focus:bg-background focus:outline-none focus:ring-2 focus:ring-ring/40"
						/>
					</div>
					<div class="relative shrink-0" data-sort-dropdown>
						<button
							type="button"
							onclick={() => (sortOpen = !sortOpen)}
							class="flex items-center gap-1.5 rounded-full border border-transparent bg-accent/40 px-3 py-2 text-xs hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring/40"
							aria-haspopup="listbox"
							aria-expanded={sortOpen}
						>
							<span class="truncate">{SORT_OPTIONS.find((o) => o.k === sortBy)?.label ?? 'Sort'}</span>
							<ChevronDown class="h-3.5 w-3.5 opacity-70 transition-transform {sortOpen ? 'rotate-180' : ''}" />
						</button>
						{#if sortOpen}
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div class="fixed inset-0 z-30" onclick={() => (sortOpen = false)}></div>
							<div class="absolute right-0 z-40 mt-1 min-w-[12rem] overflow-hidden rounded-xl border border-border bg-card shadow-xl" role="listbox">
								{#each SORT_OPTIONS as opt (opt.k)}
									<button
										type="button"
										onclick={() => { sortBy = opt.k; sortOpen = false; }}
										role="option"
										aria-selected={sortBy === opt.k}
										class="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-accent {sortBy === opt.k ? 'text-foreground' : 'text-muted-foreground'}"
									>
										<span>{opt.label}</span>
										{#if sortBy === opt.k}<Check class="h-3.5 w-3.5 text-primary" />{/if}
									</button>
								{/each}
							</div>
						{/if}
					</div>
					<button
						onclick={() => (filtersOpen = true)}
						class="relative flex shrink-0 items-center gap-1.5 rounded-full border border-transparent bg-accent/40 px-3 py-2 text-xs hover:bg-accent"
						use:tooltip={'Filters'}
						aria-label="Filters"
					>
						<SlidersHorizontal class="h-3.5 w-3.5" />
						<span class="hidden sm:inline">Filters</span>
						{#if activeFilterCount > 0}
							<span class="ml-0.5 rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">{activeFilterCount}</span>
						{/if}
					</button>
				</div>
			</div>

			<!-- Results -->
			<div class="flex-1 overflow-y-auto px-4 py-3 sm:px-6">
				{#if errorMsg}
					<div class="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
						<AlertTriangle class="h-4 w-4 shrink-0" />
						<span>{errorMsg}</span>
					</div>
				{/if}

				{#if loading && cards.length === 0}
					<div class="flex flex-col items-center justify-center py-16 text-muted-foreground">
						<Loader2 class="mb-2 h-6 w-6 animate-spin" />
						<p class="text-sm">Searching CHUB…</p>
					</div>
				{:else if cards.length === 0 && !errorMsg}
					<EmptyState
						icon={Globe}
						title="No results"
						description="Try a different search or toggle NSFW."
					/>
				{:else if visibleCards.length === 0}
					<div class="flex flex-col items-center justify-center py-16 text-muted-foreground">
						<SlidersHorizontal class="mb-2 h-8 w-8 opacity-40" />
						<p class="text-sm">All {cards.length} results are hidden by your filters.</p>
						<button
							onclick={() => { nsfwMode = 'hide'; ownedMode = 'show'; }}
							class="mt-2 rounded-lg border border-border px-3 py-1 text-xs hover:bg-accent"
						>Show all</button>
					</div>
				{:else}
					<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
						{#each visibleCards as card (card.fullPath)}
							<div class="group flex flex-col overflow-hidden rounded-xl border border-border bg-accent/20 transition-colors hover:bg-accent/40">
								<div class="relative aspect-[3/4] overflow-hidden bg-muted">
									{#if card.avatar_url}
										<img
											src={card.avatar_url}
											alt={card.name}
											loading="lazy"
											referrerpolicy="no-referrer"
											class="h-full w-full object-cover {card.nsfw && !nsfwParam ? 'blur-xl' : ''}"
										/>
									{:else}
										<div class="flex h-full w-full items-center justify-center text-muted-foreground">
											{#if activeType === 'character'}<Users class="h-8 w-8 opacity-40" />{:else}<BookOpen class="h-8 w-8 opacity-40" />{/if}
										</div>
									{/if}
									{#if card.nsfw}
										<span class="absolute left-1.5 top-1.5 rounded bg-destructive/80 px-1.5 py-0.5 text-[10px] font-bold uppercase text-destructive-foreground">NSFW</span>
									{/if}
									<button
										onclick={() => openPreview(card)}
										class="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/0 text-transparent transition-all hover:bg-black/55 hover:text-white"
										aria-label="Preview {card.name}"
									>
										<span class="opacity-0 text-xs font-semibold uppercase tracking-wide transition-opacity group-hover:opacity-100">Preview</span>
									</button>
									<button
										onclick={(e) => { e.stopPropagation(); attemptImport(card); }}
										disabled={importingPath !== null}
										class="absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded-full bg-primary/90 px-2.5 py-1 text-[11px] font-semibold text-primary-foreground opacity-0 shadow transition-opacity hover:bg-primary group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-50"
										aria-label="Import {card.name}"
									>
										{#if importingPath === card.fullPath}
											<Loader2 class="h-3 w-3 animate-spin" />
										{:else}
											<Download class="h-3 w-3" />
										{/if}
										Import
									</button>
									{#if dupFor(card)}
										{@const d = dupFor(card)!}
										{@const upd = hasUpdate(card)}
										<span
											class="absolute right-1.5 top-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase text-white shadow {upd ? 'bg-warning/90' : 'bg-success/90'}"
											use:tooltip={upd ? `Update available on CHUB (last activity ${card.lastActivityAt ? new Date(card.lastActivityAt).toLocaleDateString() : 'newer'})` : d.exact ? `Already imported: ${d.exact.name}` : `You have a ${activeType} named “${d.byName[0].name}”`}
										>{upd ? 'Update' : d.exact ? 'Owned' : 'Match'}</span>
									{/if}
								</div>
								<div class="flex flex-col gap-1 p-2.5">
									<div class="truncate text-sm font-semibold" use:tooltip={card.name}>{card.name}</div>
									<div class="truncate text-xs text-muted-foreground" use:tooltip={card.creator}>by {card.creator}</div>
									{#if card.tagline || card.description}
										<p class="line-clamp-2 text-xs text-muted-foreground/90">{card.tagline || card.description}</p>
									{/if}
									<div class="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
										<span use:tooltip={'Downloads'}>⬇ {fmtCount(card.starCount)}</span>
										{#if card.nFavorites}<span use:tooltip={'Favourites'}>★ {fmtCount(card.nFavorites)}</span>{/if}
										{#if card.nTokens}<span use:tooltip={'Tokens'}>{fmtCount(card.nTokens)}t</span>{/if}
									</div>
								</div>
							</div>
						{/each}
					</div>

					<!-- Infinite scroll sentinel -->
					<div bind:this={sentinel} class="mt-2 flex justify-center py-4">
						{#if loadingMore}
							<Loader2 class="h-5 w-5 animate-spin text-muted-foreground" />
						{:else if !hasMore && cards.length > 0}
							<p class="text-xs text-muted-foreground">{visibleCards.length} result{visibleCards.length === 1 ? '' : 's'}</p>
						{/if}
					</div>
				{/if}
			</div>

			<!-- Preview overlay moved out of the main panel — see layered modal below. -->
		</div>

		{#if previewModal.visible}
			<!-- Layered preview modal — its own backdrop + swipe-down gestures so dismissing returns to the browser exactly where it was. -->
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="fixed inset-0 z-[70] flex items-end justify-center p-0 sm:items-center sm:p-4 bg-black/60 {previewModal.closing ? 'backdrop-exit' : 'backdrop-enter'}"
			>
				<div class="absolute inset-0" onclick={closePreview}></div>
				<div
					class="relative z-10 flex h-[90dvh] w-full max-w-3xl flex-col rounded-t-2xl border border-border bg-card shadow-xl sm:h-auto sm:max-h-[90vh] sm:rounded-xl {previewModal.closing ? 'modal-exit' : 'modal-enter'}"
					ontouchstart={previewGestures.handlers.onTouchStart}
					ontouchmove={previewGestures.handlers.onTouchMove}
					ontouchend={previewGestures.handlers.onTouchEnd}
					style={previewGestures.panelStyle}
				>
					<div class="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6">
						<button
							onclick={closePreview}
							class="flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
							aria-label="Close preview"
						>
							<ArrowLeft class="h-4 w-4" /> Back
						</button>
						<div class="flex items-center gap-2">
							{#if previewCard}
								<IconButton
									icon={Link2}
									ariaLabel="Link to existing"
									title={`Link this CHUB card to an existing ${activeType} in your library`}
									disabled={importingPath !== null}
									onclick={() => openLinkPicker(previewCard!)}
								/>
								<Button
									variant="primary"
									size="sm"
									icon={importingPath === previewCard.fullPath ? undefined : Download}
									loading={importingPath === previewCard.fullPath}
									onclick={() => attemptImport(previewCard!)}
									disabled={importingPath !== null}
								>
									{importingPath === previewCard.fullPath ? 'Importing…' : 'Import'}
								</Button>
							{/if}
						</div>
					</div>

					<div class="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
						{#if previewLoading}
							<div class="flex flex-col items-center justify-center py-16 text-muted-foreground">
								<Loader2 class="mb-2 h-6 w-6 animate-spin" />
								<p class="text-sm">Loading preview…</p>
							</div>
						{:else if previewError}
							<div class="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
								<AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" />
								<span>{previewError}</span>
							</div>
						{:else if preview}
							{@const previewImg = previewCard?.avatar_url || previewCard?.max_res_url || preview.avatar_url || preview.max_res_url}
							<div class="flex flex-col gap-4 sm:flex-row sm:gap-6">
								<div class="shrink-0 sm:w-48">
									{#if previewImg}
										<button
											type="button"
											onclick={() => (enlargedImage = previewImg)}
											class="block w-full cursor-zoom-in overflow-hidden rounded-lg border border-border"
											aria-label="View full image"
										>
											<img
												src={previewImg}
												alt={preview.name}
												referrerpolicy="no-referrer"
												class="w-full object-cover {preview.nsfw && !nsfwParam ? 'blur-xl' : ''}"
											/>
										</button>
									{:else}
										<div class="flex aspect-[3/4] w-full items-center justify-center rounded-lg border border-border bg-accent/30 text-muted-foreground">
											{#if preview.type === 'character'}<Users class="h-10 w-10 opacity-40" />{:else}<BookOpen class="h-10 w-10 opacity-40" />{/if}
										</div>
									{/if}
									<div class="mt-3 space-y-1 text-xs text-muted-foreground">
										<div>by <span class="text-foreground">{preview.creator}</span></div>
										<div>⬇ {fmtCount(preview.starCount)} downloads</div>
										{#if preview.nFavorites}<div>★ {fmtCount(preview.nFavorites)} favourites</div>{/if}
										{#if preview.nTokens}<div>{fmtCount(preview.nTokens)} tokens</div>{/if}
										{#if preview.rating > 0}<div>★ {preview.rating.toFixed(1)} ({preview.ratingCount})</div>{/if}
										{#if preview.lastActivityAt}<div>Updated {new Date(preview.lastActivityAt).toLocaleDateString()}</div>{/if}
									</div>
								</div>

								<div class="min-w-0 flex-1 space-y-4">
									<div>
										<h3 class="text-xl font-bold">{preview.name}</h3>
										{#if preview.tagline}
											<p class="mt-1 text-sm italic text-muted-foreground">{preview.tagline}</p>
										{/if}
										{#if preview.topics?.length || preview.tags?.length}
											<div class="mt-2 flex flex-wrap gap-1">
												{#each [...(preview.topics ?? []), ...(preview.tags ?? [])].slice(0, 20) as tag}
													<span class="rounded-full bg-accent px-2 py-0.5 text-[11px] text-muted-foreground">{tag}</span>
												{/each}
											</div>
										{/if}
									</div>

									{#if preview.description}
										<section>
											<h4 class="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Description</h4>
											<p class="whitespace-pre-wrap text-sm text-foreground/90">{preview.description}</p>
										</section>
									{/if}

									{#if preview.type === 'character'}
										{#if preview.first_message}
											<section>
												<h4 class="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">First message</h4>
												<p class="whitespace-pre-wrap rounded-lg border border-border bg-accent/20 p-3 text-sm">{preview.first_message}</p>
											</section>
										{/if}
										{#if preview.alternate_greetings?.length}
											<section>
												<h4 class="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Alternate greetings ({preview.alternate_greetings.length})</h4>
												<details class="text-sm">
													<summary class="cursor-pointer text-muted-foreground hover:text-foreground">Show</summary>
													<div class="mt-2 space-y-2">
														{#each preview.alternate_greetings as g, i}
															<div class="rounded-lg border border-border bg-accent/20 p-2">
																<div class="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">#{i + 1}</div>
																<p class="whitespace-pre-wrap text-sm">{g}</p>
															</div>
														{/each}
													</div>
												</details>
											</section>
										{/if}
										{#if preview.personality}
											<section>
												<h4 class="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Personality</h4>
												<p class="whitespace-pre-wrap text-sm text-foreground/90">{preview.personality}</p>
											</section>
										{/if}
										{#if preview.scenario}
											<section>
												<h4 class="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Scenario</h4>
												<p class="whitespace-pre-wrap text-sm text-foreground/90">{preview.scenario}</p>
											</section>
										{/if}
										{#if preview.example_dialogs}
											<section>
												<h4 class="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Example dialogue</h4>
												<p class="whitespace-pre-wrap rounded-lg border border-border bg-accent/20 p-3 text-sm">{preview.example_dialogs}</p>
											</section>
										{/if}
										{#if preview.system_prompt}
											<section>
												<h4 class="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">System prompt</h4>
												<p class="whitespace-pre-wrap text-sm text-foreground/90">{preview.system_prompt}</p>
											</section>
										{/if}
									{:else}
										<section>
											<h4 class="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
												Entries ({preview.lorebookEntryCount})
											</h4>
											{#if preview.lorebookEntries.length === 0}
												<p class="text-sm text-muted-foreground">No entries to preview.</p>
											{:else}
												<div class="space-y-2">
													{#each preview.lorebookEntries as entry, i}
														<div class="rounded-lg border border-border bg-accent/20 p-2">
															<div class="mb-1 flex flex-wrap items-center gap-1 text-[11px]">
																<span class="font-semibold uppercase text-muted-foreground">#{i + 1}</span>
																{#each entry.keys.slice(0, 6) as k}
																	<span class="rounded bg-accent px-1.5 py-0.5 text-foreground/80">{k}</span>
																{/each}
															</div>
															<p class="whitespace-pre-wrap text-sm">{entry.content}{entry.content.length >= 500 ? '…' : ''}</p>
														</div>
													{/each}
													{#if preview.lorebookEntryCount > preview.lorebookEntries.length}
														<p class="text-center text-xs text-muted-foreground">
															+{preview.lorebookEntryCount - preview.lorebookEntries.length} more on import
														</p>
													{/if}
												</div>
											{/if}
										</section>
									{/if}
								</div>
							</div>
						{/if}
					</div>
				</div>
			</div>
		{/if}

		{#if filtersOpen}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="absolute inset-0 z-30 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
				onclick={() => (filtersOpen = false)}
			>
				<div
					class="relative flex w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-xl sm:rounded-xl"
					style="max-height: min(90vh, 720px);"
					onclick={(e) => e.stopPropagation()}
				>
					<div class="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
						<div class="flex items-center gap-2 min-w-0">
							<SlidersHorizontal class="h-4 w-4 text-primary" />
							<h3 class="truncate text-base font-semibold">Filters</h3>
							{#if activeFilterCount > 0}
								<span class="rounded-full bg-primary px-2 text-[11px] font-bold text-primary-foreground">{activeFilterCount}</span>
							{/if}
						</div>
						<div class="flex items-center gap-1">
							{#if activeFilterCount > 0}
								<button
									onclick={clearAllFilters}
									class="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
								>Clear all</button>
							{/if}
							<button
								onclick={() => (filtersOpen = false)}
								class="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
								aria-label="Close"
							>
								<X class="h-4 w-4" />
							</button>
						</div>
					</div>

					<div class="flex-1 space-y-5 overflow-y-auto px-4 py-4">
						<!-- Library three-state switches -->
						<div>
							<div class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Library</div>
							<div class="flex flex-col gap-2">
								{#each [
									{ key: 'nsfw' as const, label: 'NSFW', desc: 'Adult content.', mode: nsfwMode },
									{ key: 'owned' as const, label: 'Owned', desc: 'Linked to your library.', mode: ownedMode },
								] as row (row.key)}
									<div class="flex flex-col gap-2 rounded-lg border border-border bg-background/50 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
										<div class="flex min-w-0 flex-col">
											<span class="text-sm font-medium">{row.label}</span>
											<span class="text-xs text-muted-foreground">{row.desc}</span>
										</div>
										<div class="grid w-full shrink-0 grid-cols-3 overflow-hidden rounded-lg border border-border bg-background text-xs sm:w-auto" role="radiogroup" aria-label="{row.label} mode">
											{#each ['show', 'hide', 'only'] as const as m (m)}
												<button
													type="button"
													role="radio"
													aria-checked={row.mode === m}
													onclick={() => setSwitch(row.key, m)}
													class="px-3 py-2 font-medium capitalize transition-colors first:border-r last:border-l border-border {row.mode === m ? (m === 'only' ? 'bg-primary text-primary-foreground' : m === 'hide' ? 'bg-destructive/15 text-destructive' : 'bg-accent text-foreground') : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground'}"
												>{m}</button>
											{/each}
										</div>
									</div>
								{/each}
							</div>
						</div>

						<!-- Tags include -->
						<div>
							<label class="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground" for="chub-tags-include">Include tags</label>
							{#if tagsInclude.length > 0}
								<div class="mb-1.5 flex flex-wrap gap-1">
									{#each tagsInclude as t (t)}
										<span class="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-xs text-success">
											{t}
											<button onclick={() => removeIncludeTag(t)} class="rounded-full hover:bg-success/30" aria-label="Remove {t}">
												<X class="h-3 w-3" />
											</button>
										</span>
									{/each}
								</div>
							{/if}
							<form
								onsubmit={(e) => { e.preventDefault(); if (tagInputInclude.trim()) { addIncludeTag(tagInputInclude); tagInputInclude = ''; } }}
								class="flex gap-1.5"
							>
								<input
									id="chub-tags-include"
									type="text"
									bind:value={tagInputInclude}
									placeholder="Type a tag and press Enter…"
									class="flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
								/>
								<button type="submit" class="rounded-lg bg-primary px-2.5 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">Add</button>
							</form>
						</div>

						<!-- Tags exclude -->
						<div>
							<label class="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground" for="chub-tags-exclude">Exclude tags</label>
							{#if tagsExclude.length > 0}
								<div class="mb-1.5 flex flex-wrap gap-1">
									{#each tagsExclude as t (t)}
										<span class="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-xs text-destructive">
											{t}
											<button onclick={() => removeExcludeTag(t)} class="rounded-full hover:bg-destructive/30" aria-label="Remove {t}">
												<X class="h-3 w-3" />
											</button>
										</span>
									{/each}
								</div>
							{/if}
							<form
								onsubmit={(e) => { e.preventDefault(); if (tagInputExclude.trim()) { addExcludeTag(tagInputExclude); tagInputExclude = ''; } }}
								class="flex gap-1.5"
							>
								<input
									id="chub-tags-exclude"
									type="text"
									bind:value={tagInputExclude}
									placeholder="Type a tag and press Enter…"
									class="flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
								/>
								<button type="submit" class="rounded-lg bg-destructive px-2.5 py-1.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90">Add</button>
							</form>
						</div>

						<!-- Tag suggestions -->
						{#if tagSuggestions.length > 0}
							<div>
								<div class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Suggestions <span class="ml-1 text-[10px] font-normal normal-case opacity-70">(from results)</span></div>
								<div class="flex flex-wrap gap-1">
									{#each tagSuggestions as t (t)}
										<button
											onclick={() => addIncludeTag(t)}
											use:tooltip={'Click to include · Shift+click to exclude'}
											onmousedown={(e) => { if (e.shiftKey) { e.preventDefault(); addExcludeTag(t); } }}
											class="inline-flex items-center gap-1 rounded-full border border-border bg-accent/30 px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
										>
											<Plus class="h-3 w-3" /> {t}
										</button>
									{/each}
								</div>
							</div>
						{/if}

						<!-- Min tokens -->
						{#if activeType === 'character'}
							<div>
								<label class="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground" for="chub-min-tokens">
									Minimum tokens <span class="ml-1 text-[10px] font-normal normal-case opacity-70">(0 = no limit, default 50)</span>
								</label>
								<input
									id="chub-min-tokens"
									type="number"
									min="0"
									max="100000"
									step="50"
									bind:value={minTokens}
									class="w-32 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
								/>
							</div>
						{/if}

						<!-- Include forks -->
						<label class="flex cursor-pointer items-center gap-2 text-sm">
							<input type="checkbox" bind:checked={includeForks} class="h-4 w-4 accent-primary" />
							<span>Include forks</span>
						</label>
					</div>

					<div class="flex justify-end gap-2 border-t border-border px-4 py-3">
						<button
							onclick={() => (filtersOpen = false)}
							class="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
						>Done</button>
					</div>
				</div>
			</div>
		{/if}

		{#if linkPicker}
			{@const lp = linkPicker}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
				onclick={() => closeLinkPicker()}
			>
				<div
					class="relative flex w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-xl sm:rounded-xl"
					style="max-height: min(85vh, 640px);"
					onclick={(e) => e.stopPropagation()}
				>
					<div class="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
						<div class="min-w-0">
							<h3 class="truncate text-base font-semibold">Link to existing {activeType}</h3>
							<p class="truncate text-xs text-muted-foreground">Mark a local {activeType} as the same as <span class="text-foreground">{lp.card.name}</span></p>
						</div>
						<button
							onclick={() => closeLinkPicker()}
							class="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
							aria-label="Close"
						>
							<X class="h-4 w-4" />
						</button>
					</div>

					<div class="border-b border-border px-4 py-2">
						<div class="relative">
							<Search class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
							<input
								type="text"
								bind:value={linkQuery}
								placeholder="Filter by name…"
								class="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
							/>
						</div>
					</div>

					<div class="flex-1 overflow-y-auto">
						{#if filteredCandidates.length === 0}
							<p class="px-4 py-8 text-center text-sm text-muted-foreground">
								{#if linkQuery.trim()}No matching {activeType}s.{:else}Your library is empty.{/if}
							</p>
						{:else}
							<ul class="divide-y divide-border">
								{#each filteredCandidates as cand (cand.id)}
									<li>
										<button
											onclick={() => linkTo(cand.id, cand.name)}
											disabled={linking}
											class="flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
										>
											{#if activeType === 'character'}
												{#if cand.avatarPath}
													<img
														src={cand.avatarPath}
														alt=""
														class="h-9 w-9 shrink-0 rounded-full border border-border object-cover"
													/>
												{:else}
													<div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-accent/30 text-muted-foreground">
														<Users class="h-4 w-4 opacity-50" />
													</div>
												{/if}
											{:else}
												<div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-accent/30 text-muted-foreground">
													<BookOpen class="h-4 w-4 opacity-50" />
												</div>
											{/if}
											<span class="min-w-0 flex-1 truncate text-sm font-medium">{cand.name}</span>
											<Link2 class="h-4 w-4 shrink-0 text-muted-foreground" />
										</button>
									</li>
								{/each}
							</ul>
						{/if}
					</div>

					<div class="border-t border-border px-4 py-2 text-right">
						<button
							onclick={() => closeLinkPicker()}
							class="rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent"
						>
							Cancel
						</button>
					</div>
				</div>
			</div>
		{/if}

		{#if dupConfirm}
			{@const dc = dupConfirm}
			{@const existingId = dc.result.exact?.id ?? dc.result.byName[0]?.id}
			{@const existingName = dc.result.exact?.name ?? dc.result.byName[0]?.name ?? dc.card.name}
			{@const upd = hasUpdate(dc.card)}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="absolute inset-0 z-30 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
				onclick={() => (dupConfirm = null)}
			>
				<div
					class="relative w-full max-w-md rounded-t-2xl border border-border bg-card p-5 shadow-xl sm:rounded-xl"
					onclick={(e) => e.stopPropagation()}
				>
					<h3 class="mb-1 text-base font-semibold">
						{upd ? 'Update available' : 'Already in your library'}
					</h3>
					<p class="mb-4 text-sm text-muted-foreground">
						{#if upd}
							<span class="font-medium text-foreground">{existingName}</span> has changed on CHUB since you imported it.
						{:else if dc.result.exact}
							You imported <span class="font-medium text-foreground">{existingName}</span> from CHUB before.
						{:else}
							You already have a {activeType} named
							<span class="font-medium text-foreground">{existingName}</span>.
						{/if}
					</p>
					<div class="flex flex-col gap-2">
						{#if existingId != null}
							<button
								onclick={() => { const c = dc.card; const id = existingId!; dupConfirm = null; void replaceImport(c, id); }}
								disabled={importingPath !== null}
								class="rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50 {upd ? 'bg-warning text-warning-foreground hover:bg-warning/90' : 'border border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20'}"
							>
								{upd ? 'Update from CHUB' : 'Replace existing'}
								{#if activeType === 'character'}
									<span class="ml-1 text-[11px] opacity-80">(deletes its chats)</span>
								{:else}
									<span class="ml-1 text-[11px] opacity-80">(deletes its entries)</span>
								{/if}
							</button>
						{/if}
						<button
							onclick={() => { const c = dc.card; dupConfirm = null; void importCard(c); }}
							disabled={importingPath !== null}
							class="rounded-lg {upd ? 'border border-border hover:bg-accent text-foreground' : 'bg-primary text-primary-foreground hover:bg-primary/90'} px-3 py-2 text-sm font-medium disabled:opacity-50"
						>
							Import as a new copy
						</button>
						<button
							onclick={() => (dupConfirm = null)}
							class="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent"
						>
							Cancel
						</button>
					</div>
				</div>
			</div>
		{/if}
	</div>
	</div>
	<ImageModal src={enlargedImage} onclose={() => (enlargedImage = null)} />
{/if}
