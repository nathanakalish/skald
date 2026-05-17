import { randomUUID } from 'node:crypto';
import { logger } from '$lib/server/logger.js';
import { loadPromptContext } from './loadContext.js';
import { buildSlots } from './slots.js';
import { enforceBudget } from './budget.js';
import type { BuildChatContextResult, ProcessOptions, ResolvedContext } from './types.js';

export type { ProcessOptions, BuildChatContextResult, ResolvedContext } from './types.js';
export { SLOT_ORDER, DROPPABLE_SLOTS } from './types.js';
export { loadPromptContext } from './loadContext.js';
export { resolveGuidance } from './resolveGuidance.js';
export { buildSlots, flattenSlots } from './slots.js';
export { enforceBudget } from './budget.js';

/**
 * Public entry point. Resolves all DB state, builds the slot graph, enforces
 * the token budget, and hands back everything `chatProcessor` needs to call
 * the provider.
 *
 * The `buildId` is unique per call — useful for cross-referencing the
 * `prompt: built` log line with downstream logs and the UI's token-stats
 * payload.
 */
export function buildChatContext(chatId: number, opts: ProcessOptions): BuildChatContextResult {
	const buildId = randomUUID();
	const t0 = Date.now();
	const ctx = loadPromptContext(chatId, opts);

	const initialSlots = buildSlots(ctx, ctx.chatMessages);
	const result = enforceBudget({
		initialSlots,
		fullHistory: ctx.chatMessages,
		contextSize: ctx.contextSize,
		maxResponseTokens: ctx.maxResponseTokens,
		rebuild: (trimmedHistory) => buildSlots(ctx, trimmedHistory),
		chatId,
	});

	logger.debug('prompt: built', {
		buildId,
		chatId,
		userId: ctx.chatUserId,
		mode: ctx.chatMode,
		impersonate: !!opts.impersonate,
		greeting: !!opts.greeting,
		regenerate: !!opts.regenerate,
		promptTokens: result.tokenStats.promptTokens,
		availableForPrompt: result.tokenStats.availableForPrompt,
		overflow: result.tokenStats.overflow,
		droppedSlots: result.droppedSlots,
		guidanceSources: ctx.guidance.sources,
		durationMs: Date.now() - t0,
	});

	return {
		chat: ctx.chat,
		character: ctx.character,
		activeProvider: ctx.activeProvider,
		activeModel: ctx.activeModel,
		samplerSettings: ctx.samplerSettings,
		llmMessages: result.messages,
		tokenStats: result.tokenStats,
		streamingEnabled: ctx.streamingEnabled,
		chatUserId: ctx.chatUserId,
		buildId,
	};
}
