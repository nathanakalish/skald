/**
 * In-memory registry of currently in-flight LLM generations.
 *
 * Mirrors what the streaming pipeline emits onto the eventBus, but as
 * persistent per-chat state. Lets newly-connecting SSE clients (e.g. a
 * second device opening the chat mid-stream, or a tab reconnecting) be
 * told what's currently generating so they can render the typing
 * indicator and any tokens that have already streamed.
 *
 * A given chatId can only have one active generation at a time
 * (enforced upstream by messageQueue.isChatProcessing).
 */

import { logger } from '$lib/server/logger.js';

export interface ActiveGeneration {
	chatId: number;
	userId: number;
	isRegenerate: boolean;
	isImpersonation: boolean;
	originalMessageId: number | null;
	accumulated: string;
	accumulatedReasoning: string;
	tokenStats: any | null;
	startedAt: number;
}

const _byChatId = new Map<number, ActiveGeneration>();

export const activeGenerations = {
	start(opts: {
		chatId: number;
		userId: number;
		isRegenerate?: boolean;
		isImpersonation?: boolean;
		originalMessageId?: number | null;
	}): ActiveGeneration {
		const gen: ActiveGeneration = {
			chatId: opts.chatId,
			userId: opts.userId,
			isRegenerate: !!opts.isRegenerate,
			isImpersonation: !!opts.isImpersonation,
			originalMessageId: opts.originalMessageId ?? null,
			accumulated: '',
			accumulatedReasoning: '',
			tokenStats: null,
			startedAt: Date.now(),
		};
		_byChatId.set(opts.chatId, gen);
		return gen;
	},
	appendToken(chatId: number, token: string) {
		const gen = _byChatId.get(chatId);
		if (gen) gen.accumulated += token;
	},
	appendReasoning(chatId: number, reasoning: string) {
		const gen = _byChatId.get(chatId);
		if (gen) gen.accumulatedReasoning += reasoning;
	},
	setTokenStats(chatId: number, stats: any) {
		const gen = _byChatId.get(chatId);
		if (gen) gen.tokenStats = stats;
	},
	clear(chatId: number) {
		_byChatId.delete(chatId);
	},
	get(chatId: number): ActiveGeneration | undefined {
		return _byChatId.get(chatId);
	},
	getForUser(userId: number): ActiveGeneration[] {
		const out: ActiveGeneration[] = [];
		for (const gen of _byChatId.values()) {
			if (gen.userId === userId) out.push(gen);
		}
		return out;
	},
};

// Safety net for crashed/abandoned generations: anything older than an hour is
// almost certainly orphaned (the LLM call would have timed out long before).
// Without this the registry leaks one entry per crashed stream until restart.
const STALE_GENERATION_MS = 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const sweep = setInterval(() => {
	const cutoff = Date.now() - STALE_GENERATION_MS;
	let deletedCount = 0;
	for (const [chatId, gen] of _byChatId) {
		if (gen.startedAt < cutoff) {
			_byChatId.delete(chatId);
			deletedCount++;
		}
	}
	if (deletedCount > 0) {
		logger.warn('activeGenerations: swept stale entries', { deletedCount });
	}
}, SWEEP_INTERVAL_MS);
sweep.unref?.();
