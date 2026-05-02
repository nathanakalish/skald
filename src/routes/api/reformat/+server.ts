import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { providers, userSettings } from '$lib/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { createProvider, type ProviderType } from '$lib/providers/index.js';
import { requireUser } from '$lib/server/auth.js';
import type { ChatMessage, SamplerSettings } from '$lib/providers/base.js';

const DEFAULT_SYSTEM_PROMPT = `You are a text formatter. Your job is to reformat roleplay character greetings to use consistent formatting conventions.

Rules:
- Narration/actions should be written in plain text (no special formatting)
- Dialogue/speech should be enclosed in "double quotes"
- Internal thoughts should be wrapped in *single asterisks*
- Preserve the content, meaning, and tone exactly — only change the formatting
- Do not add or remove content
- Do not add any commentary, explanation, or notes
- Output ONLY the reformatted text, nothing else`;

function getUserSetting(userId: number, key: string): string | undefined {
	const row = db.select().from(userSettings)
		.where(and(eq(userSettings.userId, userId), eq(userSettings.key, key)))
		.get();
	return row?.value ?? undefined;
}

export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);

	const { text } = await event.request.json();
	if (!text?.trim()) {
		return json({ error: 'No text provided' }, { status: 400 });
	}

	const settingProviderId = getUserSetting(user.id, 'reformatterProviderId');
	const settingModel = getUserSetting(user.id, 'reformatterModel');
	const settingPrompt = getUserSetting(user.id, 'reformatterPrompt');

	let provider;
	if (settingProviderId) {
		provider = db.select().from(providers)
			.where(and(eq(providers.id, Number(settingProviderId)), eq(providers.userId, user.id)))
			.get();
	}
	if (!provider) {
		provider = db.select().from(providers)
			.where(and(eq(providers.userId, user.id), eq(providers.enabled, true)))
			.get();
	}

	if (!provider) {
		return json({ error: 'No provider available. Configure one in Settings > Providers.' }, { status: 400 });
	}

	const activeModel = settingModel || provider.defaultModel || '';
	const prompt = settingPrompt || DEFAULT_SYSTEM_PROMPT;

	const llm = createProvider(provider.type as ProviderType, {
		endpoint: provider.endpoint,
		apiKey: provider.apiKey || '',
		model: activeModel,
	});

	const samplerSettings: SamplerSettings = {
		temperature: 0.3,
		topP: 1.0,
		topK: 0,
		maxTokens: provider.maxTokens ?? 4096,
		repetitionPenalty: 1.0,
		frequencyPenalty: 0.0,
		presencePenalty: 0.0,
		reasoningEffort: 'off',
	};

	const messages: ChatMessage[] = [
		{ role: 'system', content: prompt },
		{ role: 'user', content: text },
	];

	let fullResponse = '';
	let contentStarted = false;
	try {
		for await (const chunk of llm.stream(messages, samplerSettings)) {
			if (chunk.type === 'content') {
				let t = chunk.text;
				if (!contentStarted) {
					t = t.trimStart();
					if (!t) continue;
					contentStarted = true;
				}
				fullResponse += t;
			}
		}
	} catch (err) {
		return json({
			error: `Failed to reformat: ${err instanceof Error ? err.message : 'Unknown error'}`
		}, { status: 500 });
	}

	return json({ reformatted: fullResponse.trimEnd() });
};
