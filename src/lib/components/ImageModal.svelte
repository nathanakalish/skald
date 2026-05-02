<script lang="ts">
	import { createModalState } from '$lib/modal.svelte.js';

	interface Props {
		src: string | null;
		alt?: string;
		onclose: () => void;
	}

	let { src, alt = '', onclose }: Props = $props();

	// For cached images, request the original full-res version when viewing enlarged
	let fullResSrc = $derived(
		src && src.includes('/api/images/cache/') && !src.includes('?original=')
			? src + '?original=1'
			: src
	);

	const modal = createModalState(() => !!src);
</script>

{#if modal.visible}
	<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
	<div
		class="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-8 {modal.closing ? 'backdrop-exit' : 'backdrop-enter'}"
		role="dialog" aria-modal="true" aria-label="Image preview"
		tabindex="-1"
		onclick={onclose}
		onkeydown={(e) => e.key === 'Escape' && onclose()}
	>
		<img
			src={fullResSrc}
			{alt}
			class="{modal.closing ? 'modal-exit' : 'modal-enter'} max-h-full max-w-full rounded-lg object-contain shadow-2xl"
		/>
	</div>
{/if}
