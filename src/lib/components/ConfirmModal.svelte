<script lang="ts">
	import { AlertTriangle } from 'lucide-svelte';
	import Modal from './Modal.svelte';
	import Button from './ui/Button.svelte';

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
			<Button variant="secondary" onclick={oncancel}>{cancelLabel}</Button>
		{/if}
		{#if secondaryLabel && onsecondary}
			<Button variant="ghost" onclick={onsecondary}>{secondaryLabel}</Button>
		{/if}
		<Button
			variant={variant === 'info' ? 'primary' : 'destructive'}
			onclick={onconfirm}
		>
			{confirmLabel}
		</Button>
	</div>
</Modal>
