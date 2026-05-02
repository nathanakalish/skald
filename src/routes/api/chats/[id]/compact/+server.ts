import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { chats } from '$lib/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth.js';
import { runCompaction } from '$lib/server/compactionService.js';

/**
 * Manually run a compaction pass on this chat. Bypasses the enabled flag —
 * the user explicitly invoked it from the chat menu, so respect that.
 */
export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const id = Number(event.params.id);
	const chat = db.select().from(chats).where(and(eq(chats.id, id), eq(chats.userId, user.id))).get();
	if (!chat) return json({ error: 'Not found' }, { status: 404 });

	const result = await runCompaction(id, { force: true });
	if (!result.ran) {
		return json({ ok: false, reason: result.reason ?? 'unknown' }, { status: 400 });
	}
	return json({
		ok: true,
		summary: result.summary,
		compactedUpToMessageId: result.compactedUpToMessageId,
		compactedCount: result.compactedCount,
	});
};
