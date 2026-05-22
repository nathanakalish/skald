<script lang="ts">
	/**
	 * Shared button primitive. Variants and sizes are intentionally limited —
	 * if you need something exotic, prefer composing or extending this rather
	 * than rolling a one-off class string. See IconButton.svelte for icon-only
	 * buttons.
	 *
	 * `loading` swaps the leading icon for a spinner and disables interaction
	 * without changing the visible label so the layout doesn't jitter.
	 */
	import type { Snippet } from 'svelte';
	import { Loader2 } from 'lucide-svelte';

	// Lucide's component type doesn't quite line up with svelte's `Component<{}>`
	// signature, so accept any component-ish thing here. Trying to be more
	// precise just creates friction at every call site.
	type IconComponent = any;

	type Variant = 'primary' | 'secondary' | 'destructive' | 'ghost' | 'text';
	type Size = 'sm' | 'md' | 'lg';

	interface Props {
		variant?: Variant;
		size?: Size;
		type?: 'button' | 'submit' | 'reset';
		disabled?: boolean;
		loading?: boolean;
		/** Optional leading icon component (lucide-svelte). */
		icon?: IconComponent;
		/** Optional trailing icon component (lucide-svelte). */
		trailingIcon?: IconComponent;
		/** When true, button stretches to fill its container. */
		fullWidth?: boolean;
		title?: string;
		ariaLabel?: string;
		class?: string;
		onclick?: (e: MouseEvent) => void;
		children?: Snippet;
	}

	let {
		variant = 'secondary',
		size = 'md',
		type = 'button',
		disabled = false,
		loading = false,
		icon,
		trailingIcon,
		fullWidth = false,
		title,
		ariaLabel,
		class: extraClass = '',
		onclick,
		children
	}: Props = $props();

	const sizeClass = $derived(
		size === 'sm'
			? 'h-8 px-3 text-xs gap-1.5'
			: size === 'lg'
				? 'h-10 px-4 text-sm gap-2'
				: 'h-9 px-3.5 text-sm gap-2'
	);

	const variantClass = $derived(
		variant === 'primary'
			? 'bg-primary text-primary-foreground hover:bg-primary/90'
			: variant === 'destructive'
				? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
				: variant === 'ghost'
					? 'text-foreground hover:bg-accent hover:text-accent-foreground'
					: variant === 'text'
						? 'text-primary hover:bg-primary/10 px-2'
						: 'border border-border bg-card text-foreground hover:bg-accent hover:text-accent-foreground'
	);

	const iconSize = $derived(size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4');
</script>

<button
	{type}
	{title}
	aria-label={ariaLabel}
	disabled={disabled || loading}
	{onclick}
	class="inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 {sizeClass} {variantClass} {fullWidth ? 'w-full' : ''} {extraClass}"
>
	{#if loading}
		<Loader2 class="{iconSize} animate-spin" />
	{:else if icon}
		{@const Icon = icon}
		<Icon class={iconSize} />
	{/if}
	{#if children}{@render children()}{/if}
	{#if trailingIcon && !loading}
		{@const TrailIcon = trailingIcon}
		<TrailIcon class={iconSize} />
	{/if}
</button>
