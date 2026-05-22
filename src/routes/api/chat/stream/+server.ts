import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { chats } from '$lib/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { enqueueJob, isChatProcessing } from '$lib/server/messageQueue.js';
import { requireUser } from '$lib/server/auth.js';
import { ApiError } from '$lib/server/apiError.js';

/**
 * Kick off a background impersonation generation. Tokens stream out via
 * the per-user SSE event endpoint (same path regular sends use), so the
 * generation survives navigating away and shows up on every device.
 */
export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const { chatId, impersonate, guidance } = await event.request.json();

	if (!chatId) return ApiError.badRequest('chatId required');

	const chat = db.select().from(chats).where(and(eq(chats.id, chatId), eq(chats.userId, user.id))).get();
	if (!chat) return ApiError.notFound('Chat not found');
	if (chat.deletedAt != null) return ApiError.gone('Chat has been deleted');

	if (isChatProcessing(chatId)) {
		event.locals.logger?.warn('chat: stream rejected (already processing)', { chatId });
		return ApiError.conflict('Chat already has an in-flight generation');
	}

	try {
		const jobId = enqueueJob({
			chatId,
			impersonate: !!impersonate,
			guidance: typeof guidance === 'string' && guidance.trim() ? guidance : undefined,
		});
		event.locals.logger?.info('chat: impersonation enqueued', { chatId, jobId, hasGuidance: !!(guidance && String(guidance).trim()) });
		return json({ ok: true, jobId });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to enqueue';
		event.locals.logger?.warn('chat: stream enqueue failed', { chatId, err: message });
		return json({ error: message }, { status: 500 });
	}
};
