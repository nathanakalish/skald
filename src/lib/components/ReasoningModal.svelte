<script lang="ts">
	import { tooltip } from '$lib/tooltip.js';
	import { tick } from 'svelte';
	import { Pencil, Check, X } from 'lucide-svelte';
	import { createModalState, createModalGestures } from '$lib/modal.svelte.js';

	let { open = $bindable(false), reasoning = '', characterName = '', messageId = 0, onreasoningupdate }: {
		open: boolean;
		reasoning: string;
		characterName?: string;
		messageId?: number;
		onreasoningupdate?: (messageId: number, reasoning: string) => void;
	} = $props();

	let scrollContainer: HTMLDivElement | undefined = $state();
	let isEditing = $state(false);
	let editContent = $state('');

	// Auto-scroll to bottom as reasoning streams in
	$effect(() => {
		reasoning; // track changes
		if (scrollContainer && !isEditing) {
			tick().then(() => {
				scrollContainer!.scrollTop = scrollContainer!.scrollHeight;
			});
		}
	});

	function startEdit() {
		editContent = reasoning;
		isEditing = true;
	}

	function cancelEdit() {
		isEditing = false;
		editContent = '';
	}

	async function saveEdit() {
		if (!messageId || editContent === reasoning) { cancelEdit(); return; }
		onreasoningupdate?.(messageId, editContent);
		cancelEdit();
	}

	const modal = createModalState(() => open);
	const gestures = createModalGestures({ onclose: () => { open = false; }, modal });
</script>

{#if modal.visible}
	<div class="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
		<!-- Backdrop -->
		<div
			class="absolute inset-0 bg-black/60 backdrop-blur-sm {modal.closing ? 'backdrop-exit' : 'backdrop-enter'}"
			role="presentation"
		>
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<div
				class="h-full w-full"
				onkeydown={(e) => { if (e.key === 'Escape') { if (isEditing) cancelEdit(); else open = false; } }}
				onclick={() => { if (!isEditing) open = false; }}
				tabindex="-1"
				role="dialog" aria-modal="true" aria-label="Model Reasoning"
			></div>
		</div>

		<!-- Modal -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="{modal.closing ? 'modal-exit' : 'modal-enter'} relative z-10 flex max-h-[80vh] w-full max-w-2xl flex-col rounded-t-2xl border border-border bg-card shadow-2xl sm:rounded-xl"
			ontouchstart={gestures.handlers.onTouchStart}
			ontouchmove={gestures.handlers.onTouchMove}
			ontouchend={gestures.handlers.onTouchEnd}
			style={gestures.panelStyle}
		>
			<div class="flex items-center justify-between border-b border-border px-5 py-3">
				<h2 class="text-sm font-semibold text-foreground">{characterName ? `${characterName}'s Thoughts` : 'Model Reasoning'}</h2>
				<div class="flex items-center gap-1">
					{#if isEditing}
						<button
							onclick={saveEdit}
							aria-label="Save reasoning"
							class="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							use:tooltip={'Save'}
						>
							<Check class="h-4 w-4" />
						</button>
						<button
							onclick={cancelEdit}
							aria-label="Cancel edit"
							class="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							use:tooltip={'Cancel edit'}
						>
							<X class="h-4 w-4" />
						</button>
					{:else}
						{#if messageId > 0}
							<button
								onclick={startEdit}
								aria-label="Edit reasoning"
								class="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
								use:tooltip={'Edit reasoning'}
							>
								<Pencil class="h-3.5 w-3.5" />
							</button>
						{/if}
						<button
							onclick={() => { open = false; }}
							aria-label="Close reasoning"
							class="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							use:tooltip={'Close'}
						>
							<X class="h-4 w-4" />
						</button>
					{/if}
				</div>
			</div>
			<div bind:this={scrollContainer} class="overflow-y-auto px-5 py-4">
				{#if isEditing}
					<textarea
						bind:value={editContent}
						class="w-full resize-none rounded-lg border border-input bg-background p-3 text-sm leading-relaxed text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
						rows={Math.min(20, Math.max(5, editContent.split('\n').length + 2))}
					></textarea>
				{:else}
					<div class="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
						{reasoning}
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}
