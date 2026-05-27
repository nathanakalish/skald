<!--
	Multi-line textarea with soft character limit. Typing past `limit` is
	allowed; we only flip the border to the destructive theme color so the
	user sees they've gone over.

	Previously this rendered a transparent textarea with a coloured overlay
	div mirroring the text so the overflow portion could be tinted red. That
	cute trick caused cursor-position bugs: clicks land on the textarea but
	the user sees the overlay's text layout, and the two wrap subtly
	differently (textarea word-break vs the div's break-words, plus baseline
	differences between native textarea rendering and a regular block). The
	caret would end up in the wrong spot after a tap or while typing past
	soft wraps. Worth more than the red-text affordance — gone.

	Honours the global `limitsState.enabled` flag — when off, even the border
	highlight goes away and this is a plain `<textarea>`.

	Exposes the inner element via the bindable `element` prop for consumers
	that need direct DOM access (autosize, focus management).
-->
<script lang="ts">
	import type { HTMLTextareaAttributes } from 'svelte/elements';
	import { limitsState } from '$lib/limits.svelte.js';

	interface Props extends Omit<HTMLTextareaAttributes, 'value' | 'maxlength'> {
		value: string;
		/** Soft cap. Typing past it is allowed but the border turns red. */
		limit: number;
		/** Optional bindable handle for the inner <textarea> element. */
		element?: HTMLTextAreaElement | undefined;
	}

	let {
		value = $bindable(''),
		limit,
		element = $bindable(undefined),
		class: className = '',
		...rest
	}: Props = $props();

	let textareaEl: HTMLTextAreaElement | undefined = $state();

	$effect(() => {
		element = textareaEl;
	});

	const isOver = $derived(limitsState.enabled && (value ?? '').length > limit);
</script>

<textarea
	bind:this={textareaEl}
	bind:value
	{...rest}
	class="{className} {isOver ? 'limited-over' : ''}"
></textarea>

<style>
	:global(.limited-over) {
		border-color: var(--destructive) !important;
	}
	:global(.limited-over:focus),
	:global(.limited-over:focus-visible) {
		--color-ring: var(--destructive) !important;
		--tw-ring-color: var(--destructive) !important;
		outline-color: var(--destructive) !important;
		box-shadow: 0 0 0 2px var(--destructive) !important;
	}
</style>
