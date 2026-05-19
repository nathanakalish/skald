<!--
	Single-line text input with soft character limit. Lets users type past the
	limit (no maxlength hard-stop) and renders the overflow portion in the
	destructive theme color via an overlay div that sits behind the input.

	The input itself is rendered with transparent text + transparent background
	so the overlay shows through; the caret stays visible via caret-color. The
	user-supplied `class` is applied to both the overlay and the real input so
	padding / font / border geometry stays in sync — without that, the colored
	text would misalign with the caret.

	When the admin has disabled limits globally (`limitsState.enabled === false`)
	the overlay + border highlight disappear and this behaves like a plain
	`<input>`.

	Use for `type="text"`-shaped inputs. Other types (password, number, time,
	color, file, etc.) don't make sense here and aren't supported.
-->
<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';
	import { limitsState } from '$lib/limits.svelte.js';

	interface Props extends Omit<HTMLInputAttributes, 'value' | 'maxlength'> {
		value: string;
		/** Soft cap. Typing past it is allowed but rendered red. */
		limit: number;
		/** Optional bindable handle for the inner <input> element. */
		element?: HTMLInputElement | undefined;
	}

	let {
		value = $bindable(''),
		limit,
		element = $bindable(undefined),
		class: className = '',
		...rest
	}: Props = $props();

	let inputEl: HTMLInputElement | undefined = $state();
	let overlayEl: HTMLDivElement | undefined = $state();

	$effect(() => {
		element = inputEl;
	});

	const safe = $derived(value ?? '');
	const limitsOn = $derived(limitsState.enabled);
	const isOver = $derived(limitsOn && safe.length > limit);
	const okText = $derived(isOver ? safe.slice(0, limit) : safe);
	const overflowText = $derived(isOver ? safe.slice(limit) : '');

	function syncScroll() {
		if (overlayEl && inputEl) overlayEl.scrollLeft = inputEl.scrollLeft;
	}

	// Native inputs scroll on type/caret-move without firing reliable events,
	// so re-sync after each value update too.
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
			class="{className} limited-overlay pointer-events-none absolute inset-0 overflow-hidden whitespace-pre"
			style="border-color: transparent !important;"
		>{okText}<span style="color: var(--destructive);">{overflowText}</span></div>
	{/if}
	<input
		bind:this={inputEl}
		bind:value
		{...rest}
		onscroll={syncScroll}
		oninput={syncScroll}
		class="{className} {isOver ? 'limited-over' : ''} {limitsOn ? 'relative' : ''}"
		style={limitsOn
			? 'background-color: transparent !important; color: transparent !important; caret-color: var(--foreground);'
			: ''}
	/>
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
