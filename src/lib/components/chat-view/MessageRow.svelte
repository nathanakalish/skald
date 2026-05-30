<script lang="ts">
	import { Archive, ChevronLeft, ChevronRight, Brain, RefreshCw, ImagePlus, Loader2, CornerRightUp, GitBranchPlus, Pencil, Wand2, UserPen, Copy, Trash2 } from 'lucide-svelte';
	import { tooltip } from '$lib/tooltip.js';
	import { haptic } from '$lib/utils/haptics';
	import { toasts } from '$lib/stores/toast.svelte.js';
	import MessageBubble from '$lib/components/MessageBubble.svelte';
	import type { Message, MessageImageRow, MessageSiblings } from '$lib/chat/message';
	import type { GuideTarget } from '$lib/chat/state/ui.svelte';

	// All the per-message callbacks the orchestrator wires up. Bundled into one
	// prop bag rather than 14 separate props to keep the call-site readable.
	export type MessageRowActions = {
		swipe: (idx: number, dir: -1 | 1) => void;
		startEdit: (msg: Message) => void;
		saveEdit: (idx: number) => void;
		cancelEdit: () => void;
		handleEditKeydown: (e: KeyboardEvent, idx: number) => void;
		regenerate: () => void;
		generateImage: (messageId: number) => void;
		resend: (idx: number) => void;
		reImpersonate: (idx: number) => void;
		reformatGreeting: (idx: number) => void;
		branchFromHere: (idx: number) => void;
		requestDelete: (idx: number) => void;
		openGuide: (target: GuideTarget, prefill: string) => void;
		openMsgMenu: (idx: number, e: MouseEvent) => void;
		startMsgLongPress: (idx: number, e: TouchEvent) => void;
		moveMsgLongPress: (e: TouchEvent) => void;
		endMsgLongPress: (e?: TouchEvent) => void;
		openLightbox: (messageId: number) => void;
		openReasoning: (msg: Message, isLive: boolean) => void;
		enlargeImage: (src: string) => void;
		openCompactionEditor: () => void;
	};

	type Props = {
		// Position
		message: Message;
		i: number;
		messageList: Message[];
		// Visual grouping (precomputed in orchestrator)
		consecutive: boolean;
		groupEnd: boolean;
		msgNumber: number;
		showDateSeparator: boolean;
		dateLabel: string;
		showCompactionIndicator: boolean;
		// State flags
		isCompacted: boolean;
		isLast: boolean;
		isExiting: boolean;
		isAborting: boolean;
		isSearchDimmed: boolean;
		isEditing: boolean;
		editContent: string;
		isStreaming: boolean;
		isImpersonating: boolean;
		isReasoning: boolean;
		isReformatting: boolean;
		isTexting: boolean;
		// Render config
		effectiveRenderMode: string;
		messageTimestamps: string;
		characterAvatarPath: string | null;
		characterName: string;
		personaAvatarPath: string | null;
		personaName: string;
		enterClass: string;
		// Helpers
		renderContent: (content: string, skipCache?: boolean) => string;
		getMessageTime: (createdAt: string | null) => string;
		// Per-message data
		messageImages: Record<number, MessageImageRow[]>;
		messageSiblings: MessageSiblings;
		imageGenInFlight: Map<number, number>;
		imageGenAvailable: boolean;
		streamingAssistantIdx: number;
		streamIsRegenerate: boolean;
		// Pinned-actions config + active impersonation swipe guidance
		pinnedActions: Set<string>;
		activeImpersonationGuidance: string | null;
		// Actions
		actions: MessageRowActions;
	};

	let {
		message,
		i,
		messageList,
		consecutive,
		groupEnd,
		msgNumber,
		showDateSeparator,
		dateLabel,
		showCompactionIndicator,
		isCompacted,
		isLast,
		isExiting,
		isAborting,
		isSearchDimmed,
		isEditing,
		editContent = $bindable(''),
		isStreaming,
		isImpersonating,
		isReasoning,
		isReformatting,
		isTexting,
		effectiveRenderMode,
		messageTimestamps,
		characterAvatarPath,
		characterName,
		personaAvatarPath,
		personaName,
		enterClass,
		renderContent,
		getMessageTime,
		messageImages,
		messageSiblings,
		imageGenInFlight,
		imageGenAvailable,
		streamingAssistantIdx,
		streamIsRegenerate,
		pinnedActions,
		activeImpersonationGuidance,
		actions
	}: Props = $props();

	// Image attached to the active swipe of this message. Mirrors the original
	// per-row @const block.
	const swipeMsgImages = $derived(
		(messageImages[message.id] ?? []).filter((im) => (im.swipeIndex ?? 0) === (message.swipeIndex ?? 0))
	);
	const activeMsgImage = $derived(
		swipeMsgImages.find((im) => im.isActive) ?? swipeMsgImages[swipeMsgImages.length - 1] ?? null
	);
	const isRegenStreamTarget = $derived(streamIsRegenerate && streamingAssistantIdx === i);
	const activeMsgImageUrl = $derived(
		(isRegenStreamTarget || !activeMsgImage) ? null : `/api/images/cache/${activeMsgImage.filePath}`
	);

	const parentMsg = $derived(message.parentId != null ? messageList.find((mm) => mm.id === message.parentId) : null);
	const assistantGuidance = $derived(message.role === 'assistant' ? (message.guidance ?? null) : null);
	const reasoningPresent = $derived(!!message.reasoning?.[message.swipeIndex]);

	// Visibility of each pinned action — all the same gates the original used.
	const pinShow = $derived({
		viewReasoning: pinnedActions.has('viewReasoning') && reasoningPresent,
		regenerate: pinnedActions.has('regenerate') && message.role === 'assistant' && isLast && (i !== 0 || isTexting) && !isCompacted,
		generateImage: pinnedActions.has('generateImage') && message.role === 'assistant' && imageGenAvailable && !isCompacted,
		resend: pinnedActions.has('resend') && message.role === 'user' && isLast && !isCompacted,
		branch: pinnedActions.has('branch') && !isLast && !isCompacted,
		edit: pinnedActions.has('edit') && !isCompacted && !isEditing,
		copy: pinnedActions.has('copy'),
		del: pinnedActions.has('delete') && i > 0 && !isCompacted,
		swipes: pinnedActions.has('swipes') && message.swipes.length > 1 && !(i === 0 && messageList.length > 1),
		guideReplyUser: pinnedActions.has('guideReply') && message.role === 'user' && isLast && !isCompacted,
		guideReplyAssistant: pinnedActions.has('guideReply') && message.role === 'assistant' && isLast && !isCompacted && parentMsg?.role === 'user',
		guideImpersonation: pinnedActions.has('guideImpersonation') && message.role === 'user' && isLast && !isCompacted,
		reimpersonate: pinnedActions.has('reimpersonate') && message.role === 'user' && isLast && !isCompacted,
		reformatGreeting: pinnedActions.has('reformatGreeting') && i === 0 && message.role === 'assistant' && !isCompacted
	});

	const hasPinned = $derived(
		pinShow.viewReasoning || pinShow.regenerate || pinShow.generateImage || pinShow.resend || pinShow.branch ||
		pinShow.edit || pinShow.copy || pinShow.del || pinShow.swipes || pinShow.guideReplyUser ||
		pinShow.guideReplyAssistant || pinShow.guideImpersonation || pinShow.reimpersonate || pinShow.reformatGreeting
	);

	// Hide the pinned toolbar while the row is collapsing out of existence
	// — otherwise the buttons jump around during the delete animation.
	const showToolbar = $derived(hasPinned && groupEnd && !isExiting);

	async function copyToClipboard() {
		try {
			await navigator.clipboard.writeText(message.content);
			haptic('success');
			toasts.success('Copied');
		} catch {
			toasts.error('Copy failed');
		}
	}
