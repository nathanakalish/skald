/**
 * In-memory SSE event bus. Multiplexes events to connected clients.
 *
 * Two flavours of event ride this bus:
 *
 *   1. Chat-stream events (token, reasoning, complete, error, …) emitted by
 *      the streaming pipeline. Always carry a chatId.
 *   2. Resource invalidation events (`<resource>:created|updated|deleted`)
 *      emitted by mutation endpoints to push canonical state out to all of
 *      the user's tabs. May or may not carry a chatId.
 *
 * Events are tagged with userId so each SSE connection can filter to its own.
 * There's a recent-event buffer too, so reconnecting clients can replay what
 * they missed during the gap.
 */

export interface ChatEvent {
	/**
		 * Original chat-stream event types plus the resource-invalidation events.
		 * Kept as a permissive string so callers (especially the resource broadcast
		 * helper) can pass the typed union through without redeclaring it here.
		 * Wire-format only — the typed shape lives in `src/lib/realtime/events.ts`.
	 */
	type:
		| 'token' | 'reasoning' | 'complete' | 'error' | 'tokenStats'
		| 'unread' | 'streaming' | 'chat-muted'
		| (string & {});
	/** Optional — resource events for non-chat resources omit this. */
	chatId?: number;
	userId: number;
	data: any;
}

export interface SequencedEvent extends ChatEvent {
	id: number;
}

type Listener = (event: SequencedEvent) => void;

const BUFFER_MAX = 500;
const BUFFER_TTL_MS = 5 * 60 * 1000; // 5 minutes

class EventBus {
	private listeners = new Set<Listener>();
	private seq = 0;
	// Single combined ring of {event, ts}. Was previously two parallel arrays
	// (`buffer` + `bufferTimestamps`) which had to stay length-synced — easy to
	// drift if a listener re-entered emit() mid-prune.
	private buffer: { event: SequencedEvent; ts: number }[] = [];

	/** Subscribe to all chat events. Returns an unsubscribe function. */
	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Emit an event to every connected listener. */
	emit(event: ChatEvent): void {
		const sequenced: SequencedEvent = { ...event, id: ++this.seq };

		// Buffer the important stuff (complete / unread / error) for replay on reconnect.
		if (event.type === 'complete' || event.type === 'unread' || event.type === 'error') {
			this.buffer.push({ event: sequenced, ts: Date.now() });
			this.pruneBuffer();
		}

		for (const listener of this.listeners) {
			try {
				listener(sequenced);
			} catch {
				// One broken listener doesn't get to take the others down with it.
			}
		}
	}

	/** Replay buffered events newer than `afterId` for one specific user. */
	replay(afterId: number, userId: number): SequencedEvent[] {
		const out: SequencedEvent[] = [];
		for (const entry of this.buffer) {
			if (entry.event.id > afterId && entry.event.userId === userId) out.push(entry.event);
		}
		return out;
	}

	/** Drop expired or excess entries from the replay buffer. */
	private pruneBuffer(): void {
		const cutoff = Date.now() - BUFFER_TTL_MS;
		while (this.buffer.length > 0 && this.buffer[0].ts < cutoff) {
			this.buffer.shift();
		}
		while (this.buffer.length > BUFFER_MAX) {
			this.buffer.shift();
		}
	}
}

// Singleton — shared across all requests in the same server process.
export const eventBus = new EventBus();
