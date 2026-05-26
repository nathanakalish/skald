<script lang="ts">
	import { createModalState } from '$lib/modal.svelte.js';
	import { X, ChevronLeft, ChevronRight, RefreshCw, Trash2, Download, Loader2, Info } from 'lucide-svelte';
	import { tooltip } from '$lib/tooltip.js';

	// Single unified lightbox. Two modes:
	//   - Simple: pass `src` (and optionally `alt`). Just shows the image with
	//     a close button.
	//   - Feature-rich: pass `images[]` plus any of the action handlers
	//     (onregenerate, ondelete, onactivate). Each handler unlocks the
	//     corresponding toolbar button; nav arrows + counter render when the
	//     list has more than one image.
	//
	// Action buttons only appear when their handler is provided, so consumers
	// that don't need them (avatar previews, inline image previews) end up
	// with the same minimal chrome the old `ImageModal` had.

	export interface LightboxImage {
		id: number | string;
		// Base URL used for display + download. The full-resolution version is
		// fetched by appending `?original=1` when the URL points at the local
		// image cache.
		src: string;
		alt?: string;
		prompt?: string | null;
		isActive?: boolean;
		downloadName?: string;
	}

	interface Props {
		// Simple mode
		src?: string | null;
		alt?: string;
		// Multi-image mode
		images?: LightboxImage[];
		// Open marker. The lightbox is visible when either `src` is set or
		// `images` has at least one entry.
		onclose: () => void;
		// Optional handlers. Each one toggles its toolbar button.
		onactivate?: (imageId: LightboxImage['id']) => void;
		onregenerate?: () => void;
		ondelete?: (imageId: LightboxImage['id']) => void;
		regenerating?: boolean;
	}

	let {
		src = null,
		alt = '',
		images,
		onclose,
		onactivate,
		onregenerate,
		ondelete,
		regenerating = false
	}: Props = $props();

	// Normalize the two input shapes into a single array we render from.
	const items = $derived<LightboxImage[]>(
		images && images.length > 0
			? images
			: src
				? [{ id: 'single', src, alt }]
				: []
	);

	const modal = createModalState(() => items.length > 0);

	// Append `?original=1` to cached-image URLs so the lightbox always shows
	// the un-optimized version. Other URLs are passed through.
	function fullRes(url: string): string {
		if (!url) return url;
		if (url.includes('?')) return url;
		if (url.includes('/api/images/cache/')) return `${url}?original=1`;
		return url;
	}

	// Which item is currently displayed. Defaults to the `isActive` one (or the
	// first) when the lightbox opens, and gets reset when the source changes.
	let viewingId = $state<LightboxImage['id'] | null>(null);
	$effect(() => {
		if (items.length === 0) { viewingId = null; return; }
		if (viewingId === null || !items.some((im) => im.id === viewingId)) {
			viewingId = items.find((im) => im.isActive)?.id ?? items[0].id;
		}
	});

	const currentIdx = $derived(items.findIndex((im) => im.id === viewingId));
	const current = $derived(currentIdx >= 0 ? items[currentIdx] : null);
	const total = $derived(items.length);

	// Captions can be very long (character description + scene text on
	// generated images), so they're hidden by default and toggled via the
	// Info button in the toolbar.
	let showPrompt = $state(false);
	$effect(() => {
		// Reset when switching images so the next one starts collapsed too.
		viewingId;
		showPrompt = false;
	});

	// Loading skeleton while the (full-res) image decodes. Keeps the modal
	// from popping in cold for slow networks.
	let loaded = $state(false);
	$effect(() => {
		viewingId;
		loaded = false;
	});

	function go(delta: number) {
		if (total < 2) return;
		const next = (currentIdx + delta + total) % total;
		const target = items[next];
		viewingId = target.id;
		// Activating swaps which image is shown in the source bubble.
		if (onactivate && !target.isActive) onactivate(target.id);
	}

	function onKey(e: KeyboardEvent) {
		if (items.length === 0) return;
		if (e.key === 'Escape') onclose();
		else if (e.key === 'ArrowLeft') go(-1);
		else if (e.key === 'ArrowRight') go(1);
	}

	function downloadName(image: LightboxImage): string {
		if (image.downloadName) return image.downloadName;
		// Fall back to the trailing filename from the URL.
		const m = image.src.match(/([^/?]+)(?:\?|$)/);
		return m?.[1] ?? 'image';
	}
</script>

<svelte:window onkeydown={onKey} />

