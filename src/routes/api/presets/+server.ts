import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { presets } from '$lib/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth.js';

// CRUD-M6: bound generation params at write time so providers don't reject
// with confusing errors later. Each entry is [min, max]; omit a bound with
// null/undefined. Ranges follow the loosest sane provider envelope — the
// stricter per-provider check still happens at request time.
const NUMERIC_BOUNDS: Record<string, [number | null, number | null]> = {
	temperature: [0, 2],
	topP: [0, 1],
	topK: [0, 1000],
	maxTokens: [1, 1_000_000],
	contextSize: [128, 10_000_000],
	repetitionPenalty: [0, 5],
	frequencyPenalty: [-2, 2],
	presencePenalty: [-2, 2],
	storyContextMessages: [0, 100_000],
	textingContextMessages: [0, 100_000],
	lorebookDepth: [0, 1000],
	textingTypingSpeed: [0, 10_000],
	textingTypingMax: [0, 600_000],
	textingInitialDelay: [0, 600_000],
};

function validateNumeric(body: Record<string, unknown>): string | null {
	for (const [key, [min, max]] of Object.entries(NUMERIC_BOUNDS)) {
		if (!(key in body) || body[key] == null) continue;
		const v = body[key];
		if (typeof v !== 'number' || !Number.isFinite(v)) {
			return `${key} must be a finite number`;
		}
		if (min !== null && v < min) return `${key} must be ≥ ${min}`;
		if (max !== null && v > max) return `${key} must be ≤ ${max}`;
	}
	return null;
}

export const GET: RequestHandler = async (event) => {
	const user = requireUser(event);
	const preset = db.select().from(presets).where(and(eq(presets.userId, user.id), eq(presets.isDefault, true))).get();
	return json(preset ?? null);
};

export const PUT: RequestHandler = async (event) => {
	const user = requireUser(event);
	const body = await event.request.json();

	const err = validateNumeric(body);
	if (err) return json({ error: err }, { status: 400 });

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
