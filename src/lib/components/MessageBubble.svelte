<script lang="ts">
	import { Bot, Check, X, Brain, RefreshCw, Loader2 } from 'lucide-svelte';
	import { tooltip } from '$lib/tooltip.js';
	import LimitedTextarea from '$lib/components/LimitedTextarea.svelte';
	import { FIELD_LIMITS } from '$lib/fieldLimits.js';

	// Lifted from ChatView. Kept structurally identical so callers can pass
	// their own Message rows without conversion.
	interface Message {
		id: number;
		role: string;
		content: string;
		createdAt: string | null;
	}

	let {
		message,
		groupEnd,
		consecutive,
		msgNumber,
		isCompacted,
		isExiting,
		isAborting,
		isSearchDimmed,
		isLast,
		isEditing,
		editContent = $bindable(''),
		isStreaming,
		isImpersonating,
		isReasoning,
		isReformatting,
		effectiveRenderMode,
		messageTimestamps,
		characterAvatarPath,
		characterName,
		enterClass,
		renderContent,
		getMessageTime,
		onsaveEdit,
		oncancelEdit,
		onhandleEditKeydown,
		onregenerate,
		onopenMenu,
		onstartLongPress,
		onmoveLongPress,
		onendLongPress,
		onopenReasoning,
		onimageClick,
		onenlargeAvatar,
		generatedImageUrl = null,
		generatedImageLoading = false,
		ongeneratedImageClick = () => {}
	}: {
		message: Message;
		groupEnd: boolean;
		consecutive: boolean;
		msgNumber: number;
		isCompacted: boolean;
		isExiting: boolean;
		isAborting: boolean;
		isSearchDimmed: boolean;
		isLast: boolean;
		isEditing: boolean;
		editContent: string;
		isStreaming: boolean;
		isImpersonating: boolean;
		isReasoning: boolean;
		isReformatting: boolean;
		effectiveRenderMode: string;
		messageTimestamps: string;
		characterAvatarPath: string | null;
		characterName: string;
		enterClass: string;
		renderContent: (content: string, skipCache?: boolean) => string;
		getMessageTime: (createdAt: string | null) => string;
		onsaveEdit: () => void;
		oncancelEdit: () => void;
		onhandleEditKeydown: (e: KeyboardEvent) => void;
		onregenerate: () => void;
		onopenMenu: (e: MouseEvent) => void;
		onstartLongPress: (e: TouchEvent) => void;
		onmoveLongPress: (e: TouchEvent) => void;
		onendLongPress: (e?: TouchEvent) => void;
		onopenReasoning: (isLive: boolean) => void;
		onimageClick: (src: string) => void;
		onenlargeAvatar: (src: string) => void;
		generatedImageUrl?: string | null;
		generatedImageLoading?: boolean;
		ongeneratedImageClick?: () => void;
	} = $props();

	// Streaming-tail check used to decide whether to show the typing/reasoning
	// affordance instead of the rendered content. Mirrors the original
	// inline condition exactly so behaviour is unchanged after extraction.
	const showStreamingAffordance = $derived(
		isStreaming && !isImpersonating && isLast && message.role === 'assistant' && (!message.content || isReasoning)
	);

	// True for the currently-streaming assistant bubble. Used to skip the
	// renderCache for in-flight content — caching every token snapshot churns
	// the LRU with throwaway entries and adds GC pressure.
	const isLiveStreamingBubble = $derived(
		isStreaming && !isImpersonating && isLast && message.role === 'assistant'
	);
</script>

<div
	class="msg-row {enterClass} {isExiting ? 'msg-exit' : ''} {isAborting ? 'msg-abort' : ''} group relative flex transition-opacity duration-200 {consecutive ? 'mt-0.5 gap-2 md:gap-3' : 'gap-2 md:gap-3'} {isCompacted ? 'opacity-60' : ''}"
	class:flex-row-reverse={message.role === 'user'}
	class:opacity-20={isSearchDimmed}
