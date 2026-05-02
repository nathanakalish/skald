<script lang="ts">
	import { toasts } from '$lib/stores/toast.svelte.js';
	import { Check, AlertCircle, Info } from 'lucide-svelte';
	import { fade } from 'svelte/transition';

	const iconMap = {
		success: Check,
		error: AlertCircle,
		info: Info
	};

	const colorMap = {
		success: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
		error: 'bg-destructive/15 text-destructive border-destructive/30',
		info: 'bg-primary/15 text-primary border-primary/30'
	};

	const iconColorMap = {
		success: 'text-emerald-400',
		error: 'text-destructive',
		info: 'text-primary'
	};
</script>

{#if toasts.all.length > 0}
	<div class="fixed bottom-4 left-1/2 z-[200] flex -translate-x-1/2 flex-col items-center gap-2" role="status" aria-live="polite">
		{#each toasts.all as toast (toast.id)}
			<div
				class="toast-spring-enter flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium shadow-lg backdrop-blur-md {colorMap[toast.type]}"
				out:fade={{ duration: 150 }}
			>
				<svelte:component this={iconMap[toast.type]} class="h-4 w-4 shrink-0 {iconColorMap[toast.type]}" />
				{toast.message}
			</div>
		{/each}
	</div>
{/if}
