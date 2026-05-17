/**
 * Conversation compaction — collapse old turns into a rolling "highlights"
 * note so chats can keep going past the context window without dropping the
 * narrative.
 *
 * The flow:
 *   1. Auto-trigger fires when prompt usage crosses `threshold%`. Skipped for
 *      impersonate (one-shots) and for chats below the minimum tail.
 *   2. Pick which messages to fold in:
 *        - `window` mode (default for auto): take oldest messages whose tokens
 *          add up to `windowPercent × contextSize`. Keeps each run bounded.
 *        - `fixed` mode (default for manual): take exactly N oldest messages.
 *   3. Feed previous highlights + the chosen turns to the summarizer LLM.
 *      Output is bounded by `highlightsCap = clamp(round(0.025 × contextSize), 256, 4096)`.
 *   4. Truncate the returned summary to `highlightsCap` tokens if it overshot,
 *      log a warning, then persist + advance `compactedUpToMessageId`.
 *
 * `highlightsCap` governs BOTH the LLM `maxTokens` AND the post-hoc truncation
 * so the injected slot can never exceed the budget we promised the prompt
 * pipeline. Single source of truth.
 */
import { db } from '$lib/db/index.js';
import { chats, messages, providers, userSettings } from '$lib/db/schema.js';
import { eq, and, sql } from 'drizzle-orm';
import { createProvider, type ProviderType } from '$lib/providers/index.js';
import type { ChatMessage, SamplerSettings } from '$lib/providers/base.js';
import { loadActivePath, type MessageRow } from '$lib/server/chatTree.js';
import { countTokens } from '$lib/services/tokenizer.js';
import { logger } from '$lib/server/logger.js';
import { broadcast } from '$lib/server/realtime.js';

/**
 * Terse fact-list summarizer prompt. Earlier versions asked for a prose
 * paragraph, which the model would happily inflate to 800+ tokens of
 * "in this conversation" filler. The terse format keeps highlights dense
 * and lets the cap-truncation be lossless in practice.
 */
export const DEFAULT_COMPACTION_PROMPT = `You compress the EARLIER portion of a roleplay/chat into a terse highlights list. The list is shown to the storytelling AI in place of the original messages — every line you write is a fact it can rely on.

If a PREVIOUS HIGHLIGHTS block is provided, you MUST carry every still-relevant fact forward into the new list. Do NOT lose information.

Output format — ONLY lines of "Category: fact". One fact per line. No prose, no preamble, no markdown.

Categories to use (skip any with no facts):
- Setting: location, time of day, season, surroundings
- Item: notable objects, gifts, props the characters interact with
- Relationship: dynamics, attractions, conflicts, history between characters
- Event: things that happened, choices made, promises, secrets revealed
- State: current emotional state or mood, physical condition, what someone is wearing
- World: established rules, lore, abilities, world details

Rules:
- Each line stands alone. Past tense, third-person where possible.
- Be terse. "Setting: rainy bus stop at night" beats "It was raining and they were at a bus stop late at night."
- Do NOT invent details. Every fact must come from the messages or the previous highlights.
- Do NOT include meta-commentary or note that this is a summary.
- Output ONLY the highlight lines.`;

function getUserSetting(userId: number, key: string): string | undefined {
	const row = db.select().from(userSettings)
		.where(and(eq(userSettings.userId, userId), eq(userSettings.key, key)))
		.get();
	return row?.value ?? undefined;
}

export type CompactionMode = 'window' | 'fixed';

export interface EffectiveCompactionSettings {
	enabled: boolean;
	threshold: number;          // % of context window at which auto-trigger fires
	mode: CompactionMode;
	/** Window mode: how much of contextSize (token-wise) to fold per run. */
	windowPercent: number;
	/** Fixed mode: how many oldest messages to fold per run. */
	fixedCount: number;
	providerId: number | null;
	model: string;
	prompt: string;
}

