<script lang="ts">
	import { ChevronLeft, ChevronRight, GitBranch, GitBranchPlus, Brain, RefreshCw, ImagePlus, CornerRightUp, Wand2, UserPen, Pencil, Copy, Trash2 } from 'lucide-svelte';
	import { tooltip } from '$lib/tooltip.js';
	import { haptic } from '$lib/utils/haptics';
	import { toasts } from '$lib/stores/toast.svelte.js';
	import type { Message, MessageSiblings } from '$lib/chat/message';
	import type { GuideTarget } from '$lib/chat/state/ui.svelte';
	import type { MenuPosition } from '$lib/chat/utils/menuPositioning';

	// Same set the orchestrator already feeds to MessageRow's actions bag.
	// Reusing the type keeps the wiring uniform.
	export type MessageContextActions = {
		swipe: (idx: number, dir: -1 | 1) => Promise<void> | void;
		switchBranch: (messageId: number, dir: -1 | 1) => void;
		regenerate: () => void;
		generateImage: (messageId: number) => void;
		resend: (idx: number) => void;
		reImpersonate: (idx: number) => void;
		reformatGreeting: (idx: number) => void;
		branchFromHere: (idx: number) => void;
		startEdit: (msg: Message) => void;
		requestDelete: (idx: number) => void;
		openGuide: (target: GuideTarget, prefill: string) => void;
		openReasoning: (msg: Message, isLive: boolean) => void;
		// Used so the menu can briefly suppress messages-container scroll-pin during swipe.
		setScrollSuppressed: (v: boolean) => void;
		close: () => void;
	};

	type Props = {
		idx: number | null;
		position: MenuPosition | null;
		messageList: Message[];
		messageSiblings: MessageSiblings;
		isCompacted: (messageId: number) => boolean;
		isStreaming: boolean;
		isTexting: boolean;
		imageGenAvailable: boolean;
		imageGenInFlight: Map<number, number>;
		pinnedActions: Set<string>;
		// Guidance text for the active impersonation swipe — passed in so this
		// component stays read-only over the orchestrator's impersonation state.
		activeImpersonationGuidance: string | null;
		actions: MessageContextActions;
	};

	let {
		idx,
		position,
		messageList,
		messageSiblings,
		isCompacted,
		isStreaming,
		isTexting,
		imageGenAvailable,
		imageGenInFlight,
		pinnedActions,
		activeImpersonationGuidance,
		actions
	}: Props = $props();

	const menuMsg = $derived(idx !== null ? messageList[idx] : null);
	const menuIsLast = $derived(idx !== null && idx === messageList.length - 1);
	const menuIsLastAssistant = $derived(!!menuMsg && menuMsg.role === 'assistant' && menuIsLast);
	const menuIsLastUser = $derived(!!menuMsg && menuMsg.role === 'user' && menuIsLast);
	const menuIsFirst = $derived(idx === 0);
	const menuShowRegen = $derived(menuIsLastAssistant && (!menuIsFirst || isTexting));
	const menuSiblings = $derived(menuMsg ? messageSiblings[menuMsg.id] : undefined);
	const menuHasBranches = $derived(!!menuSiblings && menuSiblings.total > 1);
	const menuIsCompacted = $derived(!!menuMsg && isCompacted(menuMsg.id));
	const menuParentMsg = $derived(menuMsg && menuMsg.parentId != null ? messageList.find((mm) => mm.id === menuMsg!.parentId) : null);
	const menuAssistantGuidance = $derived(menuMsg && menuMsg.role === 'assistant' ? (menuMsg.guidance ?? null) : null);
	// First-message guard: once the greeting has any replies, swipes are
	// locked because changing them would orphan the children.
	const menuGreetingLocked = $derived(menuIsFirst && messageList.length > 1);

	const menuVisibleCount = $derived.by(() => {
		if (!menuMsg || idx === null) return 0;
		let n = 0;
		if (menuMsg.swipes.length > 1 && !pinnedActions.has('swipes') && !menuGreetingLocked) n++;
		if (menuHasBranches) n++;
		if (menuMsg.reasoning[menuMsg.swipeIndex] && !pinnedActions.has('viewReasoning')) n++;
		if (menuShowRegen && !menuIsCompacted && !pinnedActions.has('regenerate')) n++;
		if (menuMsg.role === 'assistant' && !menuIsCompacted && imageGenAvailable && !pinnedActions.has('generateImage')) n++;
		if (menuIsLastUser && !menuIsCompacted && !pinnedActions.has('resend')) n++;
		if (menuIsLastUser && !menuIsCompacted && !pinnedActions.has('guideReply')) n++;
		if (menuIsLastUser && !menuIsCompacted && !pinnedActions.has('reimpersonate')) n++;
		if (menuMsg.role === 'user' && menuIsLast && !menuIsCompacted && !pinnedActions.has('guideImpersonation')) n++;
		if (menuMsg.role === 'user' && !menuIsLast && !menuIsCompacted && menuMsg.impersonationGuidance) n++;
		if (menuIsLastAssistant && menuParentMsg && menuParentMsg.role === 'user' && !menuIsCompacted && !pinnedActions.has('guideReply')) n++;
		if (!menuIsLast && !menuIsCompacted && !pinnedActions.has('branch')) n++;
		if (menuIsFirst && menuMsg.role === 'assistant' && !menuIsCompacted && !pinnedActions.has('reformatGreeting')) n++;
		if (!pinnedActions.has('edit')) n++;
		if (!pinnedActions.has('copy')) n++;
		if (idx > 0 && !menuIsCompacted && !pinnedActions.has('delete')) n++;
		return n;
	});

	async function copyMenuContent() {
		if (!menuMsg) return;
		try {
			await navigator.clipboard.writeText(menuMsg.content);
			haptic('success');
			toasts.success('Copied');
		} catch {
			toasts.error('Copy failed');
		}
		actions.close();
	}
