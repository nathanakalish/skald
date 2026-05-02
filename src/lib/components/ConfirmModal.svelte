<script lang="ts">
	import { AlertTriangle } from 'lucide-svelte';
	import Modal from './Modal.svelte';

	interface Props {
		open: boolean;
		title?: string;
		message?: string;
		confirmLabel?: string;
		cancelLabel?: string;
		secondaryLabel?: string;
		variant?: 'danger' | 'info';
		onsecondary?: () => void;
		onconfirm: () => void;
		oncancel: () => void;
	}

	let {
		open,
		title = 'Confirm',
		message = 'Are you sure?',
		confirmLabel = 'Delete',
		cancelLabel = 'Cancel',
		secondaryLabel = '',
		variant = 'danger',
		onsecondary,
		onconfirm,
		oncancel
	}: Props = $props();
</script>

<Modal {open} onclose={oncancel} ariaLabel="Confirmation" maxWidth="max-w-sm">
	<div class="mb-4 flex items-center gap-3">
		<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full {variant === 'info' ? 'bg-primary/10' : 'bg-destructive/10'}">
			<AlertTriangle class="h-5 w-5 {variant === 'info' ? 'text-primary' : 'text-destructive'}" />
		</div>
		<h3 class="text-lg font-semibold">{title}</h3>
	</div>
	<p class="mb-6 whitespace-pre-line text-sm text-muted-foreground">{message}</p>
	<div class="flex justify-end gap-3">
		{#if cancelLabel}
		<button
			onclick={oncancel}
			class="rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-accent"
		>
			{cancelLabel}
		</button>
		{/if}
		{#if secondaryLabel && onsecondary}
		<button
			onclick={onsecondary}
			class="rounded-lg border border-border bg-accent px-4 py-2 text-sm font-medium transition-colors hover:bg-accent/80"
		>
			{secondaryLabel}
		</button>
		{/if}
		<button
			onclick={onconfirm}
			class="rounded-lg px-4 py-2 text-sm font-medium transition-colors {variant === 'info' ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'bg-destructive text-destructive-foreground hover:bg-destructive/90'}"
		>
			{confirmLabel}
		</button>
	</div>
</Modal>
