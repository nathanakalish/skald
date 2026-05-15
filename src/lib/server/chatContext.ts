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

	// Guidance is strictly tied to whatever the caller passed plus the
	// chat-wide reply guidance, if any. We do NOT walk the active path
	// looking for stored guidance — that would let stale reply guidance
	// from an earlier turn silently steer later generations. Regenerate
	// paths must explicitly look up the assistant message's guidance and
	// forward it via opts.guidance.
	let effectiveGuidance: string | undefined;
	if (!opts.impersonate) {
		const chatWide = chat.replyGuidance?.trim();
		const perMessage = opts.guidance?.trim();
		if (chatWide && perMessage) {
			effectiveGuidance = `${chatWide}\n\n${perMessage}`;
		} else {
			effectiveGuidance = chatWide || perMessage || undefined;
		}
	} else {
		effectiveGuidance = opts.guidance?.trim() || undefined;
	}

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
		guidance: effectiveGuidance,
		customPrompt,
		lorebookDepth,
		renderMode,
		slotOrder,
		compactionSummary: chat.compactionSummary ?? null,
	});

	const budget = computeTokenBudget(firstPass.slots, contextSize, maxResponseTokens);
	let llmMessages = firstPass.messages;
	let tokenStats = budget;
	let activeSlots = firstPass.slots;

	if (budget.overflow > 0) {
		const nonHistoryTokens = firstPass.slots
			.filter(s => s.name !== 'history')
			.reduce((sum, s) => sum + countMessageTokens(s.messages), 0);

		const historySlot = firstPass.slots.find(s => s.name === 'history');
		if (historySlot) {
			const { trimmed } = trimHistoryToFitBudget(historySlot.messages, nonHistoryTokens, contextSize, maxResponseTokens);

			const trimmedNonSystem = trimmed.filter(m => m.role !== 'system').length;
			const keepCount = Math.min(trimmedNonSystem, chatMessages.length);
			// Array.slice(-0) === slice(0) === the WHOLE array, not an empty
			// one. So when the trim decided to drop everything (context too
			// full to fit any history alongside system + guidance + nudge)
			// we'd accidentally keep the entire history, the prompt would
			// still overflow, and most providers respond by truncating from
			// the front — silently nuking the system prompt and guidance.
			const trimmedChatMessages = keepCount > 0 ? chatMessages.slice(-keepCount) : [];

			const secondPass = buildPromptWithSlots({
				character,
				persona: activePersona,
				chatMode: (chat.mode as 'story' | 'texting') || 'story',
				chatMessages: mapMessages(trimmedChatMessages),
				lorebookEntries: lorebookMatches,
				isGreeting: !!opts.greeting,
				isRegenerate: !!opts.regenerate,
				isImpersonate: !!opts.impersonate,
				guidance: effectiveGuidance,
				customPrompt,
				lorebookDepth,
				renderMode,
				slotOrder,
				compactionSummary: chat.compactionSummary ?? null,
			});

			llmMessages = secondPass.messages;
			tokenStats = computeTokenBudget(secondPass.slots, contextSize, maxResponseTokens);
			activeSlots = secondPass.slots;
		}
	}

	// Third pass: if non-history alone is so big that even after we threw out
	// the entire chat history we're still over budget, drop optional slots
	// progressively. Without this, we'd ship an over-budget prompt and let
	// the provider truncate from the front — which silently nukes the system
	// prompt, character card, and (because reply guidance lives near the end
	// but the model loses all framing) effectively kills guidance too. The
	// user reports this as "guidance not applying at the context limit".
	//
	// Drop order: least-essential first. We never drop `system`, `guidance`,
	// `customPrompt`, `character`, `persona`, `nudge`, `starterNudge`, or
	// `history` here — those are load-bearing for the model's behaviour.
	if (tokenStats.overflow > 0) {
		const dropOrder = ['examples', 'compactionSummary', 'timeline', 'postHistory', 'greetingContext'];
		const slotsArr = [...activeSlots];

		for (const dropName of dropOrder) {
			if (tokenStats.overflow <= 0) break;
			const idx = slotsArr.findIndex(s => s.name === dropName);
			if (idx === -1) continue;
			const dropped = slotsArr.splice(idx, 1)[0];
			const newStats = computeTokenBudget(slotsArr, contextSize, maxResponseTokens);
			logger.warn('chatContext: dropped optional slot to fit context budget', {
				chatId,
				slot: dropName,
				freedTokens: tokenStats.promptTokens - newStats.promptTokens,
				overflowBefore: tokenStats.overflow,
				overflowAfter: newStats.overflow,
				droppedMessages: dropped.messages.length,
			});
			tokenStats = newStats;
		}

		llmMessages = slotsArr.flatMap(s => s.messages);

		if (tokenStats.overflow > 0) {
			// At this point even dropping every optional slot didn't help —
			// the user's static content (system + character + customPrompt +
			// guidance + lorebook) alone is bigger than their context budget.
			// Log loudly so it shows up in the chat error stream / logs;
			// the provider is about to truncate or reject.
			logger.warn('chatContext: prompt exceeds context budget after all trimming — provider may truncate or error', {
				chatId,
				promptTokens: tokenStats.promptTokens,
				availableForPrompt: tokenStats.availableForPrompt,
				contextSize,
				maxResponseTokens,
				overflow: tokenStats.overflow,
				breakdown: tokenStats.breakdown,
			});
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
