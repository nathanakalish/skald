import { OpenAIProvider } from './openai.js';
import type { ChatMessage, SamplerSettings } from './base.js';

/**
 * Z.AI (Zhipu) provider. OpenAI-compatible streaming with z.ai's
 * `thinking: { type: 'enabled' | 'disabled' }` toggle in place of `reasoning_effort`.
 */
export class ZaiProvider extends OpenAIProvider {
	get type() {
		return 'zai';
	}

	protected get providerName(): string {
		return 'Z.AI';
	}

	protected buildRequestBody(messages: ChatMessage[], settings: SamplerSettings): Record<string, unknown> {
		const thinkingEnabled = settings.reasoningEffort && settings.reasoningEffort !== 'off';

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

		if (thinkingEnabled) {
			body.thinking = { type: 'enabled' };
		}

		return body;
	}
}
