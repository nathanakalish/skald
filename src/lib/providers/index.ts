import type { LLMProvider, ProviderConfig } from './base.js';
import { OpenAIProvider } from './openai.js';
import { AnthropicProvider } from './anthropic.js';
import { OllamaProvider } from './ollama.js';
import { ZaiProvider } from './zai.js';
import { GeminiProvider } from './gemini.js';
import { providerProfiles, type ProviderType } from './profiles.js';

export type { ProviderType } from './profiles.js';

// OpenAI-compatible providers that don't need a request-body override —
// they only differ from the base OpenAIProvider by their `type` ID and the
// human-readable name in error messages.
const openAICompatible: Record<string, string> = {
	openai: 'OpenAI',
	deepseek: 'DeepSeek',
	openrouter: 'OpenRouter',
	xai: 'xAI',
	mistral: 'Mistral',
	groq: 'Groq',
	together: 'Together',
	fireworks: 'Fireworks',
	perplexity: 'Perplexity',
	cerebras: 'Cerebras',
	cohere: 'Cohere'
};

function makeOpenAICompatible(typeId: string, displayName: string): new (config: ProviderConfig) => LLMProvider {
	return class extends OpenAIProvider {
		get type() {
			return typeId;
		}
		protected get providerName(): string {
			return displayName;
		}
	};
}

const constructors: Record<string, new (config: ProviderConfig) => LLMProvider> = {
	anthropic: AnthropicProvider,
	ollama: OllamaProvider,
	zai: ZaiProvider,
	gemini: GeminiProvider,
	...Object.fromEntries(
		Object.entries(openAICompatible).map(([id, name]) => [id, makeOpenAICompatible(id, name)])
	)
};

// Sanity check at module load so a registry/factory mismatch fails loud.
for (const profile of providerProfiles) {
	if (!constructors[profile.id]) {
		throw new Error(`Provider profile "${profile.id}" has no constructor registered`);
	}
}

export function createProvider(type: ProviderType | string, config: ProviderConfig): LLMProvider {
	const Ctor = constructors[type];
	if (!Ctor) throw new Error(`Unknown provider type: ${type}`);
	return new Ctor(config);
}

