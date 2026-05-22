// ComfyUI is image-only. It has no text streaming or chat-completion
// surface, so this stub exists purely to satisfy the LLMProvider factory
// (every profile in profiles.ts must have a constructor). The real
// image-generation logic lives in src/lib/providers/images.ts; the methods
// here either no-op (for things that don't make sense like listing text
// models) or throw to fail loud if someone wires ComfyUI into the text
// pipeline by mistake.

import { LLMProvider, type ChatMessage, type SamplerSettings, type StreamChunk, type TestConnectionResult } from './base.js';

export class ComfyUIProvider extends LLMProvider {
	get type() {
		return 'comfyui';
	}

	async *stream(
		_messages: ChatMessage[],
		_samplerSettings: SamplerSettings,
		_signal?: AbortSignal
	): AsyncGenerator<StreamChunk, void, unknown> {
		throw new Error('ComfyUI does not support text generation');
		// Unreachable, but required to satisfy the async generator return type.
		yield { type: 'content', text: '' };
	}

	// No text models to list — the "model" in ComfyUI is the workflow JSON
	// configured on the provider row, not anything the server can enumerate.
	async listModels(): Promise<string[]> {
		return [];
	}

	async testConnection(): Promise<TestConnectionResult> {
		try {
			await this.guardEndpoint();
			const res = await fetch(`${this.config.endpoint.replace(/\/$/, '')}/system_stats`, {
				method: 'GET'
			});
			if (!res.ok) {
				return { ok: false, error: `ComfyUI returned HTTP ${res.status}` };
			}
			return { ok: true };
		} catch (err) {
			return { ok: false, error: err instanceof Error ? err.message : 'Connection failed' };
		}
	}
}
