import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { providers, userSettings } from '$lib/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { createProvider, type ProviderType } from '$lib/providers/index.js';
import { requireUser } from '$lib/server/auth.js';
import type { ChatMessage, SamplerSettings } from '$lib/providers/base.js';
import { ApiError } from '$lib/server/apiError.js';

const FIELD_KEYS = ['name', 'description', 'personality', 'scenario', 'firstMessage', 'systemPrompt', 'tags'] as const;
type FieldKey = typeof FIELD_KEYS[number];

const DEFAULT_SYSTEM_PROMPT = `You are a character creator assistant for a roleplay app. The user is building or editing a character. They will give you the character's current field values and a request.

OUTPUT FORMAT — THIS IS NON-NEGOTIABLE:
You respond with a single JSON object. Nothing else. No prose, no code fences, no preamble, no explanation, no apology, no acknowledgement. Your ENTIRE response must be parseable as JSON. The first character of your response MUST be \`{\` and the last character MUST be \`}\`. If you ever output anything other than a single JSON object, the system breaks and the user's character is destroyed.

Required JSON shape:
{ "message": "<plain-English summary of what you changed>", "changes": { ...only changed fields... } }

Fields you may include in "changes": name, description, personality, scenario, firstMessage, systemPrompt, tags.
- "tags" is a comma-separated string.
- "firstMessage" is the character's opening message in a new chat.
- "systemPrompt" is an optional system-prompt override for chats with this character. Leave it as an empty string unless the user specifically asks for one.

Behavior rules:
- Make the SMALLEST change necessary to fulfill the user's request. If the user says "make the character taller", edit ONLY the relevant part of the description (or wherever height lives) — do NOT rewrite anything else.
- Omit any field you are not changing from the "changes" object. Do NOT echo unchanged fields. Do NOT include a field just because it appears in the current state.
- Greeting formatting: narration in plain text, "dialogue in double quotes", *internal thoughts in single asterisks*. Use {{char}} for the character's name and {{user}} for the user where it reads naturally.
- The "message" is conversational, brief (1-2 sentences), and explains what you changed. Do NOT include the new field values in "message" — they belong in "changes".

REMINDER: Output a single JSON object and NOTHING else. Do not wrap it in code fences. Do not say "Sure!" or "Here you go" before the JSON. Do not add any text after the closing brace. Your previous turns in this conversation also obey this rule — do not let any past mistake convince you it is acceptable to break format. Every response is JSON-only, every time, with no exceptions.`;

const JSON_REMINDER_SUFFIX = `\n\n[Reply with a SINGLE JSON object only. First char \`{\`, last char \`}\`. No prose outside the JSON, no code fences, no commentary. Schema: {"message": string, "changes": {...only changed fields...}}.]`;

const RETRY_REMINDER = `Your previous response was not valid JSON in the required shape. Reply NOW with a single JSON object only. The first character of your reply must be \`{\` and the last character must be \`}\`. No code fences, no prose, no apology, no commentary. Schema: {"message": "...", "changes": {...}}. If you have nothing to change, return {"message": "...", "changes": {}}.`;

function getUserSetting(userId: number, key: string): string | undefined {
	const row = db.select().from(userSettings)
		.where(and(eq(userSettings.userId, userId), eq(userSettings.key, key)))
		.get();
	return row?.value ?? undefined;
}

function tryParseJSON(text: string): { message: string; changes: Partial<Record<FieldKey, string>> } | null {
	const trimmed = text.trim();
	let candidate = trimmed;
	const fenceMatch = candidate.match(/```(?:json)?\s*([\s\S]*?)```/i);
	if (fenceMatch) candidate = fenceMatch[1].trim();
	const firstBrace = candidate.indexOf('{');
	const lastBrace = candidate.lastIndexOf('}');
	if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
		candidate = candidate.slice(firstBrace, lastBrace + 1);
	}
	try {
		const parsed = JSON.parse(candidate);
		if (typeof parsed !== 'object' || parsed === null) return null;
		const message = typeof parsed.message === 'string' ? parsed.message : '';
		const rawChanges = (parsed.changes && typeof parsed.changes === 'object') ? parsed.changes : {};
		const changes: Partial<Record<FieldKey, string>> = {};
		for (const key of FIELD_KEYS) {
			const v = (rawChanges as any)[key];
			if (typeof v === 'string') changes[key] = v;
		}
		return { message, changes };
	} catch {
		return null;
	}
}

