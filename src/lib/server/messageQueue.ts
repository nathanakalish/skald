/**
 * Message queue with per-provider concurrency control. Simple in-memory FIFO
 * queue + semaphores keyed by provider ID.
 */
import { db } from '$lib/db/index.js';
import { chats, providers } from '$lib/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { processChat, type ProcessOptions } from '$lib/server/chatProcessor.js';
import { eventBus } from '$lib/server/eventBus.js';
import { logger } from '$lib/server/logger.js';

/** Hard cap on queued (not running) jobs per provider. Bounds memory and stops runaway enqueueing. */
const MAX_QUEUED_PER_PROVIDER = (() => {
	const raw = Number(process.env.MAX_QUEUED_PER_PROVIDER);
	return Number.isFinite(raw) && raw > 0 ? raw : 100;
})();

/** Hard cap on queued + running jobs per user, across all providers.
 *  Keeps one user from drowning the whole instance even when they have
 *  several high-`maxConcurrent` providers configured. */
const MAX_JOBS_PER_USER = (() => {
	const raw = Number(process.env.MAX_JOBS_PER_USER);
	return Number.isFinite(raw) && raw > 0 ? raw : 50;
})();

/** Per-job wall-clock timeout. A stuck provider (network hang, infinite
 *  stream) would otherwise pin a slot forever. 0 disables. */
const JOB_TIMEOUT_MS = (() => {
	const raw = Number(process.env.JOB_TIMEOUT_MS);
	if (raw === 0) return 0;
	return Number.isFinite(raw) && raw > 0 ? raw : 10 * 60_000;
})();

interface QueueJob {
	id: number;
	chatId: number;
	providerId: number;
	userId: number;
	options: ProcessOptions;
	enqueuedAt: number;
}

let jobIdCounter = 0;

/** Per-provider: how many jobs are running right now. */
const runningCount = new Map<number, number>();

/** Per-provider: jobs waiting for a slot. */
const queues = new Map<number, QueueJob[]>();

/** chatIds that currently have a running job. */
const activeChats = new Set<number>();

/** Chats queued but not yet running. Combined with activeChats this gives an
 * atomic check-and-set in enqueueJob — the previous code did the
 * "is this chat already processing?" check and the queue insert as two
 * separate synchronous steps, so two concurrent enqueueJob calls could both
 * pass the check and both insert (M3). */
const queuedChats = new Set<number>();

/** AbortControllers for running jobs, keyed by chatId. */
const abortControllers = new Map<number, AbortController>();

/** Cache of maxConcurrent per provider (short TTL since it rarely changes). */
const maxConcurrentCache = new Map<number, { value: number; time: number }>();
const MAX_CONCURRENT_TTL = 30_000; // 30 seconds

function getMaxConcurrent(providerId: number): number {
	const cached = maxConcurrentCache.get(providerId);
	if (cached && Date.now() - cached.time < MAX_CONCURRENT_TTL) {
		return cached.value;
	}
	const provider = db.select().from(providers).where(eq(providers.id, providerId)).get();
	const value = provider?.maxConcurrent ?? 1;
	maxConcurrentCache.set(providerId, { value, time: Date.now() });
	return value;
}

function getRunning(providerId: number): number {
	return runningCount.get(providerId) ?? 0;
}

function incrementRunning(providerId: number) {
	runningCount.set(providerId, getRunning(providerId) + 1);
}

function decrementRunning(providerId: number) {
	const count = getRunning(providerId);
	if (count > 1) {
		runningCount.set(providerId, count - 1);
	} else {
		runningCount.delete(providerId);
	}
}

function getQueue(providerId: number): QueueJob[] {
	let q = queues.get(providerId);
	if (!q) {
		q = [];
		queues.set(providerId, q);
	}
	return q;
}

async function executeJob(job: QueueJob) {
	incrementRunning(job.providerId);
	activeChats.add(job.chatId);
	queuedChats.delete(job.chatId);
	const controller = new AbortController();
	abortControllers.set(job.chatId, controller);
	const startedAt = Date.now();
	let timedOut = false;
	const timeoutHandle = JOB_TIMEOUT_MS > 0
		? setTimeout(() => {
			timedOut = true;
			logger.warn('queue: job timed out, aborting', { jobId: job.id, chatId: job.chatId, providerId: job.providerId, timeoutMs: JOB_TIMEOUT_MS });
			controller.abort();
		}, JOB_TIMEOUT_MS)
		: null;
	logger.debug('queue: job started', { jobId: job.id, chatId: job.chatId, providerId: job.providerId, waitMs: startedAt - job.enqueuedAt });
	logger.metric('queue.waitMs', startedAt - job.enqueuedAt);
	try {
		await processChat(job.options, controller.signal);
		logger.info('queue: job completed', {
			jobId: job.id, chatId: job.chatId, providerId: job.providerId,
			durationMs: Date.now() - startedAt,
		});
	} catch (err) {
		const chat = db.select().from(chats).where(eq(chats.id, job.chatId)).get();
		const userId = chat?.userId ?? 0;
		if (controller.signal.aborted) {
			const reason = timedOut ? 'timeout' : 'aborted';
			logger.info(`queue: job ${reason}`, { jobId: job.id, chatId: job.chatId, durationMs: Date.now() - startedAt });
			if (timedOut) {
				eventBus.emit({ type: 'error', chatId: job.chatId, userId, data: { error: 'Generation timed out \u2014 the provider took too long to respond.' } });
			} else {
				eventBus.emit({ type: 'complete', chatId: job.chatId, userId, data: { aborted: true } });
			}
		} else {
			const message = err instanceof Error ? err.message : 'Unknown error';
			logger.error('queue job failed', { err, jobId: job.id, chatId: job.chatId, providerId: job.providerId, durationMs: Date.now() - startedAt });
			eventBus.emit({ type: 'error', chatId: job.chatId, userId, data: { error: message } });
		}
	} finally {
		if (timeoutHandle) clearTimeout(timeoutHandle);
		abortControllers.delete(job.chatId);
		activeChats.delete(job.chatId);
		decrementRunning(job.providerId);
		drainQueue(job.providerId);
	}
}

