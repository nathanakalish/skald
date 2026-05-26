<script lang="ts">
	import { Send, Square, Bot, ChevronLeft, ChevronRight, RefreshCw, Pencil, Trash2, Check, X, CornerRightUp, UserPen, GitBranch, GitBranchPlus, Undo2, ArrowDown, SlidersHorizontal, Brain, Smartphone, BookOpen, Info, Wand2, BookMarked, Search, MoreHorizontal, Copy, Loader2, Archive, ImagePlus, Download } from 'lucide-svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { tick, untrack } from 'svelte';
	import { marked } from 'marked';
	import DOMPurify from 'isomorphic-dompurify';
	import ImageLightbox from '$lib/components/ImageLightbox.svelte';
	import MessageBubble from '$lib/components/MessageBubble.svelte';
	import ChatSettings from '$lib/components/ChatSettings.svelte';
	import ReasoningModal from '$lib/components/ReasoningModal.svelte';
	import CharacterInfoModal from '$lib/components/CharacterInfoModal.svelte';
	import CharacterLorebooksModal from '$lib/components/CharacterLorebooksModal.svelte';
	import GreetingReviewModal from '$lib/components/GreetingReviewModal.svelte';
	import ChatHeaderMenu from '$lib/components/ChatHeaderMenu.svelte';
	import { haptic } from '$lib/utils/haptics.js';
	import { renderRoleplay as renderRoleplayUtil } from '$lib/utils/rp-format.js';
	import { toasts } from '$lib/stores/toast.svelte.js';
	import { saveScroll, loadScroll } from '$lib/stores/scrollMemory.js';
	import { generationsStore } from '$lib/stores/generations.svelte.js';
	import { LinkValidator } from '$lib/chat/linkValidation.svelte.js';
	import { TextareaAutosizer } from '$lib/chat/textareaAutosize.svelte.js';
	import { parseImpersonationSwipes, type ImpersonationSwipe as ImpersonationSwipeEntry } from '$lib/chat/impersonationSwipes.js';
	import { parseSwipes, parseReasoning } from '$lib/messageJson.js';
	import { settingsStore } from '$lib/stores/settings.svelte.js';
	import { tooltip } from '$lib/tooltip.js';
	import { pickCharacterTheme, characterHasAnyTheme } from '$lib/theme/characterTheme.js';
	import LimitedTextarea from '$lib/components/LimitedTextarea.svelte';
	import { checkFieldLimits } from '$lib/limitCheck.js';
	import { playMessageBeep } from '$lib/utils/notificationSound.js';
	import { FIELD_LIMITS } from '$lib/fieldLimits.js';

	let { chat, character, initialMessages, initialMessageImages = {}, initialPendingImageGens = [], messageSiblingsData, hiddenBranchData, totalMessageCount = 0, providers, personas, allLorebooks = [], onrefresh, streamEvent, ontogglemobile, totalUnread = 0, sendWithEnterDesktop = true, sendWithEnterMobile = true, autoScrollThreshold = 'normal', confirmDeletions = true, messageTimestamps = 'relative', showReasoning = false, chatPageSize = 50, renderMode = 'roleplay', reduceMotion = false, blockExternalContent = false, nestedEmphasisInSpeech = true, dismissKeyboardOnScroll = true, connectionState = 'connected' }: {
		chat: any;
		character: any;
		initialMessages: any[];
		initialMessageImages?: Record<number, MessageImageRow[]>;
		initialPendingImageGens?: Array<{ messageId: number; swipeIndex: number }>;
		messageSiblingsData: Record<number, { index: number; total: number }>;
		hiddenBranchData: number;
		totalMessageCount?: number;
		providers: any[];
		personas: any[];
		allLorebooks?: any[];
		onrefresh: () => Promise<void>;
		streamEvent: { seq: number; type: string; chatId: number; data: any } | null;
		ontogglemobile?: () => void;
		totalUnread?: number;
		sendWithEnterDesktop?: boolean;
		sendWithEnterMobile?: boolean;
		autoScrollThreshold?: string;
		confirmDeletions?: boolean;
		messageTimestamps?: string;
		showReasoning?: boolean;
		chatPageSize?: number;
		renderMode?: string;
		reduceMotion?: boolean;
		blockExternalContent?: boolean;
		nestedEmphasisInSpeech?: boolean;
		dismissKeyboardOnScroll?: boolean;
		connectionState?: 'connecting' | 'connected' | 'reconnecting' | 'failed';
	} = $props();

	// Resolve the active provider for this chat
	let activeProvider = $derived.by(() => {
		if (chat.overrideProviderId) {
			return providers.find((p: any) => p.id === chat.overrideProviderId) ?? providers.find((p: any) => p.enabled) ?? null;
		}
		return providers.find((p: any) => p.enabled) ?? null;
	});

	// Image-gen availability for this chat. Mirrors the server's resolution:
	// chat image override > chat text override > first-enabled provider.
	// We check whether the resolved provider actually has an image model OR a
	// ComfyUI workflow configured — otherwise the pinned button / context menu
	// item should stay hidden and the API call would error anyway.
	let imageProvider = $derived.by(() => {
		const id = chat.overrideImageProviderId ?? chat.overrideProviderId ?? null;
		if (id) return providers.find((p: any) => p.id === id) ?? null;
		return providers.find((p: any) => p.enabled) ?? null;
	});
	let imageGenAvailable = $derived.by(() => {
		const p = imageProvider;
		if (!p) return false;
		if (chat.overrideImageModel) return true;
		if (p.type === 'comfyui') return !!p.imageComfyWorkflow && !!p.imageComfyPromptNodeId;
		return !!p.imageModel;
	});

	let showChatSettings = $state(false);
	let showCharacterInfo = $state(false);
	let showCharacterLorebooks = $state(false);
	let showHeaderMenu = $state(false);
	let compactingNow = $state(false);
	let showCompactionEditor = $state(false);
	let compactionEditorDraft = $state('');
	let savingCompactionSummary = $state(false);

	function isMessageCompacted(messageId: number | undefined): boolean {
		if (!messageId) return false;
		const upTo = chat.compactedUpToMessageId ?? 0;
		return upTo > 0 && messageId <= upTo;
	}

	async function runManualCompaction() {
		if (compactingNow) return;
		compactingNow = true;
		try {
			const res = await fetch(`/api/chats/${chat.id}/compact`, { method: 'POST' });
			if (res.ok) {
				const data = await res.json();
				toasts.success(`Compacted ${data.compactedCount} message${data.compactedCount === 1 ? '' : 's'}`);
				await onrefresh?.();
			} else {
				const data = await res.json().catch(() => ({}));
				toasts.error(data.reason ? `Compaction skipped: ${data.reason}` : 'Compaction failed');
			}
		} catch {
			toasts.error('Compaction failed');
		} finally {
			compactingNow = false;
		}
	}

	function openCompactionEditor() {
		compactionEditorDraft = chat.compactionSummary ?? '';
		showCompactionEditor = true;
	}

	async function saveCompactionSummary() {
		if (savingCompactionSummary) return;
		const ok = await checkFieldLimits([
			{ label: 'Compaction summary', value: compactionEditorDraft, limit: FIELD_LIMITS.compactionSummary, trim: (v) => (compactionEditorDraft = v) },
		]);
		if (!ok) return;
		savingCompactionSummary = true;
		try {
			const res = await fetch(`/api/chats/${chat.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ compactionSummary: compactionEditorDraft.trim() ? compactionEditorDraft : null })
			});
			if (res.ok) {
				toasts.success('Summary saved');
				showCompactionEditor = false;
				await onrefresh?.();
			} else {
				toasts.error('Failed to save summary');
			}
		} finally {
			savingCompactionSummary = false;
		}
	}

	function closeHeaderMenu() { showHeaderMenu = false; }
	$effect(() => {
		if (!showHeaderMenu) return;
		const onDoc = (e: MouseEvent) => {
			if (!(e.target as HTMLElement).closest('[data-header-menu]')) closeHeaderMenu();
		};
		const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeHeaderMenu(); };
		// Defer adding the click listener so the click that opened the menu
		// doesn't immediately close it.
		const attachTimer = setTimeout(() => document.addEventListener('click', onDoc), 0);
		document.addEventListener('keydown', onKey);
		return () => {
			clearTimeout(attachTimer);
			document.removeEventListener('click', onDoc);
			document.removeEventListener('keydown', onKey);
		};
	});

	// Message search
	let messageSearchOpen = $state(false);
	let messageSearchQuery = $state('');
	let messageSearchInputEl: HTMLInputElement | undefined = $state();
	let messageSearchMatches = $derived.by(() => {
		const q = messageSearchQuery.trim().toLowerCase();
		if (!q) return new Set<number>();
		const ids = new Set<number>();
		for (const m of messageList) {
			if (m.content.toLowerCase().includes(q)) ids.add(m.id);
		}
		return ids;
	});

	function toggleMessageSearch() {
		messageSearchOpen = !messageSearchOpen;
		if (messageSearchOpen) tick().then(() => messageSearchInputEl?.focus());
		else messageSearchQuery = '';
	}

	// Check if this chat has any overrides active
	let hasOverrides = $derived(
		chat.overrideProviderId != null ||
		!!chat.overrideModel ||
		chat.overrideTemperature != null ||
		chat.overrideMaxTokens != null ||
		!!chat.overrideCustomPrompt ||
		!!chat.overrideReasoningEffort ||
		!!chat.overrideRenderMode
	);

	// Effective render mode: per-chat override wins, then global setting
	let effectiveRenderMode = $derived(chat.overrideRenderMode ?? renderMode);

	interface Message {
		id: number;
		role: string;
		content: string;
		swipes: string[];
		swipeIndex: number;
		reasoning: string[];
		parentId: number | null;
		createdAt: string | null;
		guidance: string | null;
		impersonationGuidance: string | null;
	}

	interface MessageImageRow {
		id: number;
		messageId: number;
		swipeIndex: number;
		filePath: string;
		prompt: string;
		model: string;
		providerId: number | null;
		isActive: boolean;
		createdAt: string | null;
	}

	// Monotonic negative IDs for client-side message placeholders. Real DB IDs are positive,
	// so negatives never collide with persisted messages and decrement guarantees uniqueness
	// even within the same millisecond (replaces unsafe Date.now() / Date.now()+1 pattern).
	let placeholderIdSeq = -Date.now();
	function nextPlaceholderId(): number {
		return --placeholderIdSeq;
	}

	// Pick the right initial textarea value for a chat. Priority order:
	//   1. Live impersonation stream — start blank so streaming tokens fill it.
	//   2. Fresh impersonation draft (status=done) we haven't seen — gates on
	//      generatedAt to avoid clobbering local edits on remount.
	//   3. Server-persisted unsent draft (chat.pendingDraft) when it's newer
	//      than this device's local draft — cross-device sync entry point.
	//   4. Local draft from localStorage — offline-survival fallback.
	function pickDraftForChat(c: typeof chat): string {
		const localStr = (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function')
			? localStorage.getItem(`skald-draft-${c.id}`) || ''
			: '';
		const localAt = (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function')
			? Number(localStorage.getItem(`skald-draft-${c.id}-at`) || '0')
			: 0;

		const status = (c as any).impersonationStatus as string | null | undefined;
		if (status === 'streaming') return '';

		const swipes = parseImpersonationSwipes((c as any).impersonationSwipes);
		const idx = (c as any).impersonationSwipeIndex ?? 0;
		const active = swipes[idx];
		if (status === 'done' && active?.draft && active.generatedAt && typeof localStorage !== 'undefined') {
			const seen = localStorage.getItem(`skald-impersonation-seen-${c.id}`);
			if (seen !== active.generatedAt) {
				localStorage.setItem(`skald-impersonation-seen-${c.id}`, active.generatedAt);
				return active.draft;
			}
		}

		// Server draft beats local when its timestamp is newer (i.e. another
		// device typed something more recently than this one). Equal timestamps
		// favour local — avoids a no-op clobber on the same device's remount.
		const serverDraft = (c as any).pendingDraft as string | null | undefined;
		const serverAt = (c as any).pendingDraftAt ?? 0;
		if (serverAt > localAt && serverDraft != null) return serverDraft;

		return localStr;
	}

	function parseMessage(m: any): Message {
		let swipes = parseSwipes(m.swipes);
		if (swipes.length === 0) swipes = [m.content];
		const reasoning = parseReasoning(m.reasoning);
		return {
			id: m.id,
			role: m.role,
			content: m.content,
			swipes,
			swipeIndex: m.swipeIndex ?? 0,
			reasoning,
			parentId: m.parentId ?? null,
			createdAt: m.createdAt ?? null,
			guidance: m.guidance ?? null,
			impersonationGuidance: m.impersonationGuidance ?? null
		};
	}

	async function loadEarlierMessages() {
		if (loadingMore || !hasMore || !chatPageSize) return;
		loadingMore = true;
		try {
			const offset = messageList.length;
			const res = await fetch(`/api/chats/${chat.id}/data?limit=${chatPageSize}&offset=${offset}`);
			if (!res.ok) return;
			const data = await res.json();
			const earlier = (data.messages ?? []).map(parseMessage);
			if (earlier.length > 0) {
				// Prepend the new messages and reveal them immediately. We
				// deliberately don't bump renderedStart by earlier.length any
				// more — the button is a user action and should produce a
				// visible result. flex-col-reverse + overflow-anchor:none keeps
				// the viewport anchored to whatever the user was reading; the
				// newly loaded rows appear above their current scroll position
				// without moving the visible content. suppressCompensation is
				// set so the ResizeObserver doesn't mistake the top-growth for
				// the bubble-growing-below-viewport case it normally corrects.
				suppressCompensation = true;
				try {
					messageList = [...earlier, ...messageList];
					Object.assign(messageSiblings, data.messageSiblings ?? {});
					if (data.totalMessages) totalMsgCount = data.totalMessages;
					await tick();
				} finally {
					requestAnimationFrame(() => { suppressCompensation = false; });
				}
			}
		} finally {
			loadingMore = false;
		}
	}

	let messageList: Message[] = $state(untrack(() => (initialMessages ?? []).map(parseMessage)));
	let messageSiblings: Record<number, { index: number; total: number }> = $state(untrack(() => messageSiblingsData ?? {}));
	let messageImages: Record<number, MessageImageRow[]> = $state(untrack(() => initialMessageImages ?? {}));
	// Messages currently being generated server-side. Keyed by messageId
	// with the value being the swipeIndex the gen is for — the server only
	// allows one in-flight gen per message, so a flat Map is enough. Seeded
	// from the chat load (in case generation was running before this client
	// mounted) and kept in sync via `messageImage:started` /
	// `messageImage:created` / `messageImage:error` SSE events.
	let imageGenInFlight = $state(new Map<number, number>(
		untrack(() => (initialPendingImageGens ?? []).map((p) => [p.messageId, p.swipeIndex] as [number, number]))
	));
	// Lightbox state — null hides; otherwise contains all gen rows for that message
	let lightboxMessageId = $state<number | null>(null);
	let hiddenBranchCount = $derived(hiddenBranchData ?? 0);
	let totalMsgCount = $state(untrack(() => totalMessageCount || (initialMessages ?? []).length));
	let loadingMore = $state(false);
	let hasMore = $derived(messageList.length < totalMsgCount);

	// FRONT-C4: windowed render. Most chats stay well under this; long sessions
	// that have triggered "Load earlier" repeatedly get DOM-node-count relief
	// without changing pagination semantics. `content-visibility: auto` on
	// rendered rows still applies as a second-stage paint guard.
	const RENDER_WINDOW_SIZE = 100;
	const RENDER_WINDOW_GROW = 100;
	let renderedStart = $state(untrack(() => Math.max(0, ((initialMessages ?? []).length) - RENDER_WINDOW_SIZE)));
	let topSentinel: HTMLDivElement | undefined = $state();
	let loadEarlierButton: HTMLButtonElement | undefined = $state();
	let expandingWindow = false;

	// Watch the top sentinel; when it enters view (user scrolled near the top of
	// the rendered window), reveal the next RENDER_WINDOW_GROW older messages and
	// preserve scroll position by the delta in scrollHeight.
	$effect(() => {
		if (!topSentinel) return;
		const sentinel = topSentinel;
		const observer = new IntersectionObserver(async (entries) => {
			if (!entries[0]?.isIntersecting) return;
			if (expandingWindow || renderedStart === 0) return;
			expandingWindow = true;
			suppressCompensation = true;
			try {
				// In flex-col-reverse the bottom is the scroll anchor — prepending
				// rows to the DOM doesn't shift anything already in the viewport, so
				// we deliberately do NOT touch scrollTop here. Earlier versions ran
				// `scrollTop = prev ± delta` which fought the browser's natural
				// anchoring and snapped the viewport to the top of the newly
				// revealed window.
				renderedStart = Math.max(0, renderedStart - RENDER_WINDOW_GROW);
				await tick();
			} finally {
				expandingWindow = false;
				requestAnimationFrame(() => { suppressCompensation = false; });
			}
		}, { rootMargin: '600px 0px 0px 0px' });
		observer.observe(sentinel);
		return () => observer.disconnect();
	});

	// Auto-fetch the next batch of earlier messages from the server when the
	// "Load earlier" button scrolls into view, but only if the user opted in
	// via Settings → Chat. Without this flag set, the button stays a manual
	// click target so users with large chats can decide when to spend the
	// network round-trip.
	$effect(() => {
		if (!loadEarlierButton) return;
		if (!settingsStore.settings.autoLoadEarlierMessages) return;
		const btn = loadEarlierButton;
		const observer = new IntersectionObserver((entries) => {
			if (!entries[0]?.isIntersecting) return;
			if (loadingMore || !hasMore) return;
			void loadEarlierMessages();
		}, { rootMargin: '400px 0px 0px 0px' });
		observer.observe(btn);
		return () => observer.disconnect();
	});

	// Defensive clamp: deletions or replace-by-id paths shouldn't normally take
	// renderedStart out of range, but if they ever do (e.g. branch reset that
	// drops earlier messages), pull it back into the valid window so the each-
	// block doesn't render against a negative slice.
	$effect(() => {
		const len = messageList.length;
		if (renderedStart > len) renderedStart = Math.max(0, len - RENDER_WINDOW_SIZE);
	});

	let confirmingDeleteIdx: number | null = $state(null);
	let input = $state(untrack(() => pickDraftForChat(chat)));
	let isStreaming = $state(false);
	let messagesContainer: HTMLDivElement | undefined = $state();
	let bottomSentinel: HTMLDivElement | undefined = $state();
	let enlargedImage: string | null = $state(null);
	let editingId: number | null = $state(null);
	let editContent = $state('');
	let isTexting = $derived(chat.mode === 'texting');

	// Which per-message actions the user has pinned as always-visible quick buttons
	// below each bubble. Pinned ids are also hidden from the long-press / right-click
	// menu so the same action doesn't appear in two places.
	const pinnedActions = $derived(
		new Set((String(settingsStore.settings.pinnedMessageActions || '')).split(',').map((s) => s.trim()).filter(Boolean))
	);
	let keyboardVisible = $state(false);
	// Live-tracked height of the floating compose row. Drives:
	//   - the messages spacer's bottom padding (so anchored-to-bottom view
	//     stays anchored above the compose pill when the textarea grows)
	//   - the scroll-to-bottom button's bottom offset (so it never collides
	//     with the send button on iOS PWA where safe-area inflates things).
	let composeRowEl: HTMLDivElement | undefined = $state();
	let composeRowHeight = $state(0);
	// === Scroll/anchor model ===
	// `isAnchored` is the single source of truth for whether the viewport is
	// pinned to the bottom of the chat. It only changes in response to a USER
	// scroll (or an explicit programmatic anchor via scrollToBottom). The
	// browser handles the actual viewport stability for both states natively
	// because the messages container is flex-col-reverse + overflow-anchor:none.
	// We never compute scroll deltas or move scrollTop ourselves during streaming.
	let isAnchored = $state(true);
	// Set true while we programmatically move scrollTop so the resulting scroll
	// event doesn't get misinterpreted as the user un-anchoring.
	let suppressScrollHandler = false;
	// Set true around mutations that grow the wrapper at the TOP (prepending
	// older messages, revealing the next windowed batch). In col-reverse with
	// a bottom-anchored wrapper, top-growth doesn't shift content relative to
	// the wrapper bottom — but the ResizeObserver compensator can't tell where
	// the growth happened, so we mute it for those known top-growth paths.
	let suppressCompensation = false;
	const showScrollButton = $derived(!isAnchored);
	let scrollButtonAttention = $state(false);
	let isMobile = $state(false);

	// Derive effective send-with-enter based on device type
	let sendWithEnter = $derived(isMobile ? sendWithEnterMobile : sendWithEnterDesktop);

	// Message context menu (right-click / long-press)
	let msgMenuIdx: number | null = $state(null);
	let msgMenuPosition: { x: number; y: number; flipUp: boolean; viewportH: number } | null = $state(null);
	const MSG_MENU_W = 200;
	const MSG_MENU_H = 300;
	let msgLongPressTimer: ReturnType<typeof setTimeout> | null = null;
	let msgLongPressStart = { x: 0, y: 0 };
	let msgLongPressFired = false;
	let msgSuppressNextClick = $state(false);
	let msgMenuScrollSuppressed = false;

	function openMsgMenu(idx: number, e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		// Only one context menu on screen at a time — dismiss the others.
		showImpersonateMenu = false;
		showSendMenu = false;
		const pos = positionForMenu(e.clientX, e.clientY, MSG_MENU_W, MSG_MENU_H);
		msgMenuPosition = pos;
		msgMenuIdx = idx;
	}
	function openMsgMenuAtPoint(idx: number, clientX: number, clientY: number) {
		showImpersonateMenu = false;
		showSendMenu = false;
		const pos = positionForMenu(clientX, clientY, MSG_MENU_W, MSG_MENU_H);
		msgMenuPosition = pos;
		msgMenuIdx = idx;
	}
	function startMsgLongPress(idx: number, e: TouchEvent) {
		const t = e.touches[0];
		msgLongPressStart = { x: t.clientX, y: t.clientY };
		msgLongPressFired = false;
		if (msgLongPressTimer) clearTimeout(msgLongPressTimer);
		msgLongPressTimer = setTimeout(() => {
			msgLongPressTimer = null;
			msgLongPressFired = true;
			haptic('medium');
			openMsgMenuAtPoint(idx, msgLongPressStart.x, msgLongPressStart.y);
		}, 500);
	}
	function moveMsgLongPress(e: TouchEvent) {
		if (!msgLongPressTimer) return;
		const t = e.touches[0];
		if (Math.abs(t.clientX - msgLongPressStart.x) > 10 || Math.abs(t.clientY - msgLongPressStart.y) > 10) {
			clearTimeout(msgLongPressTimer);
			msgLongPressTimer = null;
		}
	}
	function endMsgLongPress(e?: TouchEvent) {
		if (msgLongPressTimer) { clearTimeout(msgLongPressTimer); msgLongPressTimer = null; }
		if (msgLongPressFired) {
			// Stop the synthetic click that touchend fires from reaching the
			// document click-outside listener — same fix as buttonContextHandlers.
			e?.preventDefault();
			msgSuppressNextClick = true;
			msgLongPressFired = false;
		}
	}
	function closeMsgMenu() { msgMenuIdx = null; msgMenuPosition = null; }

	let reformattingMessageId: number | null = $state(null);
	let reformatReviewResults: { index: number; original: string; reformatted: string }[] = $state([]);
	let showReformatReview = $state(false);
	let textareaEl: HTMLTextAreaElement | undefined = $state();
	let animationReady = $state(false);
	let deletingFromIdx: number | null = $state(null);
	let deletingSingleIdx: number | null = $state(null);
	let abortAnimating = $state(false);
	// True between the user pressing Stop and finishStreaming() running.
	// Lets the placeholder/no-response text be skipped on user-initiated
	// aborts so cancelled generations don't leave a stuck "⚠ No response
	// returned" bubble that can't be deleted (it has a placeholder id).
	let wasAbortedManually = $state(false);
	let textareaRows = $state(1);
	type DeleteMode = 'single' | 'thread';
	let deleteMode = $state<DeleteMode>('thread');

	const MAX_TEXTAREA_ROWS = 5;
	const TALL_THRESHOLD = 4;
	let isTallTextarea = $derived(textareaRows >= TALL_THRESHOLD);

	// Auto-grow textarea (delegates to TextareaAutosizer).
	const textareaSizer = new TextareaAutosizer({ maxRows: MAX_TEXTAREA_ROWS });
	$effect(() => textareaSizer.bind(textareaEl ?? null));
	$effect(() => {
		void input;
		tick().then(() => textareaSizer.measure());
	});
	$effect(() => { textareaRows = textareaSizer.rows; });
	let lastTokenStats: { contextSize: number; maxResponseTokens: number; promptTokens: number; availableForPrompt: number; breakdown: { name: string; tokens: number }[] } | null = $state(null);
	let tokenStatsFetchSeq = 0;
	async function refreshTokenStats() {
		const seq = ++tokenStatsFetchSeq;
		try {
			const res = await fetch(`/api/chats/${chat.id}/token-stats`);
			if (!res.ok) return;
			const data = await res.json();
			if (seq !== tokenStatsFetchSeq) return;
			if (typeof data?.promptTokens !== 'number' || typeof data?.availableForPrompt !== 'number') return;
			lastTokenStats = {
				contextSize: data.contextSize,
				maxResponseTokens: data.maxResponseTokens,
				promptTokens: data.promptTokens,
				availableForPrompt: data.availableForPrompt,
				breakdown: data.breakdown ?? [],
			};
		} catch { /* ignore */ }
	}
	// Refresh whenever the chat, message tail, compaction summary, or active
	// branch changes — so the avatar ring is always populated, even before
	// the first send and right after compaction. Only `chat.id` and
	// `messageList.length` need to be tracked here; everything else changes
	// in lockstep with one of those.
	$effect(() => {
		const _id = chat.id;
		const _len = messageList.length;
		const _streaming = isStreaming;
		void _id; void _len;
		if (_streaming) return;
		refreshTokenStats();
	});
	let streamingReasoning = $state('');
	let isReasoning = $state(false);
	let showReasoningModal = $state(false);
	let reasoningModalText = $state('');
	let reasoningModalIsLive = $state(false);
	let reasoningModalIsImpersonation = $state(false);
	let reasoningModalMessageId = $state(0);
	let activeReasoningText = $derived(reasoningModalIsLive ? streamingReasoning : reasoningModalText);
	let activePersona = $derived(personas.find((p: any) => p.id === chat.overridePersonaId) ?? personas.find((p: any) => p.isDefault) ?? null);
	let reasoningModalName = $derived(reasoningModalIsImpersonation ? (activePersona?.name ?? 'You') : character.name);
	let isImpersonating = $state(false);
	let impersonateReasoning = $state('');

	// Local mirror of the persisted impersonation swipes on the chat row.
	// We keep these as $state (not $derived) so chevron nav can update them
	// optimistically — otherwise the chevron index/text lags behind the
	// PATCH→SSE roundtrip and feels sluggish. The $effect below re-syncs
	// from the chat row whenever the server pushes a new snapshot.
	let chatImpersonationSwipes = $state<ImpersonationSwipeEntry[]>(
		untrack(() => parseImpersonationSwipes((chat as any).impersonationSwipes))
	);
	let chatImpersonationSwipeIndex = $state<number>(
		untrack(() => Math.max(0, Math.min(
			// Reuse the parse from the line above — avoids a second JSON.parse
			// of the same blob on mount.
			chatImpersonationSwipes.length - 1,
			(chat as any).impersonationSwipeIndex ?? 0
		)))
	);
	let lastSyncedImpersonationRaw = $state<string>(
		untrack(() => ((chat as any).impersonationSwipes as string | null) ?? '')
	);
	$effect(() => {
		const raw = ((chat as any).impersonationSwipes as string | null) ?? '';
		const idx = (chat as any).impersonationSwipeIndex ?? 0;
		// Only sync when the server snapshot actually changed. Local nav
		// updates `chatImpersonationSwipes`/`chatImpersonationSwipeIndex`
		// without touching `lastSyncedImpersonationRaw`, so the next SSE
		// patch (which carries our just-sent payload) lands cleanly here.
		if (raw !== untrack(() => lastSyncedImpersonationRaw)) {
			lastSyncedImpersonationRaw = raw;
			const parsed = parseImpersonationSwipes(raw);
			chatImpersonationSwipes = parsed;
			const newIdx = Math.max(0, Math.min(parsed.length - 1, idx));
			chatImpersonationSwipeIndex = newIdx;

			// Push the active swipe's draft into the textarea when it
			// represents a fresh server-side change — e.g. a user message
			// just got "unsent" via revertLeafUserMessages and its content
			// belongs in the chat bar now. Use the same generatedAt-marker
			// trick as pickDraftForChat so we only do this once per swipe.
			const status = (chat as any).impersonationStatus as string | null | undefined;
			const active = parsed[newIdx];
			if (status !== 'streaming' && active?.generatedAt && typeof localStorage !== 'undefined') {
				const seenKey = `skald-impersonation-seen-${chat.id}`;
				const seen = localStorage.getItem(seenKey);
				if (seen !== active.generatedAt) {
					localStorage.setItem(seenKey, active.generatedAt);
					input = active.draft ?? '';
					impersonateReasoning = active.reasoning ?? '';
				}
			}
		}
	});
	let activeImpersonationSwipe = $derived(chatImpersonationSwipes[chatImpersonationSwipeIndex]);

	// Guide modal state. Used by the impersonate button menu, the send
	// button menu, and the user/assistant message context menus. The
	// `target` describes what the modal will do on submit.
	type GuideTarget =
		| { kind: 'impersonate' }
		| { kind: 'impersonateView' } // read-only: just shows the guidance that produced the active swipe
		| { kind: 'send' }
		| { kind: 'guideReply'; userMessageId: number } // start a NEW reply with the guidance attached
		| { kind: 'editAssistantGuidance'; assistantMessageId: number }; // PATCH the assistant's own guidance, then regenerate it
	let showGuideModal = $state(false);
	let guideModalText = $state('');
	let guideModalTarget = $state<GuideTarget | null>(null);

	// Long-press / right-click menus for the impersonate + send buttons.
	let showImpersonateMenu = $state(false);
	let impersonateMenuPosition = $state<{ x: number; y: number; flipUp: boolean; viewportH: number } | null>(null);
	let showSendMenu = $state(false);
	let sendMenuPosition = $state<{ x: number; y: number; flipUp: boolean; viewportH: number } | null>(null);

	// Character theme: parse character.theme JSON into CSS variable overrides
	const ALLOWED_THEME_KEYS = new Set([
		'background', 'foreground', 'card', 'card-foreground', 'primary', 'primary-foreground',
		'secondary', 'secondary-foreground', 'muted', 'muted-foreground', 'accent', 'accent-foreground',
		'destructive', 'destructive-foreground', 'border', 'input', 'ring', 'speech',
		'sidebar-background', 'sidebar-foreground', 'sidebar-border', 'sidebar-primary', 'sidebar-accent'
	]);
	// Only allow CSS color-like values: oklch/hsl/rgb/hex/named colors, no url() or special chars.
	// `/` was previously allowed (for slash-separated alpha in modern oklch syntax) but also
	// permitted relative `url(/path)` values in theory; explicit `url(` rejection is defense-in-depth.
	const SAFE_CSS_VALUE = /^[a-zA-Z0-9\s().,%#\-\/]+$/;
	const FORBIDDEN_CSS_TOKENS = /url\s*\(|@import|expression\s*\(|<|>/i;

	let characterThemeStyle = $derived.by(() => {
		if (!chat.useCharacterTheme) return '';
		const theme = pickCharacterTheme(character.theme, settingsStore.effectiveMode);
		const entries = Object.entries(theme).filter(
			([k, v]) => v && ALLOWED_THEME_KEYS.has(k) && SAFE_CSS_VALUE.test(v) && !FORBIDDEN_CSS_TOKENS.test(v)
		);
		if (entries.length === 0) return '';
		return entries.map(([k, v]) => `--${k}: ${v}`).join('; ');
	});

	let characterHasTheme = $derived.by(() => {
		if (character.backgroundPath) return true;
		return characterHasAnyTheme(character.theme);
	});

	const STREAM_TIMEOUT_MS = 90_000;

	// SSE-backed streaming: track the assistant message index being streamed into
	let streamingAssistantIdx = $state(-1);
	let streamAccumulated = $state('');
	let streamAccumulatedReasoning = $state('');
	let streamIsRegenerate = $state(false);
	let streamOriginalMessage: Message | null = $state(null);
	let awaitingServerRefresh = $state(false);
	let lastSeq = 0;

	let streamTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

	function resetStreamTimeout() {
		if (streamTimeoutTimer) clearTimeout(streamTimeoutTimer);
		if (!isStreaming) return;
		streamTimeoutTimer = setTimeout(() => {
			if (isStreaming && !isImpersonating) {
				abortGeneration();
			}
		}, STREAM_TIMEOUT_MS);
	}

	function clearStreamTimeout() {
		if (streamTimeoutTimer) {
			clearTimeout(streamTimeoutTimer);
			streamTimeoutTimer = null;
		}
	}

	async function abortGeneration() {
		if (!isStreaming) return;
		clearStreamTimeout();

		// For non-impersonation regular replies we animate the streaming
		// bubble out before swapping in the final state. Impersonation has
		// no bubble (text lives in the textarea) so we just skip that.
		if (!isImpersonating) {
			abortAnimating = true;
		}
		wasAbortedManually = true;

		try {
			await fetch('/api/chat/abort', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ chatId: chat.id })
			});
		} catch {
			// Best effort
		}

		if (!isImpersonating) {
			await new Promise(r => setTimeout(r, 250));
			abortAnimating = false;
			finishStreaming();
		}
		// Impersonation finalization happens via the realtime
		// `chat:impersonation` event + generationsStore done branch.
	}

	// Background-generation persistence: hydrate from the global generations
	// store on mount (so users returning to a chat that was streaming while
	// they were away see the typing indicator + accumulated tokens), and
	// keep local state in sync with tokens that arrived via SSE while this
	// component was unmounted. Defined later in the file (after the chat-id
	// resync effect) so it runs after that effect's `isStreaming = false`
	// reset, otherwise the reset would clobber our restored placeholder.
	let didHydrateGen = false;



	// Process SSE events from the layout
	$effect(() => {
		if (!streamEvent || streamEvent.chatId !== chat.id || streamEvent.seq <= lastSeq) return;
		lastSeq = streamEvent.seq;

		const { type, data: eventData } = streamEvent;

		// Reset timeout on any data received
		resetStreamTimeout();

		if (type === 'tokenStats') {
			lastTokenStats = eventData;
		} else if (type === 'reasoning' || type === 'token') {
			// Handled by the generations-store effect above (single source
			// of truth so background-streamed tokens for chats the user has
			// navigated away from are preserved and replayed on return).
		} else if (type === 'error') {
			if (streamingAssistantIdx >= 0) {
				streamAccumulated += `\n\nError: ${eventData.error}`;
				messageList[streamingAssistantIdx] = { ...messageList[streamingAssistantIdx], content: streamAccumulated };
			}
			// Stop generation: server emits 'error' as a terminal event with no
			// 'complete' to follow, so the stop button would otherwise stay stuck.
			finishStreaming();
		} else if (type === 'complete') {
			// Cross-device abort sync: the server tags aborted completions with
			// `aborted: true`. Honour that so the receiving device runs the
			// same cleanup branch as the device that clicked stop — restoring
			// the original message on regen aborts, dropping empty placeholders
			// on fresh-send aborts. Without this the other device would keep
			// the partial stream as the final state and diverge from the
			// canceller.
			if (eventData?.aborted) {
				wasAbortedManually = true;
			}
			if (!isAnchored) {
				// Flag the scroll-down button so it pulses — message they didn't
				// see is now finalized at the bottom.
				scrollButtonAttention = true;
			}
			// Beep on a real assistant completion only when the user can't
			// already see the finished bubble (i.e. they're scrolled up). If
			// they're anchored to the bottom the new message is literally on
			// screen — a sound would be noise. Aborts and impersonation are
			// always skipped (already-cancelled / user-initiated).
			if (!eventData?.aborted && !isImpersonating && !isAnchored) {
				playMessageBeep();
			}
			finishStreaming();
		} else if (type === 'message:created' || type === 'message:patched' || type === 'message:deleted') {
			// Cross-device sync. Two cases must be handled to avoid the
			// classic "duplicates on sender / missing on receiver" pair:
			//   1. SENDER: We already have an optimistic placeholder user
			//      message with a negative id. The SSE arrives with the
			//      real DB id and identical content — replace the
			//      placeholder's id in place instead of appending.
			//   2. RECEIVER: No local placeholder. Append (or splice in
			//      before the tail assistant placeholder if a stream is
			//      already in flight here).
			// Assistant message:created events are similarly handled —
			// the local stream has its own placeholder; if no stream is
			// active here (cross-device assistant complete) we append.
			if (type === 'message:created' && eventData?.message) {
				const msg = parseMessage(eventData.message);
				const alreadyPresent = messageList.some((m) => m.id === msg.id);
				if (!alreadyPresent) {
					// Try to claim an optimistic placeholder by role +
					// content match (same chat, recent, negative id).
					const placeholderIdx = messageList.findIndex(
						(m) => m.id < 0 && m.role === msg.role && m.content === msg.content
					);
					if (placeholderIdx >= 0) {
						const next = messageList.slice();
						next[placeholderIdx] = { ...next[placeholderIdx], ...msg };
						messageList = next;
						knownMessageIds.add(msg.id);
						if (streamingAssistantIdx === placeholderIdx) {
							streamingAssistantIdx = placeholderIdx;
						}
					} else if (msg.role === 'user') {
						// Cross-device user send: a message arrived that wasn't from
						// our optimistic placeholder. Clear our local draft + textarea
						// + impersonation reasoning so this device doesn't keep around
						// a now-stale draft (the server has already cleared impersonation
						// swipes + pendingDraft, and our $effects pick that up).
						input = '';
						impersonateReasoning = '';
						try {
							localStorage.removeItem(`skald-draft-${chat.id}`);
							localStorage.removeItem(`skald-draft-${chat.id}-at`);
						} catch { /* ignore */ }
						if (streamingAssistantIdx >= 0 && streamingAssistantIdx === messageList.length - 1) {
							// Splice before the streaming tail placeholder.
							const next = messageList.slice();
							next.splice(streamingAssistantIdx, 0, msg);
							messageList = next;
							streamingAssistantIdx = next.length - 1;
						} else {
							messageList = [...messageList, msg];
						}
						knownMessageIds.add(msg.id);
					} else if (msg.role === 'assistant' && streamingAssistantIdx < 0) {
						// Cross-device or post-finishStreaming: try to claim a
						// leftover assistant placeholder first. Server-side regex
						// scripts and image caching may have rewritten the content,
						// so the strict content match above can miss — leading to
						// the placeholder + new message both showing until refresh.
						const orphanIdx = messageList.findIndex(
							(m) => m.id < 0 && m.role === 'assistant'
						);
						if (orphanIdx >= 0) {
							const next = messageList.slice();
							next[orphanIdx] = { ...next[orphanIdx], ...msg };
							messageList = next;
						} else {
							messageList = [...messageList, msg];
						}
						knownMessageIds.add(msg.id);
					}
					// Else: assistant placeholder is owned by our local
					// stream and will get its real id at finishStreaming.
				}
			}
			if (streamingAssistantIdx < 0 && !isStreaming) {
				onrefresh?.();
			}
		} else if (type === 'messageImage:started' && eventData) {
			const { messageId, swipeIndex } = eventData as { messageId: number; swipeIndex: number };
			if (imageGenInFlight.get(messageId) !== swipeIndex) {
				const next = new Map(imageGenInFlight);
				next.set(messageId, swipeIndex ?? 0);
				imageGenInFlight = next;
			}
		} else if (type === 'messageImage:created' && eventData?.image) {
			const img = eventData.image as MessageImageRow;
			const swipeIdx = img.swipeIndex ?? 0;
			// Only deactivate siblings within the same swipe so other swipes'
			// active selections survive a fresh generation.
			const list = (messageImages[img.messageId] ?? []).map((it) =>
				(it.swipeIndex ?? 0) === swipeIdx ? { ...it, isActive: false } : it
			);
			list.push(img);
			messageImages = { ...messageImages, [img.messageId]: list };
			if (imageGenInFlight.has(img.messageId)) {
				const next = new Map(imageGenInFlight);
				next.delete(img.messageId);
				imageGenInFlight = next;
			}
		} else if (type === 'messageImage:error' && eventData) {
			const { messageId, error } = eventData as { messageId: number; error: string };
			if (imageGenInFlight.has(messageId)) {
				const next = new Map(imageGenInFlight);
				next.delete(messageId);
				imageGenInFlight = next;
			}
			toasts.error(error || 'Image generation failed');
		} else if (type === 'messageImage:activated' && eventData) {
			const { messageId, imageId } = eventData as { messageId: number; imageId: number };
			const list = messageImages[messageId];
			if (list) {
				// Scope the deactivation to the same swipe; other swipes
				// keep their own active selection.
				const target = list.find((it) => it.id === imageId);
				const swipeIdx = target?.swipeIndex ?? 0;
				messageImages = {
					...messageImages,
					[messageId]: list.map((it) => {
						if ((it.swipeIndex ?? 0) !== swipeIdx) return it;
						return { ...it, isActive: it.id === imageId };
					})
				};
			}
		} else if (type === 'messageImage:deleted' && eventData) {
			const { messageId, imageId } = eventData as { messageId: number; imageId: number };
			const list = messageImages[messageId];
			if (list) {
				const removed = list.find((it) => it.id === imageId);
				const swipeIdx = removed?.swipeIndex ?? 0;
				const next = list.filter((it) => it.id !== imageId);
				// If the removed image was the active one for its swipe and
				// there are still images in that swipe, promote the most
				// recent remaining one (mirrors the server's policy).
				const swipeRemaining = next.filter((it) => (it.swipeIndex ?? 0) === swipeIdx);
				if (removed?.isActive && swipeRemaining.length && !swipeRemaining.some((it) => it.isActive)) {
					const lastInSwipe = swipeRemaining[swipeRemaining.length - 1];
					const idx = next.findIndex((it) => it.id === lastInSwipe.id);
					if (idx !== -1) next[idx] = { ...next[idx], isActive: true };
				}
				messageImages = { ...messageImages, [messageId]: next };
			}
		}
	});

	async function finishStreaming() {
		// Final safety net: if any tokens lived only in the global store
		// (e.g. arrived in the same microtask batch as `complete`), pick
		// them up before composing the final message — otherwise the
		// regen overlay would briefly clear over the OLD content.
		const finalGen = generationsStore.get(chat.id);
		if (finalGen) {
			if (finalGen.accumulated.length > streamAccumulated.length) {
				streamAccumulated = finalGen.accumulated;
			}
			if (finalGen.accumulatedReasoning.length > streamAccumulatedReasoning.length) {
				streamAccumulatedReasoning = finalGen.accumulatedReasoning;
			}
		}

		if (streamingAssistantIdx >= 0) {
			// User-cancelled generation with no usable output: drop the
			// placeholder bubble entirely instead of leaving a stuck
			// "⚠ No response returned" message that has no DB id and
			// can't be deleted. EXCEPT for regenerates — there we want
			// the previous swipe back, otherwise cancelling vanishes
			// the message until the next page reload.
			if (wasAbortedManually && !streamAccumulated) {
				if (streamIsRegenerate && streamOriginalMessage) {
					const restored = streamOriginalMessage;
					messageList[streamingAssistantIdx] = restored;
					streamingAssistantIdx = -1;
				} else {
					const idx = streamingAssistantIdx;
					const removed = messageList[idx];
					messageList = messageList.slice(0, idx).concat(messageList.slice(idx + 1));
					if (removed) totalMsgCount = Math.max(0, totalMsgCount - 1);
					streamingAssistantIdx = -1;
				}
			} else if (!streamAccumulated && streamAccumulatedReasoning) {
				// Reasoning-only output (model returned thoughts but no
				// final text): surface a placeholder so the bubble isn't
				// blank. Skipped on manual abort (handled above).
				streamAccumulated = '⚠ No response returned';
			}
		}

		if (streamingAssistantIdx >= 0) {

			// In texting mode, reveal the full message after a typing delay
			if (isTexting && (streamAccumulated || streamAccumulatedReasoning)) {
				if (streamAccumulated) await typingDelay(streamAccumulated, !!streamAccumulatedReasoning);
				if (streamIsRegenerate && streamOriginalMessage) {
					const newSwipes = [...streamOriginalMessage.swipes, streamAccumulated];
					const newReasoning = [...streamOriginalMessage.reasoning, streamAccumulatedReasoning];
					messageList[streamingAssistantIdx] = {
						...streamOriginalMessage,
						content: streamAccumulated,
						swipes: newSwipes,
						swipeIndex: newSwipes.length - 1,
						reasoning: newReasoning
					};
				} else {
					messageList[streamingAssistantIdx] = {
						...messageList[streamingAssistantIdx],
						content: streamAccumulated,
						swipes: [streamAccumulated],
						reasoning: [streamAccumulatedReasoning]
					};
				}
			}

			// In reduce-motion mode (non-texting), reveal content all at once
			if (reduceMotion && !isTexting && (streamAccumulated || streamAccumulatedReasoning)) {
				if (streamIsRegenerate && streamOriginalMessage) {
					const newSwipes = [...streamOriginalMessage.swipes, streamAccumulated];
					const newReasoning = [...streamOriginalMessage.reasoning, streamAccumulatedReasoning];
					messageList[streamingAssistantIdx] = {
						...streamOriginalMessage,
						content: streamAccumulated,
						swipes: newSwipes,
						swipeIndex: newSwipes.length - 1,
						reasoning: newReasoning
					};
				} else {
					messageList[streamingAssistantIdx] = {
						...messageList[streamingAssistantIdx],
						content: streamAccumulated,
						swipes: [streamAccumulated],
						reasoning: [streamAccumulatedReasoning]
					};
				}
			}

			// Normal streaming mode: token handler updates live, but if no tokens arrived
			// (e.g. reasoning-only), write the final state
			if (!isTexting && !reduceMotion && streamAccumulated) {
				if (streamIsRegenerate && streamOriginalMessage) {
					const newSwipes = [...streamOriginalMessage.swipes, streamAccumulated];
					const newReasoning = [...streamOriginalMessage.reasoning, streamAccumulatedReasoning];
					messageList[streamingAssistantIdx] = {
						...streamOriginalMessage,
						content: streamAccumulated,
						swipes: newSwipes,
						swipeIndex: newSwipes.length - 1,
						reasoning: newReasoning
					};
				} else {
					messageList[streamingAssistantIdx] = {
						...messageList[streamingAssistantIdx],
						content: streamAccumulated,
						reasoning: [streamAccumulatedReasoning]
					};
				}
			}
		}

		clearStreamTimeout();
		awaitingServerRefresh = true;
		isStreaming = false;
		isReasoning = false;
		isImpersonating = false;
		if (reasoningModalIsLive && streamAccumulatedReasoning) {
			reasoningModalText = streamAccumulatedReasoning;
			reasoningModalIsLive = false;
		}
		streamingReasoning = '';
		// For regen: hold the blur overlay one paint past the content
		// swap so the new text is on screen before the overlay lifts.
		// Without this the user can briefly see the OLD message
		// unblurred between the messageList mutation and the next paint.
		if (streamIsRegenerate) {
			await tick();
		}
		clearStreamBubbleTarget();
		streamAccumulated = '';
		streamAccumulatedReasoning = '';
		generationsStore.clear(chat.id);
		wasAbortedManually = false;
		// Only re-anchor if the user was already at the bottom. Reading older
		// messages mid-stream should stay put when generation finishes.
		if (isAnchored) await scrollToBottom();
		// Defer refresh to break out of $effect reactive scope (avoids SvelteKit SSR fetch warning)
		setTimeout(async () => {
			try {
				await onrefresh();
			} finally {
				awaitingServerRefresh = false;
			}
		}, 0);
	}

	// Only enable message animations after initial load
	$effect(() => {
		// Reset on chat change
		animationReady = false;
		// eslint-disable-next-line no-unused-expressions
		chat.id;
		const timer = setTimeout(() => { animationReady = true; }, 300);
		return () => clearTimeout(timer);
	});

	$effect(() => {
		const mq = window.matchMedia('(max-width: 767px)');
		isMobile = mq.matches;
		const onChange = (e: MediaQueryListEvent) => { isMobile = e.matches; };
		mq.addEventListener('change', onChange);
		return () => mq.removeEventListener('change', onChange);
	});

	$effect(() => {
		const vv = window.visualViewport;
		if (!vv) return;
		const onResize = () => {
			keyboardVisible = vv.height < window.innerHeight * 0.75;
		};
		vv.addEventListener('resize', onResize);
		return () => vv.removeEventListener('resize', onResize);
	});

	// User-driven anchor tracking. Programmatic scrolls bypass this via
	// `suppressScrollHandler` so they don't flip the anchored state themselves.
	$effect(() => {
		const el = messagesContainer;
		if (!el) return;
		const onScroll = () => {
			if (suppressScrollHandler) return;
			const atBottom = isNearBottom();
			if (atBottom !== isAnchored) isAnchored = atBottom;
			if (atBottom) scrollButtonAttention = false;
		};
		el.addEventListener('scroll', onScroll, { passive: true });
		return () => el.removeEventListener('scroll', onScroll);
	});

	// Scroll compensation. col-reverse anchors the wrapper's BOTTOM edge to
	// the container, not the user's content — so when the streaming bubble
	// grows the wrapper bottom stays pinned and everything above drifts up
	// by the growth delta. For an anchored user that's fine (they're
	// following new content). For a scrolled-up user it means what they
	// were reading crawls out of view. Counter it by subtracting the delta
	// from scrollTop so the same content stays put.
	//
	// IMPORTANT: gated on `streamingAssistantIdx >= 0`. Earlier we tried
	// running this for any wrapper resize, but image decodes, theme
	// transitions, and font swaps would all trigger small deltas while the
	// user was actively scrolling — the scrollTop writes fought their
	// gesture and read as "snapping" on both desktop and mobile. Streaming
	// growth is the only resize source worth compensating; everything else
	// is short-lived and lives well enough with col-reverse's natural
	// behaviour.
	$effect(() => {
		const container = messagesContainer;
		if (!container) return;
		const wrapper = container.firstElementChild as HTMLElement | null;
		if (!wrapper) return;
		let prevHeight = wrapper.offsetHeight;
		const observer = new ResizeObserver(() => {
			const newHeight = wrapper.offsetHeight;
			const delta = newHeight - prevHeight;
			prevHeight = newHeight;
			if (delta === 0) return;
			if (suppressCompensation || isAnchored) return;
			if (streamingAssistantIdx < 0) return;
			suppressScrollHandler = true;
			container.scrollTop = container.scrollTop - delta;
			requestAnimationFrame(() => { suppressScrollHandler = false; });
		});
		observer.observe(wrapper);
		return () => observer.disconnect();
	});

	// Dismiss keyboard on scroll (mobile only, opt-out via setting).
	$effect(() => {
		if (!isMobile) return;
		if (!dismissKeyboardOnScroll) return;
		const el = messagesContainer;
		if (!el) return;
		let startY = 0;
		const onTouchStart = (e: TouchEvent) => { startY = e.touches[0].clientY; };
		const onTouchMove = (e: TouchEvent) => {
			if (Math.abs(e.touches[0].clientY - startY) > 10) {
				const active = document.activeElement as HTMLElement | null;
				if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) {
					active.blur();
				}
			}
		};
		el.addEventListener('touchstart', onTouchStart, { passive: true });
		el.addEventListener('touchmove', onTouchMove, { passive: true });
		return () => {
			el.removeEventListener('touchstart', onTouchStart);
			el.removeEventListener('touchmove', onTouchMove);
		};
	});

	// Close message context menu on click-outside, scroll, Escape
	$effect(() => {
		if (msgMenuIdx === null) return;
		const onClick = (e: Event) => {
			// If the menu was opened by a long-press, endMsgLongPress set this
			// flag. The touchend-generated click is stopped via preventDefault
			// above, but on some browsers it still propagates — consume it once.
			if (msgSuppressNextClick) { msgSuppressNextClick = false; return; }
			if (!(e.target as HTMLElement).closest('[data-msg-menu]')) closeMsgMenu();
		};
		const onScroll = () => { if (!msgMenuScrollSuppressed) closeMsgMenu(); };
		const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeMsgMenu(); };
		const el = messagesContainer;
		const attachTimer = setTimeout(() => document.addEventListener('click', onClick), 0);
		el?.addEventListener('scroll', onScroll, { passive: true });
		document.addEventListener('keydown', onKey);
		return () => {
			clearTimeout(attachTimer);
			document.removeEventListener('click', onClick);
			el?.removeEventListener('scroll', onScroll);
			document.removeEventListener('keydown', onKey);
		};
	});

	// Close impersonate/send menus on click-outside or Escape
	$effect(() => {
		if (!showImpersonateMenu && !showSendMenu) return;
		const onClick = (e: Event) => {
			// Skip the synthetic click that follows the long-press that just
			// opened this menu (mobile fires `click` after `pointerup`).
			if (impersonateBtnHandlers.isSuppressing() || sendBtnHandlers.isSuppressing()) return;
			const t = e.target as HTMLElement;
			if (showImpersonateMenu && !t.closest('[data-impersonate-menu]')) showImpersonateMenu = false;
			if (showSendMenu && !t.closest('[data-send-menu]')) showSendMenu = false;
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') { showImpersonateMenu = false; showSendMenu = false; }
		};
		const attachTimer = setTimeout(() => document.addEventListener('click', onClick), 0);
		document.addEventListener('keydown', onKey);
		return () => {
			clearTimeout(attachTimer);
			document.removeEventListener('click', onClick);
			document.removeEventListener('keydown', onKey);
		};
	});

	// Close Guide modal on Escape
	$effect(() => {
		if (!showGuideModal) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') { showGuideModal = false; guideModalTarget = null; }
		};
		document.addEventListener('keydown', onKey);
		return () => document.removeEventListener('keydown', onKey);
	});

	// Delegated image load handler — adds 'loaded' class without inline event handlers
	$effect(() => {
		const el = messagesContainer;
		if (!el) return;
		const onLoad = (e: Event) => {
			if (e.target instanceof HTMLImageElement) {
				e.target.classList.add('loaded');
			}
		};
		el.addEventListener('load', onLoad, { capture: true });
		return () => el.removeEventListener('load', onLoad, { capture: true });
	});

	// Date separator helper
	function getDateLabel(dateStr: string | null): string {
		if (!dateStr || messageTimestamps === 'off') return '';
		const d = new Date(dateStr + 'Z');
		if (messageTimestamps === 'absolute') {
			return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
		}
		const now = new Date();
		const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		const msgDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
		const diff = today.getTime() - msgDate.getTime();
		const days = Math.floor(diff / 86400000);
		if (days === 0) return 'Today';
		if (days === 1) return 'Yesterday';
		if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
		return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: now.getFullYear() !== d.getFullYear() ? 'numeric' : undefined });
	}

	// Compact time for per-message hover labels (e.g. "3:42 PM" or "Mar 14, 3:42 PM" if older)
	function getMessageTime(dateStr: string | null): string {
		if (!dateStr) return '';
		const d = new Date(dateStr + 'Z');
		const now = new Date();
		const sameDay = d.toDateString() === now.toDateString();
		const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
		if (sameDay) return time;
		return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
	}

	// Precompute date separators and consecutive grouping for all messages
	let dateSeparatorIndices = $derived.by(() => {
		const result = new Set<number>();
		if (messageTimestamps === 'off') return result;
		let prevLabel: string | null = null;
		for (let i = 0; i < messageList.length; i++) {
			const msg = messageList[i];
			if (msg.role === 'system') continue;
			const label = getDateLabel(msg.createdAt);
			if (!label) continue;
			if (prevLabel === null || label !== prevLabel) {
				result.add(i);
			}
			prevLabel = label;
		}
		return result;
	});

	let consecutiveIndices = $derived.by(() => {
		const result = new Set<number>();
		let prevRole: string | null = null;
		for (let i = 0; i < messageList.length; i++) {
			const msg = messageList[i];
			if (msg.role === 'system') continue;
			if (prevRole !== null && prevRole === msg.role) {
				result.add(i);
			}
			prevRole = msg.role;
		}
		return result;
	});

	// Simulate typing delay based on message length (texting mode only)
	// Skips delay if the model used reasoning (already had natural delay)
	function typingDelay(text: string, hadReasoning: boolean): Promise<void> {
		if (hadReasoning) return Promise.resolve();
		const ap = activeProvider;
		const speed = ap?.textingTypingSpeed ?? 35;
		const max = ap?.textingTypingMax ?? 4000;
		if (speed === 0 && max === 0) return Promise.resolve();
		const min = 800;
		const delay = Math.min(max, Math.max(min, text.length * speed));
		if (delay <= 0) return Promise.resolve();
		return new Promise((resolve) => setTimeout(resolve, delay));
	}

	// Delay before showing the typing indicator (texting mode only)
	function initialTypingDelay(): Promise<void> {
		const ap = activeProvider;
		const delay = ap?.textingInitialDelay ?? 1500;
		if (delay <= 0) return Promise.resolve();
		return new Promise((resolve) => setTimeout(resolve, delay));
	}

	// Track known message IDs to only animate truly new messages
	let knownMessageIds = new Set(untrack(() => (initialMessages ?? []).map((m: any) => m.id)));

	function isNewMessage(id: number): boolean {
		if (knownMessageIds.has(id)) return false;
		knownMessageIds.add(id);
		return true;
	}

	function msgEnterClass(messageId: number, role: string): string {
		if (!animationReady || !isNewMessage(messageId)) return '';
		if (isTexting) return role === 'user' ? 'msg-enter-texting-user' : 'msg-enter-texting-assistant';
		return 'msg-enter-story';
	}

	// Unified messageList sync + background-generation hydration.
	//
	// Single source of truth for keeping `messageList` aligned with the
	// server-side `initialMessages` AND for layering in the in-flight
	// generation state held by `generationsStore` when the user returns
	// to a chat that's still streaming. Doing both in one effect (instead
	// of split effects) avoids ordering bugs where a sync would clobber
	// a hydrated placeholder, or vice versa.
	//
	// Three branches:
	//   1. Chat id changed -> full reset, then hydrate if needed.
	//   2. Same chat, not streaming -> diff incoming server messages into
	//      the list (cheap, preserves object identity for unchanged rows).
	//   3. Same chat, streaming -> leave messageList alone; the local
	//      streaming flow owns the placeholder / regen target.
	let lastSyncedChatId: number | null = null;
	let bootstrappedStartedAt: number | null = null;
	$effect(() => {
		const incoming = (initialMessages ?? []).map(parseMessage);
		const newSiblings = messageSiblingsData ?? {};
		const newTotal = totalMessageCount;
		const chatId = chat.id;

		if (chatId !== lastSyncedChatId) {
			// Save scroll position of the previous chat before switching.
			if (lastSyncedChatId != null && messagesContainer) {
				saveScroll(lastSyncedChatId, messagesContainer.scrollTop);
			}
			messageList = incoming;
			renderedStart = Math.max(0, incoming.length - RENDER_WINDOW_SIZE);
			messageSiblings = newSiblings;
			totalMsgCount = newTotal || incoming.length;
			input = pickDraftForChat(chat);
			isStreaming = false;
			isReasoning = false;
			streamingReasoning = '';
			clearStreamBubbleTarget();
			clearStreamTimeout();
			streamAccumulated = '';
			streamAccumulatedReasoning = '';
			isImpersonating = false;
			{
				const swipes = parseImpersonationSwipes((chat as any).impersonationSwipes);
				const idx = (chat as any).impersonationSwipeIndex ?? 0;
				impersonateReasoning = chat.impersonationStatus === 'done'
					? (swipes[idx]?.reasoning ?? '')
					: '';
			}
			awaitingServerRefresh = false;
			lastSyncedChatId = chatId;
			bootstrappedStartedAt = null;
			didHydrateGen = false;
			knownMessageIds = new Set(incoming.map(m => m.id));
			// Reset messageImages from the new chat's initial payload. Without
			// this the previous chat's image metadata stayed in memory and the
			// Record grew across chat switches.
			messageImages = initialMessageImages ?? {};
			const savedScroll = loadScroll(chatId);
			if (savedScroll != null && savedScroll > 0) {
				tick().then(() => {
					if (messagesContainer) {
						suppressScrollHandler = true;
						messagesContainer.scrollTop = savedScroll;
						isAnchored = isNearBottom();
						requestAnimationFrame(() => { suppressScrollHandler = false; });
					}
				});
			} else {
				scrollToBottom(true);
			}
			if (chat.mode === 'texting' && incoming.length === 0) {
				setTimeout(() => generateGreeting(), 0);
			}
		} else if (!untrack(() => isStreaming) && !untrack(() => awaitingServerRefresh)) {
			// Same chat, not streaming — diff against the new server data.
			const nextTotal = newTotal || incoming.length;
			if (nextTotal !== totalMsgCount) {
				totalMsgCount = nextTotal;
			}
			const currentList = untrack(() => messageList);
			const oldById = new Map(currentList.map(m => [m.id, m]));
			const incomingIds = new Set(incoming.map(m => m.id));

			// If the user has scrolled back to load earlier pages, preserve
			// them when the server refresh only returns the tail window.
			// We do this only when the chains connect: the oldest incoming
			// message's parent is already in our list (i.e. the path didn't
			// change), so the earlier portion is still valid.
			const keptEarlier = currentList.filter(m => !incomingIds.has(m.id));
			const firstIncoming = incoming[0];
			const safeMerge =
				keptEarlier.length > 0 &&
				firstIncoming != null &&
				firstIncoming.parentId !== null &&
				oldById.has(firstIncoming.parentId);

			const needsUpdate = safeMerge
				? incoming.some(m => {
					const old = oldById.get(m.id);
					return !old || old.content !== m.content || old.swipeIndex !== m.swipeIndex
						|| (old.guidance ?? null) !== (m.guidance ?? null)
						|| (old.impersonationGuidance ?? null) !== (m.impersonationGuidance ?? null);
				})
				: incoming.length !== currentList.length ||
				incoming.some((m, idx) => {
					const old = currentList[idx];
					return !old || old.id !== m.id || old.content !== m.content || old.swipeIndex !== m.swipeIndex
						|| (old.guidance ?? null) !== (m.guidance ?? null)
						|| (old.impersonationGuidance ?? null) !== (m.impersonationGuidance ?? null);
				});

			if (needsUpdate) {
				const merged = incoming.map(m => {
					const old = oldById.get(m.id);
					if (old && old.content === m.content && old.swipeIndex === m.swipeIndex &&
						old.swipes.length === m.swipes.length && old.reasoning.length === m.reasoning.length &&
						(old.guidance ?? null) === (m.guidance ?? null) &&
						(old.impersonationGuidance ?? null) === (m.impersonationGuidance ?? null)) {
						return old;
					}
					return m;
				});
				messageList = safeMerge ? [...keptEarlier, ...merged] : merged;
				totalMsgCount = nextTotal;
				for (const m of incoming) knownMessageIds.add(m.id);
			}
			// Merge siblings so earlier-page swipe counts survive a tail refresh.
			if (safeMerge) {
				Object.assign(messageSiblings, newSiblings);
			} else {
				messageSiblings = newSiblings;
			}
		}
		// Streaming branch: leave messageList alone.

		// Hydrate streaming state from the global store. Bootstraps the
		// local typing/regen UI for both:
		//   • the user returning to a chat that's still streaming (first
		//     mount of this chat id), and
		//   • a remote-initiated stream beginning while this ChatView is
		//     already mounted (e.g. another device sent or regenerated).
		// Tracks `bootstrappedStartedAt` so a fresh generation after one
		// has finished re-bootstraps instead of being ignored.
		const gen = generationsStore.get(chatId);
		if (gen && bootstrappedStartedAt !== gen.startedAt) {
			bootstrappedStartedAt = gen.startedAt;
			didHydrateGen = true;
			if (gen.status === 'done' || gen.status === 'error') {
				untrack(() => {
					generationsStore.clear(chatId);
					setTimeout(() => onrefresh?.(), 0);
				});
			} else if (gen.status === 'streaming' && !untrack(() => isStreaming)) {
				untrack(() => {
					if (gen.isImpersonation) {
						// Impersonation: tokens go into the textarea, not a
						// message bubble. No placeholder needed. Clear any
						// stale assistant-bubble streaming state so live
						// token mirroring can't bleed into the previous reply.
						clearStreamBubbleTarget();
						isImpersonating = true;
						input = gen.accumulated;
						impersonateReasoning = gen.accumulatedReasoning;
						streamingReasoning = gen.accumulatedReasoning;
					} else if (gen.isRegenerate && gen.originalMessageId != null) {
						// Regenerate: stash the previous swipe so we can restore it
						// on abort, then blank out the bubble content so the typing
						// indicator (and live tokens) replace it instead of sitting
						// behind a blur overlay. finishStreaming uses
						// streamOriginalMessage to compose the new swipe array.
						const idx = messageList.findIndex(m => m.id === gen.originalMessageId);
						if (idx >= 0) {
							streamOriginalMessage = { ...messageList[idx] };
							streamingAssistantIdx = idx;
							streamIsRegenerate = true;
							messageList[idx] = {
								...messageList[idx],
								content: gen.accumulated,
								reasoning: [gen.accumulatedReasoning]
							};
						} else {
							// Original missing (very rare race) — fall back
							// to a tail placeholder so the user at least sees
							// the typing indicator.
							appendStreamPlaceholder('', '');
							streamIsRegenerate = false;
							streamOriginalMessage = null;
						}
					} else {
						// New send: append a placeholder for the assistant.
						appendStreamPlaceholder(gen.accumulated, gen.accumulatedReasoning);
						streamIsRegenerate = false;
						streamOriginalMessage = null;
					}
					streamAccumulated = gen.accumulated;
					streamAccumulatedReasoning = gen.accumulatedReasoning;
					streamingReasoning = gen.accumulatedReasoning;
					isStreaming = true;
					isReasoning = !!gen.accumulatedReasoning && !gen.accumulated;
					resetStreamTimeout();
					tick().then(() => scrollToBottom(true));
				});
			}
		}

		// Live mirror: keep local stream state aligned with new tokens
		// arriving via the global store (covers tokens that streamed in
		// while this component was unmounted *and* normal live streaming).
		// Skip during impersonation — those tokens belong in the textarea,
		// not in a message bubble (the impersonation mirror block below
		// owns that path).
		if (gen && !gen.isImpersonation && untrack(() => isStreaming) && untrack(() => streamingAssistantIdx) >= 0) {
			if (gen.accumulatedReasoning.length > untrack(() => streamAccumulatedReasoning).length) {
				streamAccumulatedReasoning = gen.accumulatedReasoning;
				streamingReasoning = gen.accumulatedReasoning;
				if (!untrack(() => isReasoning) && showReasoning) {
					reasoningModalIsImpersonation = false;
					reasoningModalIsLive = true;
					showReasoningModal = true;
				}
				if (!untrack(() => streamAccumulated)) isReasoning = true;
				resetStreamTimeout();
			}
			if (gen.accumulated.length > untrack(() => streamAccumulated).length) {
				isReasoning = false;
				streamAccumulated = gen.accumulated;
				// Mirror tokens onto the bubble so the user sees text appear
				// as it streams — for both fresh sends AND regenerates. For
				// regen, finishStreaming still composes the new swipe at the
				// end using streamOriginalMessage.
				const idx = untrack(() => streamingAssistantIdx);
				if (!isTexting && !reduceMotion && idx >= 0) {
					untrack(() => {
						messageList[idx] = {
							...messageList[idx],
							content: streamAccumulated,
							reasoning: [streamAccumulatedReasoning]
						};
					});
				}
				resetStreamTimeout();
			}
			// Catch-up finalize: if the generation finished while we were
			// backgrounded (or otherwise missed the live `complete` SSE
			// event), the mirror would otherwise leave isStreaming stuck on
			// — bubble shows tokens with the typing indicator forever. Run
			// finishStreaming here so the bubble settles into its final
			// state without waiting for a fresh user action.
			if (gen.status === 'done' || gen.status === 'error') {
				untrack(() => { finishStreaming(); });
			}
		}

		// Live mirror for impersonation: tokens land in the textarea and
		// reasoning area instead of a message bubble. Runs whenever the
		// current generation is impersonation, regardless of streamingAssistantIdx.
		if (gen && gen.isImpersonation && untrack(() => isImpersonating)) {
			if (gen.accumulatedReasoning.length > untrack(() => impersonateReasoning).length) {
				impersonateReasoning = gen.accumulatedReasoning;
				streamingReasoning = gen.accumulatedReasoning;
				if (!untrack(() => isReasoning)) isReasoning = true;
				resetStreamTimeout();
			}
			if (gen.accumulated.length > untrack(() => input).length) {
				isReasoning = false;
				input = gen.accumulated;
				resetStreamTimeout();
			}
			if (gen.status === 'done' || gen.status === 'error') {
				untrack(() => {
					isStreaming = false;
					isImpersonating = false;
					isReasoning = false;
					streamingReasoning = '';
					generationsStore.clear(chatId);
				});
			}
		}
	});

	function appendStreamPlaceholder(content: string, reasoning: string) {
		const placeholder: Message = {
			id: nextPlaceholderId(),
			role: 'assistant',
			content,
			swipes: [content || ''],
			swipeIndex: 0,
			reasoning: [reasoning],
			parentId: null,
			createdAt: new Date().toISOString().replace('Z', ''),
			guidance: null,
			impersonationGuidance: null
		};
		messageList = [...messageList, placeholder];
		streamingAssistantIdx = messageList.length - 1;
	}

	// Clear the assistant-bubble streaming target. Called whenever we're
	// done with (or cancelling) a stream that was painting into a specific
	// message slot. Doesn't touch token buffers — finishStreaming and the
	// pre-stream setup do that explicitly when needed.
	function clearStreamBubbleTarget() {
		streamingAssistantIdx = -1;
		streamIsRegenerate = false;
		streamOriginalMessage = null;
	}

	// Persist input draft per conversation. Two stores layered:
	//   - localStorage  → offline survival; works even when SSE is dead
	//   - chat.pendingDraft (server) → cross-device sync; debounced PATCH below
	// We track the wall-clock time of the most recent local edit so the
	// server's last-write-wins logic and the on-reconnect push both work
	// with a single source of truth.
	let lastLocalDraftAt = $state(untrack(() => {
		if (typeof localStorage === 'undefined') return 0;
		return Number(localStorage.getItem(`skald-draft-${chat.id}-at`) || '0');
	}));
	// What we last received from the server (or just sent up). Used to
	// suppress feedback loops: if the new value matches this, the change
	// came FROM the server and shouldn't be PATCHed back.
	let lastSyncedDraft = $state<string>(untrack(() => ((chat as any).pendingDraft as string | null) ?? ''));
	let lastSyncedDraftAt = $state<number>(untrack(() => (chat as any).pendingDraftAt ?? 0));

	$effect(() => {
		const draft = input;
		const chatId = chat.id;
		if (draft) {
			localStorage.setItem(`skald-draft-${chatId}`, draft);
		} else {
			localStorage.removeItem(`skald-draft-${chatId}`);
			localStorage.removeItem(`skald-draft-${chatId}-at`);
		}
		// Bump the local timestamp ONLY when the value actually diverges from
		// the last server snapshot — otherwise an SSE-driven assignment to
		// `input` would falsely look like a local edit and ping-pong with
		// the server.
		if (draft !== untrack(() => lastSyncedDraft)) {
			lastLocalDraftAt = Date.now();
			localStorage.setItem(`skald-draft-${chatId}-at`, String(lastLocalDraftAt));
		}
	});

	// Debounced server save for the textarea draft. 1.5s after the last edit
	// — also fires immediately when the tab is hidden or the textarea blurs.
	let draftSaveTimer: ReturnType<typeof setTimeout> | null = null;
	const DRAFT_SAVE_DEBOUNCE_MS = 1500;
	async function flushDraftSave() {
		if (draftSaveTimer) { clearTimeout(draftSaveTimer); draftSaveTimer = null; }
		const draft = input;
		if (draft === lastSyncedDraft) return;
		const at = lastLocalDraftAt || Date.now();
		const chatId = chat.id;
		try {
			await fetch(`/api/chats/${chatId}/draft`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ draft: draft || null, draftAt: at })
			});
			lastSyncedDraft = draft;
			lastSyncedDraftAt = at;
		} catch { /* offline; localStorage retains it for the reconnect push */ }
	}
	$effect(() => {
		void input; // track
		const chatId = chat.id;
		void chatId;
		if (draftSaveTimer) clearTimeout(draftSaveTimer);
		// Skip when the change came FROM the server (suppresses loops).
		if (input === untrack(() => lastSyncedDraft)) return;
		// Skip when offline; rely on the reconnect push instead.
		if (untrack(() => connectionState) !== 'connected') return;
		draftSaveTimer = setTimeout(flushDraftSave, DRAFT_SAVE_DEBOUNCE_MS);
	});

	// Mirror server-side draft into the textarea when another device has
	// typed something more recent than this device's latest local edit.
	$effect(() => {
		const remote = ((chat as any).pendingDraft as string | null) ?? '';
		const remoteAt = ((chat as any).pendingDraftAt as number | null) ?? 0;
		// Same snapshot we last reconciled — nothing to do.
		if (remoteAt === untrack(() => lastSyncedDraftAt) && remote === untrack(() => lastSyncedDraft)) return;
		// Server is older than our latest local edit — our pending PATCH will
		// replace it. Don't clobber what the user is currently typing.
		if (remoteAt < untrack(() => lastLocalDraftAt)) return;
		lastSyncedDraft = remote;
		lastSyncedDraftAt = remoteAt;
		if (input !== remote) input = remote;
	});

	// Inline message-edit buffer sync — same pattern as the textarea draft.
	let lastSyncedEditId = $state<number | null>(untrack(() => (chat as any).editingMessageId ?? null));
	let lastSyncedEditContent = $state<string>(untrack(() => (chat as any).editingMessageContent ?? ''));
	let lastSyncedEditAt = $state<number>(untrack(() => (chat as any).editingMessageAt ?? 0));
	let lastLocalEditAt = $state(0);
	let editSaveTimer: ReturnType<typeof setTimeout> | null = null;
	const EDIT_SAVE_DEBOUNCE_MS = 1500;
	async function flushEditSave() {
		if (editSaveTimer) { clearTimeout(editSaveTimer); editSaveTimer = null; }
		const id = editingId;
		const content = editContent;
		if (id === lastSyncedEditId && content === lastSyncedEditContent) return;
		const at = lastLocalEditAt || Date.now();
		const chatId = chat.id;
		try {
			await fetch(`/api/chats/${chatId}/draft`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					editingMessageId: id,
					editingMessageContent: id == null ? null : content,
					editingAt: at
				})
			});
			lastSyncedEditId = id;
			lastSyncedEditContent = id == null ? '' : content;
			lastSyncedEditAt = at;
		} catch { /* offline; reconnect-push will cover it */ }
	}
	$effect(() => {
		void editingId; void editContent;
		// Bump local timestamp whenever local diverges from last sync.
		if (editingId !== untrack(() => lastSyncedEditId) || editContent !== untrack(() => lastSyncedEditContent)) {
			lastLocalEditAt = Date.now();
		}
		if (editSaveTimer) clearTimeout(editSaveTimer);
		if (editingId === untrack(() => lastSyncedEditId) && editContent === untrack(() => lastSyncedEditContent)) return;
		if (untrack(() => connectionState) !== 'connected') return;
		// Clearing the edit (cancel/save) flushes immediately — feels nicer
		// when the matching device drops the ghost edit right away.
		const delay = editingId == null ? 0 : EDIT_SAVE_DEBOUNCE_MS;
		editSaveTimer = setTimeout(flushEditSave, delay);
	});
	$effect(() => {
		const remoteId = ((chat as any).editingMessageId as number | null) ?? null;
		const remoteContent = ((chat as any).editingMessageContent as string | null) ?? '';
		const remoteAt = ((chat as any).editingMessageAt as number | null) ?? 0;
		if (remoteAt === untrack(() => lastSyncedEditAt) && remoteId === untrack(() => lastSyncedEditId) && remoteContent === untrack(() => lastSyncedEditContent)) return;
		if (remoteAt < untrack(() => lastLocalEditAt)) return;
		lastSyncedEditId = remoteId;
		lastSyncedEditContent = remoteContent;
		lastSyncedEditAt = remoteAt;
		if (editingId !== remoteId) editingId = remoteId;
		if (editContent !== remoteContent) editContent = remoteContent;
	});

	// Flush pending saves when the tab becomes hidden or the page is about to
	// unload — covers the "I composed a message then closed the laptop" case.
	$effect(() => {
		if (typeof document === 'undefined') return;
		const onHide = () => { if (document.hidden) { flushDraftSave(); flushEditSave(); } };
		const onPageHide = () => { flushDraftSave(); flushEditSave(); };
		document.addEventListener('visibilitychange', onHide);
		window.addEventListener('pagehide', onPageHide);
		return () => {
			document.removeEventListener('visibilitychange', onHide);
			window.removeEventListener('pagehide', onPageHide);
		};
	});

	// On reconnect, push any local-only edits that happened while offline.
	// localStorage already preserved the draft text across the disconnect;
	// we just need to get it up to the server so other devices see it.
	let prevConnectionState: typeof connectionState = $state(untrack(() => connectionState));
	$effect(() => {
		const cs = connectionState;
		const prev = untrack(() => prevConnectionState);
		prevConnectionState = cs;
		if (cs !== 'connected' || prev === 'connected') return;
		// Just reconnected. Push if local diverges from last known server snapshot.
		if (input !== untrack(() => lastSyncedDraft)) flushDraftSave();
		if (editingId !== untrack(() => lastSyncedEditId) || editContent !== untrack(() => lastSyncedEditContent)) flushEditSave();
	});

	async function generateGreeting() {
		isStreaming = true;
		isReasoning = false;
		streamingReasoning = '';
		streamAccumulated = '';
		streamAccumulatedReasoning = '';
		streamIsRegenerate = false;
		streamOriginalMessage = null;
		resetStreamTimeout();

		// Wait before showing typing indicator
		if (isTexting) await initialTypingDelay();

		// Add placeholder for assistant
		messageList = [{ id: nextPlaceholderId(), role: 'assistant', content: '', swipes: [''], swipeIndex: 0, reasoning: [''], parentId: null, createdAt: new Date().toISOString().replace('Z', ''), guidance: null, impersonationGuidance: null }];
		totalMsgCount = 1;
		streamingAssistantIdx = 0;
		await scrollToBottom(true);

		try {
			const response = await fetch('/api/chat/send', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ chatId: chat.id, greeting: true })
			});

			if (!response.ok) {
				const err = await response.json();
				messageList[0] = { ...messageList[0], content: `Error: ${err.error || 'Failed to generate greeting'}` };
				isStreaming = false;
				streamingAssistantIdx = -1;
			}
			// SSE events will drive the rest
		} catch (err) {
			messageList[0] = { ...messageList[0], content: `Error: ${err instanceof Error ? err.message : 'Network error'}` };
			isStreaming = false;
			streamingAssistantIdx = -1;
		}
	}

	// Stack-based *thought* / "speech" / narration formatter lives in
	// $lib/utils/rp-format. Robust against edge cases like "-*x*",
	// "(*x*)", and asterisks adjacent to punctuation.
	function renderRoleplay(content: string): string {
		return renderRoleplayUtil(content, {
			isTexting,
			nestedEmphasisInSpeech
		});
	}

	// --- Markdown renderer: full markdown via marked, then DOMPurify ---
	function renderMarkdownContent(content: string): string {
		const raw = content.trimStart();
		let html = marked.parse(raw, { async: false, breaks: true }) as string;

		// XSS guard: marked escapes HTML in *source* but does NOT strip raw
		// HTML the model emits via its allowed-tags output. DOMPurify is the
		// final line of defence before {@html}.
		html = DOMPurify.sanitize(html, { ADD_ATTR: ['target', 'rel'] });

		html = html.replace(/<a\s+href="/g, '<a target="_blank" rel="noopener noreferrer" href="');

		// Add image click handling class
		html = html.replace(/<img /g, '<img class="my-2 max-w-full cursor-pointer rounded-lg" ');

		return html;
	}

	// Dispatch to the active renderer with caching for non-streaming messages
	const RENDER_CACHE_MAX = 500;
	const renderCache = new Map<string, string>();
	let lastRenderMode: string | undefined;
	let lastBlockExternal: boolean | undefined;

	/** Strip external <img> tags entirely when external content is blocked.
	 *  We remove the element rather than blanking the src so the browser
	 *  never even queues a request, and there's no empty placeholder
	 *  taking up layout space. */
	function stripExternalImages(html: string): string {
		if (!blockExternalContent) return html;
		// Remove any <img> whose src points to a remote URL. Self-closed
		// or not, with or without quotes — covers both renderer outputs
		// (markdown -> double-quoted) and raw rp-format injections.
		return html.replace(/<img\s[^>]*src=["']?https?:\/\/[^"'\s>]+["']?[^>]*>/gi, '');
	}

	function renderContent(content: string, skipCache = false): string {
		// Invalidate cache if render mode or external blocking changed
		if (lastRenderMode !== effectiveRenderMode || lastBlockExternal !== blockExternalContent) {
			renderCache.clear();
			lastRenderMode = effectiveRenderMode;
			lastBlockExternal = blockExternalContent;
		}
		const cached = renderCache.get(content);
		if (cached !== undefined) return cached;
		let result = effectiveRenderMode === 'markdown'
			? renderMarkdownContent(content)
			: renderRoleplay(content);
		result = stripExternalImages(result);
		// Skip caching for actively streaming content (changes every tick)
		if (content.length > 0 && !skipCache) {
			renderCache.set(content, result);
			// Prevent unbounded growth
			if (renderCache.size > RENDER_CACHE_MAX) {
				const first = renderCache.keys().next().value;
				if (first !== undefined) renderCache.delete(first);
			}
		}
		return result;
	}

	// Link validation: extracted to LinkValidator so the cache + debounce live
	// outside the component body. One instance per mount; cleanup runs on unmount.
	const linkValidator = new LinkValidator();
	$effect(() => {
		void messageList.length; // re-run when messages change
		if (typeof window !== 'undefined' && !isStreaming) {
			linkValidator.scheduleValidate(messagesContainer ?? null);
		}
		return linkValidator.cleanup;
	});

	// Prune messageImages so entries for messages that are no longer in the
	// list (deleted, regen'd into nothing, etc.) don't accumulate. Otherwise
	// the Record grows for the whole session — over many edits + deletes it
	// becomes a noticeable leak.
	$effect(() => {
		const liveIds = new Set(messageList.map(m => m.id));
		let pruned = false;
		const next: typeof messageImages = {};
		for (const [id, list] of Object.entries(messageImages)) {
			if (liveIds.has(Number(id))) next[Number(id)] = list;
			else pruned = true;
		}
		if (pruned) messageImages = next;
	});

	// Single delegated listener for image loads inside the messages container.
	// Replaces a per-image `load` attach loop that piled up closures whenever
	// scrollToBottom(force) ran against already-complete images. `load` doesn't
	// bubble, so we use capture. Only re-anchor if the user is already at the
	// bottom — otherwise late image layout shouldn't drag them down.
	$effect(() => {
		const el = messagesContainer;
		if (!el) return;
		const onLoad = (e: Event) => {
			if (e.target instanceof HTMLImageElement && isAnchored) {
				suppressScrollHandler = true;
				el.scrollTop = 0;
				requestAnimationFrame(() => { suppressScrollHandler = false; });
			}
		};
		el.addEventListener('load', onLoad, { capture: true });
		return () => el.removeEventListener('load', onLoad, { capture: true });
	});

	function isNearBottom(): boolean {
		if (!messagesContainer) return true;
		const thresholdMap: Record<string, number> = { tight: 20, normal: 50, relaxed: 150 };
		const px = thresholdMap[autoScrollThreshold] ?? 50;
		// col-reverse: scrollTop = 0 at bottom, negative when scrolled up to
		// older messages, positive only during below-anchor rubber-band /
		// overscroll. Only the negative side counts as scrolled away — any
		// positive overscroll past the latest message is still "at bottom"
		// so the scroll-to-bottom button stays hidden during spring-back.
		return messagesContainer.scrollTop >= -px;
	}

	// Jump to bottom and re-anchor. The `force` arg is vestigial (kept for
	// callsite compatibility) — every programmatic call should anchor.
	async function scrollToBottom(_force = true) {
		void _force;
		await tick();
		const el = messagesContainer;
		if (!el) return;
		suppressScrollHandler = true;
		el.scrollTop = 0;
		isAnchored = true;
		scrollButtonAttention = false;
		// Release after the resulting scroll event has fired.
		requestAnimationFrame(() => { suppressScrollHandler = false; });
	}

	async function sendMessage(guidance?: string) {
		const content = input.trim();
		if (!content || isStreaming) return;
		const ok = await checkFieldLimits([
			{ label: 'Message', value: input, limit: FIELD_LIMITS.messageContent, trim: (v) => (input = v) },
		]);
		if (!ok) return;

		const hadFocus = document.activeElement === textareaEl;

		// Snapshot any persisted impersonation swipes so the outgoing user
		// message preserves all of them as swipeable variants. The send
		// endpoint also clears them server-side in the same transaction.
		const impSwipesSnap = chatImpersonationSwipes.slice();
		const impIdxSnap = chatImpersonationSwipeIndex;
		const hadImpersonation = (chat as any).impersonationStatus === 'done' || impSwipesSnap.length > 0;
		if (hadImpersonation && impSwipesSnap.length === 0) {
			// Defensive: legacy/stale state (status=done with empty swipes).
			// Just nuke it so the send doesn't get stuck thinking we have data.
			fetch(`/api/chats/${chat.id}/impersonation`, { method: 'DELETE' }).catch(() => {});
		}

		input = '';
		isStreaming = true;
		isReasoning = false;
		streamingReasoning = '';
		streamAccumulated = '';
		streamAccumulatedReasoning = '';
		streamIsRegenerate = false;
		streamOriginalMessage = null;
		impersonateReasoning = '';
		resetStreamTimeout();

		// Text mode: keep keyboard if it was already up; Story mode: always dismiss
		if (textareaEl) {
			if (isTexting && hadFocus) {
				textareaEl.focus();
			} else {
				textareaEl.blur();
			}
		}

		// Optimistically add user message — preserve impersonation swipes
		// as message swipes so the user can flip between them later.
		const optimisticSwipes = impSwipesSnap.length > 0
			? impSwipesSnap.map((s, i) => i === impIdxSnap ? content : s.draft)
			: [content];
		const optimisticReasoning = impSwipesSnap.length > 0
			? impSwipesSnap.map(s => s.reasoning ?? '')
			: [];
		const optimisticIdx = impSwipesSnap.length > 0 ? impIdxSnap : 0;
		const optimisticGuidance = impSwipesSnap.length > 0
			? (impSwipesSnap[impIdxSnap]?.guidance ?? guidance ?? null)
			: (guidance ?? null);
		messageList = [...messageList, { id: nextPlaceholderId(), role: 'user', content, swipes: optimisticSwipes, swipeIndex: optimisticIdx, reasoning: optimisticReasoning, parentId: null, createdAt: new Date().toISOString().replace('Z', ''), guidance: optimisticGuidance, impersonationGuidance: null }];
		totalMsgCount++;
		await scrollToBottom(true);

		// Wait before showing typing indicator
		if (isTexting) await initialTypingDelay();

		// Add placeholder for assistant
		messageList = [...messageList, { id: nextPlaceholderId(), role: 'assistant', content: '', swipes: [''], swipeIndex: 0, reasoning: [''], parentId: null, createdAt: new Date().toISOString().replace('Z', ''), guidance: null, impersonationGuidance: null }];
		totalMsgCount++;
		streamingAssistantIdx = messageList.length - 1;
		await scrollToBottom(true);

		try {
			const response = await fetch('/api/chat/send', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					chatId: chat.id,
					content,
					guidance: guidance && guidance.trim() ? guidance : undefined,
					impersonationSwipes: impSwipesSnap.length > 0 ? impSwipesSnap : undefined,
					impersonationSwipeIndex: impSwipesSnap.length > 0 ? impIdxSnap : undefined,
				})
			});

			if (!response.ok) {
				const err = await response.json();
				messageList[streamingAssistantIdx] = { ...messageList[streamingAssistantIdx], content: `Error: ${err.error || 'Failed to send'}` };
				isStreaming = false;
				streamingAssistantIdx = -1;
			}
			// SSE events will drive the rest via the streamEvent $effect
		} catch (err) {
			messageList[streamingAssistantIdx] = { ...messageList[streamingAssistantIdx], content: `Error: ${err instanceof Error ? err.message : 'Network error'}` };
			isStreaming = false;
			streamingAssistantIdx = -1;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey && sendWithEnter) {
			e.preventDefault();
			sendMessage();
		}
	}

	async function impersonateMessage(guidance?: string) {
		// Single-tap during streaming is silently ignored — re-impersonate
		// is only available via the menu (and grayed out there too).
		if (isStreaming || isImpersonating) return;
		// Save whatever's in the textarea right now into the active swipe
		// (in-place) before kicking off a new generation. If there are no
		// swipes yet, this becomes swipe[0]. The new draft will append.
		const currentText = input;
		const existing = chatImpersonationSwipes.slice();
		const existingIdx = chatImpersonationSwipeIndex;
		if (currentText.trim() || existing.length > 0) {
			const updated = existing.length > 0 ? existing.slice() : [];
			if (updated.length === 0) {
				updated.push({ draft: currentText, reasoning: '', generatedAt: null });
			} else {
				updated[existingIdx] = { ...updated[existingIdx], draft: currentText };
			}
			// Await the PATCH so the server has the user's text persisted
			// BEFORE chatProcessor reads the chat row to append the new
			// placeholder swipe — otherwise the two writes race and the
			// user's first-swipe text gets overwritten by an empty entry.
			try {
				await fetch(`/api/chats/${chat.id}/impersonation`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ swipeIndex: existingIdx, swipes: updated })
				});
			} catch { /* best effort */ }
		}

		// Fire-and-forget: enqueue the generation server-side. Tokens come
		// back via the realtime SSE flow → generationsStore → the live
		// mirror $effect below routes them into `input`. This keeps the
		// stream going (and the draft persisted) even if the user navigates
		// away or the tab dies.
		input = '';
		impersonateReasoning = '';
		streamingReasoning = '';
		// Defensive: blow away any stale assistant-bubble stream state so
		// the impersonation tokens can't be mirrored onto the previous
		// reply (which would render the regen blur+spinner overlay there).
		clearStreamBubbleTarget();
		streamAccumulated = '';
		streamAccumulatedReasoning = '';
		try {
			const res = await fetch('/api/chat/stream', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					chatId: chat.id,
					impersonate: true,
					guidance: guidance && guidance.trim() ? guidance : undefined,
				})
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				input = `Error: ${err.error || 'Failed to impersonate'}`;
			}
		} catch (err) {
			input = `Error: ${err instanceof Error ? err.message : 'Network error'}`;
		}
	}

	async function navImpersonationSwipe(direction: -1 | 1) {
		if (isStreaming) return;
		if (chatImpersonationSwipes.length === 0) return;
		// Wrap around the ends so single-handed swiping never dead-ends.
		const total = chatImpersonationSwipes.length;
		const newIdx = ((chatImpersonationSwipeIndex + direction) % total + total) % total;
		if (newIdx === chatImpersonationSwipeIndex) return;
		haptic('light');

		// Save current textarea contents into the active swipe in-place,
		// then load the target swipe's draft into the textarea. Update local
		// state immediately so chevrons + text feel instant; the PATCH below
		// just persists for other devices / reloads.
		const updated = chatImpersonationSwipes.slice();
		updated[chatImpersonationSwipeIndex] = {
			...updated[chatImpersonationSwipeIndex],
			draft: input
		};
		chatImpersonationSwipes = updated;
		chatImpersonationSwipeIndex = newIdx;
		input = updated[newIdx]?.draft ?? '';
		impersonateReasoning = updated[newIdx]?.reasoning ?? '';

		try {
			await fetch(`/api/chats/${chat.id}/impersonation`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ swipeIndex: newIdx, swipes: updated })
			});
		} catch { /* best effort */ }
	}

	// Long-press / right-click handler factory for toolbar buttons (impersonate, send).
	//
	// When the long-press fires we open the menu, then need to swallow exactly
	// two follow-up events that would otherwise tear it down again:
	//   1. the synthetic `click` mobile browsers fire on the button after
	//      `pointerup` (would re-trigger the button's primary action),
	//   2. that same click bubbling to `document` (would hit the click-outside
	//      listener and immediately close the menu we just opened).
	// We can't use a time window — the user may hold for arbitrarily long after
	// the timer fires. Instead we set a "consume next click" flag that's cleared
	// by whichever consumer sees the click first.
	function buttonContextHandlers(open: (x: number, y: number) => void) {
		let timer: ReturnType<typeof setTimeout> | null = null;
		let start = { x: 0, y: 0 };
		let pending = false; // long-press fired; the next click should be swallowed
		const trigger = (x: number, y: number) => {
			pending = true;
			haptic('medium');
			open(x, y);
		};
		return {
			onpointerdown(e: PointerEvent) {
				if (e.button !== 0) return;
				start = { x: e.clientX, y: e.clientY };
				if (timer) clearTimeout(timer);
				timer = setTimeout(() => {
					timer = null;
					trigger(start.x, start.y);
				}, 500);
			},
			onpointermove(e: PointerEvent) {
				if (!timer) return;
				if (Math.abs(e.clientX - start.x) > 8 || Math.abs(e.clientY - start.y) > 8) {
					clearTimeout(timer);
					timer = null;
				}
			},
			onpointerup() {
				if (timer) { clearTimeout(timer); timer = null; }
			},
			onpointercancel() {
				if (timer) { clearTimeout(timer); timer = null; }
				pending = false;
			},
			oncontextmenu(e: MouseEvent) {
				e.preventDefault();
				e.stopPropagation();
				if (timer) { clearTimeout(timer); timer = null; }
				trigger(e.clientX, e.clientY);
				// Right-click doesn't fire a follow-up `click`, so don't leave
				// the flag armed — it'd swallow the user's next legitimate click.
				pending = false;
			},
			// Called from the button's own onclick. Returns true (and consumes
			// the flag) if this click is the synthetic one following a long-press.
			suppressClick() {
				if (!pending) return false;
				pending = false;
				return true;
			},
			// Called from the document-level click-outside listener. Peeks at
			// the flag without consuming it — the button's onclick (which fires
			// first because the click originated on the button) will consume it.
			// If the click happened *outside* the button, the button's onclick
			// never runs and we still see the flag set; clear it here so a
			// stray click doesn't keep the menu wedged open.
			isSuppressing() {
				if (!pending) return false;
				pending = false;
				return true;
			},
			reset() {
				pending = false;
			}
		};
	}

	function positionForMenu(clientX: number, clientY: number, menuW: number, menuH: number) {
		// On mobile with the soft keyboard up, position:fixed elements track
		// the visual viewport, but Touch.clientY is relative to the layout
		// viewport. Without translating, the menu drifts up by the keyboard's
		// offset and its bounds are clamped against the wrong height. Use
		// visualViewport when available to keep both coord spaces in sync.
		const vv = typeof window !== 'undefined' ? window.visualViewport : null;
		const offX = vv?.offsetLeft ?? 0;
		const offY = vv?.offsetTop ?? 0;
		const winW = vv?.width ?? window.innerWidth;
		const winH = vv?.height ?? window.innerHeight;
		const localX = clientX - offX;
		const localY = clientY - offY;
		const pad = 8;
		// When flipUp=true the menu uses CSS `bottom` positioning, so y is the
		// *bottom edge* of the menu (distance from viewport top). When false, y
		// is the *top edge* (CSS `top`). Keep that in mind when clamping.
		//
		// Default: open above the finger (bottom edge just above touch point).
		// Fallback: open below if there isn't enough room above.
		const enoughRoomAbove = localY - menuH - pad >= pad;
		const flipUp = enoughRoomAbove;
		// Clamp x so menu never clips left or right edge.
		const x = Math.max(pad, Math.min(winW - menuW - pad, localX - menuW / 2));
		// y = bottom edge when flipUp, top edge when !flipUp.
		// Clamp so the menu always stays fully on screen.
		const y = flipUp
			? Math.max(menuH + pad, Math.min(winH - pad, localY - pad))   // bottom edge ≥ menuH+pad so top stays on screen
			: Math.max(pad, Math.min(winH - menuH - pad, localY + pad));  // top edge, bottom stays on screen
		return { x, y, flipUp, viewportH: winH };
	}

	const IMPERSONATE_MENU_W = 220;
	const IMPERSONATE_MENU_H = 220;
	const SEND_MENU_W = 220;
	const SEND_MENU_H = 80;

	const impersonateBtnHandlers = buttonContextHandlers((x, y) => {
		// Only one context menu on screen at a time.
		closeMsgMenu();
		showSendMenu = false;
		impersonateMenuPosition = positionForMenu(x, y, IMPERSONATE_MENU_W, IMPERSONATE_MENU_H);
		showImpersonateMenu = true;
	});
	const sendBtnHandlers = buttonContextHandlers((x, y) => {
		closeMsgMenu();
		showImpersonateMenu = false;
		sendMenuPosition = positionForMenu(x, y, SEND_MENU_W, SEND_MENU_H);
		showSendMenu = true;
	});

	function openGuideModal(target: GuideTarget, prefill = '') {
		guideModalTarget = target;
		guideModalText = prefill;
		showGuideModal = true;
	}

	async function submitGuideModal() {
		const ok = await checkFieldLimits([
			{ label: 'Reply guidance', value: guideModalText, limit: FIELD_LIMITS.replyGuidance, trim: (v) => (guideModalText = v) },
		]);
		if (!ok) return;
		const text = guideModalText.trim();
		const target = guideModalTarget;
		showGuideModal = false;
		guideModalTarget = null;
		guideModalText = '';
		if (!target) return;
		if (target.kind === 'impersonate') {
			impersonateMessage(text || undefined);
		} else if (target.kind === 'impersonateView') {
			// no-op; modal was read-only
		} else if (target.kind === 'send') {
			sendMessage(text || undefined);
		} else if (target.kind === 'editAssistantGuidance') {
			// Update the assistant message's own guidance and regenerate it
			// against the new guidance. Future regenerations of this same
			// assistant pick up the persisted value automatically.
			try {
				await fetch(`/api/messages/${target.assistantMessageId}`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ guidance: text || null })
				});
				// Mirror locally so reopening the modal shows the *current*
				// guidance, not the value from when the message was first sent.
				const idx = messageList.findIndex(m => m.id === target.assistantMessageId);
				if (idx >= 0) {
					messageList[idx] = { ...messageList[idx], guidance: text || null };
				}
			} catch { /* best effort */ }
			regenerateMessage();
		} else if (target.kind === 'guideReply') {
			// User message is the latest — there's no assistant reply yet.
			// Persist the guidance on the user message first (so an empty
			// submit clears any stale guidance left over from a deleted
			// assistant), then kick off generation. chatProcessor will
			// move the guidance onto the new assistant and clear it from
			// the user message.
			try {
				await fetch(`/api/messages/${target.userMessageId}`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ guidance: text || null })
				});
				const idx = messageList.findIndex(m => m.id === target.userMessageId);
				if (idx >= 0) {
					messageList[idx] = { ...messageList[idx], guidance: text || null };
				}
			} catch { /* best effort */ }
			await generateNextReply(text || undefined);
		}
	}

	// Kick off a fresh assistant reply for the existing latest user
	// message. Used by "Guide Reply" when the user message is already at
	// the tail (no assistant after it). Server-side, /api/chat/stream
	// without an `impersonate` flag enqueues a normal generation against
	// whatever the chat's active leaf currently is.
	async function generateNextReply(guidance?: string) {
		if (isStreaming || isImpersonating) return;
		isStreaming = true;
		isReasoning = false;
		streamingReasoning = '';
		streamAccumulated = '';
		streamAccumulatedReasoning = '';
		streamIsRegenerate = false;
		streamOriginalMessage = null;
		impersonateReasoning = '';
		resetStreamTimeout();

		if (isTexting) await initialTypingDelay();

		appendStreamPlaceholder('', '');
		streamingAssistantIdx = messageList.length - 1;
		await scrollToBottom(true);

		try {
			const res = await fetch('/api/chat/stream', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					chatId: chat.id,
					guidance: guidance && guidance.trim() ? guidance : undefined,
				})
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				if (streamingAssistantIdx >= 0) {
					messageList[streamingAssistantIdx] = {
						...messageList[streamingAssistantIdx],
						content: `Error: ${err.error || 'Failed to generate'}`
					};
				}
				isStreaming = false;
				streamingAssistantIdx = -1;
			}
		} catch (err) {
			if (streamingAssistantIdx >= 0) {
				messageList[streamingAssistantIdx] = {
					...messageList[streamingAssistantIdx],
					content: `Error: ${err instanceof Error ? err.message : 'Network error'}`
				};
			}
			isStreaming = false;
			streamingAssistantIdx = -1;
		}
	}

	async function resendMessage(msgIdx: number) {
		if (isStreaming) return;
		const msg = messageList[msgIdx];
		const content = msg.content;

		// Optimistically trim the local view; restore on delete failure so we
		// don't end up with the message gone from the UI but still in the DB.
		const savedList = messageList;
		messageList = messageList.slice(0, msgIdx);
		input = content;
		await tick();

		fetch(`/api/messages/${msg.id}`, { method: 'DELETE' })
			.then((res) => { if (!res.ok) messageList = savedList; })
			.catch(() => { messageList = savedList; });

		sendMessage();
	}

	async function reImpersonateMessage(msgIdx: number) {
		if (isStreaming) return;
		const msg = messageList[msgIdx];

		// Mirror resendMessage: optimistic trim, fire-and-forget DELETE,
		// then kick off a fresh impersonation immediately.
		const savedList = messageList;
		messageList = messageList.slice(0, msgIdx);
		input = '';
		await tick();

		fetch(`/api/messages/${msg.id}`, { method: 'DELETE' })
			.then((res) => { if (!res.ok) messageList = savedList; })
			.catch(() => { messageList = savedList; });

		impersonateMessage();
	}

	function startEdit(msg: Message) {
		editingId = msg.id;
		editContent = msg.content;
	}

	function cancelEdit() {
		editingId = null;
		editContent = '';
	}

	async function saveEdit(msgIdx: number) {
		const msg = messageList[msgIdx];
		if (!editingId || editContent === msg.content) {
			cancelEdit();
			return;
		}
		const ok = await checkFieldLimits([
			{ label: 'Message', value: editContent, limit: FIELD_LIMITS.messageContent, trim: (v) => (editContent = v) },
		]);
		if (!ok) return;

		// Optimistic: apply edit immediately
		const savedContent = msg.content;
		const newContent = editContent;
		messageList[msgIdx] = { ...msg, content: newContent };
		cancelEdit();

		try {
			const res = await fetch(`/api/messages/${msg.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ content: newContent })
			});

			if (res.ok) {
				const updated = await res.json();
				const swipes = Array.isArray(updated.swipes) ? updated.swipes : msg.swipes;
				messageList[msgIdx] = { ...msg, content: updated.content, swipes, swipeIndex: updated.swipeIndex };
			} else {
				messageList[msgIdx] = { ...msg, content: savedContent };
			}
		} catch {
			messageList[msgIdx] = { ...msg, content: savedContent };
		}
	}

	async function handleReasoningUpdate(messageId: number, newReasoning: string) {
		const msgIdx = messageList.findIndex(m => m.id === messageId);
		if (msgIdx < 0) return;

		const msg = messageList[msgIdx];
		const savedReasoning = [...msg.reasoning];
		const updatedReasoning = [...msg.reasoning];
		updatedReasoning[msg.swipeIndex] = newReasoning;
		messageList[msgIdx] = { ...msg, reasoning: updatedReasoning };
		reasoningModalText = newReasoning;

		try {
			const res = await fetch(`/api/messages/${messageId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ reasoning: newReasoning })
			});

			if (!res.ok) {
				messageList[msgIdx] = { ...msg, reasoning: savedReasoning };
				reasoningModalText = savedReasoning[msg.swipeIndex] || '';
			}
		} catch {
			messageList[msgIdx] = { ...msg, reasoning: savedReasoning };
			reasoningModalText = savedReasoning[msg.swipeIndex] || '';
		}
	}

	async function reformatMessage(msgIdx: number) {
		const msg = messageList[msgIdx];
		if (!msg.content?.trim()) return;
		reformattingMessageId = msg.id;
		try {
			const res = await fetch(`/api/messages/${msg.id}/reformat`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({})
			});
			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				toasts.error(data.error || 'Failed to reformat message');
				return;
			}
			const data = await res.json();
			reformatReviewResults = [{ index: msgIdx, original: data.original, reformatted: data.reformatted }];
			showReformatReview = true;
		} catch {
			toasts.error('Failed to reformat message');
		} finally {
			reformattingMessageId = null;
		}
	}

	async function acceptReformat(results: typeof reformatReviewResults) {
		showReformatReview = false;
		for (const r of results) {
			const msg = messageList[r.index];
			messageList[r.index] = { ...msg, content: r.reformatted };
			// Save to DB
			try {
				const res = await fetch(`/api/messages/${msg.id}`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ content: r.reformatted })
				});
				if (res.ok) {
					const updated = await res.json();
					const swipes = Array.isArray(updated.swipes) ? updated.swipes : msg.swipes;
					messageList[r.index] = { ...msg, content: updated.content, swipes, swipeIndex: updated.swipeIndex };
				}
			} catch { /* revert not needed — optimistic is fine here */ }
		}
	}

	function requestDelete(msgIdx: number) {
		if (!confirmDeletions) {
			// Skip confirmation — animate and delete immediately
			performDelete(msgIdx, 'thread');
			return;
		}
		deleteMode = msgIdx < messageList.length - 1 ? 'thread' : 'single';
		confirmingDeleteIdx = msgIdx;
	}

	function cancelDelete() {
		confirmingDeleteIdx = null;
	}

	async function confirmDelete() {
		if (confirmingDeleteIdx === null) return;
		const idx = confirmingDeleteIdx;
		confirmingDeleteIdx = null;
		haptic('warning');
		performDelete(idx, deleteMode);
	}

	async function performDelete(idx: number, mode: DeleteMode) {
		const msg = messageList[idx];
		const savedList = messageList;

		// Trigger exit animation. Skip the wait when reduceMotion is on so the
		// row disappears immediately instead of holding for an animation that
		// CSS has already collapsed to ~0ms.
		if (mode === 'thread') deletingFromIdx = idx;
		else deletingSingleIdx = idx;
		if (!reduceMotion) {
			await new Promise(r => setTimeout(r, 300));
		}

		// Remove from list
		if (mode === 'thread') {
			messageList = messageList.slice(0, idx);
		} else {
			messageList = [...messageList.slice(0, idx), ...messageList.slice(idx + 1)];
		}
		deletingFromIdx = null;
		deletingSingleIdx = null;

		try {
			const res = await fetch(`/api/messages/${msg.id}?mode=${mode}`, { method: 'DELETE' });
			if (res.ok) {
				await onrefresh();
				if (mode === 'thread') await scrollToBottom(true);
			} else {
				messageList = savedList;
				toasts.error('Failed to delete message');
			}
		} catch {
			messageList = savedList;
			toasts.error('Failed to delete message');
		} finally {
			deletingFromIdx = null;
			deletingSingleIdx = null;
		}
	}

	async function undoBranch() {
		// Return to the previous branch by switching to the first child of the current leaf
		const lastMsg = messageList[messageList.length - 1];
		if (!lastMsg) return;

		// The switch-branch endpoint on the first child will walk to deepest leaf
		const res = await fetch(`/api/messages/${lastMsg.id}/switch-branch`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ direction: 0, limit: chatPageSize })
		});

		if (res.ok) {
			applyBranchData(await res.json());
		}
	}

	async function switchBranch(messageId: number, direction: -1 | 1) {
		const siblings = messageSiblings[messageId];
		if (!siblings || siblings.total <= 1) return;

		const msg = messageList.find(m => m.id === messageId);
		if (!msg) return;

		const newIndex = siblings.index + direction;
		if (newIndex < 0 || newIndex >= siblings.total) return;
		haptic('selection');

		// Server resolves the sibling by parent+index, walks to deepest leaf,
		// and returns the new message window inline — no second round-trip needed.
		const res = await fetch(`/api/messages/${messageId}/switch-branch`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ direction, limit: chatPageSize })
		});

		if (res.ok) {
			applyBranchData(await res.json());
		}
	}

	async function branchFromHere(msgIdx: number) {
		if (isStreaming) return;
		const msg = messageList[msgIdx];

		// For user messages, branch from the parent so the new message becomes a sibling
		// For assistant messages, branch from this message so the user continues after it
		const branchPointId = msg.role === 'user' && msg.parentId != null
			? msg.parentId
			: msg.id;

		const res = await fetch(`/api/chats/${chat.id}/branch`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ activeLeafId: branchPointId, limit: chatPageSize })
		});

		if (res.ok) {
			applyBranchData(await res.json());
		}
	}

	// Apply an inline message window returned by a branch-switch or branchFromHere
	// endpoint. Renders the new branch immediately without waiting for onrefresh()
	// to round-trip through the layout. The background onrefresh() keeps
	// chatData in layout consistent but its diff-sync will be a no-op.
	function applyBranchData(data: any) {
		if (!data?.messages) return;
		const incoming: Message[] = data.messages.map(parseMessage);
		// Preserve in-flight optimistic messages (negative ids assigned by
		// sendMessage's appendOptimistic path) so a branch fetch that returns
		// after a user typed + sent doesn't visually drop their message.
		const optimisticTail = messageList.filter(m => m.id < 0 && !incoming.some(n => n.id === m.id));
		messageList = optimisticTail.length ? [...incoming, ...optimisticTail] : incoming;
		messageSiblings = data.messageSiblings ?? {};
		if (data.totalMessages != null) totalMsgCount = data.totalMessages;
		scrollToBottom(true);
		// Sync layout state in the background — no await so the user sees
		// the new branch immediately.
		onrefresh?.();
	}


	function handleEditKeydown(e: KeyboardEvent, msgIdx: number) {
		if (e.key === 'Escape') {
			cancelEdit();
		} else if (e.key === 'Enter' && !e.shiftKey && sendWithEnter) {
			e.preventDefault();
			saveEdit(msgIdx);
		}
	}

	async function swipeMessage(messageIdx: number, direction: -1 | 1) {
		const msg = messageList[messageIdx];
		const total = msg.swipes.length;
		if (total <= 1) return;
		const newIndex = ((msg.swipeIndex + direction) % total + total) % total;
		if (newIndex === msg.swipeIndex) return;
		haptic('light');

		// Optimistic: show the swipe content immediately
		const savedIndex = msg.swipeIndex;
		const savedContent = msg.content;
		messageList[messageIdx] = {
			...msg,
			content: msg.swipes[newIndex],
			swipeIndex: newIndex
		};
		await scrollToBottom(true);

		try {
			const res = await fetch(`/api/messages/${msg.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ swipeIndex: newIndex })
			});

			if (!res.ok) {
				// Revert
				messageList[messageIdx] = { ...msg, content: savedContent, swipeIndex: savedIndex };
			}
		} catch {
			messageList[messageIdx] = { ...msg, content: savedContent, swipeIndex: savedIndex };
		}
	}

	// Trigger an image gen for an assistant message. The server resolves the
	// effective provider / model / prompt template and broadcasts the resulting
	// row via SSE — we just kick the request and surface failures.
	async function generateImageForMessage(messageId: number) {
		if (imageGenInFlight.has(messageId)) return;
		const msg = messageList.find((m) => m.id === messageId);
		const swipeIdx = msg?.swipeIndex ?? 0;
		// Optimistic: drop the spinner in right away. The SSE
		// `messageImage:started` event confirms it; `messageImage:created`
		// / `messageImage:error` clear it.
		const optimistic = new Map(imageGenInFlight);
		optimistic.set(messageId, swipeIdx);
		imageGenInFlight = optimistic;
		try {
			const res = await fetch(`/api/messages/${messageId}/images`, { method: 'POST' });
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				const errMsg = body?.error || body?.message
					|| 'No image provider configured. Set an image model in the provider profile or in this chat\u2019s settings.';
				toasts.error(errMsg);
				if (imageGenInFlight.has(messageId)) {
					const next = new Map(imageGenInFlight);
					next.delete(messageId);
					imageGenInFlight = next;
				}
			}
		} catch {
			toasts.error('Failed to start image generation');
			if (imageGenInFlight.has(messageId)) {
				const next = new Map(imageGenInFlight);
				next.delete(messageId);
				imageGenInFlight = next;
			}
		}
	}

	async function activateMessageImage(messageId: number, imageId: number) {
		try {
			await fetch(`/api/messages/${messageId}/images/${imageId}`, { method: 'PATCH' });
		} catch { /* SSE will reconcile */ }
	}

	async function deleteMessageImage(messageId: number, imageId: number) {
		try {
			await fetch(`/api/messages/${messageId}/images/${imageId}`, { method: 'DELETE' });
		} catch { /* SSE will reconcile */ }
	}

	async function regenerateMessage() {
		if (isStreaming) return;

		// Find the last assistant message index
		let lastAssistantIdx = -1;
		for (let i = messageList.length - 1; i >= 0; i--) {
			if (messageList[i].role === 'assistant') {
				lastAssistantIdx = i;
				break;
			}
		}
		if (lastAssistantIdx < 0) return;

		isStreaming = true;
		isReasoning = false;
		streamingReasoning = '';
		streamAccumulated = '';
		streamAccumulatedReasoning = '';
		streamIsRegenerate = true;
		streamOriginalMessage = { ...messageList[lastAssistantIdx] };
		resetStreamTimeout();

		// Wait before showing typing indicator
		if (isTexting) await initialTypingDelay();

		// Blank the bubble immediately so the typing indicator (and then
		// the live tokens) replaces the old reply rather than sitting under
		// a blur overlay. streamOriginalMessage holds the previous swipe
		// for restore-on-abort and for composing the new swipe in
		// finishStreaming.
		streamingAssistantIdx = lastAssistantIdx;
		messageList[lastAssistantIdx] = {
			...messageList[lastAssistantIdx],
			content: '',
			reasoning: ['']
		};
		await scrollToBottom(true);

		try {
			const response = await fetch('/api/chat/send', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ chatId: chat.id, regenerate: true })
			});

			if (!response.ok) {
				const err = await response.json();
				messageList[lastAssistantIdx] = { ...streamOriginalMessage!, content: `Error: ${err.error || 'Failed to regenerate'}` };
				isStreaming = false;
				clearStreamBubbleTarget();
			}
			// SSE events will drive the rest
		} catch (err) {
			messageList[lastAssistantIdx] = { ...streamOriginalMessage!, content: `Error: ${err instanceof Error ? err.message : 'Network error'}` };
		 isStreaming = false;
			clearStreamBubbleTarget();
		}
	}
