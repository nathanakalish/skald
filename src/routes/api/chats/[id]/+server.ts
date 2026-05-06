import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { chats, messages, characters } from '$lib/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { deleteCachedImagesFromContent } from '$lib/services/imageCache.js';
import { requireUser } from '$lib/server/auth.js';
import { eventBus } from '$lib/server/eventBus.js';
import { broadcast } from '$lib/server/realtime.js';
import { recomputeChatTail } from '$lib/db/chatTail.js';
import { ownsProvider, ownsPersona } from '$lib/server/ownership.js';

// Build the same sidebar-shaped row that GET /api/chats returns, for one id.
// Mutation handlers return this so the client store can reconcile without
// hitting GET /api/chats again.
function getSidebarRow(chatId: number) {
	const row = db
		.select({
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
		})
		.from(chats)
		.innerJoin(characters, eq(chats.characterId, characters.id))
		.where(eq(chats.id, chatId))
		.get();
	if (!row) return null;
	return {
		...row,
		lastMessage: row.lastMessage ?? '',
		lastMessageRole: row.lastMessageRole ?? ''
	};
}

export const PATCH: RequestHandler = async (event) => {
	const user = requireUser(event);
	const id = Number(event.params.id);
	const body = await event.request.json();

	// Verify ownership.
	const chat = db.select().from(chats).where(and(eq(chats.id, id), eq(chats.userId, user.id))).get();
	if (!chat) return json({ error: 'Not found' }, { status: 404 });

	const updates: Record<string, unknown> = {};
	if ('title' in body && typeof body.title === 'string') {
		updates.title = body.title.trim().slice(0, 200) || chat.title;
	}
	if ('pinned' in body) updates.pinned = body.pinned ? 1 : 0;
	if ('pinOrder' in body) updates.pinOrder = body.pinOrder;

	// Per-chat overrides (null clears the override).
	// IDOR guard: when an override references a foreign-keyed row (provider /
	// persona), confirm it belongs to the requesting user before persisting.
	if ('overrideProviderId' in body) {
		const v = body.overrideProviderId;
		if (v != null && !ownsProvider(user.id, Number(v))) {
			return json({ error: 'overrideProviderId does not belong to you' }, { status: 400 });
		}
		updates.overrideProviderId = v ?? null;
	}
	if ('overrideModel' in body) updates.overrideModel = body.overrideModel ?? null;
	if ('overrideTemperature' in body) updates.overrideTemperature = body.overrideTemperature ?? null;
	if ('overrideMaxTokens' in body) updates.overrideMaxTokens = body.overrideMaxTokens ?? null;
	if ('overrideCustomPrompt' in body) updates.overrideCustomPrompt = body.overrideCustomPrompt ?? null;
	if ('overridePersonaId' in body) {
		const v = body.overridePersonaId;
		if (v != null && !ownsPersona(user.id, Number(v))) {
			return json({ error: 'overridePersonaId does not belong to you' }, { status: 400 });
		}
		updates.overridePersonaId = v ?? null;
	}
	if ('overrideIncludeReasoning' in body) updates.overrideIncludeReasoning = body.overrideIncludeReasoning ?? null;
	if ('overrideReasoningEffort' in body) updates.overrideReasoningEffort = body.overrideReasoningEffort ?? null;
	if ('overrideRenderMode' in body) updates.overrideRenderMode = body.overrideRenderMode ?? null;
	if ('overrideCompactionEnabled' in body) updates.overrideCompactionEnabled = body.overrideCompactionEnabled ?? null;
	if ('overrideCompactionThreshold' in body) updates.overrideCompactionThreshold = body.overrideCompactionThreshold ?? null;
	if ('overrideCompactionMode' in body) updates.overrideCompactionMode = body.overrideCompactionMode ?? null;
	if ('overrideCompactionTargetPercent' in body) updates.overrideCompactionTargetPercent = body.overrideCompactionTargetPercent ?? null;
	if ('overrideCompactionFixedCount' in body) updates.overrideCompactionFixedCount = body.overrideCompactionFixedCount ?? null;
	if ('overrideCompactionProviderId' in body) {
		const v = body.overrideCompactionProviderId;
		if (v != null && !ownsProvider(user.id, Number(v))) {
			return json({ error: 'overrideCompactionProviderId does not belong to you' }, { status: 400 });
		}
		updates.overrideCompactionProviderId = v ?? null;
	}
	if ('overrideCompactionModel' in body) updates.overrideCompactionModel = body.overrideCompactionModel ?? null;
	// Let the user edit / clear the stored compaction summary directly.
	if ('compactionSummary' in body) {
		const v = body.compactionSummary;
		updates.compactionSummary = v == null || v === '' ? null : String(v);
		// Clearing the summary also resets the high-water mark so future runs start over.
		if (updates.compactionSummary === null) updates.compactedUpToMessageId = null;
	}
	if ('useCharacterTheme' in body) updates.useCharacterTheme = body.useCharacterTheme ? 1 : 0;
	if ('allowExternalResources' in body) updates.allowExternalResources = body.allowExternalResources == null ? null : body.allowExternalResources ? 1 : 0;
	if ('replyGuidance' in body) {
		const v = body.replyGuidance;
		updates.replyGuidance = typeof v === 'string' && v.trim() ? v : null;
	}

	if (Object.keys(updates).length > 0) {
		db.update(chats).set(updates).where(eq(chats.id, id)).run();
	}

	const row = getSidebarRow(id);
	if (row) broadcast(user.id, { type: 'chat:updated', id, chat: row as any });
	return json({ ok: true, chat: row });
};

