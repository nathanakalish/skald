import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { chats } from '$lib/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { enqueueJob, isChatProcessing } from '$lib/server/messageQueue.js';
import { requireUser } from '$lib/server/auth.js';

/**
 * Kick off a background impersonation generation. Tokens stream out via
 * the per-user SSE event endpoint (same path regular sends use), so the
 * generation survives navigating away and shows up on every device.
 */
export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const { chatId, impersonate, guidance } = await event.request.json();

	if (!chatId) return json({ error: 'chatId required' }, { status: 400 });

	const chat = db.select().from(chats).where(and(eq(chats.id, chatId), eq(chats.userId, user.id))).get();
	if (!chat) return json({ error: 'Chat not found' }, { status: 404 });
	if (chat.deletedAt != null) return json({ error: 'Chat has been deleted' }, { status: 410 });

	if (isChatProcessing(chatId)) {
		event.locals.logger?.warn('chat: stream rejected (already processing)', { chatId });
		return json({ error: 'Chat already has an in-flight generation' }, { status: 409 });
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