</script>

<div class="relative flex min-h-0 flex-1 flex-col {characterThemeStyle ? 'bg-background text-foreground' : ''}" style={characterThemeStyle}>
	{#if chat.useCharacterTheme && character.backgroundPath}
		<!-- Single bg-image layer on the outermost container so it extends
		     behind the messages, the fade, AND the floating compose row.
		     Previously there were two copies (mobile + desktop) nested inside
		     the messages card; that meant the opaque compose bar covered it. -->
		<div
			class="pointer-events-none absolute inset-0 z-0 bg-cover bg-center bg-no-repeat opacity-[0.06]"
			style="background-image: url({character.backgroundPath})"
		></div>
	{/if}
	<!-- Messages card. No bg-background here anymore so the outer bg-image
	     shows through. Desktop still gets rounded corners for the card look. -->
	<div class="relative flex min-h-0 flex-1 flex-col overflow-hidden md:rounded-2xl">
	<!-- Chat header. Transparent background so the chat bg-image shows through.
	     The character avatar is oversized and intentionally overhangs the
	     bottom of the bar (~60% in, ~40% below) — gives the chat a strong
	     visual identity anchor in the upper-left. The story/text-mode icon
	     became a small badge in the avatar's bottom-right. Mobile and desktop
	     now share this layout (used to be split: centered on mobile, left on
	     desktop). The messages container compensates for the overhang via
	     extra top padding so the first message and "Load earlier" button
	     never sit under the avatar. -->
	<!-- Fullscreen-mobile layout: the chat header floats over the messages
	     so the message stream extends edge-to-edge behind the device status
	     bar (PWA + viewport-fit=cover from app.html). pt-safe / pl-safe
	     pushes the interactive elements into the device's safe area;
	     pointer-events-none on the wrapper lets scroll gestures pass
	     through the gaps between the buttons (each button itself is
	     pointer-events-auto). The top fade below provides the visual
	     dissolve so messages don't read as a hard edge against the status
	     bar. Safe-area insets evaluate to 0 on desktop, so the header
	     looks identical there. -->
	<header
		class="pointer-events-none absolute left-0 right-0 top-0 z-[3] flex min-h-16 items-center gap-2 md:gap-3"
		style="padding-top: max(0.5rem, var(--safe-area-top)); padding-bottom: 0.5rem; padding-left: max(0.75rem, var(--safe-area-left)); padding-right: max(0.75rem, var(--safe-area-right));"
	>
		<!-- Back button only appears in the mobile layout (under md, where the
		     left tab bar is hidden) AND on hover-capable devices (mouse). Touch
		     mobile users have swipe-from-left for the drawer; desktop users
		     have the tab bar; only mouse-on-narrow needs this affordance. -->
		{#if ontogglemobile}
			<button
				onclick={ontogglemobile}
				class="pointer-events-auto relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-primary transition-colors hover:bg-secondary md:hidden [@media(hover:none)]:hidden"
				aria-label="Back to chats"
			>
				<ChevronLeft class="h-6 w-6" />
				{#if totalUnread && totalUnread > 0}
					<span class="absolute right-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">{totalUnread}</span>
				{/if}
			</button>
		{/if}

		<!-- Avatar + name pill. Mirrors the compose row's translucent slab so
		     the two anchors visually balance, top and bottom. Picks up
		     --background / --card from the active character theme so themed
		     chats get a tinted pill automatically. Sizes to the name (mr-auto
		     pushes the kebab to the right) but min-w-0 + max-w-full let long
		     names truncate instead of pushing the kebab off-screen. -->
		<div class="pointer-events-auto mr-auto flex min-w-0 max-w-full items-center gap-2.5 rounded-full border border-border/40 bg-card/70 py-1 pl-1 pr-3 shadow-sm backdrop-blur-md md:gap-3 md:pr-4">
		<!-- In-bar avatar. Sized to h-12 so it sits comfortably inside the
		     h-14 bar with a small breathing margin. Ring SVG and corner badge
		     align directly to the avatar bounds. pointer-events-auto so taps
		     on the avatar open the lightbox even though the parent header is
		     pointer-events-none for scroll-through. -->
		<div class="pointer-events-auto relative h-12 w-12 shrink-0">
			{#if lastTokenStats}
				{@const ringPct = Math.min(Math.round((lastTokenStats.promptTokens / lastTokenStats.availableForPrompt) * 100), 100)}
				{@const ringCircumference = 2 * Math.PI * 22}
				{@const ringOffset = ringCircumference - (ringPct / 100) * ringCircumference}
				<svg class="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 48 48"
					role="img" aria-label="Context: {lastTokenStats.promptTokens.toLocaleString()} / {lastTokenStats.availableForPrompt.toLocaleString()} tokens ({ringPct}%)"
				>
					<title>Context: {lastTokenStats.promptTokens.toLocaleString()} / {lastTokenStats.availableForPrompt.toLocaleString()} tokens ({ringPct}%)</title>
					<circle cx="24" cy="24" r="22" fill="none" stroke="currentColor" stroke-width="2" class="text-muted/40" />
					<circle cx="24" cy="24" r="22" fill="none" stroke-width="2"
						class="{ringPct > 90 ? 'text-destructive' : ringPct > 70 ? 'text-warning' : 'text-primary/70'} transition-all duration-500"
						stroke="currentColor"
						stroke-dasharray={ringCircumference}
						stroke-dashoffset={ringOffset}
						stroke-linecap="round"
						transform="rotate(-90 24 24)"
					/>
				</svg>
			{/if}
			{#if character.avatarPath}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
				<img
					src={character.avatarPath}
					alt={character.name}
					class="absolute inset-0 h-full w-full cursor-pointer rounded-full object-cover ring-2 ring-background transition-opacity hover:opacity-80"
					onclick={(e) => { e.stopPropagation(); enlargedImage = character.avatarPath?.replace('/avatars/', '/avatars/original/') ?? null; }}
				/>
			{:else}
				<div class="absolute inset-0 flex items-center justify-center rounded-full bg-primary text-base font-semibold text-primary-foreground ring-2 ring-background">
					{character.name[0]}
				</div>
			{/if}
			<!-- Story/text-mode badge in the avatar's bottom-right corner.
			     pointer-events-none so taps fall through to the avatar. -->
			<span class="pointer-events-none absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm">
				{#if isTexting}
					<Smartphone class="h-2.5 w-2.5" />
				{:else}
					<BookOpen class="h-2.5 w-2.5" />
				{/if}
			</span>
		</div>

		<!-- Character name. Vertically centred in the pill. Tap is a no-op
		     per spec — info pane stays on the kebab. -->
		<h2 class="min-w-0 flex-1 truncate text-[15px] font-semibold leading-tight md:text-base">{character.name}</h2>
		</div>

		<!-- Right side: overflow menu -->
		<div class="pointer-events-auto flex shrink-0 items-center">
			<ChatHeaderMenu
				open={showHeaderMenu}
				{hasOverrides}
				hasCompactionSummary={!!chat.compactionSummary}
				{compactingNow}
				onToggle={(e) => { e.stopPropagation(); showHeaderMenu = !showHeaderMenu; }}
				onClose={closeHeaderMenu}
				onCharacterInfo={() => { showCharacterInfo = true; }}
				onSearchMessages={toggleMessageSearch}
				onLorebooks={() => { showCharacterLorebooks = true; }}
				onCompactNow={runManualCompaction}
				onViewCompaction={openCompactionEditor}
				onChatSettings={() => { showChatSettings = true; }}
			/>
		</div>
	</header>

	<!-- Top fade. Mirrors the bottom-fade pattern: gradient runs from the
	     --background colour at the top down to --background/0 at the bottom
	     so messages dissolve into the device status bar / chat header band
	     as they scroll up. Height = safe-area-inset-top + header height +
	     small visual buffer for the fade tail. pointer-events-none lets
	     scrolls + taps pass through to the messages and header above. -->
	<div
		class="pointer-events-none absolute left-0 right-0 top-0 z-[2] bg-gradient-to-b from-background to-background/0"
		style="height: calc(max(0.5rem, var(--safe-area-top)) + 4rem + 0.75rem);"
	></div>

	{#if messageSearchOpen}
		<!-- Search bar floats below the absolute chat header so messages can
		     keep scrolling underneath. Top offset = safe-area + header height
		     (3.5rem). Has its own bg-background/95 so it isn't see-through. -->
		<div
			class="pointer-events-auto absolute left-0 right-0 z-[2] flex items-center gap-2 border-b border-border/50 bg-background/95 px-3 py-2 pl-safe pr-safe backdrop-blur-sm md:px-6"
			style="top: calc(max(0.5rem, var(--safe-area-top)) + 4rem);"
		>
			<Search class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
			<input
				bind:this={messageSearchInputEl}
				bind:value={messageSearchQuery}
				placeholder="Search in conversation..."
				class="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
				onkeydown={(e) => { if (e.key === 'Escape') toggleMessageSearch(); }}
			/>
			{#if messageSearchQuery.trim()}
				<span class="text-xs text-muted-foreground">{messageSearchMatches.size} {messageSearchMatches.size === 1 ? 'match' : 'matches'}</span>
			{/if}
			<button onclick={toggleMessageSearch} class="rounded p-1 text-muted-foreground hover:text-foreground" aria-label="Close search">
				<X class="h-3.5 w-3.5" />
			</button>
		</div>
	{/if}

	<!-- Messages -->
	<!-- overflow-anchor: none — the browser's CSS scroll-anchoring is unreliable
	     inside flex-col-reverse and produced visible jitter on top of the
	     native bottom-anchoring this container relies on. We do no manual
	     scroll compensation now; col-reverse handles both the anchored and
	     scrolled-up cases correctly as long as the browser's own anchor
	     heuristic is out of the way.
	     Top padding clears the absolute-positioned chat header (h-14) PLUS
	     the device's status-bar safe-area inset so the first message and
	     the "Load earlier" button never sit under the avatar. The inline
	     style uses calc(safe-area-inset + 3.5rem) since Tailwind can't
	     compose env() with rem in one utility. -->
	<div bind:this={messagesContainer}
		class="relative z-[1] flex flex-1 flex-col-reverse overflow-y-auto overscroll-contain pb-3 md:pb-6"
		style="overflow-anchor: none; padding-top: calc(max(0.5rem, var(--safe-area-top)) + 4rem); padding-left: max(0.75rem, var(--safe-area-left)); padding-right: max(0.75rem, var(--safe-area-right));"
	>
		<div
			class="mx-auto w-full max-w-5xl space-y-4"
			style="padding-bottom: max(4rem, {composeRowHeight}px);"
		>
			<!-- Constant-height slot housing either the "Load earlier" button or the
			     windowed-render top-sentinel. Fixed height (not min-h) so the slot
			     occupies the EXACT same pixels with the button or the 1px sentinel
			     inside — any height mismatch shows up as a small viewport jump
			     after loading because the browser's scroll anchoring tracks it. -->
			{#if (hasMore && renderedStart === 0) || renderedStart > 0}
				<div class="flex h-[52px] items-center justify-center">
					{#if hasMore && renderedStart === 0}
						<button
							bind:this={loadEarlierButton}
							onclick={loadEarlierMessages}
							disabled={loadingMore}
							class="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-xs text-muted-foreground transition-all hover:bg-accent hover:text-foreground active:scale-[0.97] disabled:opacity-50"
						>
							{#if loadingMore}
								<div class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent"></div>
								Loading…
							{:else}
								<ChevronLeft class="h-3.5 w-3.5 rotate-90" />
								Load earlier messages ({totalMsgCount - messageList.length} remaining)
							{/if}
						</button>
					{:else}
						<!-- Sentinel for FRONT-C4 windowed render: triggers reveal of older
						     in-memory messages when scrolled near the top of the window. -->
						<div bind:this={topSentinel} class="h-px w-full" aria-hidden="true"></div>
					{/if}
				</div>
			{/if}
			{#each messageList.slice(renderedStart) as message, localI (message.id)}
				{@const i = localI + renderedStart}
				{#if message.role !== 'system'}
					<!-- Compaction indicator: shown right BEFORE the first uncompacted visible message -->
					{#if chat.compactionSummary && (chat.compactedUpToMessageId ?? 0) > 0 && !isMessageCompacted(message.id) && ((i === 0 && !hasMore) || isMessageCompacted(messageList[i - 1]?.id))}
						<div class="flex items-center gap-3 py-2">
							<div class="h-px flex-1 bg-primary/30"></div>
							<button
								type="button"
								onclick={openCompactionEditor}
								class="flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/20"
								use:tooltip={'View or edit the compaction summary'}
							>
								<Archive class="h-3 w-3" /> Conversation compacted
							</button>
							<div class="h-px flex-1 bg-primary/30"></div>
						</div>
					{/if}
					<!-- Date separator -->
					{#if dateSeparatorIndices.has(i)}
						<div class="flex items-center gap-3 py-2">
							<div class="h-px flex-1 bg-border/50"></div>
							<span class="text-[11px] font-medium text-muted-foreground">{getDateLabel(message.createdAt)}</span>
							<div class="h-px flex-1 bg-border/50"></div>
						</div>
					{/if}
					{@const consecutive = consecutiveIndices.has(i)}
					{@const msgNumber = (totalMsgCount - messageList.length) + i + 1}
					{@const nextMsg = messageList[i + 1]}
					{@const groupEnd = !nextMsg || nextMsg.role === 'system' || nextMsg.role !== message.role}
					{@const isCompacted = isMessageCompacted(message.id)}
					{@const isLast = i === messageList.length - 1}
					{@const swipeMsgImages = (messageImages[message.id] ?? []).filter((im) => (im.swipeIndex ?? 0) === (message.swipeIndex ?? 0))}
					{@const activeMsgImage = swipeMsgImages.find((im) => im.isActive) ?? swipeMsgImages[swipeMsgImages.length - 1] ?? null}
					{@const isRegenStreamTarget = streamIsRegenerate && streamingAssistantIdx === i}
					{@const activeMsgImageUrl = (isRegenStreamTarget || !activeMsgImage) ? null : `/api/images/cache/${activeMsgImage.filePath}`}
					<MessageBubble
						{message}
						generatedImageUrl={activeMsgImageUrl}
						generatedImageLoading={imageGenInFlight.get(message.id) === (message.swipeIndex ?? 0)}
						ongeneratedImageClick={() => (lightboxMessageId = message.id)}
						{consecutive}
						{groupEnd}
						{msgNumber}
						{isCompacted}
						{isLast}
						isExiting={(deletingFromIdx !== null && i >= deletingFromIdx) || (deletingSingleIdx !== null && i === deletingSingleIdx)}
						isAborting={abortAnimating && isStreaming && isLast && message.role === 'assistant'}
						isSearchDimmed={!!messageSearchQuery.trim() && !messageSearchMatches.has(message.id)}
						isEditing={editingId === message.id}
						bind:editContent
						{isStreaming}
						{isImpersonating}
						{isReasoning}
						isReformatting={reformattingMessageId === message.id}
						{effectiveRenderMode}
						{messageTimestamps}
						characterAvatarPath={character.avatarPath}
						characterName={character.name}
						personaAvatarPath={activePersona?.avatarPath ?? null}
						personaName={activePersona?.displayName || activePersona?.name || ''}
						enterClass={msgEnterClass(message.id, message.role)}
						{renderContent}
						{getMessageTime}
						onsaveEdit={() => saveEdit(i)}
						oncancelEdit={cancelEdit}
						onhandleEditKeydown={(e) => handleEditKeydown(e, i)}
						onregenerate={() => regenerateMessage()}
						onopenMenu={(e) => openMsgMenu(i, e)}
						onstartLongPress={(e) => startMsgLongPress(i, e)}
						onmoveLongPress={(e) => moveMsgLongPress(e)}
						onendLongPress={(e) => endMsgLongPress(e)}
						onopenReasoning={(isLive) => { reasoningModalIsImpersonation = false; reasoningModalIsLive = isLive; showReasoningModal = true; }}
						onimageClick={(src) => (enlargedImage = src)}
						onenlargeAvatar={(src) => (enlargedImage = src)}
					/>
					{@const reasoningPresent = !!message.reasoning?.[message.swipeIndex]}
					{@const parentMsgForPin = message.parentId != null ? messageList.find((mm) => mm.id === message.parentId) : null}
					{@const assistantGuidanceForPin = message.role === 'assistant' ? (message.guidance ?? null) : null}
					{@const pinShow = {
						viewReasoning: pinnedActions.has('viewReasoning') && reasoningPresent,
						regenerate: pinnedActions.has('regenerate') && message.role === 'assistant' && isLast && (i !== 0 || isTexting) && !isCompacted,
						generateImage: pinnedActions.has('generateImage') && message.role === 'assistant' && imageGenAvailable && !isCompacted,
						resend: pinnedActions.has('resend') && message.role === 'user' && isLast && !isCompacted,
						branch: pinnedActions.has('branch') && !isLast && !isCompacted,
						edit: pinnedActions.has('edit') && !isCompacted && editingId !== message.id,
						copy: pinnedActions.has('copy'),
						del: pinnedActions.has('delete') && i > 0 && !isCompacted,
						swipes: pinnedActions.has('swipes') && message.swipes.length > 1 && !(i === 0 && messageList.length > 1),
						guideReplyUser: pinnedActions.has('guideReply') && message.role === 'user' && isLast && !isCompacted,
						guideReplyAssistant: pinnedActions.has('guideReply') && message.role === 'assistant' && isLast && !isCompacted && parentMsgForPin?.role === 'user',
						guideImpersonation: pinnedActions.has('guideImpersonation') && message.role === 'user' && isLast && !isCompacted,
						reimpersonate: pinnedActions.has('reimpersonate') && message.role === 'user' && isLast && !isCompacted,
						reformatGreeting: pinnedActions.has('reformatGreeting') && i === 0 && message.role === 'assistant' && !isCompacted
					}}
					{@const hasPinned = pinShow.viewReasoning || pinShow.regenerate || pinShow.generateImage || pinShow.resend || pinShow.branch || pinShow.edit || pinShow.copy || pinShow.del || pinShow.swipes || pinShow.guideReplyUser || pinShow.guideReplyAssistant || pinShow.guideImpersonation || pinShow.reimpersonate || pinShow.reformatGreeting}
					{#if hasPinned && groupEnd && !(deletingFromIdx !== null && i >= deletingFromIdx) && !(deletingSingleIdx !== null && i === deletingSingleIdx)}
						<div class="mt-0.5 flex items-center gap-0.5 text-muted-foreground {message.role === 'user' ? 'justify-end' : 'justify-start md:pl-12'}">
							{#if pinShow.swipes}
								<button
									type="button"
									onclick={() => swipeMessage(i, -1)}
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
									onclick={() => swipeMessage(i, 1)}
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
									onclick={() => { reasoningModalIsImpersonation = message.role === 'user'; reasoningModalIsLive = false; reasoningModalText = message.reasoning[message.swipeIndex]; reasoningModalMessageId = message.id; showReasoningModal = true; }}
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
									onclick={() => regenerateMessage()}
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
									onclick={() => generateImageForMessage(message.id)}
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
									onclick={() => resendMessage(i)}
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
									onclick={() => branchFromHere(i)}
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
									onclick={() => startEdit(message)}
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
									onclick={() => openGuideModal({ kind: 'guideReply', userMessageId: message.id }, message.guidance ?? '')}
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
									onclick={() => openGuideModal({ kind: 'editAssistantGuidance', assistantMessageId: message.id }, assistantGuidanceForPin ?? '')}
									disabled={isStreaming}
									class="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
									use:tooltip={assistantGuidanceForPin ? 'Edit reply guidance' : 'Guide reply'}
									aria-label="Guide reply"
								>
									<Wand2 class="h-3.5 w-3.5" />
								</button>
							{/if}
							{#if pinShow.guideImpersonation}
								<button
									type="button"
									onclick={() => openGuideModal({ kind: 'impersonate' }, activeImpersonationSwipe?.guidance ?? '')}
									disabled={isStreaming}
									class="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
									use:tooltip={activeImpersonationSwipe?.guidance ? 'Edit impersonation guidance' : 'Guide impersonation'}
									aria-label="Guide impersonation"
								>
									<Wand2 class="h-3.5 w-3.5" />
								</button>
							{/if}
							{#if pinShow.reimpersonate}
								<button
									type="button"
									onclick={() => reImpersonateMessage(i)}
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
									onclick={() => reformatMessage(i)}
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
									onclick={async () => { try { await navigator.clipboard.writeText(message.content); haptic('success'); toasts.success('Copied'); } catch { toasts.error('Copy failed'); } }}
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
									onclick={() => requestDelete(i)}
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
			{/each}

			<!-- Hidden branches indicator -->
			{#if hiddenBranchCount > 0 && !isStreaming}
				<div class="mx-auto mt-6 flex max-w-md flex-col items-center gap-3 rounded-xl border border-dashed border-border/60 bg-muted/30 px-6 py-4 text-center">
					<div class="flex items-center gap-2 text-sm text-muted-foreground">
						<GitBranch class="h-4 w-4" />
						<span>{hiddenBranchCount} existing {hiddenBranchCount === 1 ? 'branch' : 'branches'} below this point</span>
					</div>
					<p class="text-xs text-muted-foreground/70">Send a message to start a new branch, or return to an existing one.</p>
					<button
						onclick={undoBranch}
						class="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-foreground transition-all hover:bg-accent active:scale-95"
					>
						<Undo2 class="h-3.5 w-3.5" />
						Return to existing branch
					</button>
				</div>
			{/if}
		</div>
		<div bind:this={bottomSentinel} class="h-px"></div>
	</div>



	<!-- Scroll to bottom button. Sits above the compose row, inside the card
	     so it shares the rounded clip. The bottom offset is driven by the
	     measured compose-row height so it always clears the send button —
	     previous hard-coded bottom-20 broke on iOS PWA where the safe-area
	     inset made the compose row taller than the offset. -->
	{#if showScrollButton}
		<button
			onclick={() => { scrollButtonAttention = false; scrollToBottom(true); }}
			style="bottom: calc({composeRowHeight}px + 0.5rem);"
			class="scroll-btn-enter absolute right-4 z-[3] flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card shadow-lg transition-all hover:bg-accent hover:shadow-xl hover:scale-110 active:scale-95 md:left-1/2 md:right-auto md:-translate-x-1/2 {scrollButtonAttention ? 'scroll-btn-attention' : ''}"
		>
			<ArrowDown class="h-4 w-4 text-foreground" />
			{#if scrollButtonAttention}
				<span class="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-primary ring-2 ring-background"></span>
			{/if}
		</button>
	{/if}

	<!-- Compose row. Floats absolutely at the bottom of the messages card.
	     The fade gradient lives on the OUTER wrapper so it spans the full
	     height of the compose region — from the top of the textarea band
	     down through the safe-area-inset-bottom zone — and bottoms out at
	     solid --background. Earlier the gradient was on the inner row only
	     and the outer had bg-background, which read as a hard solid band
	     when a character theme was active. Inner controls (textarea, send,
	     etc.) are each individually opaque so they stay crisp on top of the
	     gradient. When the keyboard is up we collapse the bottom pad so the
	     row meets the keyboard with a small gap instead of riding the full
	     safe-area inset (which iOS doesn't always zero out in PWAs).
	     We bind clientHeight so the messages spacer and scroll-to-bottom
	     button can move up with the textarea as it grows. -->
	<div
		bind:this={composeRowEl}
		bind:clientHeight={composeRowHeight}
		class="pointer-events-none absolute bottom-0 left-0 right-0 z-[2] bg-gradient-to-b from-background/0 to-background"
		style="padding-bottom: {keyboardVisible ? '0.25rem' : 'env(safe-area-inset-bottom, 0px)'};"
	>
	<div
		class="{keyboardVisible ? 'pt-1.5 pb-1 md:pt-3 md:pb-3' : 'pt-2 pb-2 md:pt-3 md:pb-3'}"
		style="padding-left: max(0.75rem, var(--safe-area-left)); padding-right: max(0.75rem, var(--safe-area-right));"
	>

		<div class="pointer-events-auto mx-auto flex max-w-5xl items-stretch gap-2">
			<div class="relative flex-1">
				<LimitedTextarea
					bind:element={textareaEl}
					bind:value={input}
					oninput={() => textareaSizer.measure()}
					onkeydown={handleKeydown}
					readonly={isImpersonating && isReasoning}
					placeholder={isImpersonating ? '' : 'Reply'}
					rows={1}
					limit={FIELD_LIMITS.messageContent}
					class="block w-full resize-none rounded-3xl border border-input bg-card px-4 py-2.5 text-sm leading-normal placeholder:text-muted-foreground focus:border-foreground/30 focus:outline-none focus:ring-2 focus:ring-foreground/20"
				/>
				{#if isImpersonating && !input}
					{#if isReasoning}
						<button
							onclick={() => { reasoningModalIsImpersonation = true; reasoningModalIsLive = true; showReasoningModal = true; }}
							class="absolute inset-0 flex items-center justify-center gap-2 rounded-3xl text-xs text-muted-foreground/70 hover:text-primary hover:bg-accent/80 transition-colors"
						>
							<span class="typing-dot h-2.5 w-2.5 rounded-full bg-muted-foreground/60" style="animation-delay: 0ms"></span>
							<span class="typing-dot h-2.5 w-2.5 rounded-full bg-muted-foreground/60" style="animation-delay: 160ms"></span>
							<span class="typing-dot h-2.5 w-2.5 rounded-full bg-muted-foreground/60" style="animation-delay: 320ms"></span>
							<Brain class="h-4 w-4" />
						</button>
					{:else}
						<!-- Waiting for first token: show plain dots, no brain -->
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
					if (impersonateBtnHandlers.suppressClick()) {
						// Stop the synthetic post-long-press click from bubbling to the
						// document click-outside listener (which would close the menu).
						e.preventDefault();
						e.stopPropagation();
						return;
					}
					// Reuse the round's guidance so re-impersonating from
					// the toolbar carries forward the user's last guide.
					impersonateMessage(activeImpersonationSwipe?.guidance ?? undefined);
				}}
				onpointerdown={impersonateBtnHandlers.onpointerdown}
				onpointermove={impersonateBtnHandlers.onpointermove}
				onpointerup={impersonateBtnHandlers.onpointerup}
				onpointercancel={impersonateBtnHandlers.onpointercancel}
				oncontextmenu={impersonateBtnHandlers.oncontextmenu}
				disabled={isStreaming && !isImpersonating}
				class="flex w-11 shrink-0 items-center justify-center rounded-full border border-input bg-card text-muted-foreground shadow-sm shadow-black/10 transition-all hover:bg-accent hover:text-foreground active:scale-90 disabled:opacity-50"
				use:tooltip={'Impersonate (long-press for options)'}
				aria-label="Impersonate"
			>
				<UserPen class="h-4 w-4" />
			</button>
			{#if isStreaming}
				<button
					onclick={abortGeneration}
					class="flex w-11 shrink-0 items-center justify-center rounded-full bg-destructive text-destructive-foreground transition-all hover:bg-destructive/80 hover:scale-105 active:scale-90"
					use:tooltip={isImpersonating ? 'Stop impersonation' : 'Stop generation'}
					aria-label={isImpersonating ? 'Stop impersonation' : 'Stop generation'}
				>
					<Square class="h-4 w-4 fill-current" />
				</button>
			{:else if !(isMobile && sendWithEnterMobile)}
				<!-- On mobile with "Send with Enter" enabled, hide the send button to
				     give the textarea more room — Enter handles the send. -->
				<button
					onclick={(e) => {
						if (sendBtnHandlers.suppressClick()) {
							e.preventDefault();
							e.stopPropagation();
							return;
						}
						sendMessage();
					}}
					onpointerdown={sendBtnHandlers.onpointerdown}
					onpointermove={sendBtnHandlers.onpointermove}
					onpointerup={sendBtnHandlers.onpointerup}
					onpointercancel={sendBtnHandlers.onpointercancel}
					oncontextmenu={sendBtnHandlers.oncontextmenu}
					disabled={!input.trim()}
					class="flex w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md shadow-primary/30 transition-all hover:bg-primary/90 hover:scale-105 hover:shadow-lg hover:shadow-primary/40 active:scale-90 disabled:opacity-50 disabled:shadow-none disabled:hover:scale-100 disabled:active:scale-100"
					aria-label="Send message (long-press for guided reply)"
				>
					<Send class="h-4 w-4" />
				</button>
			{/if}
		</div>
	</div>
	</div><!-- /compose row outer (safe-area passthrough) -->
	</div><!-- /messages card -->
</div>

<ImageLightbox src={enlargedImage} onclose={() => (enlargedImage = null)} />

<ImageLightbox
	images={(() => {
		if (lightboxMessageId === null) return [];
		const list = messageImages[lightboxMessageId] ?? [];
		const msg = messageList.find((m) => m.id === lightboxMessageId);
		const swipeIdx = msg?.swipeIndex ?? 0;
		return list
			.filter((im) => (im.swipeIndex ?? 0) === swipeIdx)
			.map((im) => ({
				id: im.id,
				src: `/api/images/cache/${im.filePath}`,
				prompt: im.prompt,
				isActive: im.isActive,
				downloadName: `message-${lightboxMessageId}-${im.filePath}`
			}));
	})()}
	regenerating={(() => {
		if (lightboxMessageId === null) return false;
		const msg = messageList.find((m) => m.id === lightboxMessageId);
		return imageGenInFlight.get(lightboxMessageId) === (msg?.swipeIndex ?? 0);
	})()}
	onclose={() => (lightboxMessageId = null)}
	onactivate={(imageId) => lightboxMessageId !== null && activateMessageImage(lightboxMessageId, imageId as number)}
	ondelete={(imageId) => lightboxMessageId !== null && deleteMessageImage(lightboxMessageId, imageId as number)}
	onregenerate={() => lightboxMessageId !== null && generateImageForMessage(lightboxMessageId)}
/>

<ChatSettings
	open={showChatSettings}
	chatId={chat.id}
	chat={chat}
	{characterHasTheme}
	providers={providers ?? []}
	personas={personas ?? []}
	onclose={() => { showChatSettings = false; }}
	onrefresh={onrefresh}
/>

{#if showCompactionEditor}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-[70] flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm"
		onclick={(e) => { if (e.target === e.currentTarget) showCompactionEditor = false; }}
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
					onclick={() => { showCompactionEditor = false; }}
					class="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
					aria-label="Close"
				>
					<X class="h-4 w-4" />
				</button>
			</header>
			<div class="flex-1 overflow-y-auto p-5">
				<LimitedTextarea
					bind:value={compactionEditorDraft}
					rows={14}
					limit={FIELD_LIMITS.compactionSummary}
					class="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm leading-relaxed placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-ring"
					placeholder="Summary of the story so far..."
				/>
				<p class="mt-2 text-xs text-muted-foreground">Editing here updates what the AI sees in place of the {(chat.compactedUpToMessageId ?? 0) > 0 ? 'compacted' : 'earlier'} messages. Clearing the text resets the high-water mark so the next compaction starts from the very first message.</p>
			</div>
			<div class="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
				<Button type="button" variant="ghost" onclick={() => { showCompactionEditor = false; }}>Cancel</Button>
				<Button
					type="button"
					variant="primary"
					onclick={saveCompactionSummary}
					loading={savingCompactionSummary}
					disabled={savingCompactionSummary}
				>
					{savingCompactionSummary ? 'Saving…' : 'Save summary'}
				</Button>
			</div>
		</div>
	</div>
{/if}

<CharacterInfoModal
	open={showCharacterInfo}
	{character}
	allowExternalOverride={chat.allowExternalResources}
	onclose={() => { showCharacterInfo = false; }}
/>

<CharacterLorebooksModal
	open={showCharacterLorebooks}
	chatId={chat.id}
	characterName={character.name}
	allLorebooks={allLorebooks}
	onclose={() => { showCharacterLorebooks = false; }}
/>

<ReasoningModal bind:open={showReasoningModal} reasoning={activeReasoningText} characterName={reasoningModalName} messageId={reasoningModalIsLive ? 0 : reasoningModalMessageId} onreasoningupdate={handleReasoningUpdate} />

<GreetingReviewModal
	open={showReformatReview}
	results={reformatReviewResults}
	onaccept={acceptReformat}
	onclose={() => (showReformatReview = false)}
/>

<!-- Delete confirmation dialog -->
{#if confirmingDeleteIdx !== null}
	{@const delMsg = messageList[confirmingDeleteIdx]}
	{@const isNotLast = confirmingDeleteIdx < messageList.length - 1}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-enter" onclick={cancelDelete}>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="modal-enter mx-4 w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-xl" onclick={(e) => e.stopPropagation()}>
			<h3 class="text-base font-semibold text-foreground">Delete message?</h3>
			{#if isNotLast}
				<p class="mt-2 text-sm text-muted-foreground">Choose what to delete:</p>
				<div class="mt-3 space-y-2">
					<button
						type="button"
						onclick={() => { deleteMode = 'single'; }}
						class="w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors {deleteMode === 'single' ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'}"
					>
						Delete only this message
					</button>
					<button
						type="button"
						onclick={() => { deleteMode = 'thread'; }}
						class="w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors {deleteMode === 'thread' ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'}"
					>
						Delete this message and everything after it
					</button>
				</div>
				{#if deleteMode === 'thread'}
					<p class="mt-2 text-sm font-medium text-warning">
						All branches below this point will be deleted.
					</p>
				{/if}
			{:else}
				<p class="mt-2 text-sm text-muted-foreground">This message will be permanently deleted.</p>
			{/if}
			<div class="mt-4 flex items-center justify-end gap-2">
				<Button variant="ghost" size="sm" onclick={cancelDelete}>Cancel</Button>
				<Button variant="destructive" size="sm" onclick={confirmDelete}>
					{deleteMode === 'thread' ? 'Delete Thread' : 'Delete Message'}
				</Button>
			</div>
		</div>
	</div>
{/if}

<!-- Message context menu (right-click / long-press) -->
{#if msgMenuIdx !== null && msgMenuPosition}
	{@const menuMsg = messageList[msgMenuIdx]}
	{#if menuMsg}
		{@const menuIsLast = msgMenuIdx === messageList.length - 1}
		{@const menuIsLastAssistant = menuMsg.role === 'assistant' && menuIsLast}
		{@const menuIsLastUser = menuMsg.role === 'user' && menuIsLast}
		{@const menuIsFirst = msgMenuIdx === 0}
		{@const menuShowRegen = menuIsLastAssistant && (!menuIsFirst || isTexting)}
		{@const menuMsgIdx = msgMenuIdx}
		{@const menuMsgObj = menuMsg}
		{@const menuSiblings = messageSiblings[menuMsg.id]}
		{@const menuHasBranches = menuSiblings && menuSiblings.total > 1}
		{@const menuIsCompacted = isMessageCompacted(menuMsg.id)}
		{@const menuParentMsg = menuMsgObj.parentId != null ? messageList.find((mm) => mm.id === menuMsgObj.parentId) : null}
		{@const menuAssistantGuidance = menuMsg.role === 'assistant' ? (menuMsgObj.guidance ?? null) : null}
		{@const menuGreetingLocked = menuIsFirst && messageList.length > 1}
		{@const menuVisibleCount =
			((menuMsg.swipes.length > 1 && !pinnedActions.has('swipes') && !menuGreetingLocked) ? 1 : 0)
			+ (menuHasBranches ? 1 : 0)
			+ ((menuMsg.reasoning[menuMsg.swipeIndex] && !pinnedActions.has('viewReasoning')) ? 1 : 0)
			+ ((menuShowRegen && !menuIsCompacted && !pinnedActions.has('regenerate')) ? 1 : 0)
			+ ((menuMsg.role === 'assistant' && !menuIsCompacted && imageGenAvailable && !pinnedActions.has('generateImage')) ? 1 : 0)
			+ ((menuIsLastUser && !menuIsCompacted && !pinnedActions.has('resend')) ? 1 : 0)
			+ ((menuIsLastUser && !menuIsCompacted && !pinnedActions.has('guideReply')) ? 1 : 0)
			+ ((menuIsLastUser && !menuIsCompacted && !pinnedActions.has('reimpersonate')) ? 1 : 0)
			+ ((menuMsg.role === 'user' && menuIsLast && !menuIsCompacted && !pinnedActions.has('guideImpersonation')) ? 1 : 0)
			+ ((menuMsg.role === 'user' && !menuIsLast && !menuIsCompacted && menuMsgObj.impersonationGuidance) ? 1 : 0)
			+ ((menuIsLastAssistant && menuParentMsg && menuParentMsg.role === 'user' && !menuIsCompacted && !pinnedActions.has('guideReply')) ? 1 : 0)
			+ ((!menuIsLast && !menuIsCompacted && !pinnedActions.has('branch')) ? 1 : 0)
			+ ((menuIsFirst && menuMsg.role === 'assistant' && !menuIsCompacted && !pinnedActions.has('reformatGreeting')) ? 1 : 0)
			+ (!pinnedActions.has('edit') ? 1 : 0)
			+ (!pinnedActions.has('copy') ? 1 : 0)
			+ ((menuMsgIdx > 0 && !menuIsCompacted && !pinnedActions.has('delete')) ? 1 : 0)}
		<div
			data-msg-menu
			class="popup-menu fixed z-[60] w-[200px] rounded-xl border border-border bg-popover py-1 shadow-2xl"
			style="--popup-origin: {msgMenuPosition.flipUp ? 'bottom' : 'top'} left; left: {msgMenuPosition.x}px; {msgMenuPosition.flipUp ? 'bottom' : 'top'}: {msgMenuPosition.flipUp ? (msgMenuPosition.viewportH - msgMenuPosition.y) + 'px' : msgMenuPosition.y + 'px'}"
		>
			{#if menuMsg.swipes.length > 1 && !pinnedActions.has('swipes') && !menuGreetingLocked}
				<div class="flex items-center justify-center gap-1 px-3 py-1.5">
					<button
						type="button"
						onclick={() => { msgMenuScrollSuppressed = true; swipeMessage(menuMsgIdx, -1).finally(() => { msgMenuScrollSuppressed = false; }); }}
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
						onclick={() => { msgMenuScrollSuppressed = true; swipeMessage(menuMsgIdx, 1).finally(() => { msgMenuScrollSuppressed = false; }); }}
						disabled={isStreaming || menuMsg.swipes.length <= 1}
						class="flex h-7 w-7 items-center justify-center rounded text-foreground/60 transition-colors hover:text-foreground disabled:opacity-30"
					>
						<ChevronRight class="h-4 w-4" />
					</button>
				</div>
				<div class="my-0.5 h-px bg-border"></div>
			{/if}
			{#if menuHasBranches}
				<div class="flex items-center justify-center gap-1 px-3 py-1.5">
					<GitBranch class="h-3.5 w-3.5 text-muted-foreground/60" />
					<button
						type="button"
						onclick={() => { switchBranch(menuMsgObj.id, -1); closeMsgMenu(); }}
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
						onclick={() => { switchBranch(menuMsgObj.id, 1); closeMsgMenu(); }}
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
					onclick={() => { reasoningModalIsImpersonation = menuMsg.role === 'user'; reasoningModalIsLive = false; reasoningModalText = menuMsgObj.reasoning[menuMsgObj.swipeIndex]; reasoningModalMessageId = menuMsgObj.id; showReasoningModal = true; closeMsgMenu(); }}
					class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
				>
					<Brain class="h-4 w-4" />View reasoning
				</button>
			{/if}
			{#if menuShowRegen && !menuIsCompacted && !pinnedActions.has('regenerate')}
				<button
					type="button"
					onclick={() => { regenerateMessage(); closeMsgMenu(); }}
					disabled={isStreaming}
					class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-40 disabled:pointer-events-none"
				>
					<RefreshCw class="h-4 w-4" />Regenerate
				</button>
			{/if}
			{#if menuMsg.role === 'assistant' && !menuIsCompacted && imageGenAvailable && !pinnedActions.has('generateImage')}
				<button
					type="button"
					onclick={() => { generateImageForMessage(menuMsgObj.id); closeMsgMenu(); }}
					disabled={imageGenInFlight.has(menuMsgObj.id)}
					class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-40 disabled:pointer-events-none"
				>
					<ImagePlus class="h-4 w-4" />Generate image
				</button>
			{/if}
			{#if menuIsLastUser && !menuIsCompacted}
				{#if !pinnedActions.has('resend')}
					<button
						type="button"
						onclick={() => { resendMessage(menuMsgIdx); closeMsgMenu(); }}
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
							const id = menuMsgObj.id;
							const g = menuMsgObj.guidance ?? '';
							closeMsgMenu();
							openGuideModal({ kind: 'guideReply', userMessageId: id }, g);
						}}
						disabled={isStreaming}
						class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-40 disabled:pointer-events-none"
					>
						<Wand2 class="h-4 w-4" />{menuMsgObj.guidance ? 'Edit reply guidance…' : 'Guide reply…'}
					</button>
				{/if}
				{#if !pinnedActions.has('reimpersonate')}
					<button
						type="button"
						onclick={() => { reImpersonateMessage(menuMsgIdx); closeMsgMenu(); }}
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
					onclick={() => { closeMsgMenu(); openGuideModal({ kind: 'impersonate' }, activeImpersonationSwipe?.guidance ?? ''); }}
					disabled={isStreaming}
					class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-40 disabled:pointer-events-none"
				>
					<Wand2 class="h-4 w-4" />{activeImpersonationSwipe?.guidance ? 'Edit impersonation guidance…' : 'Guide impersonation…'}
				</button>
			{/if}
			{#if menuMsg.role === 'user' && !menuIsLast && !menuIsCompacted && menuMsgObj.impersonationGuidance}
				<!-- 2nd-latest user message: show the impersonation guidance
				     read-only so the user can see what they used, but can't edit
				     it now that the impersonation round has already produced a reply. -->
				<button
					type="button"
					onclick={() => {
						const g = menuMsgObj.impersonationGuidance ?? '';
						closeMsgMenu();
						openGuideModal({ kind: 'impersonateView' }, g);
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
						const id = menuMsgObj.id;
						const g = menuAssistantGuidance ?? '';
						closeMsgMenu();
						openGuideModal({ kind: 'editAssistantGuidance', assistantMessageId: id }, g);
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
					onclick={() => { branchFromHere(menuMsgIdx); closeMsgMenu(); }}
					disabled={isStreaming}
					class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-40 disabled:pointer-events-none"
				>
					<GitBranchPlus class="h-4 w-4" />Branch from here
				</button>
			{/if}
			{#if menuIsFirst && menuMsg.role === 'assistant' && !menuIsCompacted && !pinnedActions.has('reformatGreeting')}
				<button
					type="button"
					onclick={() => { reformatMessage(menuMsgIdx); closeMsgMenu(); }}
					disabled={isStreaming}
					class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-40 disabled:pointer-events-none"
				>
					<Wand2 class="h-4 w-4" />Reformat greeting
				</button>
			{/if}
			{#if !pinnedActions.has('edit')}
				<button
					type="button"
					onclick={() => { startEdit(menuMsgObj); closeMsgMenu(); }}
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
					onclick={async () => { try { await navigator.clipboard.writeText(menuMsgObj.content); haptic('success'); toasts.success('Copied'); } catch { toasts.error('Copy failed'); } closeMsgMenu(); }}
					class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
				>
					<Copy class="h-4 w-4" />Copy
				</button>
			{/if}
			{#if menuMsgIdx > 0 && !menuIsCompacted && !pinnedActions.has('delete')}
				<div class="my-1 h-px bg-border"></div>
				<button
					type="button"
					onclick={() => { requestDelete(menuMsgIdx); closeMsgMenu(); }}
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
{/if}

<!-- Impersonate button context menu (long-press / right-click) -->
{#if showImpersonateMenu && impersonateMenuPosition}
	<div
		data-impersonate-menu
		class="popup-menu fixed z-[60] w-[220px] rounded-xl border border-border bg-popover py-1 shadow-2xl"
		style="--popup-origin: {impersonateMenuPosition.flipUp ? 'bottom' : 'top'} left; left: {impersonateMenuPosition.x}px; {impersonateMenuPosition.flipUp ? 'bottom' : 'top'}: {impersonateMenuPosition.flipUp ? (impersonateMenuPosition.viewportH - impersonateMenuPosition.y) + 'px' : impersonateMenuPosition.y + 'px'}"
	>
		{#if chatImpersonationSwipes.length > 1}
			<div class="flex items-center justify-center gap-1 px-3 py-1.5">
				<button
					type="button"
					onclick={() => navImpersonationSwipe(-1)}
					disabled={isStreaming || chatImpersonationSwipes.length <= 1}
					class="flex h-7 w-7 items-center justify-center rounded text-foreground/60 transition-colors hover:text-foreground disabled:opacity-30"
				>
					<ChevronLeft class="h-4 w-4" />
				</button>
				<span class="text-xs tabular-nums text-muted-foreground">
					{chatImpersonationSwipeIndex + 1}/{chatImpersonationSwipes.length}
				</span>
				<button
					type="button"
					onclick={() => navImpersonationSwipe(1)}
					disabled={isStreaming || chatImpersonationSwipes.length <= 1}
					class="flex h-7 w-7 items-center justify-center rounded text-foreground/60 transition-colors hover:text-foreground disabled:opacity-30"
				>
					<ChevronRight class="h-4 w-4" />
				</button>
			</div>
			<div class="my-0.5 h-px bg-border"></div>
		{/if}
		<button
			type="button"
			onclick={() => {
				const reasoning = activeImpersonationSwipe?.reasoning ?? impersonateReasoning;
				reasoningModalIsImpersonation = true;
				reasoningModalIsLive = false;
				reasoningModalText = reasoning;
				showReasoningModal = true;
				showImpersonateMenu = false;
			}}
			disabled={!(activeImpersonationSwipe?.reasoning || impersonateReasoning)}
			class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-40 disabled:pointer-events-none"
		>
			<Brain class="h-4 w-4" />View reasoning
		</button>
		<button
			type="button"
			onclick={() => {
				showImpersonateMenu = false;
				// Reuse the active swipe's guidance for the round so the
				// user doesn't have to re-enter it on every regenerate.
				impersonateMessage(activeImpersonationSwipe?.guidance ?? undefined);
			}}
			disabled={isStreaming}
			class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-40 disabled:pointer-events-none"
		>
			<RefreshCw class="h-4 w-4" />Re-impersonate
		</button>
		<button
			type="button"
			onclick={() => {
				showImpersonateMenu = false;
				openGuideModal({ kind: 'impersonate' }, activeImpersonationSwipe?.guidance ?? '');
			}}
			disabled={isStreaming}
			class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-40 disabled:pointer-events-none"
		>
			<Wand2 class="h-4 w-4" />Guide impersonation…
		</button>
	</div>
{/if}

<!-- Send button context menu (long-press / right-click) -->
{#if showSendMenu && sendMenuPosition}
	<div
		data-send-menu
		class="popup-menu fixed z-[60] w-[220px] rounded-xl border border-border bg-popover py-1 shadow-2xl"
		style="--popup-origin: {sendMenuPosition.flipUp ? 'bottom' : 'top'} left; left: {sendMenuPosition.x}px; {sendMenuPosition.flipUp ? 'bottom' : 'top'}: {sendMenuPosition.flipUp ? (sendMenuPosition.viewportH - sendMenuPosition.y) + 'px' : sendMenuPosition.y + 'px'}"
	>
		<button
			type="button"
			onclick={() => { showSendMenu = false; openGuideModal({ kind: 'send' }, ''); }}
			disabled={!input.trim()}
			class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-40 disabled:pointer-events-none"
		>
			<Wand2 class="h-4 w-4" />Guide reply…
		</button>
	</div>
{/if}

<!-- Guide modal (shared by impersonate / send / message-edit flows) -->
{#if showGuideModal}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-enter"
		onclick={() => { showGuideModal = false; guideModalTarget = null; }}
	>
		<div class="modal-enter mx-4 flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-card p-5 shadow-xl" onclick={(e) => e.stopPropagation()}>
			<h3 class="mb-1 text-sm font-semibold text-foreground">
				{guideModalTarget?.kind === 'impersonate'
					? 'Guide impersonation'
					: guideModalTarget?.kind === 'impersonateView'
					? 'Impersonation guidance'
					: guideModalTarget?.kind === 'send'
					? 'Guide reply'
					: guideModalTarget?.kind === 'guideReply'
					? 'Guide reply'
					: 'Edit guidance'}
			</h3>
			<p class="mb-3 text-xs text-muted-foreground">
				{guideModalTarget?.kind === 'impersonate'
					? "Tell the model how to write your next reply. The text won't appear in the message itself."
					: guideModalTarget?.kind === 'impersonateView'
					? 'The guidance used to produce the active impersonation swipe.'
					: guideModalTarget?.kind === 'send'
					? 'Out-of-band guidance the character should follow without quoting.'
					: guideModalTarget?.kind === 'guideReply'
					? 'Out-of-band guidance the character should follow without quoting. Sending will start the reply.'
					: 'Update the guidance and re-run this reply.'}
			</p>
			<LimitedTextarea
				bind:value={guideModalText}
				placeholder={guideModalTarget?.kind === 'impersonateView' ? '(no guidance was set)' : 'e.g. Keep it short and aloof.'}
				readonly={guideModalTarget?.kind === 'impersonateView'}
				limit={FIELD_LIMITS.replyGuidance}
				class="block min-h-[40vh] w-full flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm focus:border-foreground/30 focus:outline-none focus:ring-2 focus:ring-ring {guideModalTarget?.kind === 'impersonateView' ? 'cursor-default opacity-90' : ''}"
			/>
			<div class="mt-4 flex items-center justify-end gap-2">
				<Button type="button" variant="ghost" size="sm" onclick={() => { showGuideModal = false; guideModalTarget = null; }}>
					{guideModalTarget?.kind === 'impersonateView' ? 'Close' : 'Cancel'}
				</Button>
				{#if guideModalTarget?.kind !== 'impersonateView'}
					<Button type="button" variant="primary" size="sm" onclick={submitGuideModal}>Go</Button>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
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

	/* Mobile toolbar slide-in */
	/* Scroll-to-bottom button entrance */
	.scroll-btn-enter {
		animation: scroll-btn-pop 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
	}

	@keyframes scroll-btn-pop {
		from {
			opacity: 0;
			transform: scale(0.5) translateY(10px);
		}
		to {
			opacity: 1;
			transform: scale(1) translateY(0);
		}
	}

	.scroll-btn-attention {
		animation: scroll-btn-pulse 1.2s ease-in-out infinite;
	}

	@keyframes scroll-btn-pulse {
		0% {
			box-shadow: 0 0 0 0 color-mix(in oklch, var(--primary) 45%, transparent);
		}
		70% {
			box-shadow: 0 0 0 12px color-mix(in oklch, var(--primary) 0%, transparent);
		}
		100% {
			box-shadow: 0 0 0 0 color-mix(in oklch, var(--primary) 0%, transparent);
		}
	}
</style>
