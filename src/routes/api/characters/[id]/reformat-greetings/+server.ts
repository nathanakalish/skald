import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { characters, providers, userSettings } from '$lib/db/schema.js';
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
	const id = Number(event.params.id);

	const character = db.select().from(characters).where(and(eq(characters.id, id), eq(characters.userId, user.id))).get();
	if (!character) {
		return json({ error: 'Character not found' }, { status: 404 });
	}

	// Read user's reformatter settings
	const settingProviderId = getUserSetting(user.id, 'reformatterProviderId');
	const settingModel = getUserSetting(user.id, 'reformatterModel');
	const settingPrompt = getUserSetting(user.id, 'reformatterPrompt');

	// Resolve provider: setting > enabled default
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

	// Collect all greetings to reformat
	const greetings: { index: number; original: string }[] = [];

	if (character.firstMessage?.trim()) {
		greetings.push({ index: -1, original: character.firstMessage });
	}

	let altGreetings: string[] = [];
	try {
		altGreetings = JSON.parse(character.alternateGreetings || '[]');
	} catch {
		altGreetings = [];
	}

	for (let i = 0; i < altGreetings.length; i++) {
		if (altGreetings[i]?.trim()) {
			greetings.push({ index: i, original: altGreetings[i] });
		}
	}

	if (greetings.length === 0) {
		return json({ error: 'No greetings to reformat' }, { status: 400 });
	}

	// Reformat each greeting
	const results: { index: number; original: string; reformatted: string }[] = [];
	const t0 = Date.now();
	event.locals.logger?.debug('characters: reformat-greetings start', { characterId: id, providerId: provider.id, model: activeModel, count: greetings.length });

	for (const greeting of greetings) {
		const messages: ChatMessage[] = [
			{ role: 'system', content: prompt },
			{ role: 'user', content: greeting.original },
		];

		let fullResponse = '';
		let contentStarted = false;
		try {
			for await (const chunk of llm.stream(messages, samplerSettings)) {
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

			results.push({
				index: greeting.index,
				original: greeting.original,
				reformatted: fullResponse.trimEnd(),
			});
		} catch (err) {
			const durationMs = Date.now() - t0;
			const msg = err instanceof Error ? err.message : 'Unknown error';
			event.locals.logger?.warn('characters: reformat-greetings failed', { characterId: id, greetingIndex: greeting.index, durationMs, err: msg });
			return json({
				error: `Failed to reformat greeting ${greeting.index === -1 ? 'first message' : `alt #${greeting.index + 1}`}: ${msg}`
			}, { status: 500 });
		}
	}

	event.locals.logger?.info('characters: reformat-greetings complete', { characterId: id, count: results.length, durationMs: Date.now() - t0 });
	return json({ results });
};
