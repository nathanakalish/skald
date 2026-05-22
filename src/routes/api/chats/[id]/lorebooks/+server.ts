import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { chats, characters, lorebooks, lorebookEntries, chatLorebooks, chatLorebookEntryOverrides } from '$lib/db/schema.js';
import { eq, and, inArray } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth.js';
import { ApiError } from '$lib/server/apiError.js';

/** GET: lorebooks for this chat (character lorebooks + user-added). */
export const GET: RequestHandler = async (event) => {
	const user = requireUser(event);
	const chatId = Number(event.params.id);

	const chat = db.select().from(chats).where(and(eq(chats.id, chatId), eq(chats.userId, user.id))).get();
	if (!chat) return ApiError.notFound('Chat not found');

	// Character lorebooks (always included, can't be removed).
	const characterBooks = db
		.select()
		.from(lorebooks)
		.where(and(eq(lorebooks.characterId, chat.characterId), eq(lorebooks.userId, user.id)))
		.all();

	// User-added lorebooks for this chat.
	const addedLinks = db
		.select({ lorebookId: chatLorebooks.lorebookId })
		.from(chatLorebooks)
		.where(eq(chatLorebooks.chatId, chatId))
		.all();

	const addedIds = new Set(addedLinks.map(l => l.lorebookId));

	const addedBooks = addedIds.size > 0
		? db.select().from(lorebooks).where(eq(lorebooks.userId, user.id)).all()
			.filter(b => addedIds.has(b.id))
		: [];

	// Pull entries for every relevant lorebook (dedupe by id).
	const seenIds = new Set(characterBooks.map(b => b.id));
	const allBooks = [...characterBooks, ...addedBooks.filter(b => !seenIds.has(b.id))];

	// Bulk-fetch character avatars for any lorebook tied to a character so the
	// UI can fall back to the character's avatar when the lorebook has no
	// iconUrl of its own. (Character-imported lorebooks inherit the portrait.)
	const charIds = Array.from(new Set(allBooks.map(b => b.characterId).filter((id): id is number => typeof id === 'number')));
	const charAvatars = new Map<number, string | null>();
	if (charIds.length > 0) {
		const rows = db
			.select({ id: characters.id, avatarPath: characters.avatarPath })
			.from(characters)
			.where(and(eq(characters.userId, user.id), inArray(characters.id, charIds)))
			.all();
		for (const r of rows) charAvatars.set(r.id, r.avatarPath ?? null);
	}

	// Per-chat per-entry overrides keyed by entry id.
	const overrides = db
		.select()
		.from(chatLorebookEntryOverrides)
		.where(eq(chatLorebookEntryOverrides.chatId, chatId))
		.all();
	const overrideMap = new Map<number, { enabled: boolean | null; constant: boolean | null }>();
	for (const o of overrides) {
		overrideMap.set(o.entryId, { enabled: o.enabled ?? null, constant: o.constant ?? null });
	}

	const result = allBooks.map(book => {
		const entries = db
			.select()
			.from(lorebookEntries)
			.where(eq(lorebookEntries.lorebookId, book.id))
			.all()
			.map(e => {
				const ov = overrideMap.get(e.id);
				const defaultEnabled = e.enabled ?? true;
				const defaultConstant = e.constant ?? false;
				return {
					...e,
					// Defaults from the lorebook library:
					defaultEnabled,
					defaultConstant,
					// Effective values used by the matcher (override wins when set):
					enabled: ov?.enabled ?? defaultEnabled,
					constant: ov?.constant ?? defaultConstant,
					// Whether each field is currently overridden in this chat:
					enabledOverridden: ov?.enabled !== undefined && ov?.enabled !== null,
					constantOverridden: ov?.constant !== undefined && ov?.constant !== null,
				};
			});
		return {
			...book,
			entries,
			characterAvatarPath: book.characterId != null ? (charAvatars.get(book.characterId) ?? null) : null,
			isCharacterLorebook: book.characterId === chat.characterId,
		};
	});

	return json(result);
};

/** POST: add a lorebook to this chat. */
export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const chatId = Number(event.params.id);
	const body = await event.request.json();
	const lorebookId = body.lorebookId;

	if (!lorebookId) return ApiError.badRequest('lorebookId required');

	const chat = db.select().from(chats).where(and(eq(chats.id, chatId), eq(chats.userId, user.id))).get();
	if (!chat) return ApiError.notFound('Chat not found');

	// Verify the lorebook exists and belongs to this user.
	const book = db.select().from(lorebooks).where(and(eq(lorebooks.id, lorebookId), eq(lorebooks.userId, user.id))).get();
	if (!book) return ApiError.notFound('Lorebook not found');

	// Already a character lorebook? It's already in there.
	if (book.characterId === chat.characterId) {
		return ApiError.badRequest('Character lorebooks are always included');
	}

	// Insert; ignore the UNIQUE collision if it's already linked.
	try {
		db.insert(chatLorebooks).values({ chatId, lorebookId }).run();
	} catch {
		// already linked, no-op
	}

	event.locals.logger?.debug('chats: lorebook attached', { chatId, lorebookId });
	return json({ ok: true });
};

/** DELETE: remove a lorebook from this chat. */
export const DELETE: RequestHandler = async (event) => {
	const user = requireUser(event);
	const chatId = Number(event.params.id);
	const body = await event.request.json();
	const lorebookId = body.lorebookId;

	if (!lorebookId) return ApiError.badRequest('lorebookId required');

	const chat = db.select().from(chats).where(and(eq(chats.id, chatId), eq(chats.userId, user.id))).get();
	if (!chat) return ApiError.notFound('Chat not found');

	db.delete(chatLorebooks)
		.where(and(eq(chatLorebooks.chatId, chatId), eq(chatLorebooks.lorebookId, lorebookId)))
		.run();

	event.locals.logger?.debug('chats: lorebook detached', { chatId, lorebookId });
	return json({ ok: true });
};
