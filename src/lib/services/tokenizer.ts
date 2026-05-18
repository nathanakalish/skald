import { getEncoding } from 'js-tiktoken';
import type { ChatMessage } from '$lib/providers/base.js';

// PROV-H2: route each provider to the tokenizer encoding closest to what it
// actually uses, and apply a small safety multiplier for providers whose true
// tokenizer we can't run in-process. Overestimating by a few percent is far
// better than the previous behaviour, where Claude/Gemini/Ollama chats would
// silently overshoot the context window because cl100k underestimates them.
//
// Encoding picks:
//   - `o200k_base` — GPT-4o family, Claude 3+ (closer than cl100k by ~10%)
//   - `cl100k_base` — GPT-4/3.5, plus a safe-ish default for everything else
//
// Multipliers are deliberately conservative; the prompt builder will trim a
// little earlier than strictly necessary in exchange for not blowing budget.

type TokEncoding = 'cl100k_base' | 'o200k_base';

interface TokenizerProfile {
	encoding: TokEncoding;
	/** Multiplier applied to content tokens (not framing overhead). */
	safetyMultiplier: number;
}

function profileFor(providerType: string | undefined): TokenizerProfile {
	switch (providerType) {
		case 'anthropic':
			return { encoding: 'o200k_base', safetyMultiplier: 1.15 };
		case 'gemini':
			return { encoding: 'cl100k_base', safetyMultiplier: 1.20 };
		case 'ollama':
			return { encoding: 'cl100k_base', safetyMultiplier: 1.25 };
		case 'zai':
			// Z.ai uses a custom tokenizer — treat like a small-margin unknown.
			return { encoding: 'cl100k_base', safetyMultiplier: 1.10 };
		case 'openai':
		case 'deepseek':
		case 'openrouter':
		case 'xai':
		case 'mistral':
		case 'groq':
		case 'together':
		case 'fireworks':
		case 'perplexity':
		case 'cerebras':
		case 'cohere':
			// All OpenAI-protocol providers — cl100k is the canonical encoding.
			// Modern OpenAI models actually use o200k; close enough either way.
			return { encoding: 'cl100k_base', safetyMultiplier: 1.0 };
		default:
			return { encoding: 'cl100k_base', safetyMultiplier: 1.0 };
	}
}

// Cache encoders so we don't re-init on every call.
const _encoderCache = new Map<TokEncoding, ReturnType<typeof getEncoding>>();
function getEncoder(encoding: TokEncoding) {
	const hit = _encoderCache.get(encoding);
	if (hit) return hit;
	const enc = getEncoding(encoding);
	_encoderCache.set(encoding, enc);
	return enc;
}

// LRU token-count cache (PERF-H1).
//
// `enforceBudget` runs three passes per send and re-tokenises the same
// history strings each time; long chats blow most of the pre-TTFT budget
// on this. Persisting a `tokenCount` column is the "real" fix but
// requires a schema migration and invalidation discipline at every
// message edit site — a content-keyed LRU gets the same wins for the
// process-local hot path without changing the DB.
//
// Cap is generous on purpose: 4 KiB avg message × 5 000 entries ≈ 20 MiB
// of strings plus the Map overhead — trivial on a self-host box.
//
// Cache key now includes the encoding so cl100k and o200k counts don't
// alias each other when a user has providers of both kinds.
const TOKEN_CACHE_MAX = 5000;
const _tokenCache = new Map<string, number>();

function cachedCount(text: string, encoding: TokEncoding): number {
	const key = encoding + '|' + text;
	const hit = _tokenCache.get(key);
	if (hit !== undefined) {
		// Touch for LRU ordering.
		_tokenCache.delete(key);
		_tokenCache.set(key, hit);
		return hit;
	}
	const n = getEncoder(encoding).encode(text).length;
	_tokenCache.set(key, n);
	if (_tokenCache.size > TOKEN_CACHE_MAX) {
		// Drop oldest entry (Map iterates in insertion order).
		const oldest = _tokenCache.keys().next().value;
		if (oldest !== undefined) _tokenCache.delete(oldest);
	}
	return n;
}

/**
 * Count tokens in a string. Memoised — see `_tokenCache` above.
 *
 * Pass `providerType` to use a provider-appropriate encoding and safety
 * multiplier (PROV-H2). Omit it for legacy callers; defaults to cl100k with
 * no multiplier.
 */
export function countTokens(text: string, providerType?: string): number {
	if (!text) return 0;
	const p = profileFor(providerType);
	const raw = cachedCount(text, p.encoding);
	return p.safetyMultiplier === 1.0 ? raw : Math.ceil(raw * p.safetyMultiplier);
}

/** Test / diagnostic helper — drops the in-process token cache. */
export function _clearTokenCacheForTests(): void {
	_tokenCache.clear();
}

/**
 * Token count for an array of chat messages, including framing overhead
 * (role + delimiters). Based on OpenAI's token counting guide — ~4 tokens
 * of overhead per message.
 *
 * Pass `providerType` to use a provider-appropriate encoding (PROV-H2). The
 * provider's safety multiplier is also applied to the framing constants so
 * non-OpenAI providers (whose chat-template overhead we can't measure
 * directly) get the same conservative margin on framing as on content
 * (PROMPT-M1). For openai/clones the multiplier is 1.0 so this is a no-op.
 */
export function countMessageTokens(messages: ChatMessage[], providerType?: string): number {
	const p = profileFor(providerType);
	let total = 0;
	for (const msg of messages) {
		total += 4; // per-message framing overhead
		total += countTokens(msg.content, providerType);
	}
	total += 2; // conversation priming
	// Apply the multiplier to the framing constants too — they were the
	// only piece of the budget left at a flat OpenAI estimate.
	if (p.safetyMultiplier !== 1.0) {
		const framing = messages.length * 4 + 2;
		const content = total - framing;
		total = content + Math.ceil(framing * p.safetyMultiplier);
	}
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
	maxResponseTokens: number,
	providerType?: string
): TokenBudget {
	const availableForPrompt = contextSize - maxResponseTokens;
	const breakdown = slots.map(slot => ({
		name: slot.name,
		tokens: countMessageTokens(slot.messages, providerType)
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
	maxResponseTokens: number,
	providerType?: string
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
		const msgTokens = 4 + countTokens(historyMessages[i].content, providerType);
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
