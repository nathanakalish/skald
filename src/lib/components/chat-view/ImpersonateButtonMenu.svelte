<script lang="ts">
	import { ChevronLeft, ChevronRight, Brain, RefreshCw, Wand2 } from 'lucide-svelte';
	import type { MenuPosition } from '$lib/chat/utils/menuPositioning';
	import type { GuideTarget } from '$lib/chat/state/ui.svelte';

	// One impersonation "swipe" — same shape as ChatView's impersonationSwipes.
	// Defined here so we don't have to drag in the full chatImpersonationSwipes
	// type just to read .guidance / .reasoning.
	type ImpersonationSwipe = {
		guidance?: string | null;
		reasoning?: string | null;
	};

	type Props = {
		open: boolean;
		position: MenuPosition | null;
		swipes: ImpersonationSwipe[];
		swipeIndex: number;
		// Currently-rendered swipe object (parent already $derives this).
		activeSwipe: ImpersonationSwipe | null | undefined;
		// Live reasoning text for an in-flight impersonation — falls back to the
		// activeSwipe's persisted reasoning when no run is active.
		liveReasoning: string;
		isStreaming: boolean;
		onClose: () => void;
		onNavSwipe: (dir: -1 | 1) => void;
		onViewReasoning: (text: string) => void;
		onReImpersonate: (guidance: string | undefined) => void;
		onOpenGuide: (target: GuideTarget, prefill: string) => void;
	};

	let {
		open,
		position,
		swipes,
		swipeIndex,
		activeSwipe,
		liveReasoning,
		isStreaming,
		onClose,
		onNavSwipe,
		onViewReasoning,
		onReImpersonate,
		onOpenGuide
	}: Props = $props();

	const reasoningText = $derived(activeSwipe?.reasoning ?? liveReasoning);
	const hasReasoning = $derived(!!reasoningText);
</script>

{#if open && position}
	<div
		data-impersonate-menu
		class="popup-menu fixed z-[60] w-[220px] rounded-xl border border-border bg-popover py-1 shadow-2xl"
		style="--popup-origin: {position.flipUp ? 'bottom' : 'top'} left; left: {position.x}px; {position.flipUp ? 'bottom' : 'top'}: {position.flipUp ? (position.viewportH - position.y) + 'px' : position.y + 'px'}"
	>
		{#if swipes.length > 1}
			<div class="flex items-center justify-center gap-1 px-3 py-1.5">
				<button
					type="button"
					onclick={() => onNavSwipe(-1)}
					disabled={isStreaming || swipes.length <= 1}
					class="flex h-7 w-7 items-center justify-center rounded text-foreground/60 transition-colors hover:text-foreground disabled:opacity-30"
				>
					<ChevronLeft class="h-4 w-4" />
				</button>
				<span class="text-xs tabular-nums text-muted-foreground">
					{swipeIndex + 1}/{swipes.length}
				</span>
				<button
					type="button"
					onclick={() => onNavSwipe(1)}
					disabled={isStreaming || swipes.length <= 1}
					class="flex h-7 w-7 items-center justify-center rounded text-foreground/60 transition-colors hover:text-foreground disabled:opacity-30"
				>
					<ChevronRight class="h-4 w-4" />
				</button>
			</div>
			<div class="my-0.5 h-px bg-border"></div>
		{/if}

		<button
			type="button"
			onclick={() => { onViewReasoning(reasoningText); onClose(); }}
			disabled={!hasReasoning}
			class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-40 disabled:pointer-events-none"
		>
			<Brain class="h-4 w-4" />View reasoning
		</button>

		<button
			type="button"
			onclick={() => {
				onClose();
				// Reuse the active swipe's guidance for the round so the user
				// doesn't have to re-enter it on every regenerate.
				onReImpersonate(activeSwipe?.guidance ?? undefined);
			}}
			disabled={isStreaming}
			class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-40 disabled:pointer-events-none"
		>
			<RefreshCw class="h-4 w-4" />Re-impersonate
		</button>

		<button
			type="button"
			onclick={() => {
				onClose();
				onOpenGuide({ kind: 'impersonate' }, activeSwipe?.guidance ?? '');
			}}
			disabled={isStreaming}
			class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-40 disabled:pointer-events-none"
		>
			<Wand2 class="h-4 w-4" />Guide impersonation…
		</button>
	</div>
{/if}
