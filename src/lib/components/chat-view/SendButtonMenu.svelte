<script lang="ts">
	import { Wand2 } from 'lucide-svelte';
	import type { MenuPosition } from '$lib/chat/utils/menuPositioning';
	import type { GuideTarget } from '$lib/chat/state/ui.svelte';

	type Props = {
		open: boolean;
		position: MenuPosition | null;
		// Trimmed input from the orchestrator — used to disable the guide-reply
		// option when there's nothing to send.
		inputTrimmed: string;
		onClose: () => void;
		onOpenGuide: (target: GuideTarget, prefill: string) => void;
	};

	let { open, position, inputTrimmed, onClose, onOpenGuide }: Props = $props();
</script>

{#if open && position}
	<div
		data-send-menu
		class="popup-menu fixed z-[60] w-[220px] rounded-xl border border-border/40 bg-translucent py-1 shadow-2xl backdrop-blur-md"
		style="--translucent-base: 1; --popup-origin: {position.flipUp ? 'bottom' : 'top'} left; left: {position.x}px; {position.flipUp ? 'bottom' : 'top'}: {position.flipUp ? (position.viewportH - position.y) + 'px' : position.y + 'px'}"
	>
		<button
			type="button"
			onclick={() => { onClose(); onOpenGuide({ kind: 'send' }, ''); }}
			disabled={!inputTrimmed}
			class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-40 disabled:pointer-events-none"
		>
			<Wand2 class="h-4 w-4" />Guide reply…
		</button>
	</div>
{/if}
