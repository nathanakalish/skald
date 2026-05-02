import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { presets } from '$lib/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth.js';

export const GET: RequestHandler = async (event) => {
	const user = requireUser(event);
	const preset = db.select().from(presets).where(and(eq(presets.userId, user.id), eq(presets.isDefault, true))).get();
	return json(preset ?? null);
};

export const PUT: RequestHandler = async (event) => {
	const user = requireUser(event);
	const body = await event.request.json();

	const preset = db.select().from(presets).where(and(eq(presets.userId, user.id), eq(presets.isDefault, true))).get();
	if (!preset) {
		return json({ error: 'No default preset found' }, { status: 404 });
	}

	db.update(presets)
		.set({
			temperature: body.temperature ?? preset.temperature,
			topP: body.topP ?? preset.topP,
			topK: body.topK ?? preset.topK,
			maxTokens: body.maxTokens ?? preset.maxTokens,
			contextSize: body.contextSize ?? preset.contextSize,
			repetitionPenalty: body.repetitionPenalty ?? preset.repetitionPenalty,
			frequencyPenalty: body.frequencyPenalty ?? preset.frequencyPenalty,
			presencePenalty: body.presencePenalty ?? preset.presencePenalty,
			storyContextMessages: body.storyContextMessages ?? preset.storyContextMessages,
			textingContextMessages: body.textingContextMessages ?? preset.textingContextMessages,
			customPrompt: body.customPrompt ?? preset.customPrompt,
			lorebookDepth: body.lorebookDepth ?? preset.lorebookDepth,
			streamingEnabled: body.streamingEnabled ?? preset.streamingEnabled,
			includeReasoning: body.includeReasoning ?? preset.includeReasoning,
			reasoningEffort: body.reasoningEffort ?? preset.reasoningEffort,
			textingTypingSpeed: body.textingTypingSpeed ?? preset.textingTypingSpeed,
			textingTypingMax: body.textingTypingMax ?? preset.textingTypingMax,
			textingInitialDelay: body.textingInitialDelay ?? preset.textingInitialDelay
		})
		.where(eq(presets.id, preset.id))
		.run();

	const updated = db.select().from(presets).where(eq(presets.id, preset.id)).get();
	return json(updated);
};