export const DELETE: RequestHandler = async (event) => {
	const user = requireUser(event);
	const id = Number(event.params.id);

	// Verify ownership.
	const chat = db.select().from(chats).where(and(eq(chats.id, id), eq(chats.userId, user.id))).get();
	if (!chat) return json({ error: 'Not found' }, { status: 404 });

	// Wipe cached images referenced by these messages.
	const chatMessages = db.select({ content: messages.content }).from(messages).where(eq(messages.chatId, id)).all();
	deleteCachedImagesFromContent(chatMessages.map((m) => m.content));

	db.delete(chats).where(eq(chats.id, id)).run();
	broadcast(user.id, { type: 'chat:deleted', id });
	return json({ ok: true });
};

export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const id = Number(event.params.id);
	const body = await event.request.json();

	if (body.action === 'reset') {
		// Verify ownership.
		const chat = db.select().from(chats).where(and(eq(chats.id, id), eq(chats.userId, user.id))).get();
		if (!chat) return json({ error: 'Not found' }, { status: 404 });

		const allMessages = db.select().from(messages).where(eq(messages.chatId, id)).all();

		// Keep the greeting/root message if there is one so reset doesn't leave
		// an empty chat. Story chats stash alternate greetings in `swipes` on
		// that first assistant message.
		const greeting = allMessages.find((m) => m.role === 'assistant' && (m.parentId == null));
		const fallbackFirst = allMessages[0];
		const keepId = greeting?.id ?? fallbackFirst?.id ?? null;

		const toDelete = keepId == null
			? allMessages
			: allMessages.filter((m) => m.id !== keepId);

		if (toDelete.length > 0) {
			deleteCachedImagesFromContent(toDelete.map((m) => m.content));
			for (const msg of toDelete) {
				db.delete(messages).where(eq(messages.id, msg.id)).run();
			}
		}

		db.update(chats).set({ activeLeafId: keepId, unread: 0 }).where(eq(chats.id, id)).run();
		recomputeChatTail(id);
		eventBus.emit({ type: 'unread', chatId: id, userId: user.id, data: { count: 0 } });

		const row = getSidebarRow(id);
		if (row) broadcast(user.id, { type: 'chat:updated', id, chat: row as any });
		return json({ ok: true, chat: row });
	}

	return json({ error: 'Unknown action' }, { status: 400 });
};
