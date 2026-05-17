import type { ChatMessage } from '$lib/providers/base.js';
import { countMessageTokens, computeTokenBudget, trimHistoryToFitBudget, type TokenBudget } from '$lib/services/tokenizer.js';
import { logger } from '$lib/server/logger.js';
import type { MessageRow } from '$lib/server/chatTree.js';
import { DROPPABLE_SLOTS, type PromptSlot } from './types.js';
import { flattenSlots } from './slots.js';

/**
 * Three-pass token budget enforcement.
 *
 *   Pass 1 — accept the initial build as-is.
 *   Pass 2 — if overflow, trim history from the front and rebuild (lorebook
 *            injection depends on history length, so a re-build is required,
 *            not just a `messages.slice()`).
 *   Pass 3 — if still overflow, drop optional slots in `DROPPABLE_SLOTS` order.
 *
 * Load-bearing slots (system, character, persona, customPrompt, history,
 * guidance, nudge, starterNudge) are NEVER dropped — if they alone exceed
 * the budget we log loudly and let the provider deal with it. Truncating
 * those from the front would silently nuke the framing the model relies on.
 */
export interface EnforceBudgetArgs {
	initialSlots: PromptSlot[];
	fullHistory: MessageRow[];
	contextSize: number;
	maxResponseTokens: number;
	/** Rebuilds the full slot list given a trimmed history slice. */
	rebuild: (trimmedHistory: MessageRow[]) => PromptSlot[];
	/** For logging only. */
	chatId: number;
}

export interface EnforceBudgetResult {
	messages: ChatMessage[];
	slots: PromptSlot[];
	tokenStats: TokenBudget;
	droppedSlots: string[];
}

export function enforceBudget(args: EnforceBudgetArgs): EnforceBudgetResult {
	const { initialSlots, fullHistory, contextSize, maxResponseTokens, rebuild, chatId } = args;

	// Pass 1
	let activeSlots = initialSlots;
	let flattened = flattenSlots(activeSlots);
	let tokenStats = computeTokenBudget(activeSlots, contextSize, maxResponseTokens);
	const droppedSlots: string[] = [];

	// Pass 2: history trim + full rebuild
	if (tokenStats.overflow > 0) {
		const nonHistoryTokens = activeSlots
			.filter(s => s.name !== 'history')
			.reduce((sum, s) => sum + countMessageTokens(s.messages), 0);

		const historySlot = activeSlots.find(s => s.name === 'history');
		if (historySlot) {
			const { trimmed } = trimHistoryToFitBudget(historySlot.messages, nonHistoryTokens, contextSize, maxResponseTokens);

			// Map the trimmed `ChatMessage[]` back to a `MessageRow[]` slice. The
			// trimmer drops oldest first, so the kept count off the end of the
			// full history is what we need. We exclude system messages (lorebook
			// injection) from the count.
			const trimmedNonSystem = trimmed.filter(m => m.role !== 'system').length;
			const keepCount = Math.min(trimmedNonSystem, fullHistory.length);
			// Array.slice(-0) returns the WHOLE array — guard explicitly.
			const trimmedHistory = keepCount > 0 ? fullHistory.slice(-keepCount) : [];

			activeSlots = rebuild(trimmedHistory);
			flattened = flattenSlots(activeSlots);
			tokenStats = computeTokenBudget(activeSlots, contextSize, maxResponseTokens);
		}
	}

	// Pass 3: drop optional slots one at a time, recomputing after each.
	if (tokenStats.overflow > 0) {
		// Work on a copy of the sorted/filtered active list so the dropped
		// indices match what we emit at the end.
		const slotsArr = flattened.activeSlots.slice();
		for (const dropName of DROPPABLE_SLOTS) {
			if (tokenStats.overflow <= 0) break;
			const idx = slotsArr.findIndex(s => s.name === dropName);
			if (idx === -1) continue;
			const dropped = slotsArr.splice(idx, 1)[0];
			const newStats = computeTokenBudget(slotsArr, contextSize, maxResponseTokens);
			logger.warn('budget: dropped optional slot to fit context', {
				chatId,
				slot: dropName,
				freedTokens: tokenStats.promptTokens - newStats.promptTokens,
				overflowBefore: tokenStats.overflow,
				overflowAfter: newStats.overflow,
				droppedMessages: dropped.messages.length,
			});
			droppedSlots.push(dropName);
			tokenStats = newStats;
		}
		activeSlots = slotsArr;
		flattened = { messages: slotsArr.flatMap(s => s.messages), activeSlots: slotsArr };

		if (tokenStats.overflow > 0) {
			// Static content (system + character + persona + customPrompt +
			// guidance + lorebook + nudge) alone exceeds the budget. The
			// provider is about to truncate or reject — log loudly so it
			// shows up in operator logs and the SSE error channel.
			logger.warn('budget: prompt still exceeds context after all trimming — provider may truncate or error', {
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
		messages: flattened.messages,
		slots: activeSlots,
		tokenStats,
		droppedSlots,
	};
}
