import { describe, it, expect } from 'vitest';
import { diffMessageList, countTrailingPlaceholders, type DiffableMessage } from './messageListDiff';

function msg(id: number, content: string, extra: Partial<DiffableMessage> = {}): DiffableMessage {
	return {
		id,
		content,
		swipeIndex: 0,
		swipes: [content],
		reasoning: [''],
		guidance: null,
		impersonationGuidance: null,
		parentId: null,
		...extra
	};
}

describe('countTrailingPlaceholders', () => {
	it('counts contiguous trailing negative ids', () => {
		expect(countTrailingPlaceholders([msg(1, 'a'), msg(-1, 'b'), msg(-2, 'c')])).toBe(2);
	});

	it('stops at the first positive id', () => {
		expect(countTrailingPlaceholders([msg(-1, 'a'), msg(1, 'b')])).toBe(0);
	});

	it('returns 0 on empty list', () => {
		expect(countTrailingPlaceholders([])).toBe(0);
	});
});

describe('diffMessageList', () => {
	it('reports no change for byte-identical snapshots', () => {
		const list = [msg(1, 'hi'), msg(2, 'there')];
		const r = diffMessageList(list, [msg(1, 'hi'), msg(2, 'there')]);
		expect(r.changed).toBe(false);
		expect(r.safeMerged).toBe(false);
	});

	it('detects content changes and produces an updated list', () => {
		const list = [msg(1, 'hi')];
		const r = diffMessageList(list, [msg(1, 'hi edited')]);
		expect(r.changed).toBe(true);
		expect(r.list[0].content).toBe('hi edited');
	});

	it('reuses old objects when content is fully equal (stable keying)', () => {
		const a = msg(1, 'hi');
		const list = [a];
		const r = diffMessageList(list, [msg(2, 'new'), msg(1, 'hi')]);
		expect(r.changed).toBe(true);
		expect(r.list[1]).toBe(a); // object identity preserved
	});

	it('pre-registers real ids that replace trailing placeholders', () => {
		const list = [msg(1, 'a'), msg(-1, 'pending user'), msg(-2, 'pending assistant')];
		const incoming = [msg(1, 'a'), msg(100, 'pending user'), msg(101, 'pending assistant')];
		const r = diffMessageList(list, incoming);
		expect(r.idsToPreRegister.sort()).toEqual([100, 101]);
	});

	it('does not pre-register ids that already exist in the current list', () => {
		const list = [msg(1, 'a'), msg(-1, 'b')];
		const incoming = [msg(1, 'a'), msg(1, 'a')]; // contrived but explicit
		const r = diffMessageList(list, incoming);
		expect(r.idsToPreRegister).toEqual([]);
	});

	it('preserves earlier pages when the server only returns the tail and chains connect', () => {
		const earlier = msg(10, 'old-1');
		const earlier2 = msg(11, 'old-2', { parentId: 10 });
		const list = [earlier, earlier2, msg(20, 'recent', { parentId: 11 })];
		// server returns only the tail window, starting from id 20
		const incoming = [msg(20, 'recent', { parentId: 11 }), msg(21, 'newer', { parentId: 20 })];
		const r = diffMessageList(list, incoming);
		expect(r.changed).toBe(true);
		expect(r.safeMerged).toBe(true);
		expect(r.list.map((m) => m.id)).toEqual([10, 11, 20, 21]);
	});

	it('does NOT safe-merge when the chain is broken', () => {
		// earlier's parent doesn't exist in either list — chain broken
		const list = [msg(10, 'unrelated'), msg(20, 'recent')];
		const incoming = [msg(30, 'fresh', { parentId: 999 })];
		const r = diffMessageList(list, incoming);
		expect(r.safeMerged).toBe(false);
		expect(r.list).toEqual(incoming);
	});

	it('detects swipeIndex-only changes', () => {
		const list = [msg(1, 'a', { swipeIndex: 0, swipes: ['a', 'b'] })];
		const r = diffMessageList(list, [msg(1, 'a', { swipeIndex: 1, swipes: ['a', 'b'] })]);
		expect(r.changed).toBe(true);
	});

	it('detects guidance changes', () => {
		const list = [msg(1, 'a')];
		const r = diffMessageList(list, [msg(1, 'a', { guidance: 'be brief' })]);
		expect(r.changed).toBe(true);
	});

	it('treats undefined and null guidance as equal', () => {
		const list = [msg(1, 'a', { guidance: undefined })];
		const r = diffMessageList(list, [msg(1, 'a', { guidance: null })]);
		expect(r.changed).toBe(false);
	});
});
