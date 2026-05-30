import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	computeTypingDelayMs,
	computeInitialTypingDelayMs,
	StreamIdleWatchdog,
	STREAM_IDLE_TIMEOUT_MS
} from './streamTimeouts';

describe('computeTypingDelayMs', () => {
	it('returns 0 when the model already used reasoning time', () => {
		expect(computeTypingDelayMs('hello there', true)).toBe(0);
	});

	it('returns 0 when provider opts out (speed=0 and max=0)', () => {
		expect(computeTypingDelayMs('hello', false, { textingTypingSpeed: 0, textingTypingMax: 0 })).toBe(0);
	});

	it('floors short messages to the minimum delay', () => {
		expect(computeTypingDelayMs('hi', false)).toBe(800);
	});

	it('scales with length up to the cap', () => {
		const long = 'x'.repeat(1000);
		// 1000 * 35 = 35000 -> capped at 4000
		expect(computeTypingDelayMs(long, false)).toBe(4000);
	});

	it('honors per-provider overrides', () => {
		expect(
			computeTypingDelayMs('a'.repeat(20), false, { textingTypingSpeed: 50, textingTypingMax: 5000 })
		).toBe(1000);
	});
});

describe('computeInitialTypingDelayMs', () => {
	it('returns the default when timing is omitted', () => {
		expect(computeInitialTypingDelayMs()).toBe(1500);
	});

	it('returns 0 for non-positive overrides (opt-out)', () => {
		expect(computeInitialTypingDelayMs({ textingInitialDelay: 0 })).toBe(0);
		expect(computeInitialTypingDelayMs({ textingInitialDelay: -1 })).toBe(0);
	});

	it('respects positive overrides', () => {
		expect(computeInitialTypingDelayMs({ textingInitialDelay: 500 })).toBe(500);
	});
});

describe('StreamIdleWatchdog', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('fires onTimeout after the configured idle period', () => {
		const cb = vi.fn();
		const w = new StreamIdleWatchdog(cb, 1000);
		w.kick();
		vi.advanceTimersByTime(999);
		expect(cb).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(cb).toHaveBeenCalledTimes(1);
	});

	it('each kick() resets the timer', () => {
		const cb = vi.fn();
		const w = new StreamIdleWatchdog(cb, 1000);
		w.kick();
		vi.advanceTimersByTime(800);
		w.kick();
		vi.advanceTimersByTime(800);
		expect(cb).not.toHaveBeenCalled();
		vi.advanceTimersByTime(200);
		expect(cb).toHaveBeenCalledTimes(1);
	});

	it('clear() cancels a pending timer', () => {
		const cb = vi.fn();
		const w = new StreamIdleWatchdog(cb, 1000);
		w.kick();
		w.clear();
		vi.advanceTimersByTime(5000);
		expect(cb).not.toHaveBeenCalled();
	});

	it('defaults to the 90s production timeout', () => {
		expect(STREAM_IDLE_TIMEOUT_MS).toBe(90_000);
	});
});