/**
 * Normalize the stored mode. Legacy rows carrying the old `threshold` value
 * are treated as `window` — the closest match in the new model. Anything
 * unrecognised also falls back to `window`.
 */
function normalizeMode(raw: string | null | undefined): CompactionMode {
	if (raw === 'fixed') return 'fixed';
	return 'window';
}

export function resolveCompactionSettings(
	chat: typeof chats.$inferSelect,
	userId: number,
): EffectiveCompactionSettings {
	const enabledGlobal = getUserSetting(userId, 'compactionEnabled') === 'true';
	const thresholdGlobal = Number(getUserSetting(userId, 'compactionThreshold') ?? '80');
	const modeGlobal = normalizeMode(getUserSetting(userId, 'compactionMode'));
	const windowGlobal = Number(getUserSetting(userId, 'compactionWindowPercent') ?? '30');
	const fixedGlobal = Number(getUserSetting(userId, 'compactionFixedCount') ?? '20');
	const providerIdGlobalRaw = getUserSetting(userId, 'compactionProviderId') ?? '';
	const providerIdGlobal = providerIdGlobalRaw ? Number(providerIdGlobalRaw) : null;
	const modelGlobal = getUserSetting(userId, 'compactionModel') ?? '';
	const promptGlobal = getUserSetting(userId, 'compactionPrompt') ?? '';

	return {
		enabled: chat.overrideCompactionEnabled ?? enabledGlobal,
		threshold: chat.overrideCompactionThreshold ?? thresholdGlobal,
		mode: chat.overrideCompactionMode ? normalizeMode(chat.overrideCompactionMode) : modeGlobal,
		windowPercent: chat.overrideCompactionWindowPercent ?? windowGlobal,
		fixedCount: chat.overrideCompactionFixedCount ?? fixedGlobal,
		providerId: chat.overrideCompactionProviderId ?? providerIdGlobal,
		model: chat.overrideCompactionModel ?? modelGlobal,
		prompt: promptGlobal || DEFAULT_COMPACTION_PROMPT,
	};
}

/**
 * Auto-trigger predicate. Compaction fires when the live prompt is using at
 * least `thresholdPct` of the available prompt budget.
 */
export function shouldAutoCompact(promptTokens: number, availableForPrompt: number, thresholdPct: number): boolean {
	if (availableForPrompt <= 0) return false;
	return (promptTokens / availableForPrompt) * 100 >= thresholdPct;
}

/**
 * Compute the highlights token cap. Scales with the model's context so big
 * windows get richer summaries and small windows stay disciplined.
 *
 * Lower bound: 256 — anything less can't fit meaningful highlights.
 * Upper bound: 4096 — past this we're spending more on the summary than we'd
 * save by compacting.
 */
export function computeHighlightsCap(contextSize: number): number {
	return Math.max(256, Math.min(Math.round(contextSize * 0.025), 4096));
}

/**
 * Pick which oldest uncompacted messages to fold in this run.
 *
 * `window` mode: walk forward from the oldest, accumulating tokens until the
 *   running total crosses `windowPercent × contextSize`. Always folds at
 *   least one message so progress is guaranteed even if a single turn is huge.
 *
 * `fixed` mode: take exactly N oldest, clamped to leave `minTailKeep` live.
 */
function pickMessagesToCompact(
	uncompacted: MessageRow[],
	settings: EffectiveCompactionSettings,
	contextSize: number,
	minTailKeep: number,
): MessageRow[] {
	if (uncompacted.length === 0) return [];
	const maxAllowed = Math.max(0, uncompacted.length - minTailKeep);
	if (maxAllowed === 0) return [];

	if (settings.mode === 'fixed') {
		const n = Math.max(1, Math.min(settings.fixedCount, maxAllowed));
		return uncompacted.slice(0, n);
	}

	const budget = Math.max(1, Math.floor((settings.windowPercent / 100) * contextSize));
	let total = 0;
	let lastIdx = 0;
	for (let i = 0; i < maxAllowed; i++) {
		const t = countTokens(uncompacted[i].content) + 4;
		if (total + t > budget && i > 0) break;
		total += t;
		lastIdx = i + 1;
	}
	return uncompacted.slice(0, Math.max(1, lastIdx));
}

