import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db, rawDb } from '$lib/db/index.js';
import { messages, chats } from '$lib/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth.js';
import { broadcast } from '$lib/server/realtime.js';
import { recomputeChatTail } from '$lib/db/chatTail.js';

export const PATCH: RequestHandler = async (event) => {
	const user = requireUser(event);
	const id = Number(event.params.id);
	const body = await event.request.json();

	const message = db.select().from(messages).where(eq(messages.id, id)).get();
	if (!message) return json({ error: 'Message not found' }, { status: 404 });

	// Verify ownership through chat
	const chat = db.select().from(chats).where(and(eq(chats.id, message.chatId), eq(chats.userId, user.id))).get();
	if (!chat) return json({ error: 'Not found' }, { status: 404 });

	// Swipe navigation: change active swipe index
	if ('swipeIndex' in body) {
		const swipes: string[] = JSON.parse(message.swipes || '[]');
		const reasoningSwipes: string[] = JSON.parse(message.reasoning || '[]');
		const newIndex = Number(body.swipeIndex);

		if (newIndex < 0 || newIndex >= swipes.length) {
			return json({ error: 'Invalid swipe index' }, { status: 400 });
		}

		db.update(messages)
			.set({
				swipeIndex: newIndex,
				content: swipes[newIndex]
			})
			.where(eq(messages.id, id))
			.run();
		recomputeChatTail(message.chatId);

		broadcast(user.id, {
			type: 'message:patched',
			chatId: message.chatId,
			id,
			patch: { swipeIndex: newIndex, content: swipes[newIndex], reasoning: reasoningSwipes[newIndex] || '' }
		});
		return json({
			id,
			swipeIndex: newIndex,
			content: swipes[newIndex],
			reasoning: reasoningSwipes[newIndex] || ''
		});
	}

	// Edit message content
	if ('content' in body) {
		const content = String(body.content);
		const swipes: string[] = JSON.parse(message.swipes || '[]');
		const idx = message.swipeIndex ?? 0;

		// Update the current swipe entry too
		if (swipes.length > 0 && idx < swipes.length) {
			swipes[idx] = content;
		}

		db.update(messages)
			.set({
				content,
				swipes: JSON.stringify(swipes)
			})
			.where(eq(messages.id, id))
			.run();
		recomputeChatTail(message.chatId);

		broadcast(user.id, {
			type: 'message:patched',
			chatId: message.chatId,
			id,
			patch: { content, swipes, swipeIndex: idx }
		});
		return json({ id, content, swipes, swipeIndex: idx });
	}

	// Edit reasoning for current swipe
	if ('reasoning' in body) {
		const reasoning = String(body.reasoning);
		const reasoningSwipes: string[] = JSON.parse(message.reasoning || '[]');
		const idx = message.swipeIndex ?? 0;

		// Ensure array is long enough
		while (reasoningSwipes.length <= idx) reasoningSwipes.push('');
		reasoningSwipes[idx] = reasoning;

		db.update(messages)
			.set({ reasoning: JSON.stringify(reasoningSwipes) })
			.where(eq(messages.id, id))
			.run();

		broadcast(user.id, {
			type: 'message:patched',
			chatId: message.chatId,
			id,
			patch: { reasoning: reasoningSwipes, swipeIndex: idx }
		});
		return json({ id, reasoning: reasoningSwipes, swipeIndex: idx });
	}

	// Edit per-message reply guidance text. Used by the assistant-reply
	// Guide menu — updates the assistant message's own guidance so future
	// regenerations of THIS reply pick it up.
	if ('guidance' in body) {
		const raw = body.guidance;
		const guidance = typeof raw === 'string' && raw.trim() ? raw : null;
		db.update(messages)
			.set({ guidance })
			.where(eq(messages.id, id))
			.run();

		broadcast(user.id, {
			type: 'message:patched',
			chatId: message.chatId,
			id,
			patch: { guidance }
		});
		return json({ id, guidance });
	}

	return json({ error: 'No valid update fields' }, { status: 400 });
};

// Helper: collect all descendant message IDs.
// Uses a recursive CTE so we don't have to slurp the whole chat into JS
// just to walk a few branches (M8).
function getDescendantIds(messageId: number, chatId: number): number[] {
	const rows = rawDb.prepare(
		`WITH RECURSIVE descendants(id) AS (
			SELECT id FROM messages WHERE parent_id = ? AND chat_id = ?
			UNION ALL
			SELECT m.id FROM messages m
			JOIN descendants d ON m.parent_id = d.id
			WHERE m.chat_id = ?
		)
		SELECT id FROM descendants`
	).all(messageId, chatId, chatId) as { id: number }[];
	return rows.map(r => r.id);
}

