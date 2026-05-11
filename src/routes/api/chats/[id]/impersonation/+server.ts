import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { chats } from '$lib/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth.js';
import { broadcast } from '$lib/server/realtime.js';
import { parseImpersonationSwipes, type ImpersonationSwipe } from '$lib/chat/impersonationSwipes.js';

function normalizeSwipes(input: unknown): ImpersonationSwipe[] {
	if (!Array.isArray(input)) return [];
	return input
		.filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
		.map(e => ({
			draft: typeof e.draft === 'string' ? e.draft : '',
			reasoning: typeof e.reasoning === 'string' ? e.reasoning : '',
			guidance: typeof e.guidance === 'string' && e.guidance.trim() ? e.guidance : undefined,
			generatedAt: typeof e.generatedAt === 'string' ? e.generatedAt : null,
		}));
}

/**
 * Clear the persisted impersonation draft. Called when the user accepts
 * (sends), edits past it, or explicitly discards. The realtime broadcast
 * keeps other devices' textareas in sync.
 */
export const DELETE: RequestHandler = async (event) => {
	const user = requireUser(event);
	const chatId = Number(event.params.id);
	if (!Number.isFinite(chatId)) return json({ error: 'Bad chat id' }, { status: 400 });

	const chat = db.select().from(chats).where(and(eq(chats.id, chatId), eq(chats.userId, user.id))).get();
	if (!chat) return json({ error: 'Chat not found' }, { status: 404 });

	db.update(chats)
		.set({ impersonationSwipes: null, impersonationSwipeIndex: 0, impersonationStatus: null })
		.where(eq(chats.id, chatId))
		.run();

	broadcast(user.id, {
		type: 'chat:impersonation', chatId,
		status: null,
		swipes: [],
		swipeIndex: 0
	});

	return json({ ok: true });
};

/**
 * Update the impersonation swipe selection (and optionally the full
 * swipes array — used when the textarea contents changed for the
 * currently-selected swipe before navigating). Idempotent.
 */
export const PATCH: RequestHandler = async (event) => {
	const user = requireUser(event);
	const chatId = Number(event.params.id);
	if (!Number.isFinite(chatId)) return json({ error: 'Bad chat id' }, { status: 400 });

	const chat = db.select().from(chats).where(and(eq(chats.id, chatId), eq(chats.userId, user.id))).get();
	if (!chat) return json({ error: 'Chat not found' }, { status: 404 });

	const body = await event.request.json();
	const existing = parseImpersonationSwipes(chat.impersonationSwipes);
	const swipes = body.swipes !== undefined ? normalizeSwipes(body.swipes) : existing;

	let swipeIndex = Number.isFinite(body.swipeIndex) ? Number(body.swipeIndex) : (chat.impersonationSwipeIndex ?? 0);
	if (swipes.length === 0) {
		swipeIndex = 0;
	} else {
		swipeIndex = Math.max(0, Math.min(swipes.length - 1, swipeIndex));
	}

	const status: 'streaming' | 'done' | 'error' | null =
		swipes.length === 0 ? null : ((chat.impersonationStatus as 'streaming' | 'done' | 'error' | null) ?? 'done');

	db.update(chats)
		.set({
			impersonationSwipes: swipes.length === 0 ? null : JSON.stringify(swipes),
			impersonationSwipeIndex: swipeIndex,
			impersonationStatus: status,
		})
		.where(eq(chats.id, chatId))
		.run();

	broadcast(user.id, {
		type: 'chat:impersonation', chatId,
		status,
		swipes,
		swipeIndex
	});

	return json({ ok: true, swipes, swipeIndex });
};
