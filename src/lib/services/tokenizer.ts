import { getEncoding } from 'js-tiktoken';
import type { ChatMessage } from '$lib/providers/base.js';

// Cache encoders so we don't re-init on every call.
let cl100kEncoder: ReturnType<typeof getEncoding> | null = null;

function getEncoder() {
	if (!cl100kEncoder) {
		// cl100k_base covers GPT-4, GPT-3.5, and is a reasonable approximation for
		// Claude and the rest (~5-10% variance, which is fine for a budget meter).
		cl100kEncoder = getEncoding('cl100k_base');
	}
	return cl100kEncoder;
}

/**
 * Count tokens in a string.
 */
export function countTokens(text: string): number {
	if (!text) return 0;
	return getEncoder().encode(text).length;
}

/**
 * Token count for an array of chat messages, including framing overhead
 * (role + delimiters). Based on OpenAI's token counting guide — ~4 tokens
 * of overhead per message.
 */
export function countMessageTokens(messages: ChatMessage[]): number {
	let total = 0;
	for (const msg of messages) {
		total += 4; // per-message framing overhead
		total += countTokens(msg.content);
	}
	total += 2; // conversation priming
	return total;
}

/**
 * Detailed token breakdown by prompt slot.
 */
export interface TokenBudget {
	contextSize: number;
	maxResponseTokens: number;
	availableForPrompt: number;
	promptTokens: number;
	breakdown: {
		name: string;
		tokens: number;
	}[];
	overflow: number; // tokens over budget (0 if we fit)
}

/**
 * Given assembled prompt slots, compute token budget and surface any overflow.
 */
export function computeTokenBudget(
	slots: { name: string; messages: ChatMessage[] }[],
	contextSize: number,
	maxResponseTokens: number
): TokenBudget {
	const availableForPrompt = contextSize - maxResponseTokens;
	const breakdown = slots.map(slot => ({
		name: slot.name,
		tokens: countMessageTokens(slot.messages)
	}));
	const promptTokens = breakdown.reduce((sum, b) => sum + b.tokens, 0);
	const overflow = Math.max(0, promptTokens - availableForPrompt);

	return {
		contextSize,
		maxResponseTokens,
		availableForPrompt,
		promptTokens,
		breakdown,
		overflow
	};
}

/**
 * Trim chat history to fit a token budget. Drops oldest messages first so the
 * most recent context stays. Returns the trimmed history and how many got cut.
 */
export function trimHistoryToFitBudget(
	historyMessages: ChatMessage[],
	otherTokens: number,
	contextSize: number,
	maxResponseTokens: number
): { trimmed: ChatMessage[]; removed: number } {
	const availableForHistory = contextSize - maxResponseTokens - otherTokens;

	if (availableForHistory <= 0) {
		return { trimmed: [], removed: historyMessages.length };
	}

	// Walk backwards from the most recent message until we run out of budget.
	const result: ChatMessage[] = [];
	let tokenCount = 2; // conversation priming
	let i = historyMessages.length - 1;

	while (i >= 0) {
		const msgTokens = 4 + countTokens(historyMessages[i].content);
		if (tokenCount + msgTokens > availableForHistory) break;
		tokenCount += msgTokens;
		result.unshift(historyMessages[i]);
		i--;
	}

	return {
		trimmed: result,
		removed: historyMessages.length - result.length
	};
}