{#if modal.visible && current}
	<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events a11y_interactive_supports_focus -->
	<div
		class="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 sm:p-8 {modal.closing ? 'backdrop-exit' : 'backdrop-enter'}"
		role="dialog" aria-modal="true" aria-label="Image preview" tabindex="-1"
		onclick={onclose}
	>
		<button
			type="button"
			onclick={(e) => { e.stopPropagation(); onclose(); }}
			aria-label="Close"
			class="absolute z-10 rounded-full bg-black/50 p-2 text-white/90 backdrop-blur-sm transition hover:bg-black/70 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
			style="top: max(1rem, calc(var(--safe-area-top) + 0.25rem)); right: max(1rem, calc(var(--safe-area-right) + 0.25rem));"
		>
			<X class="h-5 w-5" />
		</button>

		<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
		<div
			class="relative flex max-h-full max-w-full flex-col items-center gap-3 {modal.closing ? 'modal-exit' : 'modal-enter'}"
			onclick={(e) => e.stopPropagation()}
		>
			<div class="relative flex items-center justify-center">
				{#if total > 1}
					<button
						type="button"
						onclick={() => go(-1)}
						aria-label="Previous image"
						class="absolute left-2 z-10 rounded-full bg-black/50 p-2 text-white/90 backdrop-blur-sm transition hover:bg-black/70 hover:text-white"
					>
						<ChevronLeft class="h-5 w-5" />
					</button>
				{/if}
				<div class="relative">
					{#if !loaded}
						<div class="absolute inset-0 m-auto h-32 w-32 skeleton-pulse rounded-lg" aria-hidden="true"></div>
					{/if}
					<img
						src={fullRes(current.src)}
						alt={current.alt ?? current.prompt ?? alt ?? 'Image'}
						decoding="async"
						onload={() => (loaded = true)}
						class="max-h-[80vh] max-w-full rounded-lg object-contain shadow-2xl transition-opacity duration-200 {loaded ? 'opacity-100' : 'opacity-0'}"
					/>
					{#if regenerating}
						<div class="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-black/55">
							<div class="flex items-center gap-2 rounded-full bg-black/70 px-4 py-2 text-sm text-white backdrop-blur-sm">
								<Loader2 class="h-5 w-5 animate-spin" />
								<span>Generating…</span>
							</div>
						</div>
					{/if}
				</div>
				{#if total > 1}
					<button
						type="button"
						onclick={() => go(1)}
						aria-label="Next image"
						class="absolute right-2 z-10 rounded-full bg-black/50 p-2 text-white/90 backdrop-blur-sm transition hover:bg-black/70 hover:text-white"
					>
						<ChevronRight class="h-5 w-5" />
					</button>
				{/if}
			</div>

			{#if current.prompt && showPrompt}
				<div class="max-h-32 max-w-2xl overflow-y-auto whitespace-pre-wrap rounded-md bg-black/60 px-3 py-2 text-center text-xs text-white/80 backdrop-blur-sm">
					{current.prompt}
				</div>
			{/if}

			{#if total > 1 || current.prompt || onregenerate || ondelete}
				<div class="flex items-center gap-2 rounded-full bg-black/50 px-2 py-1 backdrop-blur-sm">
					{#if total > 1}
						<span class="px-2 text-xs tabular-nums text-white/80">{currentIdx + 1}/{total}</span>
						<span class="h-4 w-px bg-white/20"></span>
					{/if}
					{#if current.prompt}
						<button
							type="button"
							onclick={() => { showPrompt = !showPrompt; }}
							class="flex h-8 w-8 items-center justify-center rounded-full text-white/90 transition hover:bg-white/10 hover:text-white {showPrompt ? 'bg-white/10' : ''}"
							use:tooltip={showPrompt ? 'Hide prompt' : 'Show prompt'}
							aria-label={showPrompt ? 'Hide prompt' : 'Show prompt'}
							aria-pressed={showPrompt}
						>
							<Info class="h-4 w-4" />
						</button>
					{/if}
					{#if onregenerate || ondelete}
						<a
							href={fullRes(current.src)}
							download={downloadName(current)}
							class="flex h-8 w-8 items-center justify-center rounded-full text-white/90 transition hover:bg-white/10 hover:text-white"
							use:tooltip={'Download'}
							aria-label="Download image"
						>
							<Download class="h-4 w-4" />
						</a>
					{/if}
					{#if onregenerate}
						<button
							type="button"
							onclick={onregenerate}
							disabled={regenerating}
							class="flex h-8 w-8 items-center justify-center rounded-full text-white/90 transition hover:bg-white/10 hover:text-white disabled:opacity-40 disabled:pointer-events-none"
							use:tooltip={'Regenerate'}
							aria-label="Regenerate image"
						>
							{#if regenerating}
								<Loader2 class="h-4 w-4 animate-spin" />
							{:else}
								<RefreshCw class="h-4 w-4" />
							{/if}
						</button>
					{/if}
					{#if ondelete}
						<button
							type="button"
							onclick={() => current && ondelete(current.id)}
							class="flex h-8 w-8 items-center justify-center rounded-full text-red-300 transition hover:bg-red-500/20 hover:text-red-200"
							use:tooltip={'Delete'}
							aria-label="Delete image"
						>
							<Trash2 class="h-4 w-4" />
						</button>
					{/if}
				</div>
			{/if}
		</div>
	</div>
{/if}
