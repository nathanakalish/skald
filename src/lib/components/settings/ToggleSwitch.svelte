<script lang="ts">
	interface Props {
		checked: boolean;
		label: string;
		description?: string;
		disabled?: boolean;
		onchange: (next: boolean) => void;
	}

	let { checked, label, description, disabled = false, onchange }: Props = $props();
</script>

<button
	type="button"
	{disabled}
	onclick={() => onchange(!checked)}
	class="flex w-full items-center justify-between rounded-lg border border-border px-4 py-3 text-left transition-colors hover:bg-accent/50 disabled:cursor-not-allowed disabled:opacity-50"
>
	<div>
		<span class="block text-sm font-medium">{label}</span>
		{#if description}
			<span class="block text-xs text-muted-foreground">{description}</span>
		{/if}
	</div>
	<div class="ml-3 h-5 w-9 shrink-0 rounded-full transition-colors {checked ? 'bg-primary' : 'bg-muted'}">
		<div class="h-5 w-5 rounded-full border-2 bg-white transition-transform {checked ? 'translate-x-4 border-primary' : 'translate-x-0 border-muted'}"></div>
	</div>
</button>
