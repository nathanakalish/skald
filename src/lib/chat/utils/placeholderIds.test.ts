import { describe, it, expect } from 'vitest';
import { createPlaceholderIdSeq, isPlaceholderId } from './placeholderIds';

describe('createPlaceholderIdSeq', () => {
	it('produces strictly decreasing negative ids', () => {
		const seq = createPlaceholderIdSeq(1000);
		const a = seq.next();
		const b = seq.next();
		const c = seq.next();
		expect(a).toBeLessThan(0);
		expect(b).toBeLessThan(a);
		expect(c).toBeLessThan(b);
	});

	it('never collides across tight loops', () => {
		const seq = createPlaceholderIdSeq();
		const ids = new Set<number>();
		for (let i = 0; i < 10_000; i++) ids.add(seq.next());
		expect(ids.size).toBe(10_000);
	});

	it('treats positive seeds the same as negative ones', () => {
		const a = createPlaceholderIdSeq(500);
		const b = createPlaceholderIdSeq(-500);
		expect(a.next()).toBe(b.next());
	});

	it('isPlaceholderId discriminates negative vs real ids', () => {
		expect(isPlaceholderId(-1)).toBe(true);
		expect(isPlaceholderId(-9999)).toBe(true);
		expect(isPlaceholderId(0)).toBe(false);
		expect(isPlaceholderId(42)).toBe(false);
	});
});
