<script lang="ts">
	/**
	 * Generic modal shell that consolidates the boilerplate every dialog
	 * was repeating: portal-to-body, escape-to-close, click-outside-to-close,
	 * exit animation hand-off via `createModalState`, ARIA wrapper.
	 *
	 * Used by simple/medium modals (ConfirmModal, future PersonaEdit, etc.).
	 * Heavyweight modals with bespoke gestures (SettingsModal, CharacterEditModal)
	 * still bring their own shell.
	 */
	import type { Snippet } from 'svelte';
	import { createModalState } from '$lib/modal.svelte.js';
	import { focusTrap } from '$lib/focusTrap.js';

	interface Props {
		open: boolean;
		onclose: () => void;
		ariaLabel?: string;
		/** Tailwind max-width class for the panel. Defaults to `max-w-md`. */
		maxWidth?: string;
		/** Set false to keep clicks on the dim backdrop from closing the modal. */
		closeOnBackdrop?: boolean;
		/** Set false to disable Escape-to-close. */
		closeOnEscape?: boolean;
		children: Snippet;
	}

	let {
		open,
		onclose,
		ariaLabel = 'Dialog',
		maxWidth = 'max-w-md',
		closeOnBackdrop = true,
		closeOnEscape = true,
		children
	}: Props = $props();

	const modal = createModalState(() => open);

	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return { destroy() { node.remove(); } };
	}

	/** Focus-trap action lives in $lib/focusTrap so heavyweight modals can share it. */

	function onBackdropKey(e: KeyboardEvent) {
		if (closeOnEscape && e.key === 'Escape') onclose();
	}
</script>

{#if modal.visible}
<div use:portal>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 {modal.closing ? 'backdrop-exit' : 'backdrop-enter'}"
		role="dialog"
		aria-modal="true"
		aria-label={ariaLabel}
		tabindex="-1"
		onkeydown={onBackdropKey}
	>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div
			class="absolute inset-0"
			onclick={() => closeOnBackdrop && onclose()}
		></div>
		<div
			class="relative z-10 w-full {maxWidth} rounded-xl border border-border bg-card p-6 shadow-xl {modal.closing ? 'modal-exit' : 'modal-enter'}"
			use:focusTrap
			tabindex="-1"
		>
			{@render children()}
		</div>
	</div>
</div>
{/if}
