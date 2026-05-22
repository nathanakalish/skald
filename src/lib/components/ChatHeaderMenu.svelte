<script lang="ts">
	import { MoreHorizontal, Info, Search, BookMarked, Loader2, Archive, SlidersHorizontal } from 'lucide-svelte';
	import { tooltip } from '$lib/tooltip.js';

	interface Props {
		open: boolean;
		hasOverrides: boolean;
		hasCompactionSummary: boolean;
		compactingNow: boolean;
		onToggle: (e: MouseEvent) => void;
		onClose: () => void;
		onCharacterInfo: () => void;
		onSearchMessages: () => void;
		onLorebooks: () => void;
		onCompactNow: () => void;
		onViewCompaction: () => void;
		onChatSettings: () => void;
	}

	let {
		open,
		hasOverrides,
		hasCompactionSummary,
		compactingNow,
		onToggle,
		onClose,
		onCharacterInfo,
		onSearchMessages,
		onLorebooks,
		onCompactNow,
		onViewCompaction,
		onChatSettings,
	}: Props = $props();
</script>

<div class="relative" data-header-menu>
	<button
		onclick={onToggle}
		class="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground {hasOverrides ? 'text-primary' : ''}"
		use:tooltip={'More'}
		aria-label="More actions"
	>
		<MoreHorizontal class="h-5 w-5" />
	</button>
	{#if open}
		<div class="popup-menu absolute right-0 top-full z-50 mt-1 w-52 rounded-xl border border-border bg-popover py-1 shadow-2xl" style="--popup-origin: top right; max-height: calc(100dvh - 80px); overflow-y: auto;">
			<button onclick={() => { onClose(); onCharacterInfo(); }} class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-accent">
				<Info class="h-4 w-4" /> Character info
			</button>
			<button onclick={() => { onClose(); onSearchMessages(); }} class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-accent">
				<Search class="h-4 w-4" /> Search messages
			</button>
			<button onclick={() => { onClose(); onLorebooks(); }} class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-accent">
				<BookMarked class="h-4 w-4" /> Lorebooks
			</button>
			<button onclick={() => { onClose(); onCompactNow(); }} disabled={compactingNow} class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-accent disabled:opacity-50 disabled:pointer-events-none">
				{#if compactingNow}
					<Loader2 class="h-4 w-4 animate-spin" /> Compacting…
				{:else}
					<Archive class="h-4 w-4 {hasCompactionSummary ? 'text-primary' : ''}" /> Compact now
				{/if}
			</button>
			<button onclick={() => { onClose(); onViewCompaction(); }} disabled={!hasCompactionSummary} class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-accent disabled:opacity-50 disabled:pointer-events-none">
				<Archive class="h-4 w-4 {hasCompactionSummary ? 'text-primary' : ''}" /> View compaction summary
			</button>
			<button onclick={() => { onClose(); onChatSettings(); }} class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-accent">
				<SlidersHorizontal class="h-4 w-4 {hasOverrides ? 'text-primary' : ''}" /> Chat settings
				{#if hasOverrides}<span class="ml-auto h-1.5 w-1.5 rounded-full bg-primary"></span>{/if}
			</button>
		</div>
	{/if}
</div>
