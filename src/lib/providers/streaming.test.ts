import { describe, it, expect } from 'vitest';
import { iterateSSE, iterateNDJSON } from './streaming.js';

function streamFrom(chunks: string[]): ReadableStream<Uint8Array> {
	const enc = new TextEncoder();
	let i = 0;
	return new ReadableStream<Uint8Array>({
		pull(controller) {
			if (i >= chunks.length) {
				controller.close();
				return;
			}
			controller.enqueue(enc.encode(chunks[i++]));
		}
	});
}

async function collect<T>(it: AsyncGenerator<T>): Promise<T[]> {
	const out: T[] = [];
	for await (const v of it) out.push(v);
	return out;
}

describe('iterateSSE', () => {
	it('parses well-formed SSE lines', async () => {
		const stream = streamFrom([
			'data: {"a":1}\n',
			'data: {"a":2}\n',
			'data: [DONE]\n'
		]);
		const out = await collect(iterateSSE(stream));
		expect(out).toEqual(['{"a":1}', '{"a":2}']);
	});

	it('handles chunks split mid-line', async () => {
		const stream = streamFrom([
			'data: {"a":',
			'1}\ndata: {"b":2}\n'
		]);
		const out = await collect(iterateSSE(stream));
		expect(out).toEqual(['{"a":1}', '{"b":2}']);
	});

	it('skips blank lines and non-data prefixes (event:, id:)', async () => {
		const stream = streamFrom([
			'event: ping\n\n',
			'id: 42\n',
			'data: {"x":true}\n',
			'\n'
		]);
		const out = await collect(iterateSSE(stream));
		expect(out).toEqual(['{"x":true}']);
	});

	it('terminates early on [DONE]', async () => {
		const stream = streamFrom([
			'data: {"a":1}\n',
			'data: [DONE]\n',
			'data: {"a":2}\n'
		]);
		const out = await collect(iterateSSE(stream));
		expect(out).toEqual(['{"a":1}']);
	});

	it('respects null doneSentinel (Anthropic style)', async () => {
		const stream = streamFrom([
			'data: {"a":1}\n',
			'data: [DONE]\n',
			'data: {"a":2}\n'
		]);
		const out = await collect(iterateSSE(stream, null));
		expect(out).toEqual(['{"a":1}', '[DONE]', '{"a":2}']);
	});
});

describe('iterateNDJSON', () => {
	it('yields each non-empty line', async () => {
		const stream = streamFrom([
			'{"a":1}\n{"a":2}\n',
			'{"a":3}\n'
		]);
		const out = await collect(iterateNDJSON(stream));
		expect(out).toEqual(['{"a":1}', '{"a":2}', '{"a":3}']);
	});

	it('handles split chunks', async () => {
		const stream = streamFrom([
			'{"a":',
			'1}\n{"a":2}',
			'\n'
		]);
		const out = await collect(iterateNDJSON(stream));
		expect(out).toEqual(['{"a":1}', '{"a":2}']);
	});

	it('drops blank lines', async () => {
		const stream = streamFrom([
			'{"a":1}\n\n\n{"a":2}\n'
		]);
		const out = await collect(iterateNDJSON(stream));
		expect(out).toEqual(['{"a":1}', '{"a":2}']);
	});
});
