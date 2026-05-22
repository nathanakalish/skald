// Central registry of supported provider profiles. Adding a new entry here
// surfaces it in the UI selector, the `createProvider` factory, the
// `ProviderType` union, and default-endpoint logic in one shot.

// `imageGeneration` flags which image API shape (if any) a provider speaks.
// 'openai' covers /v1/images/generations style. 'gemini' uses the Google
// native generateContent/predict format. 'comfyui' is workflow-based.
// 'none' means the provider has no image-gen endpoint at all and the UI
// should disable / grey out the image-model dropdown.
export type ImageGenCapability = 'openai' | 'gemini' | 'comfyui' | 'none';

export interface ProviderProfile {
	id: string;
	label: string;
	endpoint: string;
	keyPlaceholder: string;
	description?: string;
	imageGeneration?: ImageGenCapability;
}

export const providerProfiles = [
	{
		id: 'openai',
		label: 'OpenAI',
		endpoint: 'https://api.openai.com/v1',
		keyPlaceholder: 'sk-...',
		description: 'Works with OpenAI, OpenRouter, and any compatible endpoint',
		imageGeneration: 'openai'
	},
	{
		id: 'anthropic',
		label: 'Anthropic',
		endpoint: 'https://api.anthropic.com/v1',
		keyPlaceholder: 'sk-ant-...',
		description: 'Anthropic Claude — Opus, Sonnet, Haiku',
		imageGeneration: 'none'
	},
	{
		id: 'gemini',
		label: 'Gemini',
		endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
		keyPlaceholder: 'AIza...',
		description: 'Google Gemini — Gemini 2.5 Flash, Gemini 2.5 Pro, and other models',
		imageGeneration: 'gemini'
	},
	{
		id: 'deepseek',
		label: 'DeepSeek',
		endpoint: 'https://api.deepseek.com/v1',
		keyPlaceholder: 'sk-...',
		description: 'DeepSeek — V3 chat and R1 reasoning models',
		imageGeneration: 'none'
	},
	{
		id: 'openrouter',
		label: 'OpenRouter',
		endpoint: 'https://openrouter.ai/api/v1',
		keyPlaceholder: 'sk-or-...',
		description: 'OpenRouter — unified gateway to dozens of models',
		imageGeneration: 'openai'
	},
	{
		id: 'xai',
		label: 'xAI',
		endpoint: 'https://api.x.ai/v1',
		keyPlaceholder: 'xai-...',
		description: 'xAI Grok models',
		imageGeneration: 'openai'
	},
	{
		id: 'mistral',
		label: 'Mistral',
		endpoint: 'https://api.mistral.ai/v1',
		keyPlaceholder: 'API key',
		description: 'Mistral — Large, Medium, Small, and open models',
		imageGeneration: 'none'
	},
	{
		id: 'groq',
		label: 'Groq',
		endpoint: 'https://api.groq.com/openai/v1',
		keyPlaceholder: 'gsk_...',
		description: 'Groq — fast inference on Llama, Mixtral, and other open models',
		imageGeneration: 'none'
	},
	{
		id: 'together',
		label: 'Together',
		endpoint: 'https://api.together.xyz/v1',
		keyPlaceholder: 'API key',
		description: 'Together AI — open-weight model hosting',
		imageGeneration: 'openai'
	},
	{
		id: 'fireworks',
		label: 'Fireworks',
		endpoint: 'https://api.fireworks.ai/inference/v1',
		keyPlaceholder: 'fw_...',
		description: 'Fireworks AI — open-weight model hosting',
		imageGeneration: 'openai'
	},
	{
		id: 'perplexity',
		label: 'Perplexity',
		endpoint: 'https://api.perplexity.ai',
		keyPlaceholder: 'pplx-...',
		description: 'Perplexity — Sonar models with built-in web search',
		imageGeneration: 'none'
	},
	{
		id: 'cerebras',
		label: 'Cerebras',
		endpoint: 'https://api.cerebras.ai/v1',
		keyPlaceholder: 'csk-...',
		description: 'Cerebras — ultra-fast inference on Llama models',
		imageGeneration: 'none'
	},
	{
		id: 'cohere',
		label: 'Cohere',
		endpoint: 'https://api.cohere.ai/compatibility/v1',
		keyPlaceholder: 'API key',
		description: 'Cohere Command models (OpenAI-compatible endpoint)',
		imageGeneration: 'none'
	},
	{
		id: 'zai',
		label: 'Z.AI',
		endpoint: 'https://api.z.ai/api/paas/v4',
		keyPlaceholder: 'zai-...',
		description: 'Z.AI (Zhipu) — GLM-5, GLM-4.6V, and other models',
		imageGeneration: 'openai'
	},
	{
		id: 'ollama',
		label: 'Ollama',
		endpoint: 'http://localhost:11434',
		keyPlaceholder: 'Not required',
		description: 'Local models via Ollama',
		imageGeneration: 'none'
	},
	{
		id: 'comfyui',
		label: 'ComfyUI',
		endpoint: 'http://localhost:8188',
		keyPlaceholder: 'Not required',
		description: 'Local ComfyUI image generation — supply a workflow JSON and prompt-node id',
		imageGeneration: 'comfyui'
	}
] as const satisfies readonly ProviderProfile[];

export type ProviderType = (typeof providerProfiles)[number]['id'];

const profileMap: Record<string, ProviderProfile> = Object.fromEntries(
	providerProfiles.map((p) => [p.id, p])
);

export function getProfile(id: string): ProviderProfile | undefined {
	return profileMap[id];
}

export const defaultEndpoints: Record<string, string> = Object.fromEntries(
	providerProfiles.map((p) => [p.id, p.endpoint])
);