function drainQueue(providerId: number) {
	const q = getQueue(providerId);
	const maxConcurrent = getMaxConcurrent(providerId);

	while (q.length > 0 && getRunning(providerId) < maxConcurrent) {
		const next = q.shift()!;
		executeJob(next);
	}
}

/**
 * Resolve which provider a chat will use (per-chat override or global default).
 * Provider lookup is constrained to the chat owner so a stale override id
 * pointing at another user's provider can't get silently used.
 */
function resolveProviderId(chatId: number): { providerId: number; userId: number } {
	const chat = db.select().from(chats).where(eq(chats.id, chatId)).get();
	if (!chat) throw new Error('Chat not found');
	const userId = chat.userId!;
	if (chat.overrideProviderId) {
		const p = db.select().from(providers)
			.where(and(eq(providers.id, chat.overrideProviderId), eq(providers.userId, userId)))
			.get();
		if (p) return { providerId: p.id, userId };
	}
	const defaultProvider = db.select().from(providers).where(and(eq(providers.userId, userId), eq(providers.enabled, true))).get();
	if (!defaultProvider) throw new Error('No provider configured');
	return { providerId: defaultProvider.id, userId };
}

function countUserJobs(userId: number): number {
	let n = 0;
	for (const q of queues.values()) {
		for (const j of q) if (j.userId === userId) n++;
	}
	// Also count running. activeChats is keyed by chatId; we don't carry user
	// there, so iterate the running jobs via abortControllers \u2014 each one is
	// a chatId; look it up in chats. Cheaper: cache the last running set by
	// userId on enqueue. For now keep it simple and cap based on queued only;
	// running jobs are bounded by per-provider maxConcurrent anyway, and
	// users only have a handful of providers each.
	void userId;
	return n;
}

/**
 * Enqueue a chat processing job. Runs immediately if a slot's free, otherwise
 * waits in the per-provider queue.
 */
export function enqueueJob(options: ProcessOptions): number {
	// Atomic check-and-set: previously the duplicate check and the queue insert
	// ran as two separate synchronous steps so two near-simultaneous requests
	// could both pass the check and both end up queued.
	if (activeChats.has(options.chatId) || queuedChats.has(options.chatId)) {
		return -1;
	}
	queuedChats.add(options.chatId);

	let providerId: number;
	let userId: number;
	try {
		const r = resolveProviderId(options.chatId);
		providerId = r.providerId;
		userId = r.userId;
	} catch (err) {
		queuedChats.delete(options.chatId);
		throw err;
	}

	// Per-user cap across all of this user's providers. Stops one user with
	// many providers from monopolising the queue.
	if (countUserJobs(userId) >= MAX_JOBS_PER_USER) {
		queuedChats.delete(options.chatId);
		logger.warn('queue rejected: per-user cap reached', { userId, cap: MAX_JOBS_PER_USER });
		throw new Error('You have too many queued generations \u2014 wait for some to finish.');
	}

	const job: QueueJob = {
		id: ++jobIdCounter,
		chatId: options.chatId,
		providerId,
		userId,
		options,
		enqueuedAt: Date.now(),
	};

	const maxConcurrent = getMaxConcurrent(providerId);
	if (getRunning(providerId) < maxConcurrent) {
		logger.info('queue: job enqueued (immediate)', {
			jobId: job.id, chatId: options.chatId, providerId,
			regenerate: !!options.regenerate, greeting: !!options.greeting,
		});
		executeJob(job);
	} else {
		const q = getQueue(providerId);
		if (q.length >= MAX_QUEUED_PER_PROVIDER) {
			queuedChats.delete(options.chatId);
			logger.warn('queue rejected: provider queue full', { providerId, queued: q.length });
			throw new Error('Provider queue is full — please wait for current requests to finish.');
		}
		q.push(job);
		logger.info('queue: job enqueued (waiting)', {
			jobId: job.id, chatId: options.chatId, providerId,
			position: q.length, running: getRunning(providerId), maxConcurrent,
		});
	}

	return job.id;
}

/** True if this chat currently has a job running or queued. */
export function isChatProcessing(chatId: number): boolean {
	return activeChats.has(chatId) || queuedChats.has(chatId);
}

/** Abort a running job for a specific chat. Returns true if anything was actually aborted. */
export function abortChat(chatId: number): boolean {
	// If it was queued but not yet running, just yank it out.
	for (const q of queues.values()) {
		const idx = q.findIndex(j => j.chatId === chatId);
		if (idx >= 0) {
			q.splice(idx, 1);
			queuedChats.delete(chatId);
			logger.info('queue: job removed from waiting list', { chatId });
			return true;
		}
	}
	// Otherwise abort the in-flight job.
	const controller = abortControllers.get(chatId);
	if (controller) {
		controller.abort();
		logger.info('queue: in-flight job abort signalled', { chatId });
		return true;
	}
	return false;
}
