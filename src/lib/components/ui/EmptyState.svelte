<script lang="ts">
	/**
	 * Empty-state placeholder. Pair with an optional CTA snippet for things
	 * like "No chats yet" + "Start a chat" button.
	 */
	import type { Snippet } from 'svelte';

	type IconComponent = any;

	interface Props {
		icon?: IconComponent;
		title: string;
		description?: string;
		/** Optional CTA snippet (typically a Button) rendered below the description. */
		action?: Snippet;
		/** Tighter spacing for inline empty states (e.g., inside small lists). */
		compact?: boolean;
		class?: string;
	}

	let {
		icon,
		title,
		description,
		action,
		compact = false,
		class: extraClass = ''
	}: Props = $props();

	const Icon = $derived(icon);
</script>

<div class="flex flex-col items-center justify-center text-center {compact ? 'gap-2 py-6' : 'gap-3 py-12'} {extraClass}">
	{#if Icon}
		<div class="rounded-full bg-muted/60 p-3 text-muted-foreground">
			<Icon class={compact ? 'h-5 w-5' : 'h-6 w-6'} />
		</div>
	{/if}
	<div class="space-y-1">
		<p class="{compact ? 'text-sm' : 'text-base'} font-medium text-foreground">{title}</p>
		{#if description}
			<p class="text-xs text-muted-foreground">{description}</p>
		{/if}
	</div>
	{#if action}
		<div class="mt-1">{@render action()}</div>
	{/if}
</div>
