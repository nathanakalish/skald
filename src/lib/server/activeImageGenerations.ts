/**
 * In-memory registry of currently in-flight image generations.
 *
 * Mirrors `activeGenerations` but for the image gen pipeline. Image jobs are
 * fired by `POST /api/messages/[id]/images`: validation runs synchronously,
 * the row is registered here, and the actual `generateImage()` call (which
 * can take 30s+) runs in the background while the HTTP response returns
 * immediately. The registry lets the SSE catch-up code tell newly-connected
 * clients (a second device, or a reload mid-generation) which messages are
 * still generating so the bubble/lightbox spinners reappear.
 *
 * Keyed by messageId because image gen is per-message; a single chat can
 * have multiple messages generating in parallel.
 */

import { logger } from '$lib/server/logger.js';

export interface ActiveImageGen {
	messageId: number;
	chatId: number;
	userId: number;
	swipeIndex: number;
	startedAt: number;
}

const _byMessageId = new Map<number, ActiveImageGen>();

export const activeImageGenerations = {
	start(opts: {
		messageId: number;
		chatId: number;
		userId: number;
		swipeIndex: number;
	}): ActiveImageGen {
		const gen: ActiveImageGen = {
			messageId: opts.messageId,
			chatId: opts.chatId,
			userId: opts.userId,
			swipeIndex: opts.swipeIndex,
			startedAt: Date.now(),
		};
		_byMessageId.set(opts.messageId, gen);
		return gen;
	},
	clear(messageId: number) {
		_byMessageId.delete(messageId);
	},
	get(messageId: number): ActiveImageGen | undefined {
		return _byMessageId.get(messageId);
	},
	has(messageId: number): boolean {
		return _byMessageId.has(messageId);
	},
	getForUser(userId: number): ActiveImageGen[] {
		const out: ActiveImageGen[] = [];
		for (const gen of _byMessageId.values()) {
			if (gen.userId === userId) out.push(gen);
		}
		return out;
	},
	getForChat(chatId: number): Array<{ messageId: number; swipeIndex: number }> {
		const out: Array<{ messageId: number; swipeIndex: number }> = [];
		for (const gen of _byMessageId.values()) {
			if (gen.chatId === chatId) out.push({ messageId: gen.messageId, swipeIndex: gen.swipeIndex });
		}
		return out;
	},
};

// Safety net for crashed / abandoned image jobs. Slightly more generous than
// the text-gen sweep because some workflows (esp. ComfyUI) legitimately take
// several minutes per image. Anything older than 30 minutes is treated as
// abandoned and gets purged so the registry doesn't leak.
const STALE_GENERATION_MS = 30 * 60 * 1000;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const sweep = setInterval(() => {
	const cutoff = Date.now() - STALE_GENERATION_MS;
	let deletedCount = 0;
	for (const [messageId, gen] of _byMessageId) {
		if (gen.startedAt < cutoff) {
			_byMessageId.delete(messageId);
			deletedCount++;
		}
	}
	if (deletedCount > 0) {
		logger.warn('activeImageGenerations: swept stale entries', { deletedCount });
	}
}, SWEEP_INTERVAL_MS);
sweep.unref?.();
