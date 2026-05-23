<script lang="ts">
	// Backwards-compatible wrapper around ImageLightbox for callers that only
	// need a single-image preview with a close button. New callers should use
	// ImageLightbox directly.
	import ImageLightbox from '$lib/components/ImageLightbox.svelte';

	interface Props {
		src: string | null;
		alt?: string;
		onclose: () => void;
	}

	let { src, alt = '', onclose }: Props = $props();
</script>

<ImageLightbox {src} {alt} {onclose} />
