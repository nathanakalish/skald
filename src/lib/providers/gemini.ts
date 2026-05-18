import { OpenAIProvider } from './openai.js';
import type { ChatMessage, SamplerSettings } from './base.js';

/**
 * Google Gemini provider. Uses the OpenAI-compatible endpoint with a
 * `thinking` request field instead of `reasoning_effort`.
 */
export class GeminiProvider extends OpenAIProvider {
	get type() {
		return 'gemini';
	}

	protected get providerName(): string {
		return 'Gemini';
	}

	protected buildRequestBody(messages: ChatMessage[], settings: SamplerSettings): Record<string, unknown> {
		const thinkingEnabled = settings.reasoningEffort && settings.reasoningEffort !== 'off';

		const body: Record<string, unknown> = {
			model: this.config.model,
			messages,
			stream: true,
			// Gemini ignores temperature when thinking is on
			temperature: thinkingEnabled ? undefined : settings.temperature,
			top_p: settings.topP,
			max_tokens: settings.maxTokens
		};

		if (thinkingEnabled) {
			const budgetMap: Record<string, number> = {
				low: Math.max(1024, settings.maxTokens),
				medium: Math.max(1024, settings.maxTokens * 4),
				high: Math.max(1024, settings.maxTokens * 8)
			};
			body.thinking = {
				type: 'enabled',
				budget_tokens: budgetMap[settings.reasoningEffort] ?? settings.maxTokens * 4
			};
		}

		return body;
	}

	async listModels(): Promise<string[]> {
		// Without this guard the Gemini-specific override bypasses SSRF
		// validation that the inherited OpenAI implementation does.
		await this.guardEndpoint();
		const response = await fetch(`${this.config.endpoint}/models`, {
			headers: {
				Authorization: `Bearer ${this.config.apiKey}`
			}
		});

		if (!response.ok) return this.fallbackModels();

		try {
			const data = await response.json();
			const models = (data.data || []).map((m: { id: string }) => m.id).sort();
			return models.length > 0 ? models : this.fallbackModels();
		} catch {
			return this.fallbackModels();
		}
	}

	private fallbackModels(): string[] {
		return [
			'gemini-2.5-flash',
			'gemini-2.5-pro',
			'gemini-2.0-flash',
			'gemini-2.0-flash-lite'
		];
	}
}
