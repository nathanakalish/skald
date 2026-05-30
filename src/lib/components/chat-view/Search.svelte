<script lang="ts">
	import { Search, X } from 'lucide-svelte';
	import { tick } from 'svelte';

	// Message-search overlay. Floats below the absolute chat header so
	// messages keep scrolling underneath. Query is two-way bound so the
	// orchestrator can compute its own `matches` set (deriving from query
	// + messageList) and pass back the count for display — keeps this
	// component free of any messageList awareness.
	let {
		query = $bindable(''),
		matchCount = 0,
		onClose
	}: {
		query?: string;
		matchCount?: number;
		onClose: () => void;
	} = $props();

	let inputEl: HTMLInputElement | undefined = $state();

	// Auto-focus when the bar mounts. Mount-time tick() gives the DOM a paint
	// before we yank focus, matching the original's behaviour on toggle.
	$effect(() => {
		void tick().then(() => inputEl?.focus());
	});
</script>

<!-- Top offset matches header height: safe-area + 4rem (header min-h-16). -->
<div
	class="pointer-events-auto absolute left-0 right-0 z-[2] flex items-center gap-2 border-b border-border/50 bg-background/95 px-3 py-2 pl-safe pr-safe backdrop-blur-sm md:px-6"
	style="top: calc(max(0.5rem, var(--safe-area-top)) + 4rem);"
>
	<Search class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
	<input
		bind:this={inputEl}
		bind:value={query}
		placeholder="Search in conversation..."
		class="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
		onkeydown={(e) => {
			if (e.key === 'Escape') onClose();
		}}
	/>
	{#if query.trim()}
		<span class="text-xs text-muted-foreground">
			{matchCount}
			{matchCount === 1 ? 'match' : 'matches'}
		</span>
	{/if}
	<button onclick={onClose} class="rounded p-1 text-muted-foreground hover:text-foreground" aria-label="Close search">
		<X class="h-3.5 w-3.5" />
	</button>
</div>
