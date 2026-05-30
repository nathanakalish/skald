<script lang="ts">
	import { Send, Square, Brain, UserPen } from 'lucide-svelte';
	import LimitedTextarea from '$lib/components/LimitedTextarea.svelte';
	import { tooltip } from '$lib/tooltip';
	import { FIELD_LIMITS } from '$lib/fieldLimits';
	import { createButtonLongPress } from '$lib/chat/utils/buttonLongPress';

	// Bottom-of-the-card compose row. Lifts the long-press / right-click
	// behaviour out of ChatView by owning the button handlers locally —
	// the parent only sees `onSendLongPress` / `onImpersonateLongPress`
	// callbacks with the coordinates needed to position a menu. Textarea
	// value is bound back to the parent so it can drive the draft store
	// and persistence layers without this component having to know about
	// either.
	let {
		input = $bindable(''),
		textareaEl = $bindable<HTMLTextAreaElement | undefined>(undefined),
		isStreaming,
		isImpersonating,
		isReasoning,
		isMobile,
		sendWithEnterMobile,
		onTextareaInput,
		onKeydown,
		onSendClick,
		onImpersonateClick,
		onAbort,
		onSendLongPress,
		onImpersonateLongPress,
		onLiveReasoningOpen
	}: {
		input?: string;
		textareaEl?: HTMLTextAreaElement;
		isStreaming: boolean;
		isImpersonating: boolean;
		isReasoning: boolean;
		isMobile: boolean;
		sendWithEnterMobile: boolean;
		onTextareaInput: () => void;
		onKeydown: (e: KeyboardEvent) => void;
		onSendClick: () => void;
		onImpersonateClick: () => void;
		onAbort: () => void;
		/** Caller positions the menu using `positionForMenu` from utils/menuPositioning. */
		onSendLongPress: (x: number, y: number) => void;
		onImpersonateLongPress: (x: number, y: number) => void;
		/** Open the live-reasoning modal when the user taps the dots during impersonation reasoning. */
		onLiveReasoningOpen: () => void;
	} = $props();

	// Handlers own the timer + suppress-flag — they're created once per mount
	// and passed straight to the DOM. The arrow-wrap is critical: capturing
	// the prop directly would freeze the initial callback ref, and parent
	// re-renders that swap the callback would silently no-op.
	const sendHandlers = createButtonLongPress((x, y) => onSendLongPress(x, y));
	const impHandlers = createButtonLongPress((x, y) => onImpersonateLongPress(x, y));

	// Hides the send button on mobile when "Send with Enter" is on — the
	// Enter key handles sending, freeing up textarea width.
	let hideSendButton = $derived(isMobile && sendWithEnterMobile);
</script>

