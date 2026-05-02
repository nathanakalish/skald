import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { chats } from '$lib/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth.js';
import { buildChatContext } from '$lib/server/chatContext.js';
import { logger } from '$lib/server/logger.js';

/**
 * Returns the current token usage for the chat's prompt as it would be sent
 * to the LLM right now (no message added). Used by the avatar context ring
 * so it stays accurate even before the first send / after compaction.
 */
export const GET: RequestHandler = async (event) => {
	const user = requireUser(event);
	const id = Number(event.params.id);
	const chat = db.select().from(chats).where(and(eq(chats.id, id), eq(chats.userId, user.id))).get();
	if (!chat) return json({ error: 'Not found' }, { status: 404 });

	try {
		const ctx = buildChatContext(id, { chatId: id });
		return json({
			contextSize: ctx.tokenStats.contextSize,
			maxResponseTokens: ctx.tokenStats.maxResponseTokens,
			availableForPrompt: ctx.tokenStats.availableForPrompt,
			promptTokens: ctx.tokenStats.promptTokens,
			breakdown: ctx.tokenStats.breakdown,
		});
	} catch (err) {
		logger.warn('token-stats: build failed', { chatId: id, err: String(err) });
		return json({ error: 'Could not compute' }, { status: 500 });
	}
};
