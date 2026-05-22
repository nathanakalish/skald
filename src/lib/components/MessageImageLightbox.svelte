<script lang="ts">
	import { createModalState } from '$lib/modal.svelte.js';
	import { X, ChevronLeft, ChevronRight, RefreshCw, Trash2, Download, Loader2, Info } from 'lucide-svelte';
	import { tooltip } from '$lib/tooltip.js';

	interface ImageItem {
		id: number;
		messageId: number;
		filePath: string;
		prompt: string | null;
		model: string | null;
		providerId: number | null;
		isActive: boolean;
		createdAt: string | number | null;
	}

	interface Props {
		messageId: number | null;
		images: ImageItem[];
		regenerating: boolean;
		onclose: () => void;
		onactivate: (imageId: number) => void;
		ondelete: (imageId: number) => void;
		onregenerate: () => void;
	}

	let { messageId, images, regenerating, onclose, onactivate, ondelete, onregenerate }: Props = $props();

	const modal = createModalState(() => messageId !== null);

	// Track which image we're viewing. Default to the active one when the lightbox
	// opens; users can swipe to others via the arrow buttons.
	let viewingId = $state<number | null>(null);
	$effect(() => {
		if (messageId === null) { viewingId = null; return; }
		if (viewingId === null || !images.some((im) => im.id === viewingId)) {
			viewingId = images.find((im) => im.isActive)?.id ?? images[0]?.id ?? null;
		}
	});

	const currentIdx = $derived(images.findIndex((im) => im.id === viewingId));
	const current = $derived(currentIdx >= 0 ? images[currentIdx] : null);
	const total = $derived(images.length);

	// Captions can be very long (character description + scene text), so they're
	// hidden by default and toggled via the Info button in the toolbar.
	let showPrompt = $state(false);
	$effect(() => {
		// Reset when switching images so the next one starts collapsed too.
		viewingId;
		showPrompt = false;
	});

	function go(delta: number) {
		if (total === 0) return;
		const next = (currentIdx + delta + total) % total;
		const target = images[next];
		viewingId = target.id;
		// Activating swaps which swipe is shown in the message bubble.
		if (!target.isActive) onactivate(target.id);
	}

	function onKey(e: KeyboardEvent) {
		if (messageId === null) return;
		if (e.key === 'Escape') onclose();
		else if (e.key === 'ArrowLeft') go(-1);
		else if (e.key === 'ArrowRight') go(1);
	}

	function downloadName(filePath: string) {
		// filePath is just the cache filename — keep the extension, prefix with the message.
		return `message-${messageId ?? 'x'}-${filePath}`;
	}
</script>

<svelte:window onkeydown={onKey} />

{#if modal.visible && current}
	<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events a11y_interactive_supports_focus -->
	<div
		class="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 sm:p-8 {modal.closing ? 'backdrop-exit' : 'backdrop-enter'}"
		role="dialog" aria-modal="true" aria-label="Generated image" tabindex="-1"
		onclick={onclose}
	>
		<button
			type="button"
			onclick={(e) => { e.stopPropagation(); onclose(); }}
			aria-label="Close"
			class="absolute right-4 top-4 z-10 rounded-full bg-black/50 p-2 text-white/90 backdrop-blur-sm transition hover:bg-black/70 hover:text-white"
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
					<img
						src={`/api/images/cache/${current.filePath}?original=1`}
						alt={current.prompt ?? 'Generated image'}
						class="max-h-[80vh] max-w-full rounded-lg object-contain shadow-2xl transition-opacity {regenerating ? 'opacity-40' : ''}"
					/>
					{#if regenerating}
						<div class="pointer-events-none absolute inset-0 flex items-center justify-center">
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
				<a
					href={`/api/images/cache/${current.filePath}?original=1`}
					download={downloadName(current.filePath)}
					class="flex h-8 w-8 items-center justify-center rounded-full text-white/90 transition hover:bg-white/10 hover:text-white"
					use:tooltip={'Download'}
					aria-label="Download image"
				>
					<Download class="h-4 w-4" />
				</a>
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
				<button
					type="button"
					onclick={() => current && ondelete(current.id)}
					class="flex h-8 w-8 items-center justify-center rounded-full text-red-300 transition hover:bg-red-500/20 hover:text-red-200"
					use:tooltip={'Delete'}
					aria-label="Delete image"
				>
					<Trash2 class="h-4 w-4" />
				</button>
			</div>
		</div>
	</div>
{/if}
