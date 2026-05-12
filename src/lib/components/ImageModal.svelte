<script lang="ts">
	import { createModalState } from '$lib/modal.svelte.js';
	import { X } from 'lucide-svelte';

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

	let loaded = $state(false);
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
		<button
			type="button"
			onclick={(e) => { e.stopPropagation(); onclose(); }}
			aria-label="Close image preview"
			class="absolute right-4 top-4 z-10 rounded-full bg-black/50 p-2 text-white/90 backdrop-blur-sm transition hover:bg-black/70 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
		>
			<X class="h-5 w-5" />
		</button>
		<div class="relative flex max-h-full max-w-full items-center justify-center">
			{#if !loaded}
				<div class="absolute inset-0 m-auto h-32 w-32 skeleton-pulse rounded-lg" aria-hidden="true"></div>
			{/if}
			<img
				src={fullResSrc}
				{alt}
				decoding="async"
				onload={() => (loaded = true)}
				class="{modal.closing ? 'modal-exit' : 'modal-enter'} max-h-full max-w-full rounded-lg object-contain shadow-2xl transition-opacity duration-200 {loaded ? 'opacity-100' : 'opacity-0'}"
			/>
		</div>
	</div>
{/if}
