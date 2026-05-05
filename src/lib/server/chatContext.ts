/**
 * Build the LLM prompt context for a chat: resolves the active character,
 * persona, provider, and per-chat overrides; loads message history; matches
 * lorebook entries; and produces the final messages array along with a token
 * budget. Used by both the background processor and the inline impersonate path.
 */
import { db } from '$lib/db/index.js';
import { messages, chats, characters, providers, personas, userSettings } from '$lib/db/schema.js';
import { eq, asc, and } from 'drizzle-orm';
import type { SamplerSettings } from '$lib/providers/base.js';
import { buildPromptWithSlots } from '$lib/services/prompt.js';
import { matchLorebookEntries } from '$lib/services/lorebook.js';
import { countMessageTokens, computeTokenBudget, trimHistoryToFitBudget } from '$lib/services/tokenizer.js';
import { loadActivePath, type MessageRow } from '$lib/server/chatTree.js';
import { logger } from '$lib/server/logger.js';

export interface ProcessOptions {
	chatId: number;
	regenerate?: boolean;
	greeting?: boolean;
	impersonate?: boolean;
	/** Optional guided-reply text the user attached. Injected as a system
	 * instruction so the LLM treats it as out-of-band steering rather than
	 * something the persona would say. */
	guidance?: string;
}

/**
 * Build the LLM prompt for a chat. Returns everything needed to call the provider.
 */
