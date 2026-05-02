import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { chats } from '$lib/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { processChatInline } from '$lib/server/chatProcessor.js';
import { requireUser } from '$lib/server/auth.js';

/**
 * SSE streaming endpoint used by impersonation (direct fetch from client).
 * Delegates to processChatInline which shares the same code path as regular messages.
 */
export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const { chatId, impersonate } = await event.request.json();

	if (!chatId) return json({ error: 'chatId required' }, { status: 400 });

	// Verify ownership
	const chat = db.select().from(chats).where(and(eq(chats.id, chatId), eq(chats.userId, user.id))).get();
	if (!chat) return json({ error: 'Chat not found' }, { status: 404 });

	const encoder = new TextEncoder();

	// Combine the request's incoming abort signal with a stream-cancel controller
	// so that closing the SSE connection or the client disconnecting both abort
	// the upstream LLM call (otherwise we keep burning tokens for nothing).
	const abortController = new AbortController();
	const onRequestAbort = () => abortController.abort();
	event.request.signal.addEventListener('abort', onRequestAbort);

	const stream = new ReadableStream({
		async start(controller) {
			function send(data: string) {
				try {
					controller.enqueue(encoder.encode(`data: ${data}\n\n`));
				} catch { /* stream closed */ }
			}

			try {
				await processChatInline(
					{ chatId, impersonate: !!impersonate },
					{
						onTokenStats(stats) {
							send(JSON.stringify({ tokenStats: {
								contextSize: stats.contextSize,
								maxResponseTokens: stats.maxResponseTokens,
								promptTokens: stats.promptTokens,
								availableForPrompt: stats.availableForPrompt,
								breakdown: stats.breakdown,
							} }));
						},
						onReasoning(text) {
							send(JSON.stringify({ reasoning: text }));
						},
						onToken(text) {
							send(JSON.stringify({ token: text }));
						},
						onError(error) {
							send(JSON.stringify({ error }));
						},
						onDone() {
							send('[DONE]');
						},
					},
					abortController.signal
				);
			} finally {
				event.request.signal.removeEventListener('abort', onRequestAbort);
				try { controller.close(); } catch { /* already closed */ }
			}
		},
		cancel() {
			// SSE consumer (browser) closed the connection — stop the LLM call
			abortController.abort();
			event.request.signal.removeEventListener('abort', onRequestAbort);
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive',
		}
	});
};
