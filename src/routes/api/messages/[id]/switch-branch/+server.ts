import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { messages, chats } from '$lib/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth.js';
import { revertLeafUserMessages } from '$lib/server/chatRevert.js';

// POST: Switch to a sibling branch. Accepts { direction: -1 | 0 | 1 }
// direction -1/1: Find sibling at currentIndex + direction, walk to deepest leaf
// direction 0: Walk from this message's first child to deepest leaf (undo branch)
export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const messageId = Number(event.params.id);
	const { direction } = await event.request.json();

	if (direction !== -1 && direction !== 0 && direction !== 1) {
		return json({ error: 'direction must be -1, 0, or 1' }, { status: 400 });
	}

	const message = db.select().from(messages).where(eq(messages.id, messageId)).get();
	if (!message) return json({ error: 'Message not found' }, { status: 404 });

	// Verify ownership through chat
	const chat = db.select().from(chats).where(and(eq(chats.id, message.chatId), eq(chats.userId, user.id))).get();
	if (!chat) return json({ error: 'Not found' }, { status: 404 });

	// Load all messages for this chat
	const allMsgs = db.select().from(messages).where(eq(messages.chatId, message.chatId)).all();

	// Build children map for leaf-walking
	const childrenOf = new Map<number, typeof allMsgs>();
	for (const m of allMsgs) {
		if (m.parentId != null) {
			if (!childrenOf.has(m.parentId)) childrenOf.set(m.parentId, []);
			childrenOf.get(m.parentId)!.push(m);
		}
	}

	let startMsg: typeof message;

	if (direction === 0) {
		// "Undo branch": walk from this message's first child to deepest leaf
		const children = childrenOf.get(messageId);
		if (!children || children.length === 0) {
			return json({ error: 'No children to return to' }, { status: 400 });
		}
		children.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
		startMsg = children[0];
	} else {
		// Find siblings (messages with the same parentId), sorted by createdAt
		const siblings = allMsgs
			.filter(m => (m.parentId ?? null) === (message.parentId ?? null))
			.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));

		const currentIndex = siblings.findIndex(m => m.id === messageId);
		const newIndex = currentIndex + direction;

		if (newIndex < 0 || newIndex >= siblings.length) {
			return json({ error: 'No sibling in that direction' }, { status: 400 });
		}
		startMsg = siblings[newIndex];
	}

	// Walk from startMsg to deepest leaf (following first child)
	let leaf = startMsg;
	while (true) {
		const children = childrenOf.get(leaf.id);
		if (!children || children.length === 0) break;
		children.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
		leaf = children[0];
	}

	// Update activeLeafId
	db.update(chats).set({ activeLeafId: leaf.id }).where(eq(chats.id, message.chatId)).run();

	// If the deepest leaf on this branch is a user message, unsend it back
	// into the chat bar so the invariant (leaf != user) holds.
	const reverted = revertLeafUserMessages(message.chatId, user.id);
	const finalLeaf = reverted.changed ? reverted.newActiveLeafId : leaf.id;

	return json({ success: true, activeLeafId: finalLeaf });
};
