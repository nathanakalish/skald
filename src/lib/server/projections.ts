/**
 * Shared drizzle projections + ownership-check helper.
 *
 * A pile of API endpoints want only a subset of columns from `characters` /
 * `chats` for list views (sidebar, picker, search results). This is the one
 * source of truth for those projections so the field lists don't drift
 * between endpoints.
 *
 * `ownedBy()` collapses the `and(eq(table.id, id), eq(table.userId, user.id))`
 * incantation that shows up 50+ times across the API surface.
 */
import { characters, chats } from '$lib/db/schema.js';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { and, eq } from 'drizzle-orm';

/**
 * Lightweight character projection. Just the fields the sidebar / picker /
 * editor list actually need. Heavy fields (firstMessage, alternateGreetings,
 * personality, scenario, systemPrompt, mesExample, postHistoryInstructions,
 * creatorNotes, extensions) are fetched on demand via GET /api/characters/:id
 * when the editor opens.
 */
export const characterLight = {
	id: characters.id,
	name: characters.name,
	avatarPath: characters.avatarPath,
	description: characters.description,
	tags: characters.tags,
	creator: characters.creator,
	characterVersion: characters.characterVersion,
	theme: characters.theme,
	backgroundPath: characters.backgroundPath,
	createdAt: characters.createdAt,
	updatedAt: characters.updatedAt
} as const;

/**
 * Sidebar chat projection — what the chat list / search uses. Joined against
 * `characters` for the inline character name + avatar columns.
 */
export const chatSidebar = {
	id: chats.id,
	title: chats.title,
	characterId: chats.characterId,
	characterName: characters.name,
	characterAvatar: characters.avatarPath,
	mode: chats.mode,
	pinned: chats.pinned,
	pinOrder: chats.pinOrder,
	updatedAt: chats.updatedAt,
	unread: chats.unread,
	muted: chats.muted,
	lastMessage: chats.lastMessage,
	lastMessageRole: chats.lastMessageRole
} as const;

/**
 * `ownedBy(table.id, id, user.id)` → `and(eq(table.id, id), eq(table.userId, user.id))`.
 * Pass the actual `id` column so the helper can pull `userId` off the same
 * table. Keeps the call sites short without losing the explicit ownership
 * intent at the read site.
 *
 * Example:
 *   db.select().from(chats).where(ownedBy(chats.id, chatId, user.id)).get();
 */
export function ownedBy(idCol: SQLiteColumn, idVal: number, userId: number) {
	const table = (idCol as any).table as { userId: SQLiteColumn };
	return and(eq(idCol, idVal), eq(table.userId, userId));
}