export interface CompactionResult {
	ran: boolean;
	reason?: string;
	summary?: string;
	compactedUpToMessageId?: number;
	compactedCount?: number;
}

export interface RunCompactionOptions {
	/** Bypass the `enabled` gate. Used by the manual button. */
	force?: boolean;
}

/**
 * Per-chat in-flight mutex. Without this, the auto-trigger in chatProcessor
 * and the manual endpoint can both fire for the same chat — each would summarize
 * the same window, both writes race on `compactedUpToMessageId`, and we pay
 * the LLM bill twice.
 */
const inFlight = new Set<number>();

export async function runCompaction(chatId: number, opts: RunCompactionOptions = {}): Promise<CompactionResult> {
	if (inFlight.has(chatId)) return { ran: false, reason: 'already-running' };
	inFlight.add(chatId);
	const startedAt = Date.now();
	logger.info('compaction: triggered', { chatId, reason: opts.force ? 'manual' : 'auto_threshold' });
	try {
		const result = await runCompactionInner(chatId, opts);
		if (result.ran) {
			logger.info('compaction: completed', {
				chatId,
				durationMs: Date.now() - startedAt,
				summaryLength: result.summary?.length ?? 0,
				compactedCount: result.compactedCount ?? 0,
			});
		} else {
			logger.debug('compaction: skipped', { chatId, reason: result.reason, durationMs: Date.now() - startedAt });
		}
		return result;
	} finally {
		inFlight.delete(chatId);
	}
}

async function runCompactionInner(chatId: number, opts: RunCompactionOptions): Promise<CompactionResult> {
	const chat = db.select().from(chats).where(eq(chats.id, chatId)).get();
	if (!chat) return { ran: false, reason: 'chat-not-found' };

	const settings = resolveCompactionSettings(chat, chat.userId!);
	if (!settings.enabled && !opts.force) return { ran: false, reason: 'disabled' };

	const leafId = chat.activeLeafId;
	if (!leafId) return { ran: false, reason: 'no-active-leaf' };
	const activePath = loadActivePath(leafId);
	const cutoff = chat.compactedUpToMessageId ?? 0;
	const uncompacted = activePath.filter(m => m.id > cutoff);
	const minTailKeep = opts.force ? 1 : 2;
	if (uncompacted.length <= minTailKeep) return { ran: false, reason: 'too-short' };

	// Pick the summarization provider. Falls back to the chat's active provider
	// when no compaction-specific provider is configured.
	let summarizer = settings.providerId
		? db.select().from(providers).where(and(eq(providers.id, settings.providerId), eq(providers.userId, chat.userId!))).get()
		: null;
	if (!summarizer) {
		summarizer = chat.overrideProviderId
			? db.select().from(providers).where(eq(providers.id, chat.overrideProviderId)).get()
			: db.select().from(providers).where(and(eq(providers.userId, chat.userId!), eq(providers.enabled, true))).get();
	}
	if (!summarizer) return { ran: false, reason: 'no-provider' };

	// Size off the CHAT's provider, not the summarizer — the auto-trigger
	// threshold and the avatar context ring are both measured against the
	// chat provider's window. The summarizer might use a smaller model.
	const chatProvider = chat.overrideProviderId
		? db.select().from(providers).where(eq(providers.id, chat.overrideProviderId)).get() ?? summarizer
		: db.select().from(providers).where(and(eq(providers.userId, chat.userId!), eq(providers.enabled, true))).get() ?? summarizer;
	const targetContextSize = chatProvider.contextSize ?? 32768;

	const highlightsCap = computeHighlightsCap(targetContextSize);
	const toCompact = pickMessagesToCompact(uncompacted, settings, targetContextSize, minTailKeep);
	if (toCompact.length === 0) return { ran: false, reason: 'nothing-to-pick' };

	const model = settings.model || summarizer.defaultModel || '';

	// Rolling input: previous highlights → new messages. The summarizer prompt
	// instructs the model to merge them into a single fresh highlights list.
	const transcriptLines: string[] = [];
	if (chat.compactionSummary?.trim()) {
		transcriptLines.push('--- PREVIOUS HIGHLIGHTS ---');
		transcriptLines.push(chat.compactionSummary.trim());
		transcriptLines.push('');
	}
	transcriptLines.push('--- NEW MESSAGES ---');
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
		maxTokens: highlightsCap,
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

	// Belt-and-suspenders: the cap is also passed as maxTokens above, but
	// some providers ignore it or count differently. If we still overshot,
	// hard-truncate by token-proportional character count and log loudly.
	const summaryTokens = countTokens(summary);
	if (summaryTokens > highlightsCap) {
		const ratio = highlightsCap / summaryTokens;
		const cutCharCount = Math.max(64, Math.floor(summary.length * ratio));
		summary = summary.slice(0, cutCharCount).trimEnd() + '\n[...highlights truncated to fit budget...]';
		logger.warn('compaction: summary exceeded highlights cap, truncated', {
			chatId,
			summaryTokens,
			highlightsCap,
			contextSize: targetContextSize,
		});
	}

	const lastCompactedId = toCompact[toCompact.length - 1].id;
	db.update(chats)
		.set({
			// Snapshot current state so re-processing is possible.
			previousCompactionSummary: chat.compactionSummary ?? null,
			previousCompactedUpToMessageId: chat.compactedUpToMessageId ?? null,
			compactionSummary: summary,
			compactedUpToMessageId: lastCompactedId,
			compactionLastRunAt: sql`datetime('now')`,
		})
		.where(eq(chats.id, chatId))
		.run();

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
		highlightsCap,
	});

	return {
		ran: true,
		summary,
		compactedUpToMessageId: lastCompactedId,
		compactedCount: toCompact.length,
	};
}