>
	<!-- Avatar (only at the end of a same-sender group; user messages don't show avatar — iMessage style. Hidden entirely on mobile to maximize bubble width) -->
	<div class="hidden shrink-0 self-end md:block {message.role === 'user' ? 'md:hidden' : ''} {!groupEnd ? 'md:invisible' : ''}" use:tooltip={`Message #${msgNumber}`}>
		{#if message.role === 'assistant'}
			{#if characterAvatarPath}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
				<img
					src={characterAvatarPath}
					alt={characterName}
					class="h-7 w-7 cursor-pointer rounded-full object-cover transition-opacity hover:opacity-80 md:h-9 md:w-9"
					onclick={() => onenlargeAvatar(characterAvatarPath!.replace('/avatars/', '/avatars/original/'))}
				/>
			{:else}
				<div class="flex h-7 w-7 items-center justify-center rounded-full bg-primary/20 md:h-9 md:w-9">
					<Bot class="h-3.5 w-3.5 text-primary" />
				</div>
			{/if}
		{/if}
	</div>

	<!-- Message bubble (iMessage style: blue user / gray assistant) -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="chat-bubble relative select-none px-3.5 py-2 shadow-sm shadow-black/5 {isEditing ? 'w-full rounded-2xl' : 'max-w-[88%] md:max-w-[70%]'} {message.role === 'user' ? 'bg-primary text-bubble-user-fg' : 'bg-muted text-bubble-assistant-fg'} {message.role === 'user'
			? (consecutive && !groupEnd ? 'rounded-2xl rounded-br-md' : consecutive && groupEnd ? 'rounded-2xl rounded-tr-md' : groupEnd ? 'rounded-2xl' : 'rounded-2xl rounded-br-md')
			: (consecutive && !groupEnd ? 'rounded-2xl rounded-bl-md' : consecutive && groupEnd ? 'rounded-2xl rounded-tl-md' : groupEnd ? 'rounded-2xl' : 'rounded-2xl rounded-bl-md')}"
		oncontextmenu={(e) => { if (!isEditing) onopenMenu(e); }}
		ontouchstart={(e) => { if (!isEditing) onstartLongPress(e); }}
		ontouchmove={(e) => onmoveLongPress(e)}
		ontouchend={(e) => onendLongPress(e)}
		ontouchcancel={() => onendLongPress()}
		use:tooltip={messageTimestamps !== 'off' && message.createdAt ? getMessageTime(message.createdAt) : undefined}
		data-reformatting={isReformatting ? '' : undefined}
	>
		<!-- FRONT-M6: sighted users get the timestamp via tooltip on hover; screen readers get it here. Skipped entirely when timestamps are toggled off. -->
		{#if messageTimestamps !== 'off' && message.createdAt}
			<time datetime={message.createdAt} class="sr-only">{getMessageTime(message.createdAt)}</time>
		{/if}
		{#if isEditing}
			<LimitedTextarea
				bind:value={editContent}
				onkeydown={onhandleEditKeydown}
				limit={FIELD_LIMITS.messageContent}
				class="w-full resize-none rounded-lg border border-input bg-background p-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
				rows={Math.min(12, Math.max(3, editContent.split('\n').length + 1))}
			/>
			<div class="mt-1.5 flex items-center justify-end gap-1.5">
				<button
					onclick={onsaveEdit}
					class="flex h-9 w-9 md:h-6 md:w-6 items-center justify-center rounded border transition-all {message.role === 'user' ? 'border-white/15 bg-white/10 text-bubble-user-fg/80 hover:bg-white/20 hover:text-bubble-user-fg' : 'border-border bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'} active:scale-90"
					use:tooltip={'Save'}
					aria-label="Save edit"
				>
					<Check class="h-3.5 w-3.5" />
				</button>
				<button
					onclick={oncancelEdit}
					class="flex h-9 w-9 md:h-6 md:w-6 items-center justify-center rounded border transition-all {message.role === 'user' ? 'border-white/15 bg-white/10 text-bubble-user-fg/80 hover:bg-white/20 hover:text-bubble-user-fg' : 'border-border bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'} active:scale-90"
					use:tooltip={'Cancel'}
					aria-label="Cancel edit"
				>
					<X class="h-3.5 w-3.5" />
				</button>
			</div>
		{:else if showStreamingAffordance}
			{#if !message.content}
				<div class="flex items-center justify-center gap-2.5 py-2 px-1 min-h-[36px]">
					<span class="typing-dot h-3 w-3 rounded-full bg-muted-foreground/70" style="animation-delay: 0ms"></span>
					<span class="typing-dot h-3 w-3 rounded-full bg-muted-foreground/70" style="animation-delay: 160ms"></span>
					<span class="typing-dot h-3 w-3 rounded-full bg-muted-foreground/70" style="animation-delay: 320ms"></span>
					{#if isReasoning}
						<button
							onclick={() => onopenReasoning(true)}
							class="ml-1 flex items-center justify-center rounded-md p-0.5 text-muted-foreground/60 hover:text-primary hover:bg-accent transition-colors"
						>
							<Brain class="h-5 w-5" />
						</button>
					{/if}
				</div>
			{:else}
				<!-- Content streaming alongside reasoning — show content with indicator -->
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="message-content text-sm leading-relaxed {effectiveRenderMode !== 'markdown' ? 'whitespace-pre-wrap' : ''}"
					onclick={(e) => {
						if (e.target instanceof HTMLImageElement) onimageClick(e.target.src);
					}}
				>
					{@html renderContent(message.content, true)}
				</div>
				<div class="mt-1 flex items-center gap-2.5 text-xs text-muted-foreground/60">
					<span class="typing-dot h-2.5 w-2.5 rounded-full bg-muted-foreground/60" style="animation-delay: 0ms"></span>
					<span class="typing-dot h-2.5 w-2.5 rounded-full bg-muted-foreground/60" style="animation-delay: 160ms"></span>
					<span class="typing-dot h-2.5 w-2.5 rounded-full bg-muted-foreground/60" style="animation-delay: 320ms"></span>
					<button
						onclick={() => onopenReasoning(true)}
						class="ml-0.5 flex items-center gap-1 rounded-lg px-2 py-1.5 hover:text-primary hover:bg-accent transition-colors"
					>
						<Brain class="h-4 w-4" />
					</button>
				</div>
			{/if}
		{:else}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="message-content text-sm leading-relaxed {effectiveRenderMode !== 'markdown' ? 'whitespace-pre-wrap' : ''}"
				onclick={(e) => {
					if (e.target instanceof HTMLImageElement) onimageClick(e.target.src);
				}}
			>
				{@html renderContent(message.content, isLiveStreamingBubble)}
			</div>
			{#if generatedImageUrl || generatedImageLoading}
				<!-- Image gen output: clicking opens the lightbox where the user
				     can swipe between regens, download, delete, etc. The bubble
				     image is the optimized webp; the lightbox requests the
				     original via ?original=1. -->
				<div class="mt-2 flex justify-center">
					<button
						type="button"
						onclick={ongeneratedImageClick}
						class="relative block w-[80%] overflow-hidden rounded-lg border border-border/50 bg-muted/40 transition-opacity hover:opacity-90"
						aria-label="View generated image"
					>
						{#if generatedImageUrl}
							<img src={generatedImageUrl} alt="Generated illustration" class="block max-h-80 w-full object-contain" />
							{#if generatedImageLoading}
								<div class="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/55">
									<div class="flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-xs text-white backdrop-blur-sm">
										<Loader2 class="h-4 w-4 animate-spin" />
										<span>Generating…</span>
									</div>
								</div>
							{/if}
						{:else}
							<div class="flex h-40 w-full items-center justify-center gap-2 text-xs text-muted-foreground">
								<Loader2 class="h-4 w-4 animate-spin" />
								Generating image…
							</div>
						{/if}
					</button>
				</div>
			{/if}
			{#if message.content.startsWith('Error:') && isLast && !isStreaming}
				<button
					onclick={onregenerate}
					class="mt-2 flex items-center gap-1.5 rounded-lg bg-destructive/15 px-3 py-1.5 text-xs font-medium text-destructive transition-all hover:bg-destructive/25 active:scale-95"
					aria-label="Retry message generation"
				>
					<RefreshCw class="h-3.5 w-3.5" />
					Retry
				</button>
			{/if}
		{/if}
		{#if isReformatting}
			<div class="reformatting-overlay pointer-events-none absolute inset-0 flex items-center justify-center gap-2 rounded-[inherit] bg-black/10 backdrop-blur-[1px]">
				<div class="flex items-center justify-center gap-2.5 drop-shadow">
					<span class="typing-dot h-3.5 w-3.5 rounded-full bg-foreground" style="animation-delay: 0ms"></span>
					<span class="typing-dot h-3.5 w-3.5 rounded-full bg-foreground" style="animation-delay: 160ms"></span>
					<span class="typing-dot h-3.5 w-3.5 rounded-full bg-foreground" style="animation-delay: 320ms"></span>
				</div>
			</div>
		{/if}
	</div>
</div>

<style>
	/* PERF-C4 / FRONT-C4: skip layout + paint for off-screen messages.
	 * `content-visibility: auto` is a free virtualization — the browser
	 * treats off-screen elements as if `visibility: hidden` for the
	 * purposes of layout/paint while still leaving them in the DOM for
	 * find-in-page, scroll anchoring, copy-paste, etc. The intrinsic
	 * size hint keeps the scrollbar honest before measurement.
	 * Doesn't apply during print so search/print stays intact. */
	@media not print {
		.msg-row {
			content-visibility: auto;
			contain-intrinsic-size: auto 200px;
		}
	}

	.typing-dot {
		animation: typing-bounce 1.2s ease-in-out infinite;
	}

	@keyframes typing-bounce {
		0%, 60%, 100% {
			transform: translateY(0);
			opacity: 0.35;
		}
		30% {
			transform: translateY(-6px);
			opacity: 1;
		}
	}

	/* Texting mode: iMessage-style bubble pop from right (user) */
	.msg-enter-texting-user {
		animation: msg-pop-right 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
	}

	@keyframes msg-pop-right {
		from { opacity: 0; transform: translateX(24px) scale(0.92); }
		to { opacity: 1; transform: translateX(0) scale(1); }
	}

	/* Texting mode: iMessage-style bubble pop from left (assistant) */
	.msg-enter-texting-assistant {
		animation: msg-pop-left 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
	}

	@keyframes msg-pop-left {
		from { opacity: 0; transform: translateX(-24px) scale(0.92); }
		to { opacity: 1; transform: translateX(0) scale(1); }
	}

	/* Story mode: elegant fade up */
	.msg-enter-story {
		animation: msg-fade-up 0.35s ease-out;
	}

	@keyframes msg-fade-up {
		from { opacity: 0; transform: translateY(14px); }
		to { opacity: 1; transform: translateY(0); }
	}

	.msg-exit {
		animation: msg-exit 0.3s ease-in forwards;
		pointer-events: none;
	}

	@keyframes msg-exit {
		to { opacity: 0; transform: scale(0.92) translateY(-8px); }
	}

	.msg-abort {
		animation: msg-abort-fade 0.25s ease-out forwards;
		pointer-events: none;
	}

	@keyframes msg-abort-fade {
		to { opacity: 0; transform: scale(0.96) translateY(6px); }
	}

	/* Story mode RP formatting */
	.message-content :global(.rp-thought) {
		font-style: italic;
		opacity: 0.55;
	}

	.message-content :global(.rp-code) {
		display: inline-block;
		background-color: color-mix(in oklch, var(--background) 85%, var(--foreground));
		border: 1px solid var(--border);
		border-radius: 0.375rem;
		padding: 0.125rem 0.5rem;
		font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace;
		font-size: 0.875em;
		white-space: pre-wrap;
	}

	/* Inline images: hidden until loaded, then fade in.
	 * The `.loaded` class is added by markdown-rendered <img> via JS on load. */
	.message-content :global(img) {
		opacity: 0;
		transition: opacity 0.15s ease-in;
	}

	.message-content :global(img.loaded) {
		opacity: 1;
	}

	.message-content :global(img:hover) {
		opacity: 0.8;
	}
</style>
