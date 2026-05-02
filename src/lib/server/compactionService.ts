/**
 * Conversation compaction — i.e. "summarize the old stuff so we stop blowing the context window".
 *
 * Periodically (or on demand) we collapse the oldest stretch of an active chat
 * path into a short prose summary, then mark those messages as archived via
 * `chats.compactedUpToMessageId`. The summary gets injected into the prompt
 * right after the system prompt so the LLM still has narrative continuity even
 * though the raw turns aren't being sent anymore.
 *
 * Subsequent runs feed the previous summary back in so it stays a single rolling summary.
 */
import { db } from '$lib/db/index.js';
import { chats, messages, providers, userSettings } from '$lib/db/schema.js';
import { eq, and, sql } from 'drizzle-orm';
import { createProvider, type ProviderType } from '$lib/providers/index.js';
import type { ChatMessage, SamplerSettings } from '$lib/providers/base.js';
import { loadActivePath, type MessageRow } from '$lib/server/chatTree.js';
import { buildChatContext } from '$lib/server/chatContext.js';
import { countTokens } from '$lib/services/tokenizer.js';
import { logger } from '$lib/server/logger.js';
import { broadcast } from '$lib/server/realtime.js';

export const DEFAULT_COMPACTION_PROMPT = `You are a story summarizer. Your job is to compress the EARLIER portion of a roleplay/chat into a concise but information-dense summary that the storytelling AI can use as context for what has happened so far.

Focus on, in this order:
1. Setting and location (where the characters are, what's around them, time of day, season)
2. Important objects, items, or props introduced
3. Key relationships and dynamics between characters
4. Plot-relevant events, decisions, secrets, promises, or unresolved threads
5. Emotional state and recent mood shifts
6. Anything explicitly established about the world

If a previous summary is provided, INCORPORATE it — do not lose facts that were summarized before. The previous summary plus the new messages must collapse into one cohesive new summary.

Rules:
- Write in past tense, third-person, prose paragraphs (NOT a bulleted list).
- Be terse. Aim for the shortest summary that preserves all important context.
- Do NOT invent details. Only summarize what is in the messages or previous summary.
- Do NOT include meta-commentary (e.g. "in this conversation"). Just narrate the events.
- Output ONLY the summary text — no headers, no preamble, no closing remarks.`;

function getUserSetting(userId: number, key: string): string | undefined {
	const row = db.select().from(userSettings)
		.where(and(eq(userSettings.userId, userId), eq(userSettings.key, key)))
		.get();
	return row?.value ?? undefined;
}

export type CompactionMode = 'threshold' | 'fixed';

export interface EffectiveCompactionSettings {
	enabled: boolean;
	threshold: number;          // % of context window at which auto-trigger fires
	mode: CompactionMode;
	targetPercent: number;      // % of prompt budget to aim for after compaction (mode=threshold)
	fixedCount: number;         // how many oldest messages to compact each run (mode=fixed)
	providerId: number | null;  // provider for the summarization call — null means "use chat's provider"
	model: string;              // model override (empty = provider default)
	prompt: string;             // system prompt for the summarizer
}

/**
 * Resolve effective compaction settings for a chat: per-chat overrides win over user globals.
 */
export function resolveCompactionSettings(
	chat: typeof chats.$inferSelect,
	userId: number
): EffectiveCompactionSettings {
	const enabledGlobal = getUserSetting(userId, 'compactionEnabled') === 'true';
	const thresholdGlobal = Number(getUserSetting(userId, 'compactionThreshold') ?? '80');
	const modeGlobal = (getUserSetting(userId, 'compactionMode') ?? 'threshold') as CompactionMode;
	const targetGlobal = Number(getUserSetting(userId, 'compactionTargetPercent') ?? '50');
	const fixedGlobal = Number(getUserSetting(userId, 'compactionFixedCount') ?? '20');
	const providerIdGlobalRaw = getUserSetting(userId, 'compactionProviderId') ?? '';
	const providerIdGlobal = providerIdGlobalRaw ? Number(providerIdGlobalRaw) : null;
	const modelGlobal = getUserSetting(userId, 'compactionModel') ?? '';
	const promptGlobal = getUserSetting(userId, 'compactionPrompt') ?? '';

	return {
		enabled: chat.overrideCompactionEnabled ?? enabledGlobal,
		threshold: chat.overrideCompactionThreshold ?? thresholdGlobal,
		mode: (chat.overrideCompactionMode as CompactionMode | null) ?? modeGlobal,
		targetPercent: chat.overrideCompactionTargetPercent ?? targetGlobal,
		fixedCount: chat.overrideCompactionFixedCount ?? fixedGlobal,
		providerId: chat.overrideCompactionProviderId ?? providerIdGlobal,
		model: chat.overrideCompactionModel ?? modelGlobal,
		prompt: promptGlobal || DEFAULT_COMPACTION_PROMPT,
	};
}

