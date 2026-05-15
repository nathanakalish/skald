import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { chats, characters, messages } from '$lib/db/schema.js';
import { eq, and, asc } from 'drizzle-orm';
import { cacheImage } from '$lib/services/imageCache.js';
import { requireUser } from '$lib/server/auth.js';
import {
	loadActivePath,
	loadActivePathPage,
	loadSiblings,
	loadSiblingsScoped,
	type MessageRow,
} from '$lib/server/chatTree.js';
import { revertLeafUserMessages } from '$lib/server/chatRevert.js';
import { logger } from '$lib/server/logger.js';

export const GET: RequestHandler = async (event) => {
	const user = requireUser(event);
	const chatId = Number(event.params.id);
	const limitParam = event.url.searchParams.get('limit');
	const offsetParam = event.url.searchParams.get('offset');
	const limit = limitParam ? Math.max(1, Number(limitParam)) : null;
	const offset = offsetParam ? Math.max(0, Number(offsetParam)) : 0;

	let chat = db.select().from(chats).where(and(eq(chats.id, chatId), eq(chats.userId, user.id))).get();
	if (!chat) return json({ error: 'Chat not found' }, { status: 404 });

	// Lazy migration: any leaf user message gets unsent into the chat bar.
	// Re-read the chat row if anything changed so the impersonation snapshot
	// we ship to the client is current.
	const reverted = revertLeafUserMessages(chatId, user.id);
	if (reverted.changed) {
		chat = db.select().from(chats).where(and(eq(chats.id, chatId), eq(chats.userId, user.id))).get()!;
	}

	const character = db
		.select()
		.from(characters)
		.where(eq(characters.id, chat.characterId))
		.get();
	if (!character) return json({ error: 'Character not found' }, { status: 404 });

	// Lazy-resolve background image from extensions if not yet cached
	if (!character.backgroundPath) {
		try {
			const ext = JSON.parse(character.extensions || '{}');
			const bgUrl = ext?.chub?.background_image;
			if (bgUrl && typeof bgUrl === 'string' && bgUrl.startsWith('http')) {
				const cached = await cacheImage(bgUrl);
				if (cached !== bgUrl) {
					db.update(characters).set({ backgroundPath: cached }).where(eq(characters.id, character.id)).run();
					character.backgroundPath = cached;
				}
			}
		} catch (err) { logger.warn('chat data: malformed character.extensions JSON', { characterId: character.id, err: String(err) }); }
	}

	// Build active path + sibling info.
	//
	// When limit is set we use the optimised pair: loadActivePathPage walks
	// only limit+offset+1 steps from the leaf (instead of all N messages),
	// and loadSiblingsScoped queries only the parent_ids that are actually
	// visible in the returned window (instead of the full chat). For a
	// 2000-message chat with pageSize=50 this goes from ~2000 row reads to
	// ~51 — a 40× reduction in data loaded from disk.
	let messageList: MessageRow[] = [];
	let totalMessages = 0;

	if (chat.activeLeafId) {
		if (limit) {
			const page = loadActivePathPage(chat.activeLeafId, limit, offset);
			messageList = page.messages;
			totalMessages = page.total;
		} else {
			messageList = loadActivePath(chat.activeLeafId);
			totalMessages = messageList.length;
		}
	} else {
		// No active leaf — fall back to walking children from the root via the leftmost branch.
		// This is rare; do the small chat-wide load to preserve existing behavior.
		const allMessages = db.select().from(messages).where(eq(messages.chatId, chatId)).orderBy(asc(messages.createdAt)).all() as unknown as MessageRow[];
		if (allMessages.length > 0) {
			const childrenOf = new Map<number | null, MessageRow[]>();
			for (const m of allMessages) {
				const key = m.parentId ?? null;
				if (!childrenOf.has(key)) childrenOf.set(key, []);
				childrenOf.get(key)!.push(m);
			}
			let current = childrenOf.get(null)?.[0];
			while (current) {
				messageList.push(current);
				current = childrenOf.get(current.id)?.[0];
			}
			if (messageList.length > 0) {
				const leafId = messageList[messageList.length - 1].id;
				db.update(chats).set({ activeLeafId: leafId }).where(eq(chats.id, chatId)).run();
			}
		}
		totalMessages = messageList.length;
	}

	// Sibling info: scoped to the visible window when paginated, full chat otherwise.
	const siblingsByParent = limit
		? loadSiblingsScoped(chatId, messageList)
		: loadSiblings(chatId).siblingsByParent;

	const messageSiblings: Record<number, { index: number; total: number }> = {};
	for (const m of messageList) {
		const siblings = siblingsByParent.get(m.parentId ?? null) ?? [m.id];
		messageSiblings[m.id] = {
			index: siblings.indexOf(m.id),
			total: siblings.length,
		};
	}

	const lastMsg = messageList[messageList.length - 1];
	const hiddenBranchCount = lastMsg ? (siblingsByParent.get(lastMsg.id)?.length ?? 0) : 0;

	return json({
		chat,
		character,
		messages: messageList,
		messageSiblings,
		hiddenBranchCount,
		totalMessages,
	});
};
