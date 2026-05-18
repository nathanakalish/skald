/**
 * Shared SSE / NDJSON streaming utilities for LLM provider implementations.
 *
 * Every provider does the same buffer-and-split-on-newlines dance, varying
 * only in (a) whether each line is prefixed with `data: ` (OpenAI-style SSE)
 * or raw JSON (Ollama-style NDJSON), and (b) what JSON shape signals
 * "stream complete".
 */

export type LineHandler = (jsonText: string) => boolean | void;

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
						console.warn(
							`[sse] ${badLines} non-SSE lines from provider stream; ` +
							`first offending line: ${trimmed.slice(0, 120)}`
						);
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
	} finally {
		try { reader.releaseLock(); } catch { /* ignore */ }
	}
}

/** Legacy callback-style wrappers, kept for any callers not yet migrated. */
export async function readSSEStream(
	body: ReadableStream<Uint8Array>,
	onLine: LineHandler,
	doneSentinel: string | null = '[DONE]'
): Promise<void> {
	for await (const data of iterateSSE(body, doneSentinel)) {
		const stop = onLine(data);
		if (stop === true) return;
	}
}

export async function readNDJSONStream(
	body: ReadableStream<Uint8Array>,
	onLine: LineHandler
): Promise<void> {
	for await (const line of iterateNDJSON(body)) {
		const stop = onLine(line);
		if (stop === true) return;
	}
}
