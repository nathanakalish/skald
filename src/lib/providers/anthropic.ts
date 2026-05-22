import { LLMProvider, type ChatMessage, type SamplerSettings, type StreamChunk, type TestConnectionResult } from './base.js';
import { iterateSSE } from './streaming.js';

/**
 * Anthropic Claude via the Messages API.
 * Supports extended thinking when reasoningEffort isn't 'off'.
 */
export class AnthropicProvider extends LLMProvider {
	get type() {
		return 'anthropic';
	}

	private getThinkingBudget(effort: string, maxTokens: number): number {
		// Thinking budget must be >= 1024 per Anthropic. The total of
		// (budget + response) can't exceed the model output cap (64k for most
		// Claude models), so we clamp to whatever's left.
		const MODEL_OUTPUT_LIMIT = 64000;
		const cap = MODEL_OUTPUT_LIMIT - maxTokens;
		if (cap < 1024) return 0; // no headroom for thinking
		let budget: number;
		switch (effort) {
			case 'low': budget = Math.max(1024, maxTokens); break;
			case 'medium': budget = Math.max(1024, maxTokens * 4); break;
			case 'high': budget = Math.max(1024, maxTokens * 8); break;
			default: return 0;
		}
		return Math.min(budget, cap);
	}

	async *stream(
		messages: ChatMessage[],
		settings: SamplerSettings,
		signal?: AbortSignal
	): AsyncGenerator<StreamChunk, void, unknown> {
		const thinkingEnabled = settings.reasoningEffort && settings.reasoningEffort !== 'off';

		// Anthropic wants system messages in a top-level `system` param, not as
		// message roles. We collect leading system messages and concat them. Any
		// system messages mid-conversation (e.g. lorebook depth injection) get
		// converted to user messages so the model still sees them.
		const systemParts: string[] = [];
		let firstNonSystemIdx = messages.findIndex((m) => m.role !== 'system');
		if (firstNonSystemIdx === -1) firstNonSystemIdx = messages.length;

		for (let i = 0; i < firstNonSystemIdx; i++) {
			systemParts.push(messages[i].content);
		}

		const chatMessages: { role: string; content: string }[] = [];
		for (let i = firstNonSystemIdx; i < messages.length; i++) {
			const m = messages[i];
			if (m.role === 'system') {
				// mid-convo system → user
				chatMessages.push({ role: 'user', content: m.content });
			} else {
				chatMessages.push({ role: m.role, content: m.content });
			}
		}

		// Claude insists on strict user/assistant alternation. Merge adjacent same-role messages.
		const mergedMessages: { role: string; content: string }[] = [];
		for (const msg of chatMessages) {
			if (mergedMessages.length > 0 && mergedMessages[mergedMessages.length - 1].role === msg.role) {
				mergedMessages[mergedMessages.length - 1].content += '\n\n' + msg.content;
			} else {
				mergedMessages.push({ ...msg });
			}
		}

		// Anthropic refuses both temperature AND top_p at the same time. With
		// thinking enabled, temperature must be 1 and top_k is forbidden.
		const samplerParams: Record<string, unknown> = {};
		const thinkingBudget = thinkingEnabled
			? this.getThinkingBudget(settings.reasoningEffort, settings.maxTokens)
			: 0;

		if (thinkingEnabled) {
			// extended thinking: temp=1, no top_k
			samplerParams.max_tokens = settings.maxTokens + thinkingBudget;
		} else {
			samplerParams.max_tokens = settings.maxTokens;
			if (settings.topP < 1.0) {
				samplerParams.top_p = settings.topP;
			} else {
				samplerParams.temperature = settings.temperature;
			}
			if (settings.topK > 0) {
				samplerParams.top_k = settings.topK;
			}
		}

		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			'x-api-key': this.config.apiKey,
			'anthropic-version': '2023-06-01'
		};

		const body: Record<string, unknown> = {
			model: this.config.model,
			system: systemParts.join('\n\n'),
			messages: mergedMessages,
			stream: true,
			...samplerParams
		};

		if (thinkingEnabled) {
			headers['anthropic-beta'] = 'interleaved-thinking-2025-05-14';
			body.thinking = {
				type: 'enabled',
				budget_tokens: thinkingBudget
			};
		}

		await this.guardEndpoint();
		const response = await fetch(`${this.config.endpoint}/messages`, {
			method: 'POST',
			headers,
			body: JSON.stringify(body),
			signal
		});

		if (!response.ok) {
			await this.throwGeneric(response, 'Anthropic');
		}
		if (!response.body) throw new Error('No response body');

		// Anthropic doesn't send a [DONE] sentinel — pass null and rely on the
		// `message_stop` event below to terminate.
		for await (const data of iterateSSE(response.body, null)) {
			try {
				const parsed = JSON.parse(data);
				if (parsed.type === 'content_block_delta') {
					if (parsed.delta?.type === 'thinking_delta') {
						const text = parsed.delta.thinking;
						if (text) yield { type: 'reasoning', text };
					} else {
						const text = parsed.delta?.text;
						if (text) yield { type: 'content', text };
					}
				} else if (parsed.type === 'message_stop') {
					return;
				}
			} catch {
				// skip malformed lines
			}
		}
	}

	async listModels(): Promise<string[]> {
		// Anthropic's /models endpoint was added in 2024+ — fall back to a hardcoded
		// list when the upstream is unavailable or returns an empty payload.
		return this.listModelsViaDataArray({
			headers: { 'x-api-key': this.config.apiKey, 'anthropic-version': '2023-06-01' },
			fallback: [
				'claude-sonnet-4-20250514',
				'claude-3-5-haiku-20241022',
				'claude-3-5-sonnet-20241022',
				'claude-3-opus-20240229'
			],
		});
	}

	async testConnection(): Promise<TestConnectionResult> {
		const t0 = Date.now();
		try {
			await this.guardEndpoint();
			// Hit /models to validate the API key without burning tokens.
			const response = await fetch(`${this.config.endpoint}/models`, {
				headers: {
					'x-api-key': this.config.apiKey,
					'anthropic-version': '2023-06-01'
				}
			});
			if (response.ok) {
				let modelCount: number | undefined;
				try {
					const data = await response.json();
					if (Array.isArray(data?.data)) modelCount = data.data.length;
				} catch { /* shape may vary across versions; latency still useful */ }
				return { ok: true, latencyMs: Date.now() - t0, modelCount };
			}

			// Fallback: tiniest possible message request.
			const msgResponse = await fetch(`${this.config.endpoint}/messages`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-api-key': this.config.apiKey,
					'anthropic-version': '2023-06-01'
				},
				body: JSON.stringify({
					model: this.config.model || 'claude-sonnet-4-20250514',
					messages: [{ role: 'user', content: 'Hi' }],
					max_tokens: 1
				})
			});
			return { ok: msgResponse.ok, latencyMs: Date.now() - t0 };
		} catch (err) {
			return { ok: false, latencyMs: Date.now() - t0, error: err instanceof Error ? err.message : String(err) };
		}
	}
}
