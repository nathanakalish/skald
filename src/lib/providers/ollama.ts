import { LLMProvider, type ChatMessage, type SamplerSettings, type StreamChunk, type TestConnectionResult } from './base.js';
import { iterateNDJSON } from './streaming.js';

/**
 * Ollama provider for local models.
 */
export class OllamaProvider extends LLMProvider {
	get type() {
		return 'ollama';
	}

	async *stream(
		messages: ChatMessage[],
		settings: SamplerSettings,
		signal?: AbortSignal
	): AsyncGenerator<StreamChunk, void, unknown> {
		await this.guardEndpoint();
		const response = await fetch(`${this.config.endpoint}/api/chat`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model: this.config.model,
				messages,
				stream: true,
				options: {
					temperature: settings.temperature,
					top_p: settings.topP,
					top_k: settings.topK > 0 ? settings.topK : undefined,
					num_predict: settings.maxTokens,
					repeat_penalty: settings.repetitionPenalty
				}
			}),
			signal
		});

		if (!response.ok) {
			await this.throwGeneric(response, 'Ollama');
		}
		if (!response.body) throw new Error('No response body');

		for await (const line of iterateNDJSON(response.body)) {
			try {
				const parsed = JSON.parse(line);
				if (parsed.message?.content) {
					yield { type: 'content', text: parsed.message.content };
				}
				if (parsed.done) return;
			} catch {
				// skip malformed lines
			}
		}
	}

	async listModels(): Promise<string[]> {
		try {
			await this.guardEndpoint();
			const response = await fetch(`${this.config.endpoint}/api/tags`);
			if (!response.ok) return [];
			const data = await response.json();
			return (data.models || []).map((m: { name: string }) => m.name).sort();
		} catch {
			return [];
		}
	}

	async testConnection(): Promise<TestConnectionResult> {
		const t0 = Date.now();
		try {
			await this.guardEndpoint();
			const response = await fetch(`${this.config.endpoint}/api/tags`);
			if (!response.ok) {
				return { ok: false, latencyMs: Date.now() - t0, error: `HTTP ${response.status}` };
			}
			let modelCount: number | undefined;
			try {
				const data = await response.json();
				if (Array.isArray(data?.models)) modelCount = data.models.length;
			} catch { /* tags shape changes across ollama versions */ }
			return { ok: true, latencyMs: Date.now() - t0, modelCount };
		} catch (err) {
			return { ok: false, latencyMs: Date.now() - t0, error: err instanceof Error ? err.message : String(err) };
		}
	}
}