async function streamFull(llm: any, messages: ChatMessage[], settings: SamplerSettings, signal?: AbortSignal): Promise<string> {
	let full = '';
	for await (const chunk of llm.stream(messages, settings, signal)) {
		if (chunk.type === 'content') full += chunk.text;
	}
	return full.trim();
}

export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const body = await event.request.json().catch(() => ({}));

	const currentFields: Partial<Record<FieldKey, string>> = {};
	for (const key of FIELD_KEYS) {
		const v = body?.currentFields?.[key];
		currentFields[key] = typeof v === 'string' ? v : '';
	}

	const history: { role: 'user' | 'assistant'; content: string }[] = Array.isArray(body?.history)
		? body.history.filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').slice(-20)
		: [];

	const userMessage = typeof body?.userMessage === 'string' ? body.userMessage.trim() : '';
	if (!userMessage) {
		return ApiError.badRequest('userMessage is required');
	}

	// Resolve provider: characterCreator setting > reformatter setting > enabled default
	const settingProviderId = getUserSetting(user.id, 'characterCreatorProviderId') || getUserSetting(user.id, 'reformatterProviderId');
	const settingModel = getUserSetting(user.id, 'characterCreatorModel');
	const settingPrompt = getUserSetting(user.id, 'characterCreatorPrompt');

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
	const prompt = (settingPrompt && settingPrompt.trim()) ? settingPrompt : DEFAULT_SYSTEM_PROMPT;

	const llm = createProvider(provider.type as ProviderType, {
		endpoint: provider.endpoint,
		apiKey: provider.apiKey || '',
		model: activeModel,
	});

	const samplerSettings: SamplerSettings = {
		temperature: 0.8,
		topP: 1.0,
		topK: 0,
		maxTokens: provider.maxTokens ?? 4096,
		repetitionPenalty: 1.0,
		frequencyPenalty: 0.0,
		presencePenalty: 0.0,
		reasoningEffort: 'off',
	};

	const stateBlock = '```json\n' + JSON.stringify(currentFields, null, 2) + '\n```';
	const userTurnContent = `Current character:\n${stateBlock}\n\nRequest: ${userMessage}${JSON_REMINDER_SUFFIX}`;

	// Append the JSON-only suffix to every historical user message too, so the
	// model sees the format constraint reinforced on every turn it scans.
	const reinforcedHistory = history.map(h =>
		h.role === 'user' && !h.content.includes('[Reply with a SINGLE JSON object only.')
			? { role: h.role, content: h.content + JSON_REMINDER_SUFFIX }
			: { role: h.role, content: h.content }
	);

	const messages: ChatMessage[] = [
		{ role: 'system', content: prompt },
		...reinforcedHistory,
		{ role: 'user', content: userTurnContent },
	];

	let raw: string;
	const t0 = Date.now();
	event.locals.logger?.debug('characters: ai-create start', { providerId: provider.id, model: activeModel, historyTurns: history.length });
	try {
		raw = await streamFull(llm, messages, samplerSettings, event.request.signal);
	} catch (err) {
		event.locals.logger?.warn('characters: ai-create failed', { providerId: provider.id, durationMs: Date.now() - t0, err: String(err) });
		return json({ error: err instanceof Error ? err.message : 'Provider error' }, { status: 502 });
	}

	let parsed = tryParseJSON(raw);
	if (!parsed) {
		// One retry with corrective follow-up
		const retryMessages: ChatMessage[] = [
			...messages,
			{ role: 'assistant', content: raw },
			{ role: 'user', content: RETRY_REMINDER },
		];
		try {
			raw = await streamFull(llm, retryMessages, samplerSettings, event.request.signal);
		} catch (err) {
			return json({ error: err instanceof Error ? err.message : 'Provider error' }, { status: 502 });
		}
		parsed = tryParseJSON(raw);
	}

	if (!parsed) {
		return ApiError.badGateway('Model did not return valid JSON. Try again or rephrase.');
	}

	// Drop empty-string echoes that don't actually change anything
	const filteredChanges: Partial<Record<FieldKey, string>> = {};
	for (const [k, v] of Object.entries(parsed.changes) as [FieldKey, string][]) {
		if (v !== currentFields[k]) filteredChanges[k] = v;
	}

	event.locals.logger?.info('characters: ai-create complete', {
		providerId: provider.id, durationMs: Date.now() - t0,
		changedFields: Object.keys(filteredChanges),
	});

	return json({
		message: parsed.message || 'Done.',
		changes: filteredChanges,
	});
};
