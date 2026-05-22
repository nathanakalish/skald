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
		// Start from the standard OpenAI body, then strip fields Gemini's
		// compat endpoint doesn't accept and swap in its `thinking` shape.
		const body = super.buildRequestBody(messages, settings);
		delete body.frequency_penalty;
		delete body.presence_penalty;
		delete body.reasoning_effort;

		const thinkingEnabled = settings.reasoningEffort && settings.reasoningEffort !== 'off';
		if (thinkingEnabled) {
			// Gemini ignores temperature once thinking is on, so don't bother sending it.
			body.temperature = undefined;
			const budgetMap: Record<string, number> = {
				low: Math.max(1024, settings.maxTokens),
				medium: Math.max(1024, settings.maxTokens * 4),
				high: Math.max(1024, settings.maxTokens * 8)
			};
			body.thinking = {
				type: 'enabled',
				budget_tokens: budgetMap[settings.reasoningEffort!] ?? settings.maxTokens * 4
			};
		}

		return body;
	}

	async listModels(): Promise<string[]> {
		return this.listModelsViaDataArray({
			headers: { Authorization: `Bearer ${this.config.apiKey}` },
			fallback: [
				'gemini-2.5-flash',
				'gemini-2.5-pro',
				'gemini-2.0-flash',
				'gemini-2.0-flash-lite'
			],
		});
	}
}
