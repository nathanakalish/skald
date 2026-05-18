import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { chats, lorebookEntries, lorebooks, chatLorebookEntryOverrides, chatLorebooks } from '$lib/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth.js';

/**
 * Per-chat per-entry override for `enabled` / `constant`.
 *
 * The lorebook entry is reachable from the chat only if it belongs to
 * either the chat's character lorebook or a lorebook explicitly added
 * to this chat. Anything else is rejected so users can't mutate state
 * for chats that don't see this entry.
 */
async function loadAndAuthorise(event: Parameters<RequestHandler>[0]):
	Promise<
		| { ok: true; chatId: number; entryId: number; entry: { id: number; lorebookId: number; defaultEnabled: boolean | null; defaultConstant: boolean | null; bookCharacterId: number | null; bookUserId: number } }
		| { ok: false; response: Response }
	>
{
	const user = requireUser(event);
	const chatId = Number(event.params.id);
	const entryId = Number(event.params.entryId);
	if (!Number.isFinite(chatId) || !Number.isFinite(entryId)) {
		return { ok: false, response: json({ error: 'Invalid id' }, { status: 400 }) };
	}

	const chat = db
		.select()
		.from(chats)
		.where(and(eq(chats.id, chatId), eq(chats.userId, user.id)))
		.get();
	if (!chat) return { ok: false, response: json({ error: 'Chat not found' }, { status: 404 }) };

	const entry = db
		.select({
			id: lorebookEntries.id,
			lorebookId: lorebookEntries.lorebookId,
			defaultEnabled: lorebookEntries.enabled,
			defaultConstant: lorebookEntries.constant,
			bookCharacterId: lorebooks.characterId,
			bookUserId: lorebooks.userId,
		})
		.from(lorebookEntries)
		.innerJoin(lorebooks, eq(lorebookEntries.lorebookId, lorebooks.id))
		.where(eq(lorebookEntries.id, entryId))
		.get();
	if (!entry || entry.bookUserId !== user.id) {
		return { ok: false, response: json({ error: 'Entry not found' }, { status: 404 }) };
	}

	const isCharacterBook = entry.bookCharacterId === chat.characterId;
	if (!isCharacterBook) {
		const link = db
			.select()
			.from(chatLorebooks)
			.where(and(eq(chatLorebooks.chatId, chatId), eq(chatLorebooks.lorebookId, entry.lorebookId)))
			.get();
		if (!link) {
			return { ok: false, response: json({ error: 'Entry not reachable from this chat' }, { status: 404 }) };
		}
	}

	return { ok: true, chatId, entryId, entry };
}

function asNullableBool(v: unknown): boolean | null | undefined {
	if (v === null) return null;
	if (typeof v === 'boolean') return v;
	return undefined;
}

/** PATCH: set or clear individual override fields */
export const PATCH: RequestHandler = async (event) => {
	const ctx = await loadAndAuthorise(event);
	if (!ctx.ok) return ctx.response;
	const { chatId, entryId } = ctx;

	let body: unknown;
	try { body = await event.request.json(); } catch { return json({ error: 'Invalid JSON' }, { status: 400 }); }
	const obj = (body && typeof body === 'object') ? body as Record<string, unknown> : {};
	const enabled = asNullableBool(obj.enabled);
	const constant = asNullableBool(obj.constant);

	const existing = db
		.select()
		.from(chatLorebookEntryOverrides)
		.where(and(eq(chatLorebookEntryOverrides.chatId, chatId), eq(chatLorebookEntryOverrides.entryId, entryId)))
		.get();

	const next = {
		enabled: enabled === undefined ? (existing?.enabled ?? null) : enabled,
		constant: constant === undefined ? (existing?.constant ?? null) : constant,
	};

	// If both fields end up cleared, drop the row entirely.
	if (next.enabled === null && next.constant === null) {
		if (existing) {
			db.delete(chatLorebookEntryOverrides)
				.where(and(eq(chatLorebookEntryOverrides.chatId, chatId), eq(chatLorebookEntryOverrides.entryId, entryId)))
				.run();
		}
		event.locals.logger?.debug('chats: lorebook entry override cleared', { chatId, entryId });
		return json({ ok: true, cleared: true });
	}

	if (existing) {
		db.update(chatLorebookEntryOverrides)
			.set(next)
			.where(and(eq(chatLorebookEntryOverrides.chatId, chatId), eq(chatLorebookEntryOverrides.entryId, entryId)))
			.run();
	} else {
		db.insert(chatLorebookEntryOverrides)
			.values({ chatId, entryId, ...next })
			.run();
	}
	event.locals.logger?.debug('chats: lorebook entry override set', { chatId, entryId, enabled: next.enabled, constant: next.constant });
	return json({ ok: true });
};

/** DELETE: reset both overrides for this entry in this chat */
export const DELETE: RequestHandler = async (event) => {
	const ctx = await loadAndAuthorise(event);
	if (!ctx.ok) return ctx.response;
	const { chatId, entryId } = ctx;

	db.delete(chatLorebookEntryOverrides)
		.where(and(eq(chatLorebookEntryOverrides.chatId, chatId), eq(chatLorebookEntryOverrides.entryId, entryId)))
		.run();

	event.locals.logger?.debug('chats: lorebook entry override deleted', { chatId, entryId });
	return json({ ok: true });
};
