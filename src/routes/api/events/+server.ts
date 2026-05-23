import type { RequestHandler } from './$types';
import { eventBus } from '$lib/server/eventBus.js';
import { requireUser } from '$lib/server/auth.js';
import { presence } from '$lib/server/presence.js';
import { activeGenerations } from '$lib/server/activeGenerations.js';
import { activeImageGenerations } from '$lib/server/activeImageGenerations.js';
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
					logger.warn('sse: backpressure threshold exceeded, closing slow consumer', {
						userId: user.id, sessionId, desiredSize: desired,
					});
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

			// Liveness sentinel sent BEFORE any replay / subscription work, so
			// the client knows this stream is actually being served by us (not
			// e.g. a reverse-proxy cached 200 that briefly fires `onopen` but
			// never delivers real data). Sent as a named event with `id: 0` so
			// it doesn't pollute Last-Event-ID tracking.
			safeEnqueue(encoder.encode('event: connected\nid: 0\ndata: ok\n\n'));

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
			// Image generations: synthetic `messageImage:started` for each
			// in-flight job so reconnecting clients (reload, second device,
			// nav back into the chat) restore their spinner state.
			for (const img of activeImageGenerations.getForUser(user.id)) {
				send(0, JSON.stringify({
					id: 0,
					type: 'messageImage:started',
					userId: user.id,
					chatId: img.chatId,
					data: {
						type: 'messageImage:started',
						chatId: img.chatId,
						messageId: img.messageId,
						swipeIndex: img.swipeIndex
					}
				}));
			}

			for (const gen of activeGenerations.getForUser(user.id)) {
				const base = { userId: user.id, chatId: gen.chatId };
				send(0, JSON.stringify({
					id: 0,
					type: 'streaming',
					...base,
					data: { active: true, isRegenerate: gen.isRegenerate, isImpersonation: gen.isImpersonation, originalMessageId: gen.originalMessageId }
				}));
				if (gen.tokenStats) {
					send(0, JSON.stringify({ id: 0, type: 'tokenStats', ...base, data: { ...gen.tokenStats, isImpersonation: gen.isImpersonation } }));
				}
				if (gen.accumulatedReasoning) {
					send(0, JSON.stringify({
						id: 0, type: 'reasoning', ...base,
						// catchup: true tells the client to replace accumulated state
						// rather than append — avoids doubling on tab-switch reconnects.
						data: { reasoning: gen.accumulatedReasoning, isImpersonation: gen.isImpersonation, catchup: true }
					}));
				}
				if (gen.accumulated) {
					send(0, JSON.stringify({
						id: 0, type: 'token', ...base,
						data: { token: gen.accumulated, isImpersonation: gen.isImpersonation, catchup: true }
					}));
				}
			}

			unsubscribe = eventBus.subscribe((event) => {
				// `server-shutdown` is a broadcast to every connection — forward it
				// regardless of userId, then close so the client can reconnect to
				// the new process on its normal backoff.
				if (event.type === 'server-shutdown') {
					send(event.id, JSON.stringify(event));
					try { controller.close(); } catch { /* already closed */ }
					cleanup();
					return;
				}
				// Otherwise only forward events for this user's chats.
				if (event.userId === user.id) {
					send(event.id, JSON.stringify(event));
				}
			});

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
