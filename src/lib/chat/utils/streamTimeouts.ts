/**
 * Time-delay helpers for the streaming pipeline. All numbers come from provider
 * settings so individual providers can tune the texting-mode pacing, and a
 * generous idle watchdog catches stuck streams without bothering active ones.
 */

export const STREAM_IDLE_TIMEOUT_MS = 90_000;
const MIN_TYPING_DELAY_MS = 800;
const DEFAULT_TYPING_SPEED_MS_PER_CHAR = 35;
const DEFAULT_TYPING_MAX_MS = 4000;
const DEFAULT_INITIAL_DELAY_MS = 1500;

export interface TypingTimings {
	textingTypingSpeed?: number | null;
	textingTypingMax?: number | null;
	textingInitialDelay?: number | null;
}

/**
 * Fake-typing delay applied after a reply finishes streaming in texting mode.
 * Scales with message length so short snippets feel snappy and long ones feel
 * deliberate. Skipped entirely when the model already burned natural time on
 * reasoning — double-delaying makes the chat feel sluggish.
 */
export function computeTypingDelayMs(text: string, hadReasoning: boolean, timings: TypingTimings = {}): number {
	if (hadReasoning) return 0;
	const speed = timings.textingTypingSpeed ?? DEFAULT_TYPING_SPEED_MS_PER_CHAR;
	const max = timings.textingTypingMax ?? DEFAULT_TYPING_MAX_MS;
	// Provider has explicitly opted out of fake typing.
	if (speed === 0 && max === 0) return 0;
	const computed = text.length * speed;
	return Math.min(max, Math.max(MIN_TYPING_DELAY_MS, computed));
}

/** Pre-reply delay before showing the typing indicator in texting mode. */
export function computeInitialTypingDelayMs(timings: TypingTimings = {}): number {
	const delay = timings.textingInitialDelay ?? DEFAULT_INITIAL_DELAY_MS;
	return delay > 0 ? delay : 0;
}

export function sleep(ms: number): Promise<void> {
	if (ms <= 0) return Promise.resolve();
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Stateful idle watchdog. `kick()` on every incoming event; if the stream
 * goes quiet for `STREAM_IDLE_TIMEOUT_MS` the supplied `onTimeout` fires.
 */
export class StreamIdleWatchdog {
	private timer: ReturnType<typeof setTimeout> | null = null;
	constructor(
		private onTimeout: () => void,
		private timeoutMs: number = STREAM_IDLE_TIMEOUT_MS
	) {}

	kick(): void {
		this.clear();
		this.timer = setTimeout(() => {
			this.timer = null;
			this.onTimeout();
		}, this.timeoutMs);
	}

	clear(): void {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
	}
}
