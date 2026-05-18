// Per-chat scroll position memory. Volatile (in-memory only); cleared on reload.
const positions = new Map<number, number>();

export function saveScroll(chatId: number, scrollTop: number): void {
	if (!Number.isFinite(chatId) || !Number.isFinite(scrollTop)) return;
	positions.set(chatId, scrollTop);
}

export function loadScroll(chatId: number): number | null {
	return positions.get(chatId) ?? null;
}
