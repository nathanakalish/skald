/**
 * Helpers that maintain the denormalised tail (`lastMessage` + `lastMessageRole`)
 * on `chats`. The sidebar reads these columns directly so it doesn't have to
 * run a per-chat "latest message" subquery.
 *
 * Two flavours:
 *
 *   bumpChatTail(chatId, content, role)
 *     Cheapest path. Use when you just inserted/updated a message and you
 *     already know it's the new tail (i.e. no future-dated message exists).
 *     Fires one UPDATE.
 *
 *   recomputeChatTail(chatId)
 *     Use after deleting a message. Looks up the new latest message via the
 *     idx_messages_chat_created covering index and writes it. Two queries
 *     (one indexed SELECT, one UPDATE).
 *
 * Both also bump `updatedAt` so the sidebar order updates without callers
 * having to remember to set it, AND broadcast a `chat:patched` realtime
 * event so other tabs/devices sync their sidebar previews.
 */
import { db } from './index.js';
import { chats, messages } from './schema.js';
import { eq, desc, sql } from 'drizzle-orm';
import { broadcast } from '$lib/server/realtime.js';

const TAIL_MAX = 200;

function truncate(content: string): string {
	return content.length > TAIL_MAX ? content.slice(0, TAIL_MAX) : content;
}

function broadcastTail(chatId: number, lastMessage: string, lastMessageRole: string) {
	const owner = db
		.select({ userId: chats.userId, updatedAt: chats.updatedAt })
		.from(chats)
		.where(eq(chats.id, chatId))
		.get();
	if (!owner) return;
	broadcast(owner.userId, {
		type: 'chat:patched',
		id: chatId,
		patch: {
			lastMessage,
			lastMessageRole,
			updatedAt: owner.updatedAt
		} as any
	});
}

export function bumpChatTail(chatId: number, content: string, role: string): void {
	const lastMessage = truncate(content ?? '');
	const lastMessageRole = role ?? '';
	db.update(chats)
		.set({
			lastMessage,
			lastMessageRole,
			updatedAt: sql`datetime('now')`
		})
		.where(eq(chats.id, chatId))
		.run();
	broadcastTail(chatId, lastMessage, lastMessageRole);
}

export function recomputeChatTail(chatId: number): void {
	const lm = db
		.select({ content: messages.content, role: messages.role })
		.from(messages)
		.where(eq(messages.chatId, chatId))
		.orderBy(desc(messages.createdAt))
		.limit(1)
		.get();
	const lastMessage = truncate(lm?.content ?? '');
	const lastMessageRole = lm?.role ?? '';
	db.update(chats)
		.set({
			lastMessage,
			lastMessageRole,
			updatedAt: sql`datetime('now')`
		})
		.where(eq(chats.id, chatId))
		.run();
	broadcastTail(chatId, lastMessage, lastMessageRole);
}
