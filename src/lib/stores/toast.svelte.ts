// Unified toast store. Renders both small system toasts (success / error /
// info) and richer "chat" toasts (avatar + character name + message preview)
// from a single queue at the top-right of the screen. The chat-toast kind is
// what +layout.svelte uses to surface "new message in another chat" alerts
// when the user is focused on a different chat. They share the same physical
// stack so they don't fight for screen space.

interface BaseToast {
	id: number;
	/** Auto-dismiss after this many ms. 0 = sticky (manual dismiss only). */
	duration: number;
}

export interface SimpleToast extends BaseToast {
	kind: 'simple';
	type: 'success' | 'error' | 'info';
	message: string;
	/** Optional click handler. When set, the toast becomes clickable and auto-dismisses on click. */
	onclick?: () => void;
}

interface ChatToast extends BaseToast {
	kind: 'chat';
	chatId: number;
	characterName: string;
	characterAvatar: string | null;
	preview: string;
	/** Fired when the user clicks the body of the toast (not the X button). */
	onclick?: (chatId: number) => void;
}

export type ToastItem = SimpleToast | ChatToast;

let nextId = 0;
const _toasts = $state<ToastItem[]>([]);
const _timers = new Map<number, ReturnType<typeof setTimeout>>();
// Remember each toast's duration so pause/resume can reschedule with the
// originally requested wall-clock instead of starting over from scratch.
const _durations = new Map<number, number>();

function scheduleDismiss(id: number, duration: number) {
	if (duration <= 0) return; // sticky
	const timer = setTimeout(() => remove(id), duration);
	_timers.set(id, timer);
	_durations.set(id, duration);
}

/** Pause auto-dismiss while the user hovers a toast. Idempotent. */
function pause(id: number) {
	const t = _timers.get(id);
	if (t) { clearTimeout(t); _timers.delete(id); }
}

/** Resume auto-dismiss with the toast's original duration. */
function resume(id: number) {
	if (_timers.has(id)) return;
	const d = _durations.get(id);
	if (d && d > 0) {
		const timer = setTimeout(() => remove(id), d);
		_timers.set(id, timer);
	}
}

function add(message: string, type: SimpleToast['type'] = 'success', duration = 2500, onclick?: () => void) {
	const id = ++nextId;
	_toasts.push({ id, kind: 'simple', message, type, duration, ...(onclick ? { onclick } : {}) });
	scheduleDismiss(id, duration);
	return id;
}

function chat(opts: Omit<ChatToast, 'id' | 'kind' | 'duration'>, duration = 5000) {
	const id = ++nextId;
	_toasts.push({ id, kind: 'chat', duration, ...opts });
	scheduleDismiss(id, duration);
	return id;
}

function remove(id: number) {
	const idx = _toasts.findIndex(t => t.id === id);
	if (idx >= 0) _toasts.splice(idx, 1);
	const t = _timers.get(id);
	if (t) { clearTimeout(t); _timers.delete(id); }
	_durations.delete(id);
}

/** Drop every chat toast for a given chat (e.g. user opened the chat on another device). */
function removeChat(chatId: number) {
	for (let i = _toasts.length - 1; i >= 0; i--) {
		const t = _toasts[i];
		if (t.kind === 'chat' && t.chatId === chatId) remove(t.id);
	}
}

export const toasts = {
	get all() { return _toasts; },
	success: (message: string, duration?: number, onclick?: () => void) => add(message, 'success', duration, onclick),
	error: (message: string, duration?: number) => add(message, 'error', duration ?? 4000),
	info: (message: string, duration?: number, onclick?: () => void) => add(message, 'info', duration, onclick),
	chat,
	remove,
	removeChat,
	pause,
	resume,
};
