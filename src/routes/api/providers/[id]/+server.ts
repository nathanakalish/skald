import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { providers, chats } from '$lib/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { requireOwned } from '$lib/server/ownership.js';
import { broadcast } from '$lib/server/realtime.js';

export const GET: RequestHandler = async (event) => {
	const { row: provider } = requireOwned(event, providers, event.params.id);
	return json(provider);
};

export const PUT: RequestHandler = async (event) => {
	const { user } = requireOwned(event, providers, event.params.id);
	const id = Number(event.params.id);
	const body = await event.request.json();

	// Validate endpoint URL — only allow http/https protocols
	if ('endpoint' in body && body.endpoint) {
		try {
			const url = new URL(body.endpoint);
			if (url.protocol !== 'http:' && url.protocol !== 'https:') {
				return json({ error: 'Endpoint must use http or https protocol' }, { status: 400 });
			}
		} catch {
			return json({ error: 'Invalid endpoint URL' }, { status: 400 });
		}
	}

	const updates: Record<string, unknown> = {};

	// Connection settings
	if ('name' in body) updates.name = body.name;
	if ('type' in body) updates.type = body.type;
	if ('endpoint' in body) updates.endpoint = body.endpoint;
	if ('apiKey' in body) updates.apiKey = body.apiKey;
	if ('defaultModel' in body) updates.defaultModel = body.defaultModel;
	if ('enabled' in body) updates.enabled = body.enabled;
	if ('maxConcurrent' in body) updates.maxConcurrent = body.maxConcurrent ?? 1;

	// Generation settings
	if ('temperature' in body) updates.temperature = body.temperature;
	if ('topP' in body) updates.topP = body.topP;
	if ('topK' in body) updates.topK = body.topK;
	if ('maxTokens' in body) updates.maxTokens = body.maxTokens;
	if ('contextSize' in body) updates.contextSize = body.contextSize;
	if ('repetitionPenalty' in body) updates.repetitionPenalty = body.repetitionPenalty;
	if ('frequencyPenalty' in body) updates.frequencyPenalty = body.frequencyPenalty;
	if ('presencePenalty' in body) updates.presencePenalty = body.presencePenalty;
	if ('storyContextMessages' in body) updates.storyContextMessages = body.storyContextMessages;
	if ('textingContextMessages' in body) updates.textingContextMessages = body.textingContextMessages;
	if ('customPrompt' in body) updates.customPrompt = body.customPrompt;
	if ('lorebookDepth' in body) updates.lorebookDepth = body.lorebookDepth;
	if ('streamingEnabled' in body) updates.streamingEnabled = body.streamingEnabled;
	if ('includeReasoning' in body) updates.includeReasoning = body.includeReasoning;
	if ('reasoningEffort' in body) updates.reasoningEffort = body.reasoningEffort;
	if ('textingTypingSpeed' in body) updates.textingTypingSpeed = body.textingTypingSpeed;
	if ('textingTypingMax' in body) updates.textingTypingMax = body.textingTypingMax;
	if ('textingInitialDelay' in body) updates.textingInitialDelay = body.textingInitialDelay;

	if (Object.keys(updates).length > 0) {
		db.update(providers).set(updates).where(and(eq(providers.id, id), eq(providers.userId, user.id))).run();
	}

	const updated = db.select().from(providers).where(and(eq(providers.id, id), eq(providers.userId, user.id))).get();
	if (!updated) return json({ ok: true });
	const { apiKey, ...rest } = updated;
	const light = { ...rest, hasKey: !!apiKey };
	broadcast(user.id, { type: 'provider:updated', id, provider: light as any });
	return json({ ok: true, provider: light });
};

export const DELETE: RequestHandler = async (event) => {
	const { user, row: existing } = requireOwned(event, providers, event.params.id);
	const id = existing.id;
	const wasEnabled = existing.enabled;

	// One transaction: delete the row, clear any chat overrides pointing at it
	// (no FK to do this for us — see DB-H1 / CRUD-H4), then promote the next
	// provider to enabled if the deleted one was the active default.
	db.transaction(() => {
		db.delete(providers).where(and(eq(providers.id, id), eq(providers.userId, user.id))).run();
		db.update(chats)
			.set({ overrideProviderId: null })
			.where(and(eq(chats.userId, user.id), eq(chats.overrideProviderId, id)))
			.run();

		if (wasEnabled) {
			const next = db.select().from(providers).where(eq(providers.userId, user.id)).limit(1).get();
			if (next) {
				db.update(providers).set({ enabled: true }).where(eq(providers.id, next.id)).run();
			}
		}
	});

	broadcast(user.id, { type: 'provider:deleted', id });
	return json({ ok: true });
};
