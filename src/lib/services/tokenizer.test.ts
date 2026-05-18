import { describe, it, expect } from 'vitest';
import { countTokens, countMessageTokens } from './tokenizer.js';

describe('tokenizer / PROV-H2 provider-aware counting', () => {
	const sample = 'The quick brown fox jumps over the lazy dog. '.repeat(20);

	it('returns the same raw count for OpenAI-compatible providers', () => {
		const base = countTokens(sample, 'openai');
		expect(countTokens(sample, 'deepseek')).toBe(base);
		expect(countTokens(sample, 'openrouter')).toBe(base);
		expect(countTokens(sample, undefined)).toBe(base);
	});

	it('applies a safety multiplier for non-OpenAI providers', () => {
		const openai = countTokens(sample, 'openai');
		expect(countTokens(sample, 'gemini')).toBeGreaterThan(openai);
		expect(countTokens(sample, 'ollama')).toBeGreaterThan(openai);
		expect(countTokens(sample, 'zai')).toBeGreaterThanOrEqual(openai);
	});

	it('uses o200k for Anthropic (different count than cl100k baseline)', () => {
		// o200k has a different merge table; counts should differ from cl100k baseline
		// for non-trivial text, even before the safety multiplier.
		const openai = countTokens(sample, 'openai');
		const anthropic = countTokens(sample, 'anthropic');
		expect(anthropic).not.toBe(openai);
	});

	it('handles empty strings', () => {
		expect(countTokens('', 'anthropic')).toBe(0);
		expect(countTokens('', 'gemini')).toBe(0);
	});

	it('counts message framing per provider', () => {
		const msgs = [
			{ role: 'user' as const, content: 'hello' },
			{ role: 'assistant' as const, content: 'hi back' }
		];
		const openai = countMessageTokens(msgs, 'openai');
		const ollama = countMessageTokens(msgs, 'ollama');
		expect(ollama).toBeGreaterThan(openai);
	});

	it('cache does not cross-contaminate between encodings', () => {
		const text = 'cache-key-test ' + Math.random();
		const oai = countTokens(text, 'openai');
		const ant = countTokens(text, 'anthropic');
		// Second call should hit cache and return identical values
		expect(countTokens(text, 'openai')).toBe(oai);
		expect(countTokens(text, 'anthropic')).toBe(ant);
	});
});
