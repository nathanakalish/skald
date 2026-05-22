import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { messages, chats, providers, userSettings } from '$lib/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { createProvider, type ProviderType } from '$lib/providers/index.js';
import { requireUser } from '$lib/server/auth.js';
import type { ChatMessage, SamplerSettings } from '$lib/providers/base.js';
import { ApiError } from '$lib/server/apiError.js';

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
	const id = Number(event.params.id);

	const message = db.select({
		id: messages.id,
		content: messages.content,
		chatUserId: chats.userId,
	})
		.from(messages)
		.innerJoin(chats, eq(messages.chatId, chats.id))
		.where(eq(messages.id, id))
		.get();
	if (!message || message.chatUserId !== user.id) {
		return ApiError.notFound('Message not found');
	}

	if (!message.content?.trim()) {
		return ApiError.badRequest('Message has no content to reformat');
	}

	// Read user's reformatter settings
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
		return ApiError.badRequest('No provider available. Configure one in Settings > Providers.');
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

	const llmMessages: ChatMessage[] = [
		{ role: 'system', content: prompt },
		{ role: 'user', content: message.content },
	];

	let fullResponse = '';
	let contentStarted = false;
	const t0 = Date.now();
	event.locals.logger?.debug('messages: reformat start', { messageId: id, providerId: provider.id, model: activeModel });
	try {
		for await (const chunk of llm.stream(llmMessages, samplerSettings)) {
			if (chunk.type === 'content') {
				let text = chunk.text;
				if (!contentStarted) {
					text = text.trimStart();
					if (!text) continue;
					contentStarted = true;
				}
				fullResponse += text;
			}
		}

		event.locals.logger?.debug('messages: reformat complete', { messageId: id, chars: fullResponse.length, durationMs: Date.now() - t0 });
		return json({
			original: message.content,
			reformatted: fullResponse.trimEnd(),
		});
	} catch (err) {
		event.locals.logger?.warn('messages: reformat failed', { messageId: id, durationMs: Date.now() - t0, err: String(err) });
		return ApiError.server(`Failed to reformat: ${err instanceof Error ? err.message : 'Unknown error'}`);
	}
};
