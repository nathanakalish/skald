<script lang="ts">
	/**
	 * Standardized header for modals built on top of Modal.svelte. Provides
	 * a title, optional description, and a close button. Pass `actions` for
	 * additional buttons (e.g., import/export icon buttons in the right slot).
	 */
	import type { Snippet } from 'svelte';
	import { X } from 'lucide-svelte';
	import IconButton from './IconButton.svelte';

	interface Props {
		title: string;
		description?: string;
		onclose?: () => void;
		actions?: Snippet;
		/** Hide bottom border for modals that want a flush layout. */
		bordered?: boolean;
	}

	let { title, description, onclose, actions, bordered = true }: Props = $props();
</script>

<div class="flex items-start justify-between gap-3 {bordered ? 'border-b border-border' : ''} -mx-6 -mt-6 mb-4 px-6 py-4">
	<div class="min-w-0 flex-1">
		<h2 class="truncate text-lg font-semibold text-foreground">{title}</h2>
		{#if description}
			<p class="mt-0.5 text-xs text-muted-foreground">{description}</p>
		{/if}
	</div>
	<div class="flex shrink-0 items-center gap-1">
		{#if actions}{@render actions()}{/if}
		{#if onclose}
			<IconButton icon={X} ariaLabel="Close" onclick={onclose} />
		{/if}
	</div>
</div>
