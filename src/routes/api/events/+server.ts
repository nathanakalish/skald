import type { RequestHandler } from './$types';
import { eventBus } from '$lib/server/eventBus.js';
import { requireUser } from '$lib/server/auth.js';
import { presence } from '$lib/server/presence.js';
import { activeGenerations } from '$lib/server/activeGenerations.js';
import { logger } from '$lib/server/logger.js';

/**
 * Per-user SSE endpoint. Client opens one EventSource for chat events
 * (tokens, completions, errors, unread updates) on their own chats. Honours
 * Last-Event-ID for replaying anything missed during a reconnect.
 */
export const GET: RequestHandler = (requestEvent) => {
	const user = requireUser(requestEvent);
	const sessionId = requestEvent.url.searchParams.get('sid') ?? crypto.randomUUID();
	const lastEventId = parseInt(requestEvent.request.headers.get('Last-Event-ID') ?? '0', 10) || 0;
	let unsubscribe: (() => void) | null = null;
	let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

	// Register presence for this connection.
	const registeredAt = presence.register(user.id, sessionId);
	const connectedAt = Date.now();
	logger.debug('sse: client connected', { userId: user.id, sessionId, lastEventId });

	function cleanup() {
		if (unsubscribe) { unsubscribe(); unsubscribe = null; }
		if (keepaliveTimer) { clearInterval(keepaliveTimer); keepaliveTimer = null; }
		presence.unregister(user.id, sessionId, registeredAt);
		logger.debug('sse: client disconnected', {
			userId: user.id, sessionId, durationMs: Date.now() - connectedAt,
		});
	}

	const stream = new ReadableStream({
		start(controller) {
			const encoder = new TextEncoder();

			/**
			 * SSE backpressure guard. Without this, a slow consumer (mobile on a
			 * flaky connection) builds an unbounded internal queue inside
			 * `controller`, eventually OOM-ing the server. `desiredSize` reports
			 * remaining capacity — negative values mean we've already overflowed.
			 * Drop the connection rather than queue more.
			 */
			const SSE_BACKPRESSURE_LIMIT = -1024 * 1024; // 1 MiB beyond highWaterMark
			function safeEnqueue(chunk: Uint8Array): boolean {
				const desired = controller.desiredSize ?? 0;
				if (desired < SSE_BACKPRESSURE_LIMIT) {
					try { controller.close(); } catch { /* already closed */ }
					cleanup();
					return false;
				}
				try {
					controller.enqueue(chunk);
					return true;
				} catch {
					cleanup();
					return false;
				}
			}

			function send(id: number, data: string) {
				safeEnqueue(encoder.encode(`id: ${id}\ndata: ${data}\n\n`));
			}

			// Keepalive comment every 30s so proxies don't time us out.
			keepaliveTimer = setInterval(() => {
				safeEnqueue(encoder.encode(': keepalive\n\n'));
			}, 30000);

			// Replay any events missed since the last connection.
			if (lastEventId > 0) {
				const missed = eventBus.replay(lastEventId, user.id);
				for (const event of missed) {
					send(event.id, JSON.stringify(event));
				}
			}

			// Replay any in-flight generations so a newly-connected client (e.g.
			// a second device, or a reload mid-stream) can render the typing
			// indicator and the tokens that already streamed before it joined.
			// id 0 keeps these synthetic events out of the client's lastEventId
			// tracking.
			for (const gen of activeGenerations.getForUser(user.id)) {
				const base = { userId: user.id, chatId: gen.chatId };
				send(0, JSON.stringify({
					id: 0,
					type: 'streaming',
					...base,
					data: { active: true, isRegenerate: gen.isRegenerate, originalMessageId: gen.originalMessageId }
				}));
				if (gen.tokenStats) {
					send(0, JSON.stringify({ id: 0, type: 'tokenStats', ...base, data: gen.tokenStats }));
				}
				if (gen.accumulatedReasoning) {
					send(0, JSON.stringify({
						id: 0, type: 'reasoning', ...base,
						data: { reasoning: gen.accumulatedReasoning }
					}));
				}
				if (gen.accumulated) {
					send(0, JSON.stringify({
						id: 0, type: 'token', ...base,
						data: { token: gen.accumulated }
					}));
				}
			}

			unsubscribe = eventBus.subscribe((event) => {
				// Only forward events for this user's chats.
				if (event.userId === user.id) {
					send(event.id, JSON.stringify(event));
				}
			});

			controller.enqueue(encoder.encode(': connected\n\n'));
		},
		cancel() {
			cleanup();
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			'Connection': 'keep-alive',
			'X-Accel-Buffering': 'no',
		}
	});
};
