<script lang="ts">
	/**
	 * Standardized footer for modals built on top of Modal.svelte. Renders a
	 * top border + button group aligned to `align` (defaults to end). Pulls
	 * itself flush to the modal's padding using negative margins, matching
	 * ModalHeader.svelte.
	 */
	import type { Snippet } from 'svelte';

	interface Props {
		children: Snippet;
		align?: 'start' | 'end' | 'between';
		/** When true, footer sticks to the bottom on scroll-overflowing modals. */
		sticky?: boolean;
	}

	let { children, align = 'end', sticky = false }: Props = $props();

	const justifyClass = $derived(
		align === 'start' ? 'justify-start' : align === 'between' ? 'justify-between' : 'justify-end'
	);
</script>

<div
	class="-mx-6 -mb-6 mt-6 flex items-center gap-3 border-t border-border bg-card px-6 py-4 {justifyClass} {sticky ? 'sticky bottom-0 rounded-b-xl' : ''}"
>
	{@render children()}
</div>