<div class="pointer-events-auto mx-auto flex max-w-5xl items-stretch gap-2">
	<div class="relative flex-1">
		<LimitedTextarea
			bind:element={textareaEl}
			bind:value={input}
			oninput={onTextareaInput}
			onkeydown={onKeydown}
			readonly={isImpersonating && isReasoning}
			placeholder={isImpersonating ? '' : 'Reply'}
			rows={1}
			limit={FIELD_LIMITS.messageContent}
			class="block w-full resize-none rounded-3xl border border-input bg-card px-4 py-2.5 text-sm leading-normal placeholder:text-muted-foreground focus:border-foreground/30 focus:outline-none focus:ring-2 focus:ring-foreground/20"
		/>
		{#if isImpersonating && !input}
			{#if isReasoning}
				<button
					onclick={onLiveReasoningOpen}
					class="absolute inset-0 flex items-center justify-center gap-2 rounded-3xl text-xs text-muted-foreground/70 transition-colors hover:bg-accent/80 hover:text-primary"
				>
					<span class="typing-dot h-2.5 w-2.5 rounded-full bg-muted-foreground/60" style="animation-delay: 0ms"></span>
					<span class="typing-dot h-2.5 w-2.5 rounded-full bg-muted-foreground/60" style="animation-delay: 160ms"></span>
					<span class="typing-dot h-2.5 w-2.5 rounded-full bg-muted-foreground/60" style="animation-delay: 320ms"></span>
					<Brain class="h-4 w-4" />
				</button>
			{:else}
				<!-- Waiting for first token: plain dots, no brain. -->
				<div class="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 rounded-3xl">
					<span class="typing-dot h-2.5 w-2.5 rounded-full bg-muted-foreground/60" style="animation-delay: 0ms"></span>
					<span class="typing-dot h-2.5 w-2.5 rounded-full bg-muted-foreground/60" style="animation-delay: 160ms"></span>
					<span class="typing-dot h-2.5 w-2.5 rounded-full bg-muted-foreground/60" style="animation-delay: 320ms"></span>
				</div>
			{/if}
		{/if}
	</div>

	<button
		onclick={(e) => {
			if (impHandlers.suppressClick()) {
				e.preventDefault();
				e.stopPropagation();
				return;
			}
			onImpersonateClick();
		}}
		onpointerdown={impHandlers.onpointerdown}
		onpointermove={impHandlers.onpointermove}
		onpointerup={impHandlers.onpointerup}
		onpointercancel={impHandlers.onpointercancel}
		oncontextmenu={impHandlers.oncontextmenu}
		disabled={isStreaming && !isImpersonating}
		class="flex w-11 shrink-0 items-center justify-center rounded-full border border-input bg-card text-muted-foreground shadow-sm shadow-black/10 transition-all hover:bg-accent hover:text-foreground active:scale-90 disabled:opacity-50"
		use:tooltip={'Impersonate (long-press for options)'}
		aria-label="Impersonate"
	>
		<UserPen class="h-4 w-4" />
	</button>

	{#if isStreaming}
		<button
			onclick={onAbort}
			class="flex w-11 shrink-0 items-center justify-center rounded-full bg-destructive text-destructive-foreground transition-all hover:scale-105 hover:bg-destructive/80 active:scale-90"
			use:tooltip={isImpersonating ? 'Stop impersonation' : 'Stop generation'}
			aria-label={isImpersonating ? 'Stop impersonation' : 'Stop generation'}
		>
			<Square class="h-4 w-4 fill-current" />
		</button>
	{:else if !hideSendButton}
		<button
			onclick={(e) => {
				if (sendHandlers.suppressClick()) {
					e.preventDefault();
					e.stopPropagation();
					return;
				}
				onSendClick();
			}}
			onpointerdown={sendHandlers.onpointerdown}
			onpointermove={sendHandlers.onpointermove}
			onpointerup={sendHandlers.onpointerup}
			onpointercancel={sendHandlers.onpointercancel}
			oncontextmenu={sendHandlers.oncontextmenu}
			disabled={!input.trim()}
			class="flex w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md shadow-primary/30 transition-all hover:scale-105 hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/40 active:scale-90 disabled:opacity-50 disabled:shadow-none disabled:hover:scale-100 disabled:active:scale-100"
			aria-label="Send message (long-press for guided reply)"
		>
			<Send class="h-4 w-4" />
		</button>
	{/if}
</div>

<!--
	Note for orchestrator: the *outer* compose wrapper (absolutely positioned
	at the bottom of the messages card, with safe-area passthrough, the
	bg-gradient fade, and bind:clientHeight for the spacer/scroll-button)
	stays in the orchestrator — moving it here would mean exposing all the
	layout bookkeeping (composeRowHeight, composeRowEl) through props.
-->

<style>
	/* Local clone of ChatView's typing-dot animation. The spans live inside
	   this component so Svelte's scoped CSS handles isolation — no :global
	   needed, no collision with the original ChatView's identically-named
	   rule. Timing and easing match the original (1.2s, -6px, opacity 0.35→1). */
	.typing-dot {
		animation: typing-bounce 1.2s ease-in-out infinite;
	}
	@keyframes typing-bounce {
		0%, 60%, 100% { transform: translateY(0); opacity: 0.35; }
		30% { transform: translateY(-6px); opacity: 1; }
	}
</style>