</script>

{#if idx !== null && position && menuMsg}
	<div
		data-msg-menu
		class="popup-menu fixed z-[60] w-[200px] rounded-xl border border-border/40 bg-card/70 py-1 shadow-2xl backdrop-blur-md"
		style="--popup-origin: {position.flipUp ? 'bottom' : 'top'} left; left: {position.x}px; {position.flipUp ? 'bottom' : 'top'}: {position.flipUp ? (position.viewportH - position.y) + 'px' : position.y + 'px'}"
	>
		{#if menuMsg.swipes.length > 1 && !pinnedActions.has('swipes') && !menuGreetingLocked}
			<div class="flex items-center justify-center gap-1 px-3 py-1.5">
				<button
					type="button"
					onclick={() => { actions.setScrollSuppressed(true); Promise.resolve(actions.swipe(idx!, -1)).finally(() => actions.setScrollSuppressed(false)); }}
					disabled={isStreaming || menuMsg.swipes.length <= 1}
					class="flex h-7 w-7 items-center justify-center rounded text-foreground/60 transition-colors hover:text-foreground disabled:opacity-30"
				>
					<ChevronLeft class="h-4 w-4" />
				</button>
				<span class="text-xs tabular-nums text-muted-foreground">
					{menuMsg.swipeIndex + 1}/{menuMsg.swipes.length}
				</span>
				<button
					type="button"
					onclick={() => { actions.setScrollSuppressed(true); Promise.resolve(actions.swipe(idx!, 1)).finally(() => actions.setScrollSuppressed(false)); }}
					disabled={isStreaming || menuMsg.swipes.length <= 1}
					class="flex h-7 w-7 items-center justify-center rounded text-foreground/60 transition-colors hover:text-foreground disabled:opacity-30"
				>
					<ChevronRight class="h-4 w-4" />
				</button>
			</div>
			<div class="my-0.5 h-px bg-border"></div>
		{/if}

		{#if menuHasBranches && menuSiblings}
			<div class="flex items-center justify-center gap-1 px-3 py-1.5">
				<GitBranch class="h-3.5 w-3.5 text-muted-foreground/60" />
				<button
					type="button"
					onclick={() => { actions.switchBranch(menuMsg.id, -1); actions.close(); }}
					disabled={isStreaming || menuSiblings.index <= 0}
					class="flex h-7 w-7 items-center justify-center rounded text-foreground/60 transition-colors hover:text-foreground disabled:opacity-30"
				>
					<ChevronLeft class="h-4 w-4" />
				</button>
				<span class="text-xs tabular-nums text-muted-foreground">
					{menuSiblings.index + 1}/{menuSiblings.total}
				</span>
				<button
					type="button"
					onclick={() => { actions.switchBranch(menuMsg.id, 1); actions.close(); }}
					disabled={isStreaming || menuSiblings.index >= menuSiblings.total - 1}
					class="flex h-7 w-7 items-center justify-center rounded text-foreground/60 transition-colors hover:text-foreground disabled:opacity-30"
				>
					<ChevronRight class="h-4 w-4" />
				</button>
			</div>
			<div class="my-0.5 h-px bg-border"></div>
		{/if}

		{#if menuMsg.reasoning[menuMsg.swipeIndex] && !pinnedActions.has('viewReasoning')}
			<button
				type="button"
				onclick={() => { actions.openReasoning(menuMsg, false); actions.close(); }}
				class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
			>
				<Brain class="h-4 w-4" />View reasoning
			</button>
		{/if}

		{#if menuShowRegen && !menuIsCompacted && !pinnedActions.has('regenerate')}
			<button
				type="button"
				onclick={() => { actions.regenerate(); actions.close(); }}
				disabled={isStreaming}
				class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-40 disabled:pointer-events-none"
			>
				<RefreshCw class="h-4 w-4" />Regenerate
			</button>
		{/if}

		{#if menuMsg.role === 'assistant' && !menuIsCompacted && imageGenAvailable && !pinnedActions.has('generateImage')}
			<button
				type="button"
				onclick={() => { actions.generateImage(menuMsg.id); actions.close(); }}
				disabled={imageGenInFlight.has(menuMsg.id)}
				class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-40 disabled:pointer-events-none"
			>
				<ImagePlus class="h-4 w-4" />Generate image
			</button>
		{/if}

		{#if menuIsLastUser && !menuIsCompacted}
			{#if !pinnedActions.has('resend')}
				<button
					type="button"
					onclick={() => { actions.resend(idx!); actions.close(); }}
					disabled={isStreaming}
					class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-40 disabled:pointer-events-none"
				>
					<CornerRightUp class="h-4 w-4" />Resend
				</button>
			{/if}
			{#if !pinnedActions.has('guideReply')}
				<button
					type="button"
					onclick={() => {
						const id = menuMsg.id;
						const g = menuMsg.guidance ?? '';
						actions.close();
						actions.openGuide({ kind: 'guideReply', userMessageId: id }, g);
					}}
					disabled={isStreaming}
					class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-40 disabled:pointer-events-none"
				>
					<Wand2 class="h-4 w-4" />{menuMsg.guidance ? 'Edit reply guidance…' : 'Guide reply…'}
				</button>
			{/if}
			{#if !pinnedActions.has('reimpersonate')}
				<button
					type="button"
					onclick={() => { actions.reImpersonate(idx!); actions.close(); }}
					disabled={isStreaming}
					class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-40 disabled:pointer-events-none"
				>
					<UserPen class="h-4 w-4" />Re-impersonate
				</button>
			{/if}
		{/if}

		{#if menuMsg.role === 'user' && menuIsLast && !menuIsCompacted && !pinnedActions.has('guideImpersonation')}
			<button
				type="button"
				onclick={() => { actions.close(); actions.openGuide({ kind: 'impersonate' }, activeImpersonationGuidance ?? ''); }}
				disabled={isStreaming}
				class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-40 disabled:pointer-events-none"
			>
				<Wand2 class="h-4 w-4" />{activeImpersonationGuidance ? 'Edit impersonation guidance…' : 'Guide impersonation…'}
			</button>
		{/if}

		{#if menuMsg.role === 'user' && !menuIsLast && !menuIsCompacted && menuMsg.impersonationGuidance}
			<!-- 2nd-latest user message: show the impersonation guidance read-only
			     so the user can see what they used, but can't edit it now that the
			     impersonation round has already produced a reply. -->
			<button
				type="button"
				onclick={() => {
					const g = menuMsg.impersonationGuidance ?? '';
					actions.close();
					actions.openGuide({ kind: 'impersonateView' }, g);
				}}
				class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
			>
				<Wand2 class="h-4 w-4" />View impersonation guidance
			</button>
		{/if}

		{#if menuIsLastAssistant && menuParentMsg && menuParentMsg.role === 'user' && !menuIsCompacted && !pinnedActions.has('guideReply')}
			<button
				type="button"
				onclick={() => {
					const id = menuMsg.id;
					const g = menuAssistantGuidance ?? '';
					actions.close();
					actions.openGuide({ kind: 'editAssistantGuidance', assistantMessageId: id }, g);
				}}
				disabled={isStreaming}
				class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-40 disabled:pointer-events-none"
			>
				<Wand2 class="h-4 w-4" />{menuAssistantGuidance ? 'Edit reply guidance…' : 'Guide reply…'}
			</button>
		{/if}

		{#if !menuIsLast && !menuIsCompacted && !pinnedActions.has('branch')}
			<button
				type="button"
				onclick={() => { actions.branchFromHere(idx!); actions.close(); }}
				disabled={isStreaming}
				class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-40 disabled:pointer-events-none"
			>
				<GitBranchPlus class="h-4 w-4" />Branch from here
			</button>
		{/if}

		{#if menuIsFirst && menuMsg.role === 'assistant' && !menuIsCompacted && !pinnedActions.has('reformatGreeting')}
			<button
				type="button"
				onclick={() => { actions.reformatGreeting(idx!); actions.close(); }}
				disabled={isStreaming}
				class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-40 disabled:pointer-events-none"
			>
				<Wand2 class="h-4 w-4" />Reformat greeting
			</button>
		{/if}

		{#if !pinnedActions.has('edit')}
			<button
				type="button"
				onclick={() => { actions.startEdit(menuMsg); actions.close(); }}
				disabled={isStreaming || menuIsCompacted}
				class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-40 disabled:pointer-events-none"
				use:tooltip={menuIsCompacted ? 'Compacted messages cannot be edited' : ''}
			>
				<Pencil class="h-4 w-4" />Edit
			</button>
		{/if}

		{#if !pinnedActions.has('copy')}
			<button
				type="button"
				onclick={copyMenuContent}
				class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
			>
				<Copy class="h-4 w-4" />Copy
			</button>
		{/if}

		{#if idx > 0 && !menuIsCompacted && !pinnedActions.has('delete')}
			<div class="my-1 h-px bg-border"></div>
			<button
				type="button"
				onclick={() => { actions.requestDelete(idx!); actions.close(); }}
				disabled={isStreaming}
				class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-40 disabled:pointer-events-none"
			>
				<Trash2 class="h-4 w-4" />Delete
			</button>
		{/if}

		{#if menuVisibleCount === 0}
			<div class="px-3 py-2 text-center text-sm italic text-muted-foreground/60">Empty</div>
		{/if}
	</div>
{/if}
