import { describe, it, expect } from 'vitest';
import { computeSearchMatches } from './messageSearch';

const msgs = [
	{ id: 1, content: 'Hello world' },
	{ id: 2, content: 'Goodbye WORLD' },
	{ id: 3, content: 'nothing relevant' },
	{ id: 4, content: '' }
];

describe('computeSearchMatches', () => {
	it('returns empty set for empty/whitespace query', () => {
		expect(computeSearchMatches(msgs, '').size).toBe(0);
		expect(computeSearchMatches(msgs, '   ').size).toBe(0);
	});

	it('is case-insensitive', () => {
		const ids = computeSearchMatches(msgs, 'world');
		expect(ids).toEqual(new Set([1, 2]));
	});

	it('matches substrings', () => {
		expect(computeSearchMatches(msgs, 'good')).toEqual(new Set([2]));
	});

	it('returns empty set when nothing matches', () => {
		expect(computeSearchMatches(msgs, 'xyz').size).toBe(0);
	});

	it('handles empty-content messages without crashing', () => {
		expect(computeSearchMatches(msgs, 'hello')).toEqual(new Set([1]));
	});
});
