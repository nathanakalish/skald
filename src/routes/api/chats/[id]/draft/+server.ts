import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { chats } from '$lib/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth.js';
import { broadcast } from '$lib/server/realtime.js';

// Cross-device sync of the unsent textarea + inline edit buffer.
//
// Body shape (all fields optional; only the ones present are considered):
//   {
//     draft?: string | null,
//     draftAt?: number,                 // epoch ms; ignored if older than server's
//     editingMessageId?: number | null,
//     editingMessageContent?: string | null,
//     editingAt?: number                // epoch ms; ignored if older than server's
//   }
//
// Last-write-wins per field-pair (textarea draft vs. inline edit) using the
// caller-supplied timestamps. Without timestamps the write is unconditional —
// useful for explicit "clear" calls (send, save, cancel) where the server
// shouldn't second-guess the client.
export const PATCH: RequestHandler = async (event) => {
	const user = requireUser(event);
	const chatId = Number(event.params.id);
	if (!Number.isFinite(chatId)) return json({ error: 'Bad chat id' }, { status: 400 });

	const chat = db.select().from(chats).where(and(eq(chats.id, chatId), eq(chats.userId, user.id))).get();
	if (!chat) return json({ error: 'Chat not found' }, { status: 404 });

	const body = await event.request.json().catch(() => ({})) as {
		draft?: string | null;
		draftAt?: number;
		editingMessageId?: number | null;
		editingMessageContent?: string | null;
		editingAt?: number;
	};

	const patch: Record<string, unknown> = {};
	const broadcastPatch: Record<string, unknown> = {};

	const touchesDraft = body.draft !== undefined || body.draftAt !== undefined;
	if (touchesDraft) {
		const incomingAt = Number.isFinite(body.draftAt) ? Number(body.draftAt) : Date.now();
		const existingAt = (chat as any).pendingDraftAt ?? 0;
		if (incomingAt >= existingAt) {
			const next = body.draft === undefined ? (chat as any).pendingDraft ?? null : (body.draft || null);
			patch.pendingDraft = next;
			patch.pendingDraftAt = incomingAt;
			broadcastPatch.pendingDraft = next;
			broadcastPatch.pendingDraftAt = incomingAt;
		}
	}

	const touchesEdit = body.editingMessageId !== undefined || body.editingMessageContent !== undefined || body.editingAt !== undefined;
	if (touchesEdit) {
		const incomingAt = Number.isFinite(body.editingAt) ? Number(body.editingAt) : Date.now();
		const existingAt = (chat as any).editingMessageAt ?? 0;
		if (incomingAt >= existingAt) {
			const nextId = body.editingMessageId === undefined ? (chat as any).editingMessageId ?? null : body.editingMessageId;
			const nextContent = body.editingMessageContent === undefined ? (chat as any).editingMessageContent ?? null : body.editingMessageContent;
			patch.editingMessageId = nextId;
			patch.editingMessageContent = nextContent;
			patch.editingMessageAt = incomingAt;
			broadcastPatch.editingMessageId = nextId;
			broadcastPatch.editingMessageContent = nextContent;
			broadcastPatch.editingMessageAt = incomingAt;
		}
	}

	if (Object.keys(patch).length === 0) return json({ ok: true, skipped: true });

	db.update(chats).set(patch).where(eq(chats.id, chatId)).run();

	// chat:patched is the standard "a chat row changed" event — caught by
	// chatsStore + the cache mirror in +layout so the active ChatView's
	// `chat` prop updates automatically.
	broadcast(user.id, { type: 'chat:patched', id: chatId, patch: broadcastPatch });

	return json({ ok: true });
};
