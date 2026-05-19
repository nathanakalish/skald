<!--
	Multi-line textarea with soft character limit. Same overlay technique as
	LimitedInput: typing past `limit` is allowed; the excess is rendered in
	the destructive theme color, and the border turns destructive too.

	The textarea has transparent text/background so the overlay's coloured
	text shows through; selection and the caret continue to work natively.

	Honours the global `limitsState.enabled` flag — when off, the overlay and
	border highlight disappear and this behaves like a plain `<textarea>`.

	Exposes the inner element via the bindable `element` prop so consumers
	that need direct access (e.g. autosize, focus management) can wire up.
-->
<script lang="ts">
	import type { HTMLTextareaAttributes } from 'svelte/elements';
	import { limitsState } from '$lib/limits.svelte.js';

	interface Props extends Omit<HTMLTextareaAttributes, 'value' | 'maxlength'> {
		value: string;
		/** Soft cap. Typing past it is allowed but rendered red. */
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
	let overlayEl: HTMLDivElement | undefined = $state();

	$effect(() => {
		element = textareaEl;
	});

	const safe = $derived(value ?? '');
	const limitsOn = $derived(limitsState.enabled);
	const isOver = $derived(limitsOn && safe.length > limit);
	const okText = $derived(isOver ? safe.slice(0, limit) : safe);
	const overflowText = $derived(isOver ? safe.slice(limit) : '');

	function syncScroll() {
		if (overlayEl && textareaEl) {
			overlayEl.scrollTop = textareaEl.scrollTop;
			overlayEl.scrollLeft = textareaEl.scrollLeft;
		}
	}

	$effect(() => {
		void safe;
		queueMicrotask(syncScroll);
	});
</script>

<div class="relative">
	{#if limitsOn}
		<div
			bind:this={overlayEl}
			aria-hidden="true"
			class="{className} limited-overlay pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words"
			style="border-color: transparent !important;"
		>{okText}<span style="color: var(--destructive);">{overflowText}</span>{'​'}</div>
	{/if}
	<textarea
		bind:this={textareaEl}
		bind:value
		{...rest}
		onscroll={syncScroll}
		class="{className} {isOver ? 'limited-over' : ''} {limitsOn ? 'relative' : ''}"
		style={limitsOn
			? 'background-color: transparent !important; color: transparent !important; caret-color: var(--foreground);'
			: ''}
	></textarea>
</div>

<style>
	.limited-overlay {
		scrollbar-width: none;
	}
	.limited-overlay::-webkit-scrollbar {
		display: none;
	}
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