</script>

{#if message.role !== 'system'}
	{#if showCompactionIndicator}
		<div class="flex items-center gap-3 py-2">
			<div class="h-px flex-1 bg-primary/30"></div>
			<button
				type="button"
				onclick={actions.openCompactionEditor}
				class="flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/20"
				use:tooltip={'View or edit the compaction summary'}
			>
				<Archive class="h-3 w-3" /> Conversation compacted
			</button>
			<div class="h-px flex-1 bg-primary/30"></div>
		</div>
	{/if}

	{#if showDateSeparator}
		<div class="flex items-center gap-3 py-2">
			<div class="h-px flex-1 bg-border/50"></div>
			<span class="text-[11px] font-medium text-muted-foreground">{dateLabel}</span>
			<div class="h-px flex-1 bg-border/50"></div>
		</div>
	{/if}

	<MessageBubble
		{message}
		generatedImageUrl={activeMsgImageUrl}
		generatedImageLoading={imageGenInFlight.get(message.id) === (message.swipeIndex ?? 0)}
		ongeneratedImageClick={() => actions.openLightbox(message.id)}
		{consecutive}
		{groupEnd}
		{msgNumber}
		{isCompacted}
		{isLast}
		{isExiting}
		{isAborting}
		{isSearchDimmed}
		{isEditing}
		bind:editContent
		{isStreaming}
		{isImpersonating}
		{isReasoning}
		{isReformatting}
		{effectiveRenderMode}
		{messageTimestamps}
		{characterAvatarPath}
		{characterName}
		{personaAvatarPath}
		{personaName}
		{enterClass}
		{renderContent}
		{getMessageTime}
		onsaveEdit={() => actions.saveEdit(i)}
		oncancelEdit={actions.cancelEdit}
		onhandleEditKeydown={(e) => actions.handleEditKeydown(e, i)}
		onregenerate={() => actions.regenerate()}
		onopenMenu={(e) => actions.openMsgMenu(i, e)}
		onstartLongPress={(e) => actions.startMsgLongPress(i, e)}
		onmoveLongPress={(e) => actions.moveMsgLongPress(e)}
		onendLongPress={(e) => actions.endMsgLongPress(e)}
		onopenReasoning={(isLive) => actions.openReasoning(message, isLive)}
		onimageClick={(src) => actions.enlargeImage(src)}
		onenlargeAvatar={(src) => actions.enlargeImage(src)}
	/>

	{#if showToolbar}
		<div class="mt-0.5 flex items-center gap-0.5 text-muted-foreground {message.role === 'user' ? 'justify-end' : 'justify-start md:pl-12'}">
			{#if pinShow.swipes}
				<button
					type="button"
					onclick={() => actions.swipe(i, -1)}
					disabled={isStreaming}
					class="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
					use:tooltip={'Previous swipe'}
					aria-label="Previous swipe"
				>
					<ChevronLeft class="h-3.5 w-3.5" />
				</button>
				<span class="px-1 text-xs tabular-nums">{message.swipeIndex + 1}/{message.swipes.length}</span>
				<button
					type="button"
					onclick={() => actions.swipe(i, 1)}
					disabled={isStreaming}
					class="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
					use:tooltip={'Next swipe'}
					aria-label="Next swipe"
				>
					<ChevronRight class="h-3.5 w-3.5" />
				</button>
			{/if}
			{#if pinShow.viewReasoning}
				<button
					type="button"
					onclick={() => actions.openReasoning(message, false)}
					class="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-foreground"
					use:tooltip={'View reasoning'}
					aria-label="View reasoning"
				>
					<Brain class="h-3.5 w-3.5" />
				</button>
			{/if}
			{#if pinShow.regenerate}
				<button
					type="button"
					onclick={() => actions.regenerate()}
					disabled={isStreaming}
					class="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
					use:tooltip={'Regenerate'}
					aria-label="Regenerate"
				>
					<RefreshCw class="h-3.5 w-3.5" />
				</button>
			{/if}
			{#if pinShow.generateImage}
				<button
					type="button"
					onclick={() => actions.generateImage(message.id)}
					disabled={imageGenInFlight.has(message.id)}
					class="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
					use:tooltip={'Generate image'}
					aria-label="Generate image"
				>
					{#if imageGenInFlight.has(message.id)}
						<Loader2 class="h-3.5 w-3.5 animate-spin" />
					{:else}
						<ImagePlus class="h-3.5 w-3.5" />
					{/if}
				</button>
			{/if}
			{#if pinShow.resend}
				<button
					type="button"
					onclick={() => actions.resend(i)}
					disabled={isStreaming}
					class="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
					use:tooltip={'Resend'}
					aria-label="Resend"
				>
					<CornerRightUp class="h-3.5 w-3.5" />
				</button>
			{/if}
			{#if pinShow.branch}
				<button
					type="button"
					onclick={() => actions.branchFromHere(i)}
					disabled={isStreaming}
					class="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
					use:tooltip={'Branch from here'}
					aria-label="Branch from here"
				>
					<GitBranchPlus class="h-3.5 w-3.5" />
				</button>
			{/if}
			{#if pinShow.edit}
				<button
					type="button"
					onclick={() => actions.startEdit(message)}
					disabled={isStreaming}
					class="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
					use:tooltip={'Edit'}
					aria-label="Edit"
				>
					<Pencil class="h-3.5 w-3.5" />
				</button>
			{/if}
			{#if pinShow.guideReplyUser}
				<button
					type="button"
					onclick={() => actions.openGuide({ kind: 'guideReply', userMessageId: message.id }, message.guidance ?? '')}
					disabled={isStreaming}
					class="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
					use:tooltip={message.guidance ? 'Edit reply guidance' : 'Guide reply'}
					aria-label="Guide reply"
				>
					<Wand2 class="h-3.5 w-3.5" />
				</button>
			{/if}
			{#if pinShow.guideReplyAssistant}
				<button
					type="button"
					onclick={() => actions.openGuide({ kind: 'editAssistantGuidance', assistantMessageId: message.id }, assistantGuidance ?? '')}
					disabled={isStreaming}
					class="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
					use:tooltip={assistantGuidance ? 'Edit reply guidance' : 'Guide reply'}
					aria-label="Guide reply"
				>
					<Wand2 class="h-3.5 w-3.5" />
				</button>
			{/if}
			{#if pinShow.guideImpersonation}
				<button
					type="button"
					onclick={() => actions.openGuide({ kind: 'impersonate' }, activeImpersonationGuidance ?? '')}
					disabled={isStreaming}
					class="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
					use:tooltip={activeImpersonationGuidance ? 'Edit impersonation guidance' : 'Guide impersonation'}
					aria-label="Guide impersonation"
				>
					<Wand2 class="h-3.5 w-3.5" />
				</button>
			{/if}
			{#if pinShow.reimpersonate}
				<button
					type="button"
					onclick={() => actions.reImpersonate(i)}
					disabled={isStreaming}
					class="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
					use:tooltip={'Re-impersonate'}
					aria-label="Re-impersonate"
				>
					<UserPen class="h-3.5 w-3.5" />
				</button>
			{/if}
			{#if pinShow.reformatGreeting}
				<button
					type="button"
					onclick={() => actions.reformatGreeting(i)}
					disabled={isStreaming}
					class="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
					use:tooltip={'Reformat greeting'}
					aria-label="Reformat greeting"
				>
					<Wand2 class="h-3.5 w-3.5" />
				</button>
			{/if}
			{#if pinShow.copy}
				<button
					type="button"
					onclick={copyToClipboard}
					class="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-foreground"
					use:tooltip={'Copy'}
					aria-label="Copy"
				>
					<Copy class="h-3.5 w-3.5" />
				</button>
			{/if}
			{#if pinShow.del}
				<button
					type="button"
					onclick={() => actions.requestDelete(i)}
					disabled={isStreaming}
					class="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40 disabled:pointer-events-none"
					use:tooltip={'Delete'}
					aria-label="Delete"
				>
					<Trash2 class="h-3.5 w-3.5" />
				</button>
			{/if}
		</div>
	{/if}
{/if}
