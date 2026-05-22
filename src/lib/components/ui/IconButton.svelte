<script lang="ts">
	/**
	 * Icon-only button. Always square, always rounded, always has an
	 * `aria-label`. Use this for the small chrome buttons that appear in
	 * modal headers, message hovers, sidebar rows, etc.
	 */
	// Lucide's component type doesn't quite line up with svelte's `Component<{}>`
	// signature, so accept any component-ish thing here.
	type IconComponent = any;

	type Variant = 'ghost' | 'subtle' | 'primary' | 'destructive';
	type Size = 'sm' | 'md' | 'lg';

	interface Props {
		icon: IconComponent;
		ariaLabel: string;
		variant?: Variant;
		size?: Size;
		/** `rounded-lg` (default) or `rounded-full` for pill-style chips. */
		shape?: 'square' | 'pill';
		type?: 'button' | 'submit' | 'reset';
		disabled?: boolean;
		title?: string;
		class?: string;
		onclick?: (e: MouseEvent) => void;
	}

	let {
		icon,
		ariaLabel,
		variant = 'ghost',
		size = 'md',
		shape = 'square',
		type = 'button',
		disabled = false,
		title,
		class: extraClass = '',
		onclick
	}: Props = $props();

	const sizeClass = $derived(
		size === 'sm' ? 'h-7 w-7' : size === 'lg' ? 'h-10 w-10' : 'h-9 w-9'
	);
	const iconSize = $derived(
		size === 'sm' ? 'h-3.5 w-3.5' : size === 'lg' ? 'h-5 w-5' : 'h-4 w-4'
	);
	const shapeClass = $derived(shape === 'pill' ? 'rounded-full' : 'rounded-lg');

	const variantClass = $derived(
		variant === 'primary'
			? 'bg-primary text-primary-foreground hover:bg-primary/90'
			: variant === 'destructive'
				? 'text-destructive hover:bg-destructive/10'
				: variant === 'subtle'
					? 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground'
					: 'text-muted-foreground hover:bg-accent hover:text-foreground'
	);

	const Icon = $derived(icon);
</script>

<button
	{type}
	{title}
	aria-label={ariaLabel}
	{disabled}
	{onclick}
	class="inline-flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 {sizeClass} {shapeClass} {variantClass} {extraClass}"
>
	<Icon class={iconSize} />
</button>
