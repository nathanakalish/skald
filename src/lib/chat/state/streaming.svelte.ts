import { StreamIdleWatchdog } from '$lib/chat/utils/streamTimeouts';
import type { Message } from '$lib/chat/message';

/**
 * Streaming pipeline state. Holds the flags every other piece of the chat UI
 * reads to know whether tokens are coming in, plus the snapshot used to undo
 * a regen if the user aborts before any content arrives.
 *
 * `streamingAssistantIdx` is the single source of truth for "which bubble are
 * we writing into" — set to -1 when no bubble owns the stream (impersonation
 * stream, or no stream at all).
 */
export class StreamingStore {
	isStreaming = $state(false);
	isReasoning = $state(false);
	isImpersonating = $state(false);

	accumulated = $state('');
	accumulatedReasoning = $state('');
	/** Live reasoning shown in the reasoning modal. Tracked separately so users can browse historical reasoning while the stream keeps growing. */
	streamingReasoning = $state('');

	streamingAssistantIdx = $state(-1);
	isRegenerate = $state(false);
	originalMessage: Message | null = $state(null);

	awaitingServerRefresh = $state(false);
	wasAbortedManually = $state(false);
	abortAnimating = $state(false);

	/** Monotonic SSE event seq guard — events with seq <= lastSeq are replays. */
	lastSeq = 0;

	private watchdog: StreamIdleWatchdog;

	constructor(onIdleAbort: () => void) {
		this.watchdog = new StreamIdleWatchdog(onIdleAbort);
	}

	begin(): void {
		this.isStreaming = true;
		this.isReasoning = false;
		this.accumulated = '';
		this.accumulatedReasoning = '';
		this.streamingReasoning = '';
		this.wasAbortedManually = false;
		this.abortAnimating = false;
		this.watchdog.kick();
	}

	tick(): void {
		// Keep the watchdog patient as long as tokens or reasoning are flowing.
		this.watchdog.kick();
	}

	clearBubbleTarget(): void {
		this.streamingAssistantIdx = -1;
		this.isRegenerate = false;
		this.originalMessage = null;
	}

	end(): void {
		this.isStreaming = false;
		this.isReasoning = false;
		this.isImpersonating = false;
		this.watchdog.clear();
	}

	dispose(): void {
		this.watchdog.clear();
	}
}
