<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';
	import LimitedTextarea from '$lib/components/LimitedTextarea.svelte';
	import { FIELD_LIMITS } from '$lib/fieldLimits';
	import type { GuideTarget } from '$lib/chat/state/ui.svelte';

	type Props = {
		open: boolean;
		target: GuideTarget | null;
		text: string;
		onClose: () => void;
		onSubmit: () => void;
	};

	let { open, target, text = $bindable(''), onClose, onSubmit }: Props = $props();

	// Title + body copy mirror the original exactly — multiple kinds collapse
	// to the same label so a switch would obscure intent.
	const title = $derived(
		target?.kind === 'impersonate'
			? 'Guide impersonation'
			: target?.kind === 'impersonateView'
			? 'Impersonation guidance'
			: target?.kind === 'send'
			? 'Guide reply'
			: target?.kind === 'guideReply'
			? 'Guide reply'
			: 'Edit guidance'
	);

	const description = $derived(
		target?.kind === 'impersonate'
			? "Tell the model how to write your next reply. The text won't appear in the message itself."
			: target?.kind === 'impersonateView'
			? 'The guidance used to produce the active impersonation swipe.'
			: target?.kind === 'send'
			? 'Out-of-band guidance the character should follow without quoting.'
			: target?.kind === 'guideReply'
			? 'Out-of-band guidance the character should follow without quoting. Sending will start the reply.'
			: 'Update the guidance and re-run this reply.'
	);

	const readonly = $derived(target?.kind === 'impersonateView');
</script>

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-enter" onclick={onClose}>
		<div class="modal-enter mx-4 flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-translucent backdrop-blur-md p-5 shadow-xl" style="--translucent-base: 1;" onclick={(e) => e.stopPropagation()}>
			<h3 class="mb-1 text-sm font-semibold text-foreground">{title}</h3>
			<p class="mb-3 text-xs text-muted-foreground">{description}</p>
			<LimitedTextarea
				bind:value={text}
				placeholder={readonly ? '(no guidance was set)' : 'e.g. Keep it short and aloof.'}
				{readonly}
				limit={FIELD_LIMITS.replyGuidance}
				class="block min-h-[40vh] w-full flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm focus:border-foreground/30 focus:outline-none focus:ring-2 focus:ring-ring {readonly ? 'cursor-default opacity-90' : ''}"
			/>
			<div class="mt-4 flex items-center justify-end gap-2">
				<Button type="button" variant="ghost" size="sm" onclick={onClose}>
					{readonly ? 'Close' : 'Cancel'}
				</Button>
				{#if !readonly}
					<Button type="button" variant="primary" size="sm" onclick={onSubmit}>Go</Button>
				{/if}
			</div>
		</div>
	</div>
{/if}
