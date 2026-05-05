<script lang="ts">
	import { Send, Square, Bot, ChevronLeft, ChevronRight, RefreshCw, Pencil, Trash2, Check, X, CornerRightUp, UserPen, GitBranch, GitBranchPlus, Undo2, ArrowDown, SlidersHorizontal, Brain, Smartphone, BookOpen, Info, Wand2, BookMarked, Search, MoreHorizontal, Copy, Loader2, Archive } from 'lucide-svelte';
	import { tick, untrack } from 'svelte';
	import { marked } from 'marked';
	import DOMPurify from 'isomorphic-dompurify';
	import ImageModal from '$lib/components/ImageModal.svelte';
	import ChatSettings from '$lib/components/ChatSettings.svelte';
	import ReasoningModal from '$lib/components/ReasoningModal.svelte';
	import CharacterInfoModal from '$lib/components/CharacterInfoModal.svelte';
	import CharacterLorebooksModal from '$lib/components/CharacterLorebooksModal.svelte';
	import GreetingReviewModal from '$lib/components/GreetingReviewModal.svelte';
	import { haptic } from '$lib/utils/haptics.js';
	import { renderRoleplay as renderRoleplayUtil } from '$lib/utils/rp-format.js';
	import { toasts } from '$lib/stores/toast.svelte.js';
	import { saveScroll, loadScroll } from '$lib/stores/scrollMemory.js';
	import { generationsStore } from '$lib/stores/generations.svelte.js';
	import { LinkValidator } from '$lib/chat/linkValidation.svelte.js';
	import { TextareaAutosizer } from '$lib/chat/textareaAutosize.svelte.js';
	import { settingsStore } from '$lib/stores/settings.svelte.js';
	import { pickCharacterTheme, characterHasAnyTheme } from '$lib/theme/characterTheme.js';

	let { chat, character, initialMessages, messageSiblingsData, hiddenBranchData, totalMessageCount = 0, providers, personas, allLorebooks = [], onrefresh, streamEvent, ontogglemobile, totalUnread = 0, sendWithEnterDesktop = true, sendWithEnterMobile = true, autoScrollThreshold = 'normal', confirmDeletions = true, messageTimestamps = 'relative', showReasoning = false, chatPageSize = 50, renderMode = 'roleplay', reduceMotion = false, blockExternalContent = false, nestedEmphasisInSpeech = true }: {
		chat: any;
		character: any;
		initialMessages: any[];
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
	} = $props();

	// Resolve the active provider for this chat
	let activeProvider = $derived.by(() => {
		if (chat.overrideProviderId) {
			return providers.find((p: any) => p.id === chat.overrideProviderId) ?? providers.find((p: any) => p.enabled) ?? null;
		}
		return providers.find((p: any) => p.enabled) ?? null;
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
		setTimeout(() => document.addEventListener('click', onDoc), 0);
		document.addEventListener('keydown', onKey);
		return () => {
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
	}

	// Monotonic negative IDs for client-side message placeholders. Real DB IDs are positive,
	// so negatives never collide with persisted messages and decrement guarantees uniqueness
	// even within the same millisecond (replaces unsafe Date.now() / Date.now()+1 pattern).
	let placeholderIdSeq = -Date.now();
	function nextPlaceholderId(): number {
		return --placeholderIdSeq;
	}

	// Pick the right initial textarea value for a chat. Server-persisted
	// impersonation drafts beat the local draft when they're newer than
	// what this device last picked up — that's how the same generated text
	// shows up across devices. We track the last-seen `generatedAt` per
	// chat in localStorage so re-mounts on the same device don't keep
	// clobbering edits the user already made on top of the draft.
	function pickDraftForChat(c: typeof chat): string {
		const local = (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function')
			? localStorage.getItem(`skald-draft-${c.id}`) || ''
			: '';
		const status = (c as any).impersonationStatus as string | null | undefined;
		if (status === 'streaming') {
			// Live tokens will arrive via the generations store and overwrite
			// `input`. Start blank so we don't briefly flash an empty/stale draft.
			return '';
		}
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
		return local;
	}

	interface ImpersonationSwipeEntry {
		draft: string;
		reasoning: string;
		guidance?: string;
		generatedAt: string | null;
	}

	function parseImpersonationSwipes(raw: unknown): ImpersonationSwipeEntry[] {
		if (typeof raw !== 'string' || !raw) return [];
		try {
			const parsed = JSON.parse(raw);
			return Array.isArray(parsed) ? parsed : [];
		} catch { return []; }
	}

	function parseMessage(m: any): Message {
		let swipes: string[] = [];
		try { swipes = JSON.parse(m.swipes || '[]'); } catch { /* */ }
		if (swipes.length === 0) swipes = [m.content];
		let reasoning: string[] = [];
		try { reasoning = JSON.parse(m.reasoning || '[]'); } catch { /* */ }
		return {
			id: m.id,
			role: m.role,
			content: m.content,
			swipes,
			swipeIndex: m.swipeIndex ?? 0,
			reasoning,
			parentId: m.parentId ?? null,
			createdAt: m.createdAt ?? null,
			guidance: m.guidance ?? null
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
				// Preserve scroll position when prepending
				const container = messagesContainer;
				const prevHeight = container?.scrollHeight ?? 0;
				messageList = [...earlier, ...messageList];
				Object.assign(messageSiblings, data.messageSiblings ?? {});
				if (data.totalMessages) totalMsgCount = data.totalMessages;
				await tick();
				if (container) {
					container.scrollTop += container.scrollHeight - prevHeight;
				}
			}
		} finally {
			loadingMore = false;
		}
	}

	let messageList: Message[] = $state(untrack(() => (initialMessages ?? []).map(parseMessage)));
	let messageSiblings: Record<number, { index: number; total: number }> = $state(untrack(() => messageSiblingsData ?? {}));
	let hiddenBranchCount = $derived(hiddenBranchData ?? 0);
	let totalMsgCount = $state(untrack(() => totalMessageCount || (initialMessages ?? []).length));
	let loadingMore = $state(false);
	let hasMore = $derived(messageList.length < totalMsgCount);

	let confirmingDeleteIdx: number | null = $state(null);
	let input = $state(untrack(() => (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function' ? localStorage.getItem(`skald-draft-${chat.id}`) : null) || ''));
	let isStreaming = $state(false);
	let messagesContainer: HTMLDivElement | undefined = $state();
	let bottomSentinel: HTMLDivElement | undefined = $state();
	let enlargedImage: string | null = $state(null);
	let editingId: number | null = $state(null);
	let editContent = $state('');
	let isTexting = $derived(chat.mode === 'texting');
	let keyboardVisible = $state(false);
	let showScrollButton = $state(false);
	let scrollButtonAttention = $state(false);
	let isMobile = $state(false);

	// Derive effective send-with-enter based on device type
	let sendWithEnter = $derived(isMobile ? sendWithEnterMobile : sendWithEnterDesktop);

	// Message context menu (right-click / long-press)
	let msgMenuIdx: number | null = $state(null);
	let msgMenuPosition: { x: number; y: number; flipUp: boolean } | null = $state(null);
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
		const winW = window.innerWidth;
		const winH = window.innerHeight;
		const flipUp = e.clientY + MSG_MENU_H > winH;
		const x = Math.max(8, Math.min(winW - MSG_MENU_W - 8, e.clientX - MSG_MENU_W / 2));
		const rawY = flipUp ? e.clientY - 8 : e.clientY + 8;
		const y = flipUp
			? Math.max(MSG_MENU_H + 8, Math.min(winH - 8, rawY))
			: Math.max(8, Math.min(winH - MSG_MENU_H - 8, rawY));
		msgMenuPosition = { x, y, flipUp };
		msgMenuIdx = idx;
	}
	function openMsgMenuAtPoint(idx: number, clientX: number, clientY: number) {
		const winW = window.innerWidth;
		const winH = window.innerHeight;
		const flipUp = clientY + MSG_MENU_H > winH;
		const x = Math.max(8, Math.min(winW - MSG_MENU_W - 8, clientX - MSG_MENU_W / 2));
		const rawY = flipUp ? clientY - 8 : clientY + 8;
		const y = flipUp
			? Math.max(MSG_MENU_H + 8, Math.min(winH - 8, rawY))
			: Math.max(8, Math.min(winH - MSG_MENU_H - 8, rawY));
		msgMenuPosition = { x, y, flipUp };
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
	function endMsgLongPress() {
		if (msgLongPressTimer) { clearTimeout(msgLongPressTimer); msgLongPressTimer = null; }
		if (msgLongPressFired) {
			msgSuppressNextClick = true;
			setTimeout(() => { msgSuppressNextClick = false; msgLongPressFired = false; }, 500);
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
			parseImpersonationSwipes((chat as any).impersonationSwipes).length - 1,
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
			chatImpersonationSwipeIndex = Math.max(0, Math.min(parsed.length - 1, idx));
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
		| { kind: 'guideReply'; userMessageId: number } // PATCH user msg, then start a NEW reply
		| { kind: 'editAssistantGuidance'; userMessageId: number }; // PATCH parent user msg, then regenerate the assistant
	let showGuideModal = $state(false);
	let guideModalText = $state('');
	let guideModalTarget = $state<GuideTarget | null>(null);

	// Long-press / right-click menus for the impersonate + send buttons.
	let showImpersonateMenu = $state(false);
	let impersonateMenuPosition = $state<{ x: number; y: number; flipUp: boolean } | null>(null);
	let showSendMenu = $state(false);
	let sendMenuPosition = $state<{ x: number; y: number; flipUp: boolean } | null>(null);

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
			if (!isNearBottom()) {
				scrollButtonAttention = true;
				showScrollButton = true;
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
						// Cross-device: another device produced an assistant
						// message; we have no in-flight stream of our own.
						messageList = [...messageList, msg];
						knownMessageIds.add(msg.id);
					}
					// Else: assistant placeholder is owned by our local
					// stream and will get its real id at finishStreaming.
				}
			}
			if (streamingAssistantIdx < 0 && !isStreaming) {
				onrefresh?.();
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
			// can't be deleted.
			if (wasAbortedManually && !streamAccumulated) {
				const idx = streamingAssistantIdx;
				const removed = messageList[idx];
				messageList = messageList.slice(0, idx).concat(messageList.slice(idx + 1));
				if (removed) totalMsgCount = Math.max(0, totalMsgCount - 1);
				streamingAssistantIdx = -1;
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
				await updateMessagePreservingScroll(() => {
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
				});
			}

			// In reduce-motion mode (non-texting), reveal content all at once
			if (reduceMotion && !isTexting && (streamAccumulated || streamAccumulatedReasoning)) {
				updateMessagePreservingScroll(() => {
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
				});
			}

			// Normal streaming mode: token handler updates live, but if no tokens arrived
			// (e.g. reasoning-only), write the final state
			if (!isTexting && !reduceMotion && streamAccumulated) {
				updateMessagePreservingScroll(() => {
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
				});
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
		streamingAssistantIdx = -1;
		streamAccumulated = '';
		streamAccumulatedReasoning = '';
		streamIsRegenerate = false;
		streamOriginalMessage = null;
		generationsStore.clear(chat.id);
		wasAbortedManually = false;
		userScrolledAway = false;
		await scrollToBottom();
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

	// Track scroll position for button visibility and user-scrolled-away detection
	$effect(() => {
		const el = messagesContainer;
		if (!el) return;
		const onScroll = () => {
			const nearBottom = isNearBottom();
			showScrollButton = !nearBottom;
			if (nearBottom) {
				scrollButtonAttention = false;
			}
			if (isStreaming && !nearBottom) {
				userScrolledAway = true;
			}
		};
		el.addEventListener('scroll', onScroll, { passive: true });
		return () => el.removeEventListener('scroll', onScroll);
	});

	// Dismiss keyboard on scroll (mobile only)
	$effect(() => {
		if (!isMobile) return;
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
			if (msgSuppressNextClick) { msgSuppressNextClick = false; return; }
			if (!(e.target as HTMLElement).closest('[data-msg-menu]')) closeMsgMenu();
		};
		const onScroll = () => { if (!msgMenuScrollSuppressed) closeMsgMenu(); };
		const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeMsgMenu(); };
		const el = messagesContainer;
		setTimeout(() => document.addEventListener('click', onClick), 0);
		el?.addEventListener('scroll', onScroll, { passive: true });
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('click', onClick);
			el?.removeEventListener('scroll', onScroll);
			document.removeEventListener('keydown', onKey);
		};
	});

	// Close impersonate/send menus on click-outside or Escape
	$effect(() => {
		if (!showImpersonateMenu && !showSendMenu) return;
		const onClick = (e: Event) => {
			const t = e.target as HTMLElement;
			if (showImpersonateMenu && !t.closest('[data-impersonate-menu]')) showImpersonateMenu = false;
			if (showSendMenu && !t.closest('[data-send-menu]')) showSendMenu = false;
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') { showImpersonateMenu = false; showSendMenu = false; }
		};
		setTimeout(() => document.addEventListener('click', onClick), 0);
		document.addEventListener('keydown', onKey);
		return () => {
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
			messageSiblings = newSiblings;
			totalMsgCount = newTotal || incoming.length;
			input = pickDraftForChat(chat);
			isStreaming = false;
			isReasoning = false;
			streamingReasoning = '';
			streamingAssistantIdx = -1;
			streamAccumulated = '';
			streamAccumulatedReasoning = '';
			streamIsRegenerate = false;
			streamOriginalMessage = null;
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
			const savedScroll = loadScroll(chatId);
			if (savedScroll != null && savedScroll > 0) {
				tick().then(() => {
					if (messagesContainer) messagesContainer.scrollTop = savedScroll;
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
			const needsUpdate = incoming.length !== currentList.length ||
				incoming.some((m, idx) => {
					const old = currentList[idx];
					return !old || old.id !== m.id || old.content !== m.content || old.swipeIndex !== m.swipeIndex;
				});
			if (needsUpdate) {
				messageList = incoming.map(m => {
					const old = oldById.get(m.id);
					if (old && old.content === m.content && old.swipeIndex === m.swipeIndex &&
						old.swipes.length === m.swipes.length && old.reasoning.length === m.reasoning.length) {
						return old;
					}
					return m;
				});
				totalMsgCount = nextTotal;
				for (const m of incoming) knownMessageIds.add(m.id);
			}
			messageSiblings = newSiblings;
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
						streamingAssistantIdx = -1;
						streamIsRegenerate = false;
						streamOriginalMessage = null;
						isImpersonating = true;
						input = gen.accumulated;
						impersonateReasoning = gen.accumulatedReasoning;
						streamingReasoning = gen.accumulatedReasoning;
					} else if (gen.isRegenerate && gen.originalMessageId != null) {
						// Regenerate: keep the original content visible (it gets
						// blurred under the spinner overlay, like reformat). The
						// real content (or the new swipe) lands on finishStreaming.
						const idx = messageList.findIndex(m => m.id === gen.originalMessageId);
						if (idx >= 0) {
							streamOriginalMessage = { ...messageList[idx] };
							streamingAssistantIdx = idx;
							streamIsRegenerate = true;
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
				// For NEW sends, mirror tokens onto the placeholder so the
				// user sees text appear as it streams. For REGEN, keep the
				// bubble blank (typing dots only) until finishStreaming
				// performs the swap — per the chosen UX.
				const idx = untrack(() => streamingAssistantIdx);
				if (!untrack(() => streamIsRegenerate) && !isTexting && !reduceMotion && idx >= 0) {
					untrack(() => {
						updateMessagePreservingScroll(() => {
							messageList[idx] = {
								...messageList[idx],
								content: streamAccumulated,
								reasoning: [streamAccumulatedReasoning]
							};
						});
					});
				}
				resetStreamTimeout();
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
			guidance: null
		};
		messageList = [...messageList, placeholder];
		streamingAssistantIdx = messageList.length - 1;
	}

	// Persist input draft per conversation
	$effect(() => {
		const draft = input;
		const chatId = chat.id;
		if (draft) {
			localStorage.setItem(`skald-draft-${chatId}`, draft);
		} else {
			localStorage.removeItem(`skald-draft-${chatId}`);
		}
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
		messageList = [{ id: nextPlaceholderId(), role: 'assistant', content: '', swipes: [''], swipeIndex: 0, reasoning: [''], parentId: null, createdAt: new Date().toISOString().replace('Z', ''), guidance: null }];
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

	/** Replace external <img> srcs with a placeholder when external content is blocked. */
	function stripExternalImages(html: string): string {
		if (!blockExternalContent) return html;
		return html.replace(/<img\s([^>]*?)src="(https?:\/\/[^"]*)"([^>]*)>/gi, (match, before, src, after) => {
			return `<img ${before}src="" data-blocked-src="${src.replace(/"/g, '&quot;')}" title="External image blocked"${after} style="display:none">`;
		});
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

	// Track whether user has manually scrolled away during streaming
	let userScrolledAway = $state(false);

	function isNearBottom(): boolean {
		if (!messagesContainer) return true;
		const thresholdMap: Record<string, number> = { tight: 20, normal: 50, relaxed: 150 };
		const px = thresholdMap[autoScrollThreshold] ?? 50;
		// column-reverse: scrollTop = 0 at bottom, negative when scrolled up
		return Math.abs(messagesContainer.scrollTop) < px;
	}

	// Preserve scroll position when content changes and user is scrolled away.
	// In column-reverse, content growth pushes everything above the growth point upward.
	// We compensate by adjusting scrollTop by the height delta.
	async function updateMessagePreservingScroll(updateFn: () => void) {
		const el = messagesContainer;
		if (!el || !userScrolledAway) {
			updateFn();
			return;
		}
		const prevHeight = el.scrollHeight;
		const prevScroll = el.scrollTop;
		updateFn();
		await tick();
		const delta = el.scrollHeight - prevHeight;
		if (delta !== 0) {
			el.scrollTop = prevScroll - delta;
		}
	}

	async function scrollToBottom(force = false) {
		if (force) userScrolledAway = false;
		const shouldScroll = force || (!userScrolledAway && isNearBottom());
		await tick();
		if (messagesContainer && shouldScroll) {
			// column-reverse: scrollTop = 0 is the bottom
			messagesContainer.scrollTop = 0;

			// Also scroll after images load (they change layout)
			if (force) {
				const images = messagesContainer.querySelectorAll('img');
				for (const img of images) {
					if (!img.complete) {
						img.addEventListener('load', () => {
							if (messagesContainer && isNearBottom()) {
								messagesContainer.scrollTop = 0;
							}
						}, { once: true });
					}
				}
			}
		}
	}

	async function sendMessage(guidance?: string) {
		const content = input.trim();
		if (!content || isStreaming) return;

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
		messageList = [...messageList, { id: nextPlaceholderId(), role: 'user', content, swipes: optimisticSwipes, swipeIndex: optimisticIdx, reasoning: optimisticReasoning, parentId: null, createdAt: new Date().toISOString().replace('Z', ''), guidance: optimisticGuidance }];
		totalMsgCount++;
		await scrollToBottom(true);

		// Wait before showing typing indicator
		if (isTexting) await initialTypingDelay();

		// Add placeholder for assistant
		messageList = [...messageList, { id: nextPlaceholderId(), role: 'assistant', content: '', swipes: [''], swipeIndex: 0, reasoning: [''], parentId: null, createdAt: new Date().toISOString().replace('Z', ''), guidance: null }];
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
		streamingAssistantIdx = -1;
		streamIsRegenerate = false;
		streamOriginalMessage = null;
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
		const newIdx = chatImpersonationSwipeIndex + direction;
		if (newIdx < 0 || newIdx >= chatImpersonationSwipes.length) return;
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
	function buttonContextHandlers(open: (x: number, y: number) => void) {
		let timer: ReturnType<typeof setTimeout> | null = null;
		let start = { x: 0, y: 0 };
		let fired = false;
		return {
			onpointerdown(e: PointerEvent) {
				if (e.button !== 0) return;
				start = { x: e.clientX, y: e.clientY };
				fired = false;
				if (timer) clearTimeout(timer);
				timer = setTimeout(() => {
					timer = null;
					fired = true;
					haptic('medium');
					open(start.x, start.y);
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
			},
			oncontextmenu(e: MouseEvent) {
				e.preventDefault();
				e.stopPropagation();
				if (timer) { clearTimeout(timer); timer = null; }
				open(e.clientX, e.clientY);
			},
			suppressClick() {
				return fired;
			},
			reset() {
				fired = false;
			}
		};
	}

	function positionForMenu(clientX: number, clientY: number, menuW: number, menuH: number) {
		const winW = window.innerWidth;
		const winH = window.innerHeight;
		const flipUp = clientY + menuH > winH;
		const x = Math.max(8, Math.min(winW - menuW - 8, clientX - menuW / 2));
		const rawY = flipUp ? clientY - 8 : clientY + 8;
		const y = flipUp
			? Math.max(menuH + 8, Math.min(winH - 8, rawY))
			: Math.max(8, Math.min(winH - menuH - 8, rawY));
		return { x, y, flipUp };
	}

	const IMPERSONATE_MENU_W = 220;
	const IMPERSONATE_MENU_H = 220;
	const SEND_MENU_W = 220;
	const SEND_MENU_H = 80;

	const impersonateBtnHandlers = buttonContextHandlers((x, y) => {
		impersonateMenuPosition = positionForMenu(x, y, IMPERSONATE_MENU_W, IMPERSONATE_MENU_H);
		showImpersonateMenu = true;
	});
	const sendBtnHandlers = buttonContextHandlers((x, y) => {
		sendMenuPosition = positionForMenu(x, y, SEND_MENU_W, SEND_MENU_H);
		showSendMenu = true;
	});

	function openGuideModal(target: GuideTarget, prefill = '') {
		guideModalTarget = target;
		guideModalText = prefill;
		showGuideModal = true;
	}

	async function submitGuideModal() {
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
			// Update the parent user message's guidance and regenerate the
			// existing assistant reply against the new guidance.
			try {
				await fetch(`/api/messages/${target.userMessageId}`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ guidance: text || null })
				});
				// Mirror locally so reopening the modal shows the *current*
				// guidance, not the value from when the message was sent.
				const idx = messageList.findIndex(m => m.id === target.userMessageId);
				if (idx >= 0) {
					messageList[idx] = { ...messageList[idx], guidance: text || null };
				}
			} catch { /* best effort */ }
			regenerateMessage();
		} else if (target.kind === 'guideReply') {
			// User message is the latest — there's no assistant reply yet.
			// Persist the guidance on the user message, then kick off a new
			// generation. We seed local streaming UI the same way sendMessage
			// does so the user sees the typing bubble immediately.
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

		// Delete the user message from DB (cascades to children)
		await fetch(`/api/messages/${msg.id}`, { method: 'DELETE' });
		// Remove this message and everything after it from local list
		messageList = messageList.slice(0, msgIdx);

		// Re-send via the normal flow
		input = content;
		await tick();
		sendMessage();
	}

	async function reImpersonateMessage(msgIdx: number) {
		if (isStreaming) return;
		const msg = messageList[msgIdx];

		// Delete the user message (cascades to children) and trim the local
		// view, then kick off a fresh impersonation. Mirrors `resendMessage`.
		await fetch(`/api/messages/${msg.id}`, { method: 'DELETE' });
		messageList = messageList.slice(0, msgIdx);
		input = '';
		await tick();
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
				const data = await res.json();
				alert(data.error || 'Failed to reformat message');
				return;
			}
			const data = await res.json();
			reformatReviewResults = [{ index: msgIdx, original: data.original, reformatted: data.reformatted }];
			showReformatReview = true;
		} catch {
			alert('Failed to reformat message');
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
			}
		} catch {
			messageList = savedList;
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
			body: JSON.stringify({ direction: 0 })
		});

		if (res.ok) {
			await onrefresh();
		}
	}

	async function switchBranch(messageId: number, direction: -1 | 1) {
		const siblings = messageSiblings[messageId];
		if (!siblings || siblings.total <= 1) return;

		// Find sibling IDs by looking at all messages that share this parent
		const msg = messageList.find(m => m.id === messageId);
		if (!msg) return;

		const newIndex = siblings.index + direction;
		if (newIndex < 0 || newIndex >= siblings.total) return;
		haptic('selection');

		// We need to call the server to find the actual sibling and switch
		// The server will resolve sibling by parent + index, then walk to deepest leaf
		const res = await fetch(`/api/messages/${messageId}/switch-branch`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ direction })
		});

		if (res.ok) {
			await onrefresh();
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
			body: JSON.stringify({ activeLeafId: branchPointId })
		});

		if (res.ok) {
			await onrefresh();
		}
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
		const newIndex = msg.swipeIndex + direction;
		if (newIndex < 0 || newIndex >= msg.swipes.length) return;
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

		// Keep the existing content visible — the bubble overlay (blur +
		// spinner) will indicate that a new response is being generated.
		streamingAssistantIdx = lastAssistantIdx;
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
				streamingAssistantIdx = -1;
				streamIsRegenerate = false;
				streamOriginalMessage = null;
			}
			// SSE events will drive the rest
		} catch (err) {
			messageList[lastAssistantIdx] = { ...streamOriginalMessage!, content: `Error: ${err instanceof Error ? err.message : 'Network error'}` };
		 isStreaming = false;
			streamingAssistantIdx = -1;
			streamIsRegenerate = false;
			streamOriginalMessage = null;
		}
	}
