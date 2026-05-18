import { randomUUID } from 'node:crypto';
import { logger } from '$lib/server/logger.js';
import { matchLorebookEntries } from '$lib/services/lorebook.js';
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
		providerType: ctx.activeProvider.type,
		rebuild: (trimmedHistory) => {
			// PROMPT-H1: lorebook matches must follow the trimmed history.
			// Keywords that lived only in messages we just dropped should no
			// longer pull their entries into the prompt; conversely, this also
			// keeps `constant` entries injecting against the smaller window.
			ctx.lorebookEntries = matchLorebookEntries(ctx.character.id, ctx.chat.id, trimmedHistory);
			return buildSlots(ctx, trimmedHistory);
		},
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