/**
 * Re-process the last compaction batch — same message window, fresh LLM pass.
 *
 * Reconstructs the exact transcript that the last run saw (previousCompactionSummary
 * + messages from previousCompactedUpToMessageId+1 → compactedUpToMessageId) and
 * submits it to the summarizer again. `compactedUpToMessageId` does NOT change;
 * only the summary text is overwritten (the previous snapshot is updated too so
 * a second re-process still works).
 */
export async function runReprocess(chatId: number): Promise<CompactionResult> {
	if (inFlight.has(chatId)) return { ran: false, reason: 'already-running' };
	inFlight.add(chatId);
	const startedAt = Date.now();
	logger.info('compaction: reprocess triggered', { chatId });
	try {
		const result = await runReprocessInner(chatId);
		if (result.ran) {
			logger.info('compaction: reprocess completed', { chatId, durationMs: Date.now() - startedAt });
		} else {
			logger.debug('compaction: reprocess skipped', { chatId, reason: result.reason });
		}
		return result;
	} finally {
		inFlight.delete(chatId);
	}
}

async function runReprocessInner(chatId: number): Promise<CompactionResult> {
	const chat = db.select().from(chats).where(eq(chats.id, chatId)).get();
	if (!chat) return { ran: false, reason: 'chat-not-found' };
	if (!chat.compactedUpToMessageId) return { ran: false, reason: 'no-previous-compaction' };

	const settings = resolveCompactionSettings(chat, chat.userId!);

	const leafId = chat.activeLeafId;
	if (!leafId) return { ran: false, reason: 'no-active-leaf' };
	const activePath = loadActivePath(leafId);

	// Reconstruct the exact batch from the last run.
	const batchStart = chat.previousCompactedUpToMessageId ?? 0;
	const batchEnd = chat.compactedUpToMessageId;
	const batch = activePath.filter(m => m.id > batchStart && m.id <= batchEnd);
	if (batch.length === 0) return { ran: false, reason: 'batch-not-found' };

	let summarizer = settings.providerId
		? db.select().from(providers).where(and(eq(providers.id, settings.providerId), eq(providers.userId, chat.userId!))).get()
		: null;
	if (!summarizer) {
		summarizer = chat.overrideProviderId
			? db.select().from(providers).where(eq(providers.id, chat.overrideProviderId)).get()
			: db.select().from(providers).where(and(eq(providers.userId, chat.userId!), eq(providers.enabled, true))).get();
	}
	if (!summarizer) return { ran: false, reason: 'no-provider' };

	const chatProvider = chat.overrideProviderId
		? db.select().from(providers).where(eq(providers.id, chat.overrideProviderId)).get() ?? summarizer
		: db.select().from(providers).where(and(eq(providers.userId, chat.userId!), eq(providers.enabled, true))).get() ?? summarizer;
	const targetContextSize = chatProvider.contextSize ?? 32768;
	const highlightsCap = computeHighlightsCap(targetContextSize);
	const model = settings.model || summarizer.defaultModel || '';

	const transcriptLines: string[] = [];
	if (chat.previousCompactionSummary?.trim()) {
		transcriptLines.push('--- PREVIOUS HIGHLIGHTS ---');
		transcriptLines.push(chat.previousCompactionSummary.trim());
		transcriptLines.push('');
	}
	transcriptLines.push('--- NEW MESSAGES ---');
	for (const m of batch) {
		const who = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Character' : 'System';
		transcriptLines.push(`${who}: ${m.content}`);
	}

	const llm = createProvider(summarizer.type as ProviderType, {
		endpoint: summarizer.endpoint,
		apiKey: summarizer.apiKey || '',
		model,
	});
	const samplerSettings: SamplerSettings = {
		temperature: 0.4,
		topP: 1.0,
		topK: 0,
		maxTokens: highlightsCap,
		repetitionPenalty: 1.0,
		frequencyPenalty: 0.0,
		presencePenalty: 0.0,
		reasoningEffort: 'off',
	};
	const llmMessages: ChatMessage[] = [
		{ role: 'system', content: settings.prompt },
		{ role: 'user', content: transcriptLines.join('\n') },
	];

	let summary = '';
	try {
		for await (const chunk of llm.stream(llmMessages, samplerSettings)) {
			if (chunk.type === 'content') summary += chunk.text;
		}
	} catch (err) {
		logger.warn('compaction: reprocess provider stream failed', { chatId, err: String(err) });
		return { ran: false, reason: 'provider-error' };
	}

	summary = summary.trim();
	if (!summary) return { ran: false, reason: 'empty-summary' };

	const summaryTokens = countTokens(summary);
	if (summaryTokens > highlightsCap) {
		const ratio = highlightsCap / summaryTokens;
		summary = summary.slice(0, Math.max(64, Math.floor(summary.length * ratio))).trimEnd() + '\n[...highlights truncated to fit budget...]';
	}

	// Keep `compactedUpToMessageId` unchanged — we're redoing the same batch.
	db.update(chats)
		.set({
			previousCompactionSummary: chat.previousCompactionSummary ?? null,
			previousCompactedUpToMessageId: chat.previousCompactedUpToMessageId ?? null,
			compactionSummary: summary,
			compactionLastRunAt: sql`datetime('now')`,
		})
		.where(eq(chats.id, chatId))
		.run();

	const fresh = db.select().from(chats).where(eq(chats.id, chatId)).get();
	if (fresh) broadcast(chat.userId!, { type: 'chat:updated', id: chatId, chat: fresh as any });

	return {
		ran: true,
		summary,
		compactedUpToMessageId: batchEnd,
		compactedCount: batch.length,
	};
}

// Keep `messages` reachable for the planned manual-reset endpoint.
void messages;
