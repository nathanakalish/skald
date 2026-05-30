<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';

	type Props = {
		open: boolean;
		// If false, the only option is "delete only this message" (no thread option).
		canDeleteThread: boolean;
		mode: 'single' | 'thread';
		onModeChange: (mode: 'single' | 'thread') => void;
		onCancel: () => void;
		onConfirm: () => void;
	};

	let {
		open,
		canDeleteThread,
		mode,
		onModeChange,
		onCancel,
		onConfirm
	}: Props = $props();
</script>

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-enter" onclick={onCancel}>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="modal-enter mx-4 w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-xl" onclick={(e) => e.stopPropagation()}>
			<h3 class="text-base font-semibold text-foreground">Delete message?</h3>
			{#if canDeleteThread}
				<p class="mt-2 text-sm text-muted-foreground">Choose what to delete:</p>
				<div class="mt-3 space-y-2">
					<button
						type="button"
						onclick={() => onModeChange('single')}
						class="w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors {mode === 'single' ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'}"
					>
						Delete only this message
					</button>
					<button
						type="button"
						onclick={() => onModeChange('thread')}
						class="w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors {mode === 'thread' ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'}"
					>
						Delete this message and everything after it
					</button>
				</div>
				{#if mode === 'thread'}
					<p class="mt-2 text-sm font-medium text-warning">
						All branches below this point will be deleted.
					</p>
				{/if}
			{:else}
				<p class="mt-2 text-sm text-muted-foreground">This message will be permanently deleted.</p>
			{/if}
			<div class="mt-4 flex items-center justify-end gap-2">
				<Button variant="ghost" size="sm" onclick={onCancel}>Cancel</Button>
				<Button variant="destructive" size="sm" onclick={onConfirm}>
					{mode === 'thread' ? 'Delete Thread' : 'Delete Message'}
				</Button>
			</div>
		</div>
	</div>
{/if}
