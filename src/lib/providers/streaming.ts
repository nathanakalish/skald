/**
 * Shared SSE / NDJSON streaming utilities for LLM provider implementations.
 *
 * Every provider does the same buffer-and-split-on-newlines dance, varying
 * only in (a) whether each line is prefixed with `data: ` (OpenAI-style SSE)
 * or raw JSON (Ollama-style NDJSON), and (b) what JSON shape signals
 * "stream complete".
 */

import { logger } from '$lib/server/logger.js';

/**
 * Async-iterator over an SSE stream that prefixes every line with `data: `.
 * Yields the JSON-text payload (the bit after `data: `) for each event.
 * Stops automatically on `doneSentinel` (defaults to `[DONE]`).
 *
 * Used by OpenAI / Gemini / Z.AI / Anthropic providers so they can `for await`
 * over decoded events instead of re-implementing the buffer-and-split dance.
 */
export async function* iterateSSE(
	body: ReadableStream<Uint8Array>,
	doneSentinel: string | null = '[DONE]'
): AsyncGenerator<string, void, unknown> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	// Surfaces misbehaving providers spewing non-SSE noise — without this, a stream of
	// HTML error pages or plaintext garbage would silently no-op until the socket closed.
	let badLines = 0;
	let badWarned = false;
	const BAD_LINE_WARN_THRESHOLD = 32;

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n');
			buffer = lines.pop() || '';

			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed) continue;
				if (!trimmed.startsWith('data: ')) {
					badLines++;
					if (!badWarned && badLines >= BAD_LINE_WARN_THRESHOLD) {
						badWarned = true;
						logger.warn('sse: non-SSE lines from provider stream', {
							badLines,
							firstOffendingLine: trimmed.slice(0, 120),
						});
					}
					continue;
				}
				const data = trimmed.slice(6);
				if (doneSentinel && data === doneSentinel) return;
				yield data;
			}
		}
	} finally {
		try { reader.releaseLock(); } catch { /* ignore */ }
	}
}

/**
 * Async-iterator over a newline-delimited JSON stream (one JSON object per
 * line). Used by Ollama. Yields each non-empty line verbatim.
 *
 * Multi-line JSON: strict JSON forbids raw newlines inside strings (they
 * must be escaped as `\n`), so splitting on `\n` is safe for any well-formed
 * NDJSON producer. A producer that pretty-prints JSON across multiple lines
 * would just produce per-fragment parse failures upstream, which `ollama.ts`
 * silently skips — no security impact, only lost tokens. We don't attempt to
 * reassemble multi-line JSON because doing so reliably requires a streaming
 * tokeniser and the failure mode of getting it wrong is worse than the
 * symptom (truncated assistant message vs. crashed parser running on attacker
 * input).
 */
export async function* iterateNDJSON(
	body: ReadableStream<Uint8Array>
): AsyncGenerator<string, void, unknown> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n');
			buffer = lines.pop() || '';

			for (const line of lines) {
				if (!line.trim()) continue;
				yield line;
			}
		}
		// Flush any trailing content not terminated with \n. Ollama always
		// sends a final newline after the `done: true` object, but we shouldn't
		// silently drop the last message if a provider omits it.
		const trailing = buffer.trim();
		if (trailing) yield trailing;
	} finally {
		try { reader.releaseLock(); } catch { /* ignore */ }
	}
}

/** Legacy callback-style wrappers, kept for any callers not yet migrated. */