/**
 * Decide whether the current prompt usage warrants kicking off an auto-compaction.
 */
export function shouldAutoCompact(promptTokens: number, availableForPrompt: number, thresholdPct: number): boolean {
	if (availableForPrompt <= 0) return false;
	return (promptTokens / availableForPrompt) * 100 >= thresholdPct;
}

/**
 * Pick which oldest non-compacted messages to feed into this compaction run.
 *
 * Mode `fixed`: take exactly N oldest.
 * Mode `threshold`: take enough so the remaining tail PLUS the eventual summary
 * fits under `targetPercent` of the context window.
 */
function pickMessagesToCompact(
	uncompacted: MessageRow[],
	settings: EffectiveCompactionSettings,
	availableForPrompt: number,
	summaryReserveTokens: number,
	nonHistoryTokens: number,
	minTailKeep: number,
): MessageRow[] {
	if (uncompacted.length === 0) return [];

	if (settings.mode === 'fixed') {
		const n = Math.max(1, Math.min(settings.fixedCount, uncompacted.length));
		const maxAllowed = Math.max(0, uncompacted.length - minTailKeep);
		return uncompacted.slice(0, Math.min(n, maxAllowed));
	}

	// threshold mode: collapse enough so tail + summary + non-history overhead
	// fits under target% of the prompt budget the model can actually use.
	const budgetForTail = Math.max(
		0,
		Math.floor((settings.targetPercent / 100) * availableForPrompt)
			- summaryReserveTokens
			- nonHistoryTokens,
	);
	// Walk backwards from the end accumulating tail tokens. Once the tail busts
	// the budget, everything before that index is fair game to compact.
	let tailTokens = 0;
	let firstKeptIdx = uncompacted.length;
	for (let i = uncompacted.length - 1; i >= 0; i--) {
		const t = countTokens(uncompacted[i].content) + 4;
		if (tailTokens + t > budgetForTail) break;
		tailTokens += t;
		firstKeptIdx = i;
	}
	// Never compact the entire chat — keep a small live tail so the model has
	// something concrete to react to.
	if (uncompacted.length - firstKeptIdx < minTailKeep) {
		firstKeptIdx = Math.max(0, uncompacted.length - minTailKeep);
	}
	return uncompacted.slice(0, firstKeptIdx);
}

function estimateNonHistoryTokens(chatId: number): number {
	try {
		const ctx = buildChatContext(chatId, { chatId });
		return ctx.tokenStats.breakdown
			.filter((slot) => slot.name !== 'history')
			.reduce((sum, slot) => sum + slot.tokens, 0);
	} catch (err) {
		logger.warn('compaction: failed to estimate non-history tokens', { chatId, err: String(err) });
		return 0;
	}
}

export interface CompactionResult {
	ran: boolean;
	reason?: string;
	summary?: string;
	compactedUpToMessageId?: number;
	compactedCount?: number;
}

export interface RunCompactionOptions {
	/** Force run even if compaction is disabled. Used for the manual button. */
	force?: boolean;
}

/**
 * Per-chat in-flight mutex. Without this, the auto-trigger inside chatProcessor
 * and the manual /api/chats/[id]/compact endpoint can both fire runCompaction
 * for the same chat at the same time \u2014 each summarizes the same window, both
 * writes race on `compactedUpToMessageId`, and the user pays the LLM bill twice.
 * Surprise.
 */
const inFlight = new Set<number>();

/**
 * Run a compaction pass on the given chat. Synchronous \u2014 awaits the LLM call.
 * Returns ran=false (with a reason) when there's nothing to do.
 */
export async function runCompaction(chatId: number, opts: RunCompactionOptions = {}): Promise<CompactionResult> {
	if (inFlight.has(chatId)) return { ran: false, reason: 'already-running' };
	inFlight.add(chatId);
	try {
		return await runCompactionInner(chatId, opts);
	} finally {
		inFlight.delete(chatId);
	}
}

