<script lang="ts">
	import { Archive, X } from 'lucide-svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import LimitedTextarea from '$lib/components/LimitedTextarea.svelte';
	import { FIELD_LIMITS } from '$lib/fieldLimits';
	import { checkFieldLimits } from '$lib/limitCheck';
	import { toasts } from '$lib/stores/toast.svelte.js';

	type Props = {
		open: boolean;
		chatId: number;
		// Initial draft text; we copy it into a local buffer when `open` flips true
		// so cancelling doesn't mutate the parent's value.
		initialValue: string;
		// True when no compaction has run yet — message wording is slightly different.
		hasExistingCompaction: boolean;
		onClose: () => void;
		// Called after a successful save so the parent can refresh chat data.
		onSaved: () => void | Promise<void>;
	};

	let { open, chatId, initialValue, hasExistingCompaction, onClose, onSaved }: Props = $props();

	let draft = $state('');
	let saving = $state(false);
	let lastOpen = false;

	// Sync local buffer when the modal opens. Don't track on every initialValue
	// change — the parent shouldn't be able to overwrite an in-progress edit.
	$effect(() => {
		if (open && !lastOpen) {
			draft = initialValue;
		}
		lastOpen = open;
	});

	async function save() {
		if (saving) return;
		const ok = await checkFieldLimits([
			{ label: 'Compaction summary', value: draft, limit: FIELD_LIMITS.compactionSummary, trim: (v) => (draft = v) }
		]);
		if (!ok) return;
		saving = true;
		try {
			const res = await fetch(`/api/chats/${chatId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ compactionSummary: draft.trim() ? draft : null })
			});
			if (res.ok) {
				toasts.success('Summary saved');
				onClose();
				await onSaved();
			} else {
				toasts.error('Failed to save summary');
			}
		} finally {
			saving = false;
		}
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-[70] flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm"
		onclick={(e) => { if (e.target === e.currentTarget) onClose(); }}
	>
		<div class="flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-popover shadow-2xl" style="max-height: calc(100dvh - 4rem);">
			<header class="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
				<div class="flex items-center gap-2">
					<Archive class="h-4 w-4 text-primary" />
					<div>
						<h2 class="text-base font-semibold">Compaction summary</h2>
						<p class="text-xs text-muted-foreground">Replaces the earliest portion of the conversation in the prompt context.</p>
					</div>
				</div>
				<button
					type="button"
					onclick={onClose}
					class="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
					aria-label="Close"
				>
					<X class="h-4 w-4" />
				</button>
			</header>
			<div class="flex-1 overflow-y-auto p-5">
				<LimitedTextarea
					bind:value={draft}
					rows={14}
					limit={FIELD_LIMITS.compactionSummary}
					class="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm leading-relaxed placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-ring"
					placeholder="Summary of the story so far..."
				/>
				<p class="mt-2 text-xs text-muted-foreground">
					Editing here updates what the AI sees in place of the {hasExistingCompaction ? 'compacted' : 'earlier'} messages. Clearing the text resets the high-water mark so the next compaction starts from the very first message.
				</p>
			</div>
			<div class="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
				<Button type="button" variant="ghost" onclick={onClose}>Cancel</Button>
				<Button
					type="button"
					variant="primary"
					onclick={save}
					loading={saving}
					disabled={saving}
				>
					{saving ? 'Saving…' : 'Save summary'}
				</Button>
			</div>
		</div>
	</div>
{/if}
