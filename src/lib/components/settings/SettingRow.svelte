<script lang="ts">
	import type { Snippet } from 'svelte';

	// Generic wrapper for a single setting. Keeps the label + description on
	// one side and the control on the other so two-column grids line up
	// predictably even when descriptions wrap to different heights.
	//
	// layout='stacked'  → label on top, control below (default; works in any width)
	// layout='inline'   → label left, control right, vertically centered
	//                     (best for toggles and short controls)
	// size='md'         → standard label (text-sm, foreground) — for settings panels
	// size='sm'         → compact label (text-xs, muted) — for modal inline-edit cards
	interface Props {
		label?: string;
		description?: string;
		htmlFor?: string;
		layout?: 'stacked' | 'inline';
		size?: 'md' | 'sm';
		children?: Snippet;
		labelChildren?: Snippet;
		// Rendered inline on the right of the label row — useful for "reset to
		// default" buttons or status hints that should sit beside the label.
		action?: Snippet;
	}

	let { label, description, htmlFor, layout = 'stacked', size = 'md', children, labelChildren, action }: Props = $props();

	const labelClass = $derived(
		size === 'sm'
			? 'block text-xs font-medium text-muted-foreground'
			: 'block text-sm font-medium text-foreground'
	);
</script>

{#if layout === 'inline'}
	<div class="flex items-start justify-between gap-4">
		<div class="min-w-0 flex-1">
			{#if label}
				{#if htmlFor}
					<label for={htmlFor} class={labelClass}>{label}</label>
				{:else}
					<div class={labelClass}>{label}</div>
				{/if}
			{/if}
			{#if labelChildren}{@render labelChildren()}{/if}
			{#if description}
				<p class="mt-0.5 text-xs text-muted-foreground">{description}</p>
			{/if}
		</div>
		<div class="shrink-0">{#if children}{@render children()}{/if}</div>
	</div>
{:else}
	<div class="space-y-1.5">
		{#if label || action}
			<div class="flex items-center justify-between gap-3">
				{#if label}
					{#if htmlFor}
						<label for={htmlFor} class={labelClass}>{label}</label>
					{:else}
						<div class={labelClass}>{label}</div>
					{/if}
				{:else}
					<div></div>
				{/if}
				{#if action}{@render action()}{/if}
			</div>
		{/if}
		{#if labelChildren}{@render labelChildren()}{/if}
		{#if description}
			<p class="text-xs text-muted-foreground">{description}</p>
		{/if}
		{@render children?.()}
	</div>
{/if}
