// Server-side broadcast helper for realtime resource events.
//
// Every resource mutation endpoint calls `broadcast(userId, event)` after a
// successful write. The event flows through the existing `eventBus` SSE
// fan-out, reaching every tab/device the user has open. Echoes back to the
// originating tab are harmless because store mutations are idempotent.

import { eventBus } from './eventBus.js';
import { logger } from './logger.js';
import type { RealtimeEvent } from '$lib/realtime/events.js';

/**
 * Per-user 50ms coalescing window (M18). Without this, a user clicking
 * rapidly through chats — or scripting PATCHes — would flood their own SSE
 * channel with redundant events. We collapse same-key events down to the
 * latest one (e.g. five `chat:patched` for the same chat in a tick become
 * one), then emit the batch.
 */
const COALESCE_WINDOW_MS = 50;
type Pending = { timer: ReturnType<typeof setTimeout>; events: Map<string, RealtimeEvent> };
const pending = new Map<number, Pending>();

// Per-event-type counter so non-identifiable events still get a stable, unique
// key within a coalesce window. Math.random() previously meant *every* enqueue
// of an idless event got its own slot — that's fine for uniqueness but
// unnecessarily noisy; a counter is just as unique without poisoning the cache.
let _slotCounter = 0;

function eventKey(event: RealtimeEvent): string {
	// Most events have a stable identity via `id` or `chatId+id`; fall back
	// to a unique key so non-identifiable events still get through.
	const e = event as unknown as { id?: number | string; chatId?: number };
	if (typeof e.id === 'number' || typeof e.id === 'string') {
		return e.chatId !== undefined ? `${event.type}:${e.chatId}:${e.id}` : `${event.type}:${e.id}`;
	}
	if (e.chatId !== undefined) return `${event.type}:${e.chatId}`;
	// `*:replaced` events have no id — collapse all of them into one slot.
	if (/:replaced$/.test(event.type)) return event.type;
	return `${event.type}:#${++_slotCounter}`;
}

function flush(userId: number) {
	const slot = pending.get(userId);
	if (!slot) return;
	pending.delete(userId);
	logger.trace('realtime: flush', { userId, eventCount: slot.events.size });
	for (const event of slot.events.values()) {
		emit(userId, event);
	}
}

function emit(userId: number, event: RealtimeEvent): void {
	const chatId =
		'chatId' in event && typeof (event as { chatId?: unknown }).chatId === 'number'
			? (event as { chatId: number }).chatId
			: undefined;

	eventBus.emit({
		type: event.type,
		userId,
		...(chatId !== undefined ? { chatId } : {}),
		data: event
	});
}

export function broadcast(userId: number, event: RealtimeEvent): void {
	let slot = pending.get(userId);
	if (!slot) {
		slot = { events: new Map(), timer: setTimeout(() => flush(userId), COALESCE_WINDOW_MS) };
		pending.set(userId, slot);
	}
	// Shallow-copy so callers can mutate `event` after broadcasting (e.g. attach
	// derived fields) without quietly mutating what's queued for SSE flush.
	slot.events.set(eventKey(event), { ...event });
}
