import { describe, it, expect } from 'vitest';
import { isSafeRegex } from './regex.js';

describe('isSafeRegex', () => {
	it('accepts ordinary patterns', () => {
		expect(isSafeRegex('hello')).toBe(true);
		expect(isSafeRegex('\\bword\\b')).toBe(true);
		expect(isSafeRegex('foo|bar')).toBe(true);            // alternation outside a group: fine
		expect(isSafeRegex('(foo)bar')).toBe(true);
		expect(isSafeRegex('(foo)?bar')).toBe(true);          // `?` is bounded, not explosive
		expect(isSafeRegex('a{1,5}')).toBe(true);
		expect(isSafeRegex('[abc]+')).toBe(true);             // class with quantifier: linear
		expect(isSafeRegex('[a|b|c]+')).toBe(true);           // `|` inside a class is literal
	});

	it('rejects nested quantifiers (the classic shape)', () => {
		expect(isSafeRegex('(a+)+')).toBe(false);
		expect(isSafeRegex('(a*)+')).toBe(false);
		expect(isSafeRegex('(a+)*')).toBe(false);
		expect(isSafeRegex('((a*)*)')).toBe(false);
		expect(isSafeRegex('(a{1,10})*')).toBe(false);
	});

	it('rejects alternation under an unbounded quantifier', () => {
		expect(isSafeRegex('(a|b)+')).toBe(false);
		expect(isSafeRegex('(foo|bar)*')).toBe(false);
		expect(isSafeRegex('(x|y){1,5}')).toBe(false);
		expect(isSafeRegex('(a|b+)+')).toBe(false);           // both alternation AND quantifier inside
	});

	it('rejects overly long patterns', () => {
		expect(isSafeRegex('a'.repeat(501))).toBe(false);
		expect(isSafeRegex('a'.repeat(500))).toBe(true);
	});

	it('ignores escaped metacharacters', () => {
		expect(isSafeRegex('\\(a\\+\\)\\+')).toBe(true);      // literal "(a+)+", not a group
		expect(isSafeRegex('\\|')).toBe(true);
	});
});
