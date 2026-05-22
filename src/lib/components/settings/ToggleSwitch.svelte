<script lang="ts">
	import { RotateCcw } from 'lucide-svelte';
	import { tooltip } from '$lib/tooltip';

	interface Props {
		checked: boolean;
		label: string;
		description?: string;
		disabled?: boolean;
		onchange: (next: boolean) => void;
		// When set together, render a small reset affordance inside the toggle card.
		// Useful for tristate (null/true/false) overrides where null means "use default".
		canReset?: boolean;
		onreset?: () => void;
		resetTooltip?: string;
	}

	let {
		checked,
		label,
		description,
		disabled = false,
		onchange,
		canReset = false,
		onreset,
		resetTooltip = 'Reset to default'
	}: Props = $props();
</script>

<button
	type="button"
	role="switch"
	aria-checked={checked}
	aria-label={label}
	{disabled}
	onclick={() => onchange(!checked)}
	class="flex w-full items-center justify-between rounded-lg border border-border px-4 py-3 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
>
	<div>
		<span class="block text-sm font-medium">{label}</span>
		{#if description}
			<span class="block text-xs text-muted-foreground">{description}</span>
		{/if}
	</div>
	<div class="ml-3 flex items-center gap-2">
		{#if canReset && onreset}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				onclick={(e) => { e.stopPropagation(); onreset?.(); }}
				class="rounded p-1 text-muted-foreground/60 hover:text-foreground"
				use:tooltip={resetTooltip}
			>
				<RotateCcw class="h-3.5 w-3.5" />
			</div>
		{/if}
		<div class="h-5 w-9 shrink-0 rounded-full transition-colors {checked ? 'bg-primary' : 'bg-muted'}">
			<div class="h-5 w-5 rounded-full border-2 bg-white transition-transform {checked ? 'translate-x-4 border-primary' : 'translate-x-0 border-muted'}"></div>
		</div>
	</div>
</button>
