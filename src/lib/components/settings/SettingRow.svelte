<script lang="ts">
	import type { Snippet } from 'svelte';

	// Generic wrapper for a single setting. Keeps the label + description on
	// one side and the control on the other so two-column grids line up
	// predictably even when descriptions wrap to different heights.
	//
	// layout='stacked'  → label on top, control below (default; works in any width)
	// layout='inline'   → label left, control right, vertically centered
	//                     (best for toggles and short controls)
	interface Props {
		label?: string;
		description?: string;
		htmlFor?: string;
		layout?: 'stacked' | 'inline';
		children: Snippet;
		labelChildren?: Snippet;
	}

	let { label, description, htmlFor, layout = 'stacked', children, labelChildren }: Props = $props();
</script>

{#if layout === 'inline'}
	<div class="flex items-start justify-between gap-4">
		<div class="min-w-0 flex-1">
			{#if label}
				{#if htmlFor}
					<label for={htmlFor} class="block text-sm font-medium text-foreground">{label}</label>
				{:else}
					<div class="text-sm font-medium text-foreground">{label}</div>
				{/if}
			{/if}
			{#if labelChildren}{@render labelChildren()}{/if}
			{#if description}
				<p class="mt-0.5 text-xs text-muted-foreground">{description}</p>
			{/if}
		</div>
		<div class="shrink-0">{@render children()}</div>
	</div>
{:else}
	<div class="space-y-1.5">
		{#if label}
			{#if htmlFor}
				<label for={htmlFor} class="block text-sm font-medium text-foreground">{label}</label>
			{:else}
				<div class="text-sm font-medium text-foreground">{label}</div>
			{/if}
		{/if}
		{#if labelChildren}{@render labelChildren()}{/if}
		{#if description}
			<p class="text-xs text-muted-foreground">{description}</p>
		{/if}
		{@render children()}
	</div>
{/if}
