import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { messages, chats } from '$lib/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth.js';
import { revertLeafUserMessages } from '$lib/server/chatRevert.js';
import {
	findSiblingIds,
	walkToDeepestLeaf,
	loadActivePathPage,
	loadSiblingsScoped,
} from '$lib/server/chatTree.js';

// POST: Switch to a sibling branch. Accepts { direction: -1 | 0 | 1, limit?: number }
// direction -1/1: Find sibling at currentIndex + direction, walk to deepest leaf
// direction 0: Walk from this message's first child to deepest leaf (undo branch)
export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const messageId = Number(event.params.id);
	const body = await event.request.json();
	const { direction } = body;
	// Caller passes its page size so we can return the new window inline,
	// saving a second round-trip. Defaults to 50 if omitted.
	const limit = typeof body.limit === 'number' && body.limit > 0 ? body.limit : 50;

	if (direction !== -1 && direction !== 0 && direction !== 1) {
		return json({ error: 'direction must be -1, 0, or 1' }, { status: 400 });
	}

	const message = db.select().from(messages).where(eq(messages.id, messageId)).get();
	if (!message) return json({ error: 'Message not found' }, { status: 404 });

	// Verify ownership through chat
	const chat = db.select().from(chats).where(and(eq(chats.id, message.chatId), eq(chats.userId, user.id))).get();
	if (!chat) return json({ error: 'Not found' }, { status: 404 });

	let targetLeafId: number;

	if (direction === 0) {
		// "Undo branch": walk from this message's first child to deepest leaf.
		// findSiblingIds returns children of this message's parent (its siblings).
		// For undo we need children OF this message — walkToDeepestLeaf handles
		// that by following the first child chain starting from this message's
		// first child. But we need to detect "no children" first.
		const siblingIds = findSiblingIds(messageId, message.chatId);
		// siblingIds here would be children of messageId... wait, no.
		// findSiblingIds(parentId, chatId) returns children with parent_id = parentId.
		// For direction=0 we want children of messageId, i.e. messages whose parent = messageId.
		// That's findSiblingIds(messageId, chatId) — pass messageId as the parentId.
		if (siblingIds.length === 0) {
			return json({ error: 'No children to return to' }, { status: 400 });
		}
		// walkToDeepestLeaf starting from the first child
		targetLeafId = walkToDeepestLeaf(siblingIds[0]);
	} else {
		// Left/right sibling navigation.
		const siblingIds = findSiblingIds(message.parentId ?? null, message.chatId);
		const currentIndex = siblingIds.indexOf(messageId);
		const newIndex = currentIndex + direction;

		if (newIndex < 0 || newIndex >= siblingIds.length) {
			return json({ error: 'No sibling in that direction' }, { status: 400 });
		}
		targetLeafId = walkToDeepestLeaf(siblingIds[newIndex]);
	}

	// Update activeLeafId
	db.update(chats).set({ activeLeafId: targetLeafId }).where(eq(chats.id, message.chatId)).run();

	// Unsend any user message that ended up as the new leaf
	const reverted = revertLeafUserMessages(message.chatId, user.id);
	const finalLeafId = reverted.changed ? (reverted.newActiveLeafId ?? targetLeafId) : targetLeafId;

	// Return the new message window inline so the client can render immediately
	// without a second GET to /api/chats/[id]/data.
	const page = finalLeafId ? loadActivePathPage(finalLeafId, limit, 0) : { messages: [], total: 0 };
	const siblingsByParent = loadSiblingsScoped(message.chatId, page.messages);

	const messageSiblings: Record<number, { index: number; total: number }> = {};
	for (const m of page.messages) {
		const siblings = siblingsByParent.get(m.parentId ?? null) ?? [m.id];
		messageSiblings[m.id] = { index: siblings.indexOf(m.id), total: siblings.length };
	}

	const lastMsg = page.messages[page.messages.length - 1];
	const hiddenBranchCount = lastMsg ? (siblingsByParent.get(lastMsg.id)?.length ?? 0) : 0;

	return json({
		success: true,
		activeLeafId: finalLeafId,
		messages: page.messages,
		messageSiblings,
		hiddenBranchCount,
		totalMessages: page.total,
	});
};
