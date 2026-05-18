/**
 * Shared drizzle projections.
 *
 * A pile of API endpoints want only a subset of columns from `characters` /
 * `chats` for list views (sidebar, picker, search results). This is the one
 * source of truth for those projections so the field lists don't drift
 * between endpoints.
 */
import { characters, chats } from '$lib/db/schema.js';

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