async function runCompactionInner(chatId: number, opts: RunCompactionOptions): Promise<CompactionResult> {
	const chat = db.select().from(chats).where(eq(chats.id, chatId)).get();
	if (!chat) return { ran: false, reason: 'chat-not-found' };

	const settings = resolveCompactionSettings(chat, chat.userId!);
	if (!settings.enabled && !opts.force) {
		return { ran: false, reason: 'disabled' };
	}

	// Walk the active path. Skip messages already covered by a prior compaction.
	const leafId = chat.activeLeafId;
	if (!leafId) return { ran: false, reason: 'no-active-leaf' };
	const activePath = loadActivePath(leafId);
	const cutoff = chat.compactedUpToMessageId ?? 0;
	const uncompacted = activePath.filter(m => m.id > cutoff);
	const minTailKeep = opts.force ? 1 : 2;
	if (uncompacted.length <= minTailKeep) {
		return { ran: false, reason: 'too-short' };
	}

	// Resolve provider for the summarization call. Fall back to chat's
	// active provider if no compaction provider is configured.
	let summarizer = settings.providerId
		? db.select().from(providers).where(and(eq(providers.id, settings.providerId), eq(providers.userId, chat.userId!))).get()
		: null;
	if (!summarizer) {
		summarizer = chat.overrideProviderId
			? db.select().from(providers).where(eq(providers.id, chat.overrideProviderId)).get()
			: db.select().from(providers).where(and(eq(providers.userId, chat.userId!), eq(providers.enabled, true))).get();
	}
	if (!summarizer) return { ran: false, reason: 'no-provider' };

	// Sizing for the threshold-mode budget should track whatever provider the
	// CHAT actually generates with (that's what the auto-trigger threshold and
	// the avatar context ring are measured against). The summarizer may be a
	// different model with a different window.
	const chatProvider = chat.overrideProviderId
		? db.select().from(providers).where(eq(providers.id, chat.overrideProviderId)).get() ?? summarizer
		: db.select().from(providers).where(and(eq(providers.userId, chat.userId!), eq(providers.enabled, true))).get() ?? summarizer;
	const targetContextSize = chatProvider.contextSize ?? 32768;
	const targetMaxResponse = chat.overrideMaxTokens ?? chatProvider.maxTokens ?? 1024;
	const availableForPrompt = Math.max(1024, targetContextSize - targetMaxResponse);
	const nonHistoryTokens = estimateNonHistoryTokens(chatId);
	const summaryReserveTokens = Math.max(512, Math.min(summarizer.maxTokens ?? 1024, 2048));
	const toCompact = pickMessagesToCompact(
		uncompacted,
		settings,
		availableForPrompt,
		summaryReserveTokens,
		nonHistoryTokens,
		minTailKeep,
	);
	if (toCompact.length === 0) return { ran: false, reason: 'nothing-to-pick' };

	const model = settings.model || summarizer.defaultModel || '';

	// Build the summarizer input: previous summary (if any) followed by the new transcript.
	const transcriptLines: string[] = [];
	if (chat.compactionSummary?.trim()) {
		transcriptLines.push('--- PREVIOUS SUMMARY ---');
		transcriptLines.push(chat.compactionSummary.trim());
		transcriptLines.push('');
		transcriptLines.push('--- NEW MESSAGES TO INCORPORATE ---');
	}
	for (const m of toCompact) {
		const who = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Character' : 'System';
		transcriptLines.push(`${who}: ${m.content}`);
	}
	const userPayload = transcriptLines.join('\n');

	const llm = createProvider(summarizer.type as ProviderType, {
		endpoint: summarizer.endpoint,
		apiKey: summarizer.apiKey || '',
		model,
	});

	const samplerSettings: SamplerSettings = {
		temperature: 0.4,
		topP: 1.0,
		topK: 0,
		maxTokens: Math.max(512, Math.min(summarizer.maxTokens ?? 1024, 2048)),
		repetitionPenalty: 1.0,
		frequencyPenalty: 0.0,
		presencePenalty: 0.0,
		reasoningEffort: 'off',
	};

	const llmMessages: ChatMessage[] = [
		{ role: 'system', content: settings.prompt },
		{ role: 'user', content: userPayload },
	];

	let summary = '';
	try {
		for await (const chunk of llm.stream(llmMessages, samplerSettings)) {
			if (chunk.type === 'content') summary += chunk.text;
		}
	} catch (err) {
		logger.warn('compaction: provider stream failed', { chatId, err: String(err) });
		return { ran: false, reason: 'provider-error' };
	}

	summary = summary.trim();
	if (!summary) return { ran: false, reason: 'empty-summary' };

	const lastCompactedId = toCompact[toCompact.length - 1].id;
	db.update(chats)
		.set({
			compactionSummary: summary,
			compactedUpToMessageId: lastCompactedId,
			compactionLastRunAt: sql`datetime('now')`,
		})
		.where(eq(chats.id, chatId))
		.run();

	// Tell connected clients so the in-chat indicator + chat settings tab refresh.
	const fresh = db.select().from(chats).where(eq(chats.id, chatId)).get();
	if (fresh) {
		broadcast(chat.userId!, {
			type: 'chat:updated',
			id: chatId,
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			chat: fresh as any,
		});
	}

	logger.info('compaction: ran', {
		chatId,
		compactedCount: toCompact.length,
		summaryLen: summary.length,
		mode: settings.mode,
	});

	return {
		ran: true,
		summary,
		compactedUpToMessageId: lastCompactedId,
		compactedCount: toCompact.length,
	};
}

// Touch `messages` so the unused-import linter doesn't strip it — a future manual reset
// endpoint will need it.
void messages;
