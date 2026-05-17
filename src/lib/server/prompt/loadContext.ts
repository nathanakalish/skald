import { db } from '$lib/db/index.js';
import { messages, chats, characters, providers, personas, userSettings } from '$lib/db/schema.js';
import { eq, asc, and } from 'drizzle-orm';
import type { SamplerSettings } from '$lib/providers/base.js';
import { matchLorebookEntries } from '$lib/services/lorebook.js';
import { loadActivePath, type MessageRow } from '$lib/server/chatTree.js';
import { logger } from '$lib/server/logger.js';
import { resolveGuidance } from './resolveGuidance.js';
import type { ProcessOptions, ResolvedContext, ChatMode, RenderMode } from './types.js';

/**
 * Pure DB-read pass. Reads everything `buildSlots` and `enforceBudget` need
 * into a single ResolvedContext value. Keeps the rest of the prompt pipeline
 * free of Drizzle imports and easy to test.
 */
export function loadPromptContext(chatId: number, opts: ProcessOptions): ResolvedContext {
	const chat = db.select().from(chats).where(eq(chats.id, chatId)).get();
	if (!chat) throw new Error('Chat not found');

	const chatUserId = chat.userId!;

	const character = db.select().from(characters).where(eq(characters.id, chat.characterId)).get();
	if (!character) throw new Error('Character not found');

	// Persona: per-chat override wins, otherwise the user's default.
	let activePersona = db.select().from(personas)
		.where(and(eq(personas.userId, chatUserId), eq(personas.isDefault, true)))
		.get() ?? null;
	if (chat.overridePersonaId) {
		const overridePersona = db.select().from(personas).where(eq(personas.id, chat.overridePersonaId)).get();
		if (overridePersona) activePersona = overridePersona;
	}

	// Provider resolution — always scoped to the chat owner.
	const defaultProvider = db.select().from(providers)
		.where(and(eq(providers.userId, chatUserId), eq(providers.enabled, true)))
		.get();
	if (!defaultProvider) throw new Error('No provider configured');

	let activeProvider = defaultProvider;
	let activeModel = defaultProvider.defaultModel || '';

	if (chat.overrideProviderId) {
		const op = db.select().from(providers).where(eq(providers.id, chat.overrideProviderId)).get();
		if (op) {
			activeProvider = op;
			activeModel = op.defaultModel || '';
		}
	}
	if (chat.overrideModel) activeModel = chat.overrideModel;

	const samplerSettings: SamplerSettings = {
		temperature: chat.overrideTemperature ?? activeProvider.temperature ?? 0.8,
		topP: activeProvider.topP ?? 1.0,
		topK: activeProvider.topK ?? 0,
		maxTokens: chat.overrideMaxTokens ?? activeProvider.maxTokens ?? 1024,
		repetitionPenalty: activeProvider.repetitionPenalty ?? 1.0,
		frequencyPenalty: activeProvider.frequencyPenalty ?? 0.0,
		presencePenalty: activeProvider.presencePenalty ?? 0.0,
		reasoningEffort: (chat.overrideReasoningEffort ?? activeProvider.reasoningEffort ?? 'off') as SamplerSettings['reasoningEffort'],
	};

	const contextSize = activeProvider.contextSize ?? 32768;
	const maxResponseTokens = samplerSettings.maxTokens;
	const customPrompt = chat.overrideCustomPrompt ?? activeProvider.customPrompt ?? '';
	const lorebookDepth = activeProvider.lorebookDepth ?? 4;
	const streamingEnabled = activeProvider.streamingEnabled ?? true;
	const includeReasoning = chat.overrideIncludeReasoning ?? activeProvider.includeReasoning ?? false;

	// Batch all per-user settings into one query — saves a SELECT per key.
	const settingsRows = db.select().from(userSettings).where(eq(userSettings.userId, chatUserId)).all();
	const userSettingsMap = new Map(settingsRows.map(r => [r.key, r.value]));

	let renderMode: RenderMode = 'roleplay';
	if (chat.overrideRenderMode) {
		renderMode = chat.overrideRenderMode === 'markdown' ? 'markdown' : 'roleplay';
	} else {
		renderMode = userSettingsMap.get('renderMode') === 'markdown' ? 'markdown' : 'roleplay';
	}

	let slotOrder: string[] | undefined;
	const slotOrderRaw = userSettingsMap.get('promptSlotOrder');
	if (slotOrderRaw) {
		try {
			const parsed = JSON.parse(slotOrderRaw);
			if (Array.isArray(parsed)) slotOrder = parsed as string[];
		} catch (err) {
			logger.warn('loadPromptContext: malformed slotOrder JSON', { userId: chatUserId, err: String(err) });
		}
	}

	// Active branch via the recursive CTE in chatTree. Fall back to a flat
	// chronological scan if the chat has no active leaf yet (greeting path).
	const leafId = chat.activeLeafId;
	let chatMessages: MessageRow[] = [];
	if (leafId) {
		chatMessages = loadActivePath(leafId);
	} else {
		chatMessages = db.select().from(messages)
			.where(eq(messages.chatId, chatId))
			.orderBy(asc(messages.createdAt))
			.all() as unknown as MessageRow[];
	}

	// Strip messages folded into chat.compactionSummary so they don't double-
	// contribute. Their content rides in via the compactionSummary slot.
	const compactedUpTo = chat.compactedUpToMessageId ?? 0;
	if (compactedUpTo > 0 && chat.compactionSummary) {
		chatMessages = chatMessages.filter(m => m.id > compactedUpTo);
	}

	// Reasoning prefix is applied here (rather than inside the slot builder)
	// so the slot builder doesn't need to know about per-message swipe indices.
	const chatMode: ChatMode = (chat.mode as ChatMode) || 'story';

	// Lorebook match runs against the full active history (pre-trim) so the
	// budget pass can re-inject as the tail shrinks.
	const lorebookEntries = matchLorebookEntries(character.id, chatId, chatMessages);

	const guidance = resolveGuidance(chat, opts);

	return {
		chat,
		character,
		persona: activePersona,
		activeProvider,
		activeModel,
		samplerSettings,
		contextSize,
		maxResponseTokens,
		customPrompt,
		lorebookDepth,
		streamingEnabled,
		includeReasoning,
		chatMode,
		renderMode,
		slotOrder,
		chatMessages,
		lorebookEntries,
		guidance,
		chatUserId,
		opts,
	};
}
