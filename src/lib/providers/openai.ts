import { LLMProvider, type ChatMessage, type SamplerSettings, type StreamChunk, type TestConnectionResult } from './base.js';
import { iterateSSE } from './streaming.js';

/**
 * OpenAI Chat Completions–compatible provider. Works with OpenAI, OpenRouter,
 * and any endpoint implementing the Chat Completions streaming API.
 *
 * Subclasses (Gemini, Z.AI) override only `providerName` and `buildRequestBody`
 * — the SSE parsing loop is shared.
 */
export class OpenAIProvider extends LLMProvider {
	get type() {
		return 'openai';
	}

	protected get providerName(): string {
		return 'OpenAI';
	}

	/** Build the request body sent to /chat/completions. Override to tweak per-vendor. */
	protected buildRequestBody(messages: ChatMessage[], settings: SamplerSettings): Record<string, unknown> {
		const body: Record<string, unknown> = {
			model: this.config.model,
			messages,
			stream: true,
			temperature: settings.temperature,
			top_p: settings.topP,
			max_tokens: settings.maxTokens,
			frequency_penalty: settings.frequencyPenalty,
			presence_penalty: settings.presencePenalty
		};
		if (settings.reasoningEffort && settings.reasoningEffort !== 'off') {
			body.reasoning_effort = settings.reasoningEffort;
		}
		return body;
	}

	async *stream(
		messages: ChatMessage[],
		settings: SamplerSettings,
		signal?: AbortSignal
	): AsyncGenerator<StreamChunk, void, unknown> {
		await this.guardEndpoint();
		const response = await fetch(`${this.config.endpoint}/chat/completions`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${this.config.apiKey}`
			},
			body: JSON.stringify(this.buildRequestBody(messages, settings)),
			signal
		});

		if (!response.ok) {
			await this.throwGeneric(response, this.providerName);
		}
		if (!response.body) throw new Error('No response body');

		for await (const data of iterateSSE(response.body)) {
			try {
				const parsed = JSON.parse(data);
				const delta = parsed.choices?.[0]?.delta;
				if (delta?.reasoning_content) {
					yield { type: 'reasoning', text: delta.reasoning_content };
				}
				if (delta?.content) {
					yield { type: 'content', text: delta.content };
				}
			} catch {
				// skip malformed JSON lines
			}
		}
	}

	async listModels(): Promise<string[]> {
		return this.listModelsViaDataArray({
			headers: { Authorization: `Bearer ${this.config.apiKey}` },
			fallback: [],
		});
	}

	async testConnection(): Promise<TestConnectionResult> {
		const t0 = Date.now();
		try {
			const models = await this.listModels();
			return {
				ok: models.length > 0,
				latencyMs: Date.now() - t0,
				modelCount: models.length,
			};
		} catch (err) {
			return { ok: false, latencyMs: Date.now() - t0, error: err instanceof Error ? err.message : String(err) };
		}
	}
}
