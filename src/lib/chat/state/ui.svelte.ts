import type { MenuPosition } from '$lib/chat/utils/menuPositioning';

// Mirrors the original ChatView's union exactly. Distinct kinds drive different
// modal copy/behaviour in GuideModal, and different actions on submit.
export type GuideTarget =
	| { kind: 'send' }
	| { kind: 'impersonate' }
	// Read-only: just shows the guidance that produced the active impersonation swipe.
	| { kind: 'impersonateView' }
	// Start a new reply with the guidance attached to the user message.
	| { kind: 'guideReply'; userMessageId: number }
	// PATCH the assistant's own guidance, then regenerate it.
	| { kind: 'editAssistantGuidance'; assistantMessageId: number };

/**
 * Catch-all for modal + menu visibility flags and their positions. Lives in
 * one store so a sub-component can close another's menu (mutually exclusive
 * context menus on touch devices) without prop-drilling a dozen callbacks.
 */
export class UiStore {
	// Modals
	showChatSettings = $state(false);
	showCharacterInfo = $state(false);
	showCharacterLorebooks = $state(false);
	showHeaderMenu = $state(false);
	showReformatReview = $state(false);
	showCompactionEditor = $state(false);

	// Search
	searchOpen = $state(false);
	searchQuery = $state('');

	// Reasoning modal
	reasoningOpen = $state(false);
	reasoningText = $state('');
	reasoningIsLive = $state(false);
	reasoningIsImpersonation = $state(false);
	reasoningMessageId = $state(0);

	// Lightboxes
	enlargedAvatar = $state<string | null>(null);
	lightboxMessageId = $state<number | null>(null);

	// Message context menu
	msgMenuIdx = $state<number | null>(null);
	msgMenuPosition = $state<MenuPosition | null>(null);

	// Impersonate / send button menus (mutually exclusive)
	showImpersonateMenu = $state(false);
	impersonateMenuPosition = $state<MenuPosition | null>(null);
	showSendMenu = $state(false);
	sendMenuPosition = $state<MenuPosition | null>(null);

	// Guide modal
	showGuideModal = $state(false);
	guideText = $state('');
	guideTarget: GuideTarget | null = $state(null);

	// Delete confirmation
	confirmingDeleteIdx = $state<number | null>(null);
	deleteMode = $state<'single' | 'thread'>('single');

	closeMsgMenu(): void {
		this.msgMenuIdx = null;
		this.msgMenuPosition = null;
	}

	closeAllButtonMenus(): void {
		this.showImpersonateMenu = false;
		this.showSendMenu = false;
		this.impersonateMenuPosition = null;
		this.sendMenuPosition = null;
	}

	openImpersonateMenu(pos: MenuPosition): void {
		this.closeMsgMenu();
		this.showSendMenu = false;
		this.impersonateMenuPosition = pos;
		this.showImpersonateMenu = true;
	}

	openSendMenu(pos: MenuPosition): void {
		this.closeMsgMenu();
		this.showImpersonateMenu = false;
		this.sendMenuPosition = pos;
		this.showSendMenu = true;
	}

	openGuide(target: GuideTarget, prefill = ''): void {
		this.guideTarget = target;
		this.guideText = prefill;
		this.showGuideModal = true;
	}

	closeGuide(): void {
		this.showGuideModal = false;
		this.guideTarget = null;
		this.guideText = '';
	}

	openReasoning(text: string, opts: { live?: boolean; impersonation?: boolean; messageId?: number } = {}): void {
		this.reasoningText = text;
		this.reasoningIsLive = !!opts.live;
		this.reasoningIsImpersonation = !!opts.impersonation;
		this.reasoningMessageId = opts.messageId ?? 0;
		this.reasoningOpen = true;
	}

	/**
	 * Toggle the message-search bar. Closes it (and clears the query) when
	 * already open; opens it otherwise. Callers should focus the input
	 * after opening — that needs DOM access so it stays in the component.
	 */
	toggleSearch(): void {
		this.searchOpen = !this.searchOpen;
		if (!this.searchOpen) this.searchQuery = '';
	}
}
