<script lang="ts">
	/**
	 * Renders whichever dialog is currently active in the global dialog store.
	 * Mount once in +layout.svelte so calls to confirm()/alert() from anywhere
	 * in the app just work.
	 */
	import ConfirmModal from '$lib/components/ConfirmModal.svelte';
	import { dialogStore, _dialogInternals } from '$lib/dialog.svelte.js';
</script>

{#if dialogStore.active}
	{@const d = dialogStore.active}
	<ConfirmModal
		open={true}
		title={d.title}
		message={d.message}
		confirmLabel={d.confirmLabel}
		cancelLabel={d.cancelLabel}
		secondaryLabel={d.secondaryLabel}
		variant={d.variant}
		onconfirm={_dialogInternals.confirm}
		oncancel={_dialogInternals.cancel}
		onsecondary={d.secondaryLabel ? _dialogInternals.secondary : undefined}
	/>
{/if}