export function buildChatContext(chatId: number, opts: ProcessOptions) {
	const chat = db.select().from(chats).where(eq(chats.id, chatId)).get();
	if (!chat) throw new Error('Chat not found');

	const chatUserId = chat.userId!;

	const character = db.select().from(characters).where(eq(characters.id, chat.characterId)).get();
	if (!character) throw new Error('Character not found');

	// Persona: per-chat override wins, otherwise the user's default.
	let activePersona = db.select().from(personas).where(and(eq(personas.userId, chatUserId), eq(personas.isDefault, true))).get() ?? null;
	if (chat.overridePersonaId) {
		const overridePersona = db.select().from(personas).where(eq(personas.id, chat.overridePersonaId)).get();
		if (overridePersona) activePersona = overridePersona;
	}

	// Provider resolution — always scoped to the chat owner.
	const defaultProvider = db.select().from(providers).where(and(eq(providers.userId, chatUserId), eq(providers.enabled, true))).get();
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
	if (chat.overrideModel) {
		activeModel = chat.overrideModel;
	}

	// Sampler settings come from the active provider, with per-chat overrides on top.
	const samplerSettings: SamplerSettings = {
		temperature: chat.overrideTemperature ?? activeProvider.temperature ?? 0.8,
		topP: activeProvider.topP ?? 1.0,
		topK: activeProvider.topK ?? 0,
		maxTokens: chat.overrideMaxTokens ?? activeProvider.maxTokens ?? 1024,
		repetitionPenalty: activeProvider.repetitionPenalty ?? 1.0,
		frequencyPenalty: activeProvider.frequencyPenalty ?? 0.0,
		presencePenalty: activeProvider.presencePenalty ?? 0.0,
		reasoningEffort: (chat.overrideReasoningEffort ?? activeProvider.reasoningEffort ?? 'off') as SamplerSettings['reasoningEffort']
	};

	const contextSize = activeProvider.contextSize ?? 32768;
	const maxResponseTokens = samplerSettings.maxTokens;
	const customPrompt = chat.overrideCustomPrompt ?? activeProvider.customPrompt ?? '';
	const lorebookDepth = activeProvider.lorebookDepth ?? 4;
	const streamingEnabled = activeProvider.streamingEnabled ?? true;
	const includeReasoning = chat.overrideIncludeReasoning ?? activeProvider.includeReasoning ?? false;

	// Batch all per-user settings into one query (M7) instead of one SELECT per key.
	const settingsRows = db.select().from(userSettings)
		.where(eq(userSettings.userId, chatUserId))
		.all();
	const userSettingsMap = new Map(settingsRows.map(r => [r.key, r.value]));

	// Per-chat override beats global setting.
	let renderMode: 'roleplay' | 'markdown' = 'roleplay';
	if (chat.overrideRenderMode) {
		renderMode = chat.overrideRenderMode === 'markdown' ? 'markdown' : 'roleplay';
	} else {
		renderMode = (userSettingsMap.get('renderMode') === 'markdown' ? 'markdown' : 'roleplay');
	}

	// Custom prompt slot ordering, if the user has one.
	let slotOrder: string[] | undefined;
	const slotOrderRaw = userSettingsMap.get('promptSlotOrder');
	if (slotOrderRaw) {
		try { slotOrder = JSON.parse(slotOrderRaw); } catch (err) { logger.warn('chatContext: malformed slotOrder JSON', { userId: chatUserId, err: String(err) }); }
	}

	// Recursive CTE walks just the active branch in the DB.
	const leafId = chat.activeLeafId;

	let chatMessages: MessageRow[] = [];
	if (leafId) {
		chatMessages = loadActivePath(leafId);
	} else {
		// No active leaf? Pull all messages chronologically. Rare path.
		chatMessages = db.select().from(messages).where(eq(messages.chatId, chatId)).orderBy(asc(messages.createdAt)).all() as unknown as MessageRow[];
	}

	// Drop any messages already folded into chat.compactionSummary so they
	// don't double-contribute to the prompt. Their content rides in via the
	// summary slot instead (injected in prompt.ts at SYSTEM_PROMPT + 5).
	const compactedUpTo = chat.compactedUpToMessageId ?? 0;
	if (compactedUpTo > 0 && chat.compactionSummary) {
		chatMessages = chatMessages.filter(m => m.id > compactedUpTo);
	}

	// History trimming happens below via the token-budget pass; we don't apply
	// a coarse message-count cap anymore.

	// Lorebook
	const lorebookMatches = matchLorebookEntries(character.id, chatId, chatMessages);

	function mapMessages(msgs: MessageRow[]) {
		return msgs.map(m => {
			let content = m.content;
			if (includeReasoning && m.role === 'assistant' && m.reasoning) {
				try {
					const reasoningArr: string[] = JSON.parse(m.reasoning);
					const reasoning = reasoningArr[m.swipeIndex ?? 0] || '';
					if (reasoning) content = `<thinking>\n${reasoning}\n</thinking>\n${content}`;
				} catch { /* skip */ }
			}
			return { role: m.role, content, createdAt: m.createdAt };
		});
	}

	// Prompt build (first pass)

	const firstPass = buildPromptWithSlots({
		character,
		persona: activePersona,
		chatMode: (chat.mode as 'story' | 'texting') || 'story',
		chatMessages: mapMessages(chatMessages),
		lorebookEntries: lorebookMatches,
		isGreeting: !!opts.greeting,
		isRegenerate: !!opts.regenerate,
		isImpersonate: !!opts.impersonate,
		guidance: opts.guidance,
		customPrompt,
		lorebookDepth,
		renderMode,
		slotOrder,
		compactionSummary: chat.compactionSummary ?? null,
	});

	const budget = computeTokenBudget(firstPass.slots, contextSize, maxResponseTokens);
	let llmMessages = firstPass.messages;
	let tokenStats = budget;

	if (budget.overflow > 0) {
		const nonHistoryTokens = firstPass.slots
			.filter(s => s.name !== 'history')
			.reduce((sum, s) => sum + countMessageTokens(s.messages), 0);

		const historySlot = firstPass.slots.find(s => s.name === 'history');
		if (historySlot) {
			const { trimmed } = trimHistoryToFitBudget(historySlot.messages, nonHistoryTokens, contextSize, maxResponseTokens);

			const trimmedNonSystem = trimmed.filter(m => m.role !== 'system').length;
			const keepCount = Math.min(trimmedNonSystem, chatMessages.length);
			const trimmedChatMessages = chatMessages.slice(-keepCount);

			const secondPass = buildPromptWithSlots({
				character,
				persona: activePersona,
				chatMode: (chat.mode as 'story' | 'texting') || 'story',
				chatMessages: mapMessages(trimmedChatMessages),
				lorebookEntries: lorebookMatches,
				isGreeting: !!opts.greeting,
				isRegenerate: !!opts.regenerate,
				isImpersonate: !!opts.impersonate,
				guidance: opts.guidance,
				customPrompt,
				lorebookDepth,
				renderMode,
				slotOrder,
				compactionSummary: chat.compactionSummary ?? null,
			});

			llmMessages = secondPass.messages;
			tokenStats = computeTokenBudget(secondPass.slots, contextSize, maxResponseTokens);
		}
	}

	return {
		chat,
		character,
		activeProvider,
		activeModel,
		samplerSettings,
		llmMessages,
		tokenStats,
		streamingEnabled,
		chatUserId,
	};
}
