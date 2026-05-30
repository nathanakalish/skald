import { getContext, setContext } from 'svelte';
import type { MessageListStore } from './state/messageList.svelte';
import type { StreamingStore } from './state/streaming.svelte';
import type { UiStore } from './state/ui.svelte';
import type { DraftStore } from './state/drafts.svelte';

/**
 * Bundle of every chat-scoped reactive store. ChatView creates one bundle on
 * mount, sets it via `setChatViewContext`, and sub-components pull whichever
 * stores they need with `useChatViewContext`. Single context key keeps the
 * import noise low — sub-components don't need to know which key holds what.
 */
export interface ChatViewContext {
	messages: MessageListStore;
	streaming: StreamingStore;
	ui: UiStore;
	drafts: DraftStore;
}

const CTX_KEY = Symbol('chat-view');

export function setChatViewContext(ctx: ChatViewContext): ChatViewContext {
	setContext(CTX_KEY, ctx);
	return ctx;
}

export function useChatViewContext(): ChatViewContext {
	const ctx = getContext<ChatViewContext>(CTX_KEY);
	if (!ctx) throw new Error('useChatViewContext() called outside ChatView');
	return ctx;
}
