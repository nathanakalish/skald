import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { chats, messages, characters, personas } from '$lib/db/schema.js';
import { desc, eq, and, sql, lt, or, like, isNull } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth.js';
import { broadcast } from '$lib/server/realtime.js';
import { bumpChatTail } from '$lib/db/chatTail.js';
import { chatSidebar } from '$lib/server/projections.js';
import { logger } from '$lib/server/logger.js';
import { enforceCreate } from '$lib/server/userLimits.js';
import { encodeChatListCursor, parseChatListCursor } from '$lib/server/chatListCursor.js';

// GET /api/chats — paginated chat list for the sidebar.
//   ?limit=N            (default 50, max 200)
//   ?cursor=<updatedAt>:<id>   (returned by previous page; omit for first page)
//   ?q=<query>          (search title + character name; bypasses pagination)
// Returns { chats: [...], nextCursor: string|null }.
//
// Pinned chats aren't paginated — they always come first on page 1 and are
// omitted from later pages. Pagination is by updatedAt of unpinned chats.
// Search ignores pinned-vs-unpinned and just returns matches by recency.
export const GET: RequestHandler = async (event) => {
	const user = requireUser(event);
	const url = event.url;
	const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 50)));
	const cursor = url.searchParams.get('cursor'); // "<updatedAt>:<id>"
	const query = (url.searchParams.get('q') ?? '').trim();

	// Search path: match title or character name, return up to `limit` rows by
	// recency. Client treats search results as ephemeral and doesn't merge
	// them into the main paginated cache.
	if (query) {
		const needle = `%${query.toLowerCase().replace(/[%_\\]/g, m => '\\' + m)}%`;
		const rows = db.select(chatSidebar)
			.from(chats)
			.innerJoin(characters, eq(chats.characterId, characters.id))
			.where(and(
				eq(chats.userId, user.id),
				isNull(chats.deletedAt),
				or(
					like(sql`lower(${chats.title})`, needle),
					like(sql`lower(${characters.name})`, needle)
				)
			))
			.orderBy(desc(chats.updatedAt), desc(chats.id))
			.limit(limit)
			.all();

		const out = rows;
		return json({ chats: out, nextCursor: null });
	}

	// First page: include pinned chats (sorted by pinOrder) before any unpinned.
	// Later pages: only unpinned chats older than the cursor.
	const isFirstPage = !cursor;

	let rows: any[];
	if (isFirstPage) {
		// All pinned + first `limit` unpinned (updatedAt desc).
		const pinned = db.select(chatSidebar)
			.from(chats)
			.innerJoin(characters, eq(chats.characterId, characters.id))
			.where(and(eq(chats.userId, user.id), isNull(chats.deletedAt), eq(chats.pinned, 1)))
			.orderBy(sql`${chats.pinOrder} ASC`)
			.all();
		const unpinned = db.select(chatSidebar)
			.from(chats)
			.innerJoin(characters, eq(chats.characterId, characters.id))
			.where(and(eq(chats.userId, user.id), isNull(chats.deletedAt), eq(chats.pinned, 0)))
			.orderBy(desc(chats.updatedAt), desc(chats.id))
			.limit(limit + 1)
			.all();
		rows = [...pinned, ...unpinned];
	} else {
		const parsedCursor = parseChatListCursor(cursor);
		if (!parsedCursor) {
			return json({ error: 'Invalid cursor' }, { status: 400 });
		}
		rows = db.select(chatSidebar)
			.from(chats)
			.innerJoin(characters, eq(chats.characterId, characters.id))
			.where(and(
				eq(chats.userId, user.id),
				isNull(chats.deletedAt),
				eq(chats.pinned, 0),
				or(
					lt(chats.updatedAt, parsedCursor.updatedAt),
					and(eq(chats.updatedAt, parsedCursor.updatedAt), lt(chats.id, parsedCursor.id))
				)
			))
			.orderBy(desc(chats.updatedAt), desc(chats.id))
			.limit(limit + 1)
			.all();
	}

	// Detect "has more" by overshooting by one.
	let nextCursor: string | null = null;
	const unpinnedRows = rows.filter(r => !r.pinned);
	if (unpinnedRows.length > limit) {
		// Drop the overshoot, use the last kept row as the cursor.
		const dropped = unpinnedRows.pop()!;
		void dropped;
		const last = unpinnedRows[unpinnedRows.length - 1];
		if (last) nextCursor = encodeChatListCursor(last.updatedAt, last.id);
		rows = isFirstPage
			? [...rows.filter(r => r.pinned), ...unpinnedRows]
			: unpinnedRows;
	}

	const out = rows;
	return json({ chats: out, nextCursor });
};

function replaceVars(text: string, charName: string, userName: string): string {
	return text
		.replace(/\{\{char\}\}/gi, charName)
		.replace(/\{\{user\}\}/gi, userName);
}

export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const { characterId, mode = 'story', useCharacterTheme } = await event.request.json();

	const limitResponse = enforceCreate('chats', user.id);
	if (limitResponse) return limitResponse;

	const character = db.select().from(characters).where(and(eq(characters.id, characterId), eq(characters.userId, user.id))).get();
	if (!character) {
		return json({ error: 'Character not found' }, { status: 404 });
	}

	// Default persona drives {{user}} substitution.
	const defaultPersona = db.select().from(personas).where(and(eq(personas.userId, user.id), eq(personas.isDefault, true))).get();
	const userName = defaultPersona?.name || 'User';

	const chat = db
		.insert(chats)
		.values({
			userId: user.id,
			characterId,
			title: `Chat with ${character.name}`,
			mode,
			...(useCharacterTheme === false ? { useCharacterTheme: false } : {})
		})
		.returning()
		.get();

	if (mode === 'story') {
		// Story mode: insert the first message directly. Greetings already had
		// their inline images cached at character import / save time; the GET
		// endpoint lazily caches anything that slipped through. No image work
		// happens here so chat creation stays snappy.
		if (character.firstMessage) {
			const firstMsg = replaceVars(character.firstMessage, character.name, userName);

			const swipes: string[] = [firstMsg];
			try {
				const alts = JSON.parse(character.alternateGreetings || '[]');
				if (Array.isArray(alts)) {
					for (const alt of alts) {
						if (typeof alt === 'string' && alt.trim()) {
							swipes.push(replaceVars(alt, character.name, userName));
						}
					}
				}
			} catch (err) { logger.warn('chats POST: malformed alternateGreetings JSON', { characterId: character.id, err: String(err) }); }

			db.insert(messages).values({
				chatId: chat.id,
				role: 'assistant',
				content: firstMsg,
				swipes: JSON.stringify(swipes),
				swipeIndex: 0
			}).run();
			bumpChatTail(chat.id, firstMsg, 'assistant');
		}
	}
	// Texting mode: no server-side messages — the chat page auto-triggers the first message via streaming.

	// Return enough for the client to add the chat to the sidebar optimistically
	// without waiting for a full invalidateAll() round-trip.
	// Re-read so the row reflects the bumped tail/updatedAt for any greeting we just inserted.
	const fresh = db.select().from(chats).where(eq(chats.id, chat.id)).get() ?? chat;
	const sidebarChat = {
		...fresh,
		characterName: character.name,
		characterAvatar: character.avatarPath,
		lastMessage: fresh.lastMessage ?? '',
		lastMessageRole: fresh.lastMessageRole ?? '',
		unread: 0
	} as any;
	broadcast(user.id, { type: 'chat:created', chat: sidebarChat });
	return json({ id: chat.id, chat: sidebarChat });
};