</script>

<div class="relative flex min-h-0 flex-1 flex-col md:gap-2 {characterThemeStyle ? 'bg-background text-foreground md:bg-transparent' : ''}" style={characterThemeStyle}>
	{#if chat.useCharacterTheme && character.backgroundPath}
		<div
			class="pointer-events-none absolute inset-0 z-0 bg-cover bg-center bg-no-repeat opacity-[0.06] md:hidden"
			style="background-image: url({character.backgroundPath})"
		></div>
	{/if}
	<!-- Messages card (desktop: rounded card) -->
	<div class="relative flex min-h-0 flex-1 flex-col overflow-hidden md:rounded-2xl md:bg-background">
	{#if chat.useCharacterTheme && character.backgroundPath}
		<div
			class="pointer-events-none absolute inset-0 z-0 hidden bg-cover bg-center bg-no-repeat opacity-[0.06] md:block"
			style="background-image: url({character.backgroundPath})"
		></div>
	{/if}
	<!-- Chat header (Messenger desktop / iMessage mobile) -->
	<header class="relative z-[2] flex h-14 shrink-0 items-center gap-2 border-b border-border/50 bg-background px-2 md:border-b-0 md:px-5">
		<!-- Mobile back/menu button -->
		{#if ontogglemobile}
			<button
				onclick={ontogglemobile}
				class="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-primary transition-colors hover:bg-secondary md:hidden"
				aria-label="Back to chats"
			>
				<ChevronLeft class="h-6 w-6" />
				{#if totalUnread && totalUnread > 0}
					<span class="absolute right-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">{totalUnread}</span>
				{/if}
			</button>
		{/if}

		<!-- iMessage mobile: centered avatar + name. Desktop: avatar+name on left -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="flex flex-1 cursor-pointer items-center gap-3 md:cursor-default"
			onclick={() => { if (isMobile) showCharacterInfo = true; }}
		>
			<!-- Mobile: stacked avatar+name centered. Desktop: side-by-side -->
			<div class="flex w-full items-center justify-center gap-2 md:w-auto md:justify-start md:gap-3">
				<div class="group relative md:order-first">
					{#if lastTokenStats}
						{@const ringPct = Math.min(Math.round((lastTokenStats.promptTokens / lastTokenStats.availableForPrompt) * 100), 100)}
						{@const ringCircumference = 2 * Math.PI * 20}
						{@const ringOffset = ringCircumference - (ringPct / 100) * ringCircumference}
						<svg class="absolute -inset-[3px] h-[42px] w-[42px] md:h-[46px] md:w-[46px]" viewBox="0 0 42 42"
							role="img" aria-label="Context: {lastTokenStats.promptTokens.toLocaleString()} / {lastTokenStats.availableForPrompt.toLocaleString()} tokens ({ringPct}%)"
						>
							<title>Context: {lastTokenStats.promptTokens.toLocaleString()} / {lastTokenStats.availableForPrompt.toLocaleString()} tokens ({ringPct}%)</title>
							<circle cx="21" cy="21" r="20" fill="none" stroke="currentColor" stroke-width="2" class="text-muted/40" />
							<circle cx="21" cy="21" r="20" fill="none" stroke-width="2"
								class="{ringPct > 90 ? 'text-red-500' : ringPct > 70 ? 'text-yellow-500' : 'text-primary/70'} transition-all duration-500"
								stroke="currentColor"
								stroke-dasharray={ringCircumference}
								stroke-dashoffset={ringOffset}
								stroke-linecap="round"
								transform="rotate(-90 21 21)"
							/>
						</svg>
					{/if}
					{#if character.avatarPath}
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
						<img
							src={character.avatarPath}
							alt={character.name}
							class="h-9 w-9 cursor-pointer rounded-full object-cover transition-opacity hover:opacity-80 md:h-10 md:w-10"
							onclick={(e) => { e.stopPropagation(); enlargedImage = character.avatarPath?.replace('/avatars/', '/avatars/original/') ?? null; }}
						/>
					{:else}
						<div
							class="flex h-9 w-9 items-center justify-center rounded-full bg-primary/20 text-sm font-medium text-primary md:h-10 md:w-10"
						>
							{character.name[0]}
						</div>
					{/if}
				</div>
				<div class="flex min-w-0 flex-col items-center md:items-start">
					<div class="flex items-center gap-1.5">
						{#if isTexting}
							<Smartphone class="h-3.5 w-3.5 text-muted-foreground" />
						{:else}
							<BookOpen class="h-3.5 w-3.5 text-muted-foreground" />
						{/if}
						<h2 class="truncate text-[15px] font-semibold leading-tight md:text-base">{character.name}</h2>
					</div>
				</div>
			</div>
		</div>

		<!-- Right side: overflow menu -->
		<div class="flex shrink-0 items-center">
			<div class="relative" data-header-menu>
				<button
					onclick={(e) => { e.stopPropagation(); showHeaderMenu = !showHeaderMenu; }}
					class="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground {hasOverrides ? 'text-primary' : ''}"
					title="More"
					aria-label="More actions"
				>
					<MoreHorizontal class="h-5 w-5" />
				</button>
				{#if showHeaderMenu}
					<div class="popup-menu absolute right-0 top-full z-50 mt-1 w-52 rounded-xl border border-border bg-popover py-1 shadow-2xl" style="--popup-origin: top right; max-height: calc(100dvh - 80px); overflow-y: auto;">
						<button onclick={() => { closeHeaderMenu(); showCharacterInfo = true; }} class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-accent">
							<Info class="h-4 w-4" /> Character info
						</button>
						<button onclick={() => { closeHeaderMenu(); toggleMessageSearch(); }} class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-accent">
							<Search class="h-4 w-4" /> Search messages
						</button>
						<button onclick={() => { closeHeaderMenu(); showCharacterLorebooks = true; }} class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-accent">
							<BookMarked class="h-4 w-4" /> Lorebooks
						</button>
						<button onclick={() => { closeHeaderMenu(); runManualCompaction(); }} disabled={compactingNow} class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-accent disabled:opacity-50 disabled:pointer-events-none">
							{#if compactingNow}
								<Loader2 class="h-4 w-4 animate-spin" /> Compacting…
							{:else}
								<Archive class="h-4 w-4 {chat.compactionSummary ? 'text-primary' : ''}" /> Compact now
							{/if}
						</button>
						<button onclick={() => { closeHeaderMenu(); showChatSettings = true; }} class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-accent">
							<SlidersHorizontal class="h-4 w-4 {hasOverrides ? 'text-primary' : ''}" /> Chat settings
							{#if hasOverrides}<span class="ml-auto h-1.5 w-1.5 rounded-full bg-primary"></span>{/if}
						</button>
					</div>
				{/if}
			</div>
		</div>
	</header>

	{#if messageSearchOpen}
		<div class="z-[2] flex items-center gap-2 border-b border-border/50 bg-background/95 px-3 py-2 backdrop-blur-sm md:px-6">
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
	<div bind:this={messagesContainer} class="relative z-[1] flex flex-1 flex-col-reverse overflow-y-auto overscroll-contain px-2 py-3 md:p-6">
		<div class="mx-auto w-full max-w-5xl space-y-4">
			{#if hasMore}
				<div class="flex justify-center py-2">
					<button
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
				</div>
			{/if}
			{#each messageList as message, i (message.id)}
				{#if message.role !== 'system'}
					<!-- Compaction indicator: shown right BEFORE the first uncompacted visible message -->
					{#if chat.compactionSummary && (chat.compactedUpToMessageId ?? 0) > 0 && !isMessageCompacted(message.id) && (i === 0 || isMessageCompacted(messageList[i - 1]?.id))}
						<div class="flex items-center gap-3 py-2">
							<div class="h-px flex-1 bg-primary/30"></div>
							<button
								type="button"
								onclick={openCompactionEditor}
								class="flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/20"
								title="View or edit the compaction summary"
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
					<div
						class="{msgEnterClass(message.id, message.role)} {(deletingFromIdx !== null && i >= deletingFromIdx) || (deletingSingleIdx !== null && i === deletingSingleIdx) ? 'msg-exit' : ''} {abortAnimating && isStreaming && i === messageList.length - 1 && message.role === 'assistant' ? 'msg-abort' : ''} group relative flex transition-opacity duration-200 {consecutive ? 'mt-0.5 gap-2 md:gap-3' : 'gap-2 md:gap-3'} {isCompacted ? 'opacity-60' : ''}"
						class:flex-row-reverse={message.role === 'user'}
						class:opacity-20={messageSearchQuery.trim() && !messageSearchMatches.has(message.id)}
					>
						<!-- Avatar (only at the end of a same-sender group; user messages don't show avatar — iMessage style. Hidden entirely on mobile to maximize bubble width) -->
						<div class="hidden shrink-0 self-end md:block {message.role === 'user' ? 'md:hidden' : ''} {!groupEnd ? 'md:invisible' : ''}" title="Message #{msgNumber}">
							{#if message.role === 'assistant'}
								{#if character.avatarPath}
									<!-- svelte-ignore a11y_click_events_have_key_events -->
									<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
									<img
										src={character.avatarPath}
										alt={character.name}
										class="h-7 w-7 cursor-pointer rounded-full object-cover transition-opacity hover:opacity-80 md:h-9 md:w-9"
										onclick={() => (enlargedImage = character.avatarPath?.replace('/avatars/', '/avatars/original/') ?? null)}
									/>
								{:else}
									<div
										class="flex h-7 w-7 items-center justify-center rounded-full bg-primary/20 md:h-9 md:w-9"
									>
										<Bot class="h-3.5 w-3.5 text-primary" />
									</div>
								{/if}
							{/if}
						</div>

						<!-- Message bubble (iMessage style: blue user / gray assistant) -->
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class="chat-bubble relative select-none px-3.5 py-2 shadow-sm shadow-black/5 {editingId === message.id ? 'w-full rounded-2xl' : 'max-w-[88%] md:max-w-[70%]'} {message.role === 'user' ? 'bg-primary text-bubble-user-fg' : 'bg-muted text-bubble-assistant-fg'} {message.role === 'user'
								? (consecutive && !groupEnd ? 'rounded-2xl rounded-br-md' : consecutive && groupEnd ? 'rounded-2xl rounded-tr-md' : groupEnd ? 'rounded-2xl' : 'rounded-2xl rounded-br-md')
								: (consecutive && !groupEnd ? 'rounded-2xl rounded-bl-md' : consecutive && groupEnd ? 'rounded-2xl rounded-tl-md' : groupEnd ? 'rounded-2xl' : 'rounded-2xl rounded-bl-md')}"
							oncontextmenu={(e) => { if (editingId !== message.id) openMsgMenu(i, e); }}
							ontouchstart={(e) => { if (editingId !== message.id) startMsgLongPress(i, e); }}
							ontouchmove={(e) => moveMsgLongPress(e)}
							ontouchend={() => endMsgLongPress()}
							ontouchcancel={() => endMsgLongPress()}
							title={messageTimestamps !== 'off' && message.createdAt ? getMessageTime(message.createdAt) : undefined}
							data-reformatting={reformattingMessageId === message.id || (streamIsRegenerate && streamingAssistantIdx === i) ? '' : undefined}
						>
							{#if editingId === message.id}
								<textarea
									bind:value={editContent}
									onkeydown={(e) => handleEditKeydown(e, i)}
									class="w-full resize-none rounded-lg border border-input bg-background p-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
									rows={Math.min(12, Math.max(3, editContent.split('\n').length + 1))}
								></textarea>
								<div class="mt-1.5 flex items-center justify-end gap-1.5">
									<button
										onclick={() => saveEdit(i)}
										class="flex h-9 w-9 md:h-6 md:w-6 items-center justify-center rounded border transition-all {message.role === 'user' ? 'border-white/15 bg-white/10 text-bubble-user-fg/80 hover:bg-white/20 hover:text-bubble-user-fg' : 'border-border bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'} active:scale-90"
										title="Save"
										aria-label="Save edit"
									>
										<Check class="h-3.5 w-3.5" />
									</button>
									<button
										onclick={cancelEdit}
										class="flex h-9 w-9 md:h-6 md:w-6 items-center justify-center rounded border transition-all {message.role === 'user' ? 'border-white/15 bg-white/10 text-bubble-user-fg/80 hover:bg-white/20 hover:text-bubble-user-fg' : 'border-border bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'} active:scale-90"
										title="Cancel"
										aria-label="Cancel edit"
									>
										<X class="h-3.5 w-3.5" />
									</button>
								</div>
							{:else if isStreaming && !isImpersonating && i === messageList.length - 1 && message.role === 'assistant' && !streamIsRegenerate && (!message.content || isReasoning)}
								{#if !message.content}
									<div class="flex items-center justify-center gap-1.5 py-1 px-1 min-h-[28px]">
										<span class="typing-dot h-2 w-2 rounded-full bg-muted-foreground/60" style="animation-delay: 0ms"></span>
										<span class="typing-dot h-2 w-2 rounded-full bg-muted-foreground/60" style="animation-delay: 160ms"></span>
										<span class="typing-dot h-2 w-2 rounded-full bg-muted-foreground/60" style="animation-delay: 320ms"></span>
										{#if isReasoning}
											<button
												onclick={() => { reasoningModalIsImpersonation = false; reasoningModalIsLive = true; showReasoningModal = true; }}
												class="ml-1 flex items-center justify-center rounded-md p-0.5 text-muted-foreground/50 hover:text-primary hover:bg-accent transition-colors"
											>
												<Brain class="h-4 w-4" />
											</button>
										{/if}
									</div>
								{:else}
									<!-- Content is streaming alongside reasoning — show content with indicator -->
									<!-- svelte-ignore a11y_click_events_have_key_events -->
									<!-- svelte-ignore a11y_no_static_element_interactions -->
									<div
										class="message-content text-sm leading-relaxed {effectiveRenderMode !== 'markdown' ? 'whitespace-pre-wrap' : ''}"
										onclick={(e) => {
											if (e.target instanceof HTMLImageElement) {
												enlargedImage = e.target.src;
											}
										}}
									>
										{@html renderContent(message.content, true)}
									</div>
									<div class="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground/60">
										<span class="typing-dot h-1.5 w-1.5 rounded-full bg-muted-foreground/50" style="animation-delay: 0ms"></span>
										<span class="typing-dot h-1.5 w-1.5 rounded-full bg-muted-foreground/50" style="animation-delay: 160ms"></span>
										<span class="typing-dot h-1.5 w-1.5 rounded-full bg-muted-foreground/50" style="animation-delay: 320ms"></span>
										<button
										onclick={() => { reasoningModalIsLive = true; showReasoningModal = true; }}
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
											if (e.target instanceof HTMLImageElement) {
												enlargedImage = e.target.src;
											}
										}}
									>
										{@html renderContent(message.content)}
									</div>
									{#if message.content.startsWith('Error:') && i === messageList.length - 1 && !isStreaming}
										<button
											onclick={() => regenerateMessage()}
											class="mt-2 flex items-center gap-1.5 rounded-lg bg-destructive/15 px-3 py-1.5 text-xs font-medium text-destructive transition-all hover:bg-destructive/25 active:scale-95"
											aria-label="Retry message generation"
										>
											<RefreshCw class="h-3.5 w-3.5" />
											Retry
										</button>
									{/if}
							{/if}
							{#if reformattingMessageId === message.id || (streamIsRegenerate && streamingAssistantIdx === i)}
								<div class="reformatting-overlay pointer-events-none absolute inset-0 flex items-center justify-center gap-2 rounded-[inherit] bg-black/10 backdrop-blur-[1px]">
									<div class="flex items-center justify-center gap-1.5 drop-shadow">
										<span class="typing-dot h-2.5 w-2.5 rounded-full bg-foreground" style="animation-delay: 0ms"></span>
										<span class="typing-dot h-2.5 w-2.5 rounded-full bg-foreground" style="animation-delay: 160ms"></span>
										<span class="typing-dot h-2.5 w-2.5 rounded-full bg-foreground" style="animation-delay: 320ms"></span>
									</div>
									{#if streamIsRegenerate && streamingAssistantIdx === i && (isReasoning || streamAccumulatedReasoning)}
										<button
											onclick={() => { reasoningModalIsImpersonation = false; reasoningModalIsLive = true; showReasoningModal = true; }}
											class="pointer-events-auto flex items-center justify-center rounded-md p-1 text-foreground hover:text-primary hover:bg-accent transition-colors drop-shadow"
											aria-label="View reasoning"
										>
											<Brain class="h-5 w-5" />
										</button>
									{/if}
								</div>
							{/if}
						</div>
					</div>
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

	<!-- Scroll to bottom button -->
	{#if showScrollButton}
		<div class="relative">
			<button
				onclick={() => { scrollButtonAttention = false; scrollToBottom(true); }}
				class="scroll-btn-enter absolute -top-14 right-4 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card shadow-lg transition-all hover:bg-accent hover:shadow-xl hover:scale-110 active:scale-95 md:left-1/2 md:right-auto md:-translate-x-1/2 {scrollButtonAttention ? 'scroll-btn-attention' : ''}"
			>
				<ArrowDown class="h-4 w-4 text-foreground" />
				{#if scrollButtonAttention}
					<span class="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-primary ring-2 ring-background"></span>
				{/if}
			</button>
		</div>
	{/if}
	</div>

	<!-- Input -->
	<div
		class="relative z-[1] shrink-0 border-t border-border/50 bg-background px-3 md:rounded-2xl md:border-t-0 md:px-4 {keyboardVisible ? 'pt-1.5 pb-1 md:pt-3 md:pb-3' : 'pt-2 pb-5 md:pt-3 md:pb-4'}"
	>

		<div class="mx-auto flex max-w-5xl items-stretch gap-2">
			<div class="relative flex-1">
				<textarea
					bind:this={textareaEl}
					bind:value={input}
					oninput={() => textareaSizer.measure()}
					onkeydown={handleKeydown}
					readonly={isImpersonating && isReasoning}
					placeholder={isImpersonating ? '' : 'Reply'}
					rows="1"
					class="block w-full resize-none rounded-3xl border border-input bg-card px-4 py-2.5 text-sm leading-normal placeholder:text-muted-foreground focus:border-foreground/30 focus:outline-none focus:ring-2 focus:ring-foreground/20"
				></textarea>
				{#if isImpersonating && isReasoning}
					<button
						onclick={() => { reasoningModalIsImpersonation = true; reasoningModalIsLive = true; showReasoningModal = true; }}
						class="absolute inset-0 flex items-center justify-center gap-1.5 rounded-3xl text-xs text-muted-foreground/60 hover:text-primary hover:bg-accent/80 transition-colors"
					>
						<span class="typing-dot h-1.5 w-1.5 rounded-full bg-muted-foreground/50" style="animation-delay: 0ms"></span>
						<span class="typing-dot h-1.5 w-1.5 rounded-full bg-muted-foreground/50" style="animation-delay: 160ms"></span>
						<span class="typing-dot h-1.5 w-1.5 rounded-full bg-muted-foreground/50" style="animation-delay: 320ms"></span>
						<Brain class="h-3.5 w-3.5" />
					</button>
				{/if}
			</div>
			<button
				onclick={(e) => {
					if (impersonateBtnHandlers.suppressClick()) { impersonateBtnHandlers.reset(); e.preventDefault(); return; }
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
				title="Impersonate (long-press for options)"
				aria-label="Impersonate"
			>
				<UserPen class="h-4 w-4" />
			</button>
			{#if isStreaming}
				<button
					onclick={abortGeneration}
					class="flex w-11 shrink-0 items-center justify-center rounded-full bg-destructive text-destructive-foreground transition-all hover:bg-destructive/80 hover:scale-105 active:scale-90"
					title={isImpersonating ? 'Stop impersonation' : 'Stop generation'}
					aria-label={isImpersonating ? 'Stop impersonation' : 'Stop generation'}
				>
					<Square class="h-4 w-4 fill-current" />
				</button>
			{:else if !(isMobile && sendWithEnterMobile)}
				<!-- On mobile with "Send with Enter" enabled, hide the send button to
				     give the textarea more room — Enter handles the send. -->
				<button
					onclick={(e) => {
						if (sendBtnHandlers.suppressClick()) { sendBtnHandlers.reset(); e.preventDefault(); return; }
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
</div>

<ImageModal src={enlargedImage} onclose={() => (enlargedImage = null)} />

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
				<textarea
					bind:value={compactionEditorDraft}
					rows={14}
					class="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm leading-relaxed placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-ring"
					placeholder="Summary of the story so far..."
				></textarea>
				<p class="mt-2 text-xs text-muted-foreground">Editing here updates what the AI sees in place of the {(chat.compactedUpToMessageId ?? 0) > 0 ? 'compacted' : 'earlier'} messages. Clearing the text resets the high-water mark so the next compaction starts from the very first message.</p>
			</div>
			<div class="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
				<button
					type="button"
					onclick={() => { showCompactionEditor = false; }}
					class="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
				>
					Cancel
				</button>
				<button
					type="button"
					onclick={saveCompactionSummary}
					disabled={savingCompactionSummary}
					class="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
				>
					{savingCompactionSummary ? 'Saving…' : 'Save summary'}
				</button>
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
					<p class="mt-2 text-sm font-medium text-amber-400">
						All branches below this point will be deleted.
					</p>
				{/if}
			{:else}
				<p class="mt-2 text-sm text-muted-foreground">This message will be permanently deleted.</p>
			{/if}
			<div class="mt-4 flex items-center justify-end gap-2">
				<button
					onclick={cancelDelete}
					class="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				>
					Cancel
				</button>
				<button
					onclick={confirmDelete}
					class="rounded-lg bg-red-600 px-3 py-1.5 text-sm text-white transition-colors hover:bg-red-700"
				>
					{deleteMode === 'thread' ? 'Delete Thread' : 'Delete Message'}
				</button>
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
		{@const menuAssistantParentGuidance = menuMsg.role === 'assistant' ? (menuParentMsg?.guidance ?? null) : null}
		<div
			data-msg-menu
			class="popup-menu fixed z-[60] w-[200px] rounded-xl border border-border bg-popover py-1 shadow-2xl"
			style="--popup-origin: {msgMenuPosition.flipUp ? 'bottom' : 'top'} left; left: {msgMenuPosition.x}px; {msgMenuPosition.flipUp ? 'bottom' : 'top'}: {msgMenuPosition.flipUp ? (typeof window !== 'undefined' ? window.innerHeight - msgMenuPosition.y : 0) + 'px' : msgMenuPosition.y + 'px'}"
		>
			{#if menuMsg.swipes.length > 1}
				<div class="flex items-center justify-center gap-1 px-3 py-1.5">
					<button
						type="button"
						onclick={() => { msgMenuScrollSuppressed = true; swipeMessage(menuMsgIdx, -1).finally(() => { msgMenuScrollSuppressed = false; }); }}
						disabled={isStreaming || menuMsg.swipeIndex <= 0}
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
						disabled={isStreaming || menuMsg.swipeIndex >= menuMsg.swipes.length - 1}
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
			{#if menuMsg.reasoning[menuMsg.swipeIndex]}
				<button
					type="button"
					onclick={() => { reasoningModalIsImpersonation = menuMsg.role === 'user'; reasoningModalIsLive = false; reasoningModalText = menuMsgObj.reasoning[menuMsgObj.swipeIndex]; reasoningModalMessageId = menuMsgObj.id; showReasoningModal = true; closeMsgMenu(); }}
					class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
				>
					<Brain class="h-4 w-4" />View reasoning
				</button>
			{/if}
			{#if menuShowRegen && !menuIsCompacted}
				<button
					type="button"
					onclick={() => { regenerateMessage(); closeMsgMenu(); }}
					disabled={isStreaming}
					class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-40 disabled:pointer-events-none"
				>
					<RefreshCw class="h-4 w-4" />Regenerate
				</button>
			{/if}
			{#if menuIsLastUser && !menuIsCompacted}
				<button
					type="button"
					onclick={() => { resendMessage(menuMsgIdx); closeMsgMenu(); }}
					disabled={isStreaming}
					class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-40 disabled:pointer-events-none"
				>
					<CornerRightUp class="h-4 w-4" />Resend
				</button>
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
				<button
					type="button"
					onclick={() => { reImpersonateMessage(menuMsgIdx); closeMsgMenu(); }}
					disabled={isStreaming}
					class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-40 disabled:pointer-events-none"
				>
					<UserPen class="h-4 w-4" />Re-impersonate
				</button>
			{/if}
			{#if menuMsg.role === 'user' && menuIsLast && !menuIsCompacted}
				<button
					type="button"
					onclick={() => { closeMsgMenu(); openGuideModal({ kind: 'impersonate' }, activeImpersonationSwipe?.guidance ?? ''); }}
					disabled={isStreaming}
					class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-40 disabled:pointer-events-none"
				>
					<Wand2 class="h-4 w-4" />{activeImpersonationSwipe?.guidance ? 'Edit impersonation guidance…' : 'Guide impersonation…'}
				</button>
			{:else if menuMsg.role === 'user' && !menuIsCompacted && menuMsgObj.guidance}
				<!-- 2nd-latest user message: show the guidance read-only so the
				     user can see what they used, but can't edit it now that the
				     impersonation round has already produced a reply. -->
				<button
					type="button"
					onclick={() => {
						const g = menuMsgObj.guidance ?? '';
						closeMsgMenu();
						openGuideModal({ kind: 'impersonateView' }, g);
					}}
					class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
				>
					<Wand2 class="h-4 w-4" />View impersonation guidance
				</button>
			{/if}
			{#if menuIsLastAssistant && menuParentMsg && menuParentMsg.role === 'user' && !menuIsCompacted}
				<button
					type="button"
					onclick={() => {
						const id = menuParentMsg!.id;
						const g = menuAssistantParentGuidance ?? '';
						closeMsgMenu();
						openGuideModal({ kind: 'editAssistantGuidance', userMessageId: id }, g);
					}}
					disabled={isStreaming}
					class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-40 disabled:pointer-events-none"
				>
					<Wand2 class="h-4 w-4" />{menuAssistantParentGuidance ? 'Edit guidance…' : 'Guide reply…'}
				</button>
			{/if}
			{#if !menuIsLast && !menuIsCompacted}
				<button
					type="button"
					onclick={() => { branchFromHere(menuMsgIdx); closeMsgMenu(); }}
					disabled={isStreaming}
					class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-40 disabled:pointer-events-none"
				>
					<GitBranchPlus class="h-4 w-4" />Branch from here
				</button>
			{/if}
			{#if menuIsFirst && menuMsg.role === 'assistant' && !menuIsCompacted}
				<button
					type="button"
					onclick={() => { reformatMessage(menuMsgIdx); closeMsgMenu(); }}
					disabled={isStreaming}
					class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-40 disabled:pointer-events-none"
				>
					<Wand2 class="h-4 w-4" />Reformat greeting
				</button>
			{/if}
			<button
				type="button"
				onclick={() => { startEdit(menuMsgObj); closeMsgMenu(); }}
				disabled={isStreaming || menuIsCompacted}
				class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-40 disabled:pointer-events-none"
				title={menuIsCompacted ? 'Compacted messages cannot be edited' : ''}
			>
				<Pencil class="h-4 w-4" />Edit
			</button>
			<button
				type="button"
				onclick={async () => { try { await navigator.clipboard.writeText(menuMsgObj.content); haptic('success'); toasts.success('Copied'); } catch { toasts.error('Copy failed'); } closeMsgMenu(); }}
				class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
			>
				<Copy class="h-4 w-4" />Copy
			</button>
			{#if menuMsgIdx > 0 && !menuIsCompacted}
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
		</div>
	{/if}
{/if}

<!-- Impersonate button context menu (long-press / right-click) -->
{#if showImpersonateMenu && impersonateMenuPosition}
	<div
		data-impersonate-menu
		class="popup-menu fixed z-[60] w-[220px] rounded-xl border border-border bg-popover py-1 shadow-2xl"
		style="--popup-origin: {impersonateMenuPosition.flipUp ? 'bottom' : 'top'} left; left: {impersonateMenuPosition.x}px; {impersonateMenuPosition.flipUp ? 'bottom' : 'top'}: {impersonateMenuPosition.flipUp ? (typeof window !== 'undefined' ? window.innerHeight - impersonateMenuPosition.y : 0) + 'px' : impersonateMenuPosition.y + 'px'}"
	>
		{#if chatImpersonationSwipes.length > 1}
			<div class="flex items-center justify-center gap-1 px-3 py-1.5">
				<button
					type="button"
					onclick={() => navImpersonationSwipe(-1)}
					disabled={isStreaming || chatImpersonationSwipeIndex <= 0}
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
					disabled={isStreaming || chatImpersonationSwipeIndex >= chatImpersonationSwipes.length - 1}
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
		style="--popup-origin: {sendMenuPosition.flipUp ? 'bottom' : 'top'} left; left: {sendMenuPosition.x}px; {sendMenuPosition.flipUp ? 'bottom' : 'top'}: {sendMenuPosition.flipUp ? (typeof window !== 'undefined' ? window.innerHeight - sendMenuPosition.y : 0) + 'px' : sendMenuPosition.y + 'px'}"
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
			<textarea
				bind:value={guideModalText}
				placeholder={guideModalTarget?.kind === 'impersonateView' ? '(no guidance was set)' : 'e.g. Keep it short and aloof.'}
				readonly={guideModalTarget?.kind === 'impersonateView'}
				class="block min-h-[40vh] w-full flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm focus:border-foreground/30 focus:outline-none focus:ring-2 focus:ring-ring {guideModalTarget?.kind === 'impersonateView' ? 'cursor-default opacity-90' : ''}"
			></textarea>
			<div class="mt-4 flex items-center justify-end gap-2">
				<button
					type="button"
					onclick={() => { showGuideModal = false; guideModalTarget = null; }}
					class="rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				>
					{guideModalTarget?.kind === 'impersonateView' ? 'Close' : 'Cancel'}
				</button>
				{#if guideModalTarget?.kind !== 'impersonateView'}
					<button
						type="button"
						onclick={submitGuideModal}
						class="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
					>
						Go
					</button>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.typing-dot {
		animation: typing-bounce 1.4s ease-in-out infinite;
	}

	@keyframes typing-bounce {
		0%, 60%, 100% {
			transform: translateY(0);
			opacity: 0.4;
		}
		30% {
			transform: translateY(-4px);
			opacity: 1;
		}
	}

	/* Texting mode: iMessage-style bubble pop from right (user) */
	.msg-enter-texting-user {
		animation: msg-pop-right 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
	}

	@keyframes msg-pop-right {
		from {
			opacity: 0;
			transform: translateX(24px) scale(0.92);
		}
		to {
			opacity: 1;
			transform: translateX(0) scale(1);
		}
	}

	/* Texting mode: iMessage-style bubble pop from left (assistant) */
	.msg-enter-texting-assistant {
		animation: msg-pop-left 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
	}

	@keyframes msg-pop-left {
		from {
			opacity: 0;
			transform: translateX(-24px) scale(0.92);
		}
		to {
			opacity: 1;
			transform: translateX(0) scale(1);
		}
	}

	/* Story mode: elegant fade up */
	.msg-enter-story {
		animation: msg-fade-up 0.35s ease-out;
	}

	@keyframes msg-fade-up {
		from {
			opacity: 0;
			transform: translateY(14px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	/* Message exit animation (deletion) */
	.msg-exit {
		animation: msg-exit 0.3s ease-in forwards;
		pointer-events: none;
	}

	@keyframes msg-exit {
		to {
			opacity: 0;
			transform: scale(0.92) translateY(-8px);
		}
	}

	/* Abort/stop generation fade-out */
	.msg-abort {
		animation: msg-abort-fade 0.25s ease-out forwards;
		pointer-events: none;
	}

	@keyframes msg-abort-fade {
		to {
			opacity: 0;
			transform: scale(0.96) translateY(6px);
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

	/* Inline images: hidden until loaded, then fade in */
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
