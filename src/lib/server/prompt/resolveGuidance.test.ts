import { describe, it, expect } from 'vitest';
import { resolveGuidance } from './resolveGuidance.js';
import type { ChatRow, ProcessOptions } from './types.js';

function makeChat(replyGuidance: string | null = null): ChatRow {
	return { id: 1, replyGuidance } as unknown as ChatRow;
}

function opts(over: Partial<ProcessOptions> = {}): ProcessOptions {
	return { chatId: 1, ...over };
}

describe('resolveGuidance', () => {
	it('returns undefined when no guidance present', () => {
		const r = resolveGuidance(makeChat(null), opts());
		expect(r.effective).toBeUndefined();
		expect(r.sources).toEqual({ chatWide: false, perMessage: false });
	});

	it('uses chat-wide alone', () => {
		const r = resolveGuidance(makeChat('keep replies short'), opts());
		expect(r.effective).toBe('keep replies short');
		expect(r.sources).toEqual({ chatWide: true, perMessage: false });
	});

	it('uses per-turn alone', () => {
		const r = resolveGuidance(makeChat(null), opts({ guidance: 'be dramatic' }));
		expect(r.effective).toBe('be dramatic');
		expect(r.sources).toEqual({ chatWide: false, perMessage: true });
	});

	it('joins chat-wide and per-turn with a blank line, per-turn last', () => {
		const r = resolveGuidance(makeChat('keep replies short'), opts({ guidance: 'be dramatic' }));
		expect(r.effective).toBe('keep replies short\n\nbe dramatic');
		expect(r.sources).toEqual({ chatWide: true, perMessage: true });
	});

	it('trims whitespace on both sides', () => {
		const r = resolveGuidance(makeChat('  short  '), opts({ guidance: '  dramatic  ' }));
		expect(r.effective).toBe('short\n\ndramatic');
	});

	it('ignores chat-wide entirely during impersonation', () => {
		const r = resolveGuidance(makeChat('keep replies short'), opts({ impersonate: true }));
		expect(r.effective).toBeUndefined();
		expect(r.sources).toEqual({ chatWide: false, perMessage: false });
	});

	it('uses per-turn during impersonation', () => {
		const r = resolveGuidance(makeChat('keep replies short'), opts({ impersonate: true, guidance: 'agree reluctantly' }));
		expect(r.effective).toBe('agree reluctantly');
		expect(r.sources).toEqual({ chatWide: false, perMessage: true });
	});

	it('treats whitespace-only chat-wide as absent', () => {
		const r = resolveGuidance(makeChat('   \n  '), opts({ guidance: 'be dramatic' }));
		expect(r.effective).toBe('be dramatic');
		expect(r.sources).toEqual({ chatWide: false, perMessage: true });
	});
});