export const DELETE: RequestHandler = async (event) => {
	const user = requireUser(event);
	const id = Number(event.params.id);
	const modeParam = event.url.searchParams.get('mode');
	const deleteMode: 'single' | 'thread' = modeParam === 'single' ? 'single' : 'thread';

	const message = db.select().from(messages).where(eq(messages.id, id)).get();
	if (!message) return json({ error: 'Message not found' }, { status: 404 });

	// Verify ownership through chat
	const ownerChat = db.select().from(chats).where(and(eq(chats.id, message.chatId), eq(chats.userId, user.id))).get();
	if (!ownerChat) return json({ error: 'Not found' }, { status: 404 });

	if (deleteMode === 'single') {
		const allMsgs = db.select().from(messages).where(eq(messages.chatId, message.chatId)).all();
		const directChildren = allMsgs
			.filter((m) => m.parentId === id)
			.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));

		// Promote direct children to this message's parent so deleting one node
		// keeps the surrounding branch intact.
		for (const child of directChildren) {
			db.update(messages)
				.set({ parentId: message.parentId ?? null })
				.where(eq(messages.id, child.id))
				.run();
		}

		db.delete(messages).where(eq(messages.id, id)).run();

		let newLeafId: number | null = ownerChat.activeLeafId ?? null;
		if (ownerChat.activeLeafId === id) {
			if (directChildren.length > 0) {
				const remainingAfterDelete = db
					.select()
					.from(messages)
					.where(eq(messages.chatId, message.chatId))
					.all();
				const childrenOf = new Map<number, typeof remainingAfterDelete>();
				for (const m of remainingAfterDelete) {
					if (m.parentId != null) {
						if (!childrenOf.has(m.parentId)) childrenOf.set(m.parentId, []);
						childrenOf.get(m.parentId)!.push(m);
					}
				}
				let leaf = directChildren[0];
				while (true) {
					const children = childrenOf.get(leaf.id);
					if (!children || children.length === 0) break;
					children.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
					leaf = children[0];
				}
				newLeafId = leaf.id;
			} else {
				newLeafId = message.parentId ?? null;
			}
		}

		db.update(chats).set({ activeLeafId: newLeafId }).where(eq(chats.id, message.chatId)).run();
		recomputeChatTail(message.chatId);
		broadcast(user.id, { type: 'message:deleted', chatId: message.chatId, ids: [id] });
		return json({ success: true, newActiveLeafId: newLeafId, mode: deleteMode });
	}

	// Thread delete: remove this message and all descendants.
	const descendantIds = getDescendantIds(id, message.chatId);
	const allIdsToDelete = [id, ...descendantIds];
	for (const delId of allIdsToDelete) {
		db.delete(messages).where(eq(messages.id, delId)).run();
	}

	const chat = db.select().from(chats).where(eq(chats.id, message.chatId)).get();
	if (chat) {
		const parentId = message.parentId ?? null;
		const allMsgs = db.select().from(messages).where(eq(messages.chatId, message.chatId)).all();
		const remainingChildren = allMsgs
			.filter(m => (m.parentId ?? null) === parentId)
			.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));

		let newLeafId: number | null = parentId;
		if (remainingChildren.length > 0) {
			const childrenOf = new Map<number, typeof allMsgs>();
			for (const m of allMsgs) {
				if (m.parentId != null) {
					if (!childrenOf.has(m.parentId)) childrenOf.set(m.parentId, []);
					childrenOf.get(m.parentId)!.push(m);
				}
			}
			let leaf = remainingChildren[remainingChildren.length - 1];
			while (true) {
				const children = childrenOf.get(leaf.id);
				if (!children || children.length === 0) break;
				children.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
				leaf = children[0];
			}
			newLeafId = leaf.id;
		}

		db.update(chats).set({ activeLeafId: newLeafId }).where(eq(chats.id, message.chatId)).run();
		recomputeChatTail(message.chatId);
		broadcast(user.id, { type: 'message:deleted', chatId: message.chatId, ids: allIdsToDelete });
		return json({ success: true, newActiveLeafId: newLeafId, mode: deleteMode });
	}

	recomputeChatTail(message.chatId);
	broadcast(user.id, { type: 'message:deleted', chatId: message.chatId, ids: allIdsToDelete });
	return json({ success: true, newActiveLeafId: message.parentId ?? null, mode: deleteMode });
};
