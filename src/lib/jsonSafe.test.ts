import { describe, it, expect } from 'vitest';
import { parseStringArray, parseRecord, parseValidated } from './jsonSafe.js';

describe('parseStringArray', () => {
	it('parses a valid string array', () => {
		expect(parseStringArray('["a","b"]')).toEqual(['a', 'b']);
	});

	it('filters non-string entries', () => {
		expect(parseStringArray('["a",1,null,"b"]')).toEqual(['a', 'b']);
	});

	it('returns [] for non-array JSON', () => {
		expect(parseStringArray('{"x":1}')).toEqual([]);
		expect(parseStringArray('"hi"')).toEqual([]);
		expect(parseStringArray('42')).toEqual([]);
	});

	it('returns [] for malformed JSON', () => {
		expect(parseStringArray('not json')).toEqual([]);
		expect(parseStringArray('[1,')).toEqual([]);
	});

	it('returns [] for null/undefined/empty', () => {
		expect(parseStringArray(null)).toEqual([]);
		expect(parseStringArray(undefined)).toEqual([]);
		expect(parseStringArray('')).toEqual([]);
	});
});

describe('parseRecord', () => {
	it('parses a plain object', () => {
		expect(parseRecord('{"a":1,"b":"x"}')).toEqual({ a: 1, b: 'x' });
	});

	it('returns {} for arrays', () => {
		expect(parseRecord('[1,2,3]')).toEqual({});
	});

	it('returns {} for primitives and null', () => {
		expect(parseRecord('null')).toEqual({});
		expect(parseRecord('42')).toEqual({});
		expect(parseRecord('"hi"')).toEqual({});
	});

	it('returns {} for malformed JSON', () => {
		expect(parseRecord('{bad}')).toEqual({});
	});

	it('returns {} for null/undefined/empty', () => {
		expect(parseRecord(null)).toEqual({});
		expect(parseRecord('')).toEqual({});
	});
});

describe('parseValidated', () => {
	const isNumberArray = (v: unknown): v is number[] =>
		Array.isArray(v) && v.every((x) => typeof x === 'number');

	it('returns parsed value when guard passes', () => {
		expect(parseValidated('[1,2,3]', isNumberArray, [])).toEqual([1, 2, 3]);
	});

	it('returns fallback when guard rejects', () => {
		expect(parseValidated('[1,"x"]', isNumberArray, [])).toEqual([]);
	});

	it('returns fallback on parse error', () => {
		expect(parseValidated('not json', isNumberArray, [99])).toEqual([99]);
	});
});
