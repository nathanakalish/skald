/**
 * "Unsend" any user message that's currently the chat's active leaf:
 * pull its swipes/reasoning/impersonation guidance back onto the chat row's
 * impersonation-draft slot, point the active leaf at its parent, and delete
 * the message row. Repeats until the leaf is an assistant message (or null).
 *
 * The invariant this enforces: the active leaf is never a user message.
 * Any operation that could leave one (delete, branch switch, chat load)
 * runs through here so all clients see the same shape and the chat bar
 * naturally hosts the "draft" version of that message.
 */
import { db } from '$lib/db/index.js';
import { chats, messages } from '$lib/db/schema.js';
import { eq } from 'drizzle-orm';
import { broadcast } from '$lib/server/realtime.js';
import { recomputeChatTail } from '$lib/db/chatTail.js';
import { parseImpersonationSwipes, type ImpersonationSwipe } from '$lib/chat/impersonationSwipes.js';
import { parseSwipes, parseReasoning } from '$lib/messageJson.js';
import { isChatProcessing } from '$lib/server/messageQueue.js';
import { logger } from '$lib/server/logger.js';

interface RevertResult {
	deletedIds: number[];
	newActiveLeafId: number | null;
	swipes: ImpersonationSwipe[];
	swipeIndex: number;
	changed: boolean;
}

/**
 * Atomic in-place revert. Returns what was changed; callers can use this to
 * fold the broadcast into their own response (or just trust the broadcasts
 * we emit here for cross-tab sync).
 */
export function revertLeafUserMessages(chatId: number, userId: number): RevertResult {
	const result: RevertResult = {
		deletedIds: [],
		newActiveLeafId: null,
		swipes: [],
		swipeIndex: 0,
		changed: false,
	};

	// If the LLM is actively generating a reply for this chat, the active leaf
	// is intentionally a user message (the one being responded to). Deleting
	// it here would orphan the assistant reply once it lands — the processor
	// reads activeLeafId to determine the parent for the new assistant row.
	if (isChatProcessing(chatId)) return result;

	// Bounded loop — protects against malformed graphs (parent === self) that
	// would otherwise spin forever.
	for (let safety = 0; safety < 64; safety++) {
		const chat = db.select().from(chats).where(eq(chats.id, chatId)).get();
		if (!chat) break;
		result.newActiveLeafId = chat.activeLeafId ?? null;

		const leafId = chat.activeLeafId;
		if (leafId == null) break;

		const leaf = db.select().from(messages).where(eq(messages.id, leafId)).get();
		if (!leaf || leaf.role !== 'user') break;

		// Convert user msg's per-swipe data into impersonation swipes.
		// guidance lives only on the formerly-active swipe — the others
		// were never bound to any specific guidance text.
		const userSwipes = parseSwipes(leaf.swipes);
		const userReasoning = parseReasoning(leaf.reasoning);
		const userIdx = leaf.swipeIndex ?? 0;
		// Fall back to leaf.content if swipes JSON is empty/corrupt — the
		// user's text shouldn't be silently lost.
		const sourceSwipes = userSwipes.length > 0 ? userSwipes : [leaf.content ?? ''];
		const restored: ImpersonationSwipe[] = sourceSwipes.map((draft, i) => ({
			draft: draft ?? '',
			reasoning: userReasoning[i] ?? '',
			guidance: i === userIdx && leaf.impersonationGuidance ? leaf.impersonationGuidance : undefined,
			// generatedAt fresh so client-side `pickDraftForChat` treats this
			// as a new arrival worth surfacing in the textarea.
			generatedAt: new Date().toISOString(),
		}));
		const restoredActive = Math.max(0, Math.min(restored.length - 1, userIdx));

		const existing = parseImpersonationSwipes(chat.impersonationSwipes);
		const merged = [...existing, ...restored];
		const mergedActive = existing.length + restoredActive;

		const newLeafId = leaf.parentId ?? null;

		db.transaction((tx) => {
			tx.update(chats).set({
				activeLeafId: newLeafId,
				impersonationSwipes: JSON.stringify(merged),
				impersonationSwipeIndex: mergedActive,
				impersonationStatus: 'done',
			}).where(eq(chats.id, chatId)).run();
			tx.delete(messages).where(eq(messages.id, leaf.id)).run();
		});

		result.deletedIds.push(leaf.id);
		result.newActiveLeafId = newLeafId;
		result.swipes = merged;
		result.swipeIndex = mergedActive;
		result.changed = true;
	}

	if (result.changed) {
		recomputeChatTail(chatId);
		logger.info('chatRevert: reverted leaf user messages', {
			chatId, deletedCount: result.deletedIds.length, newActiveLeafId: result.newActiveLeafId,
		});
		broadcast(userId, {
			type: 'message:deleted',
			chatId,
			ids: result.deletedIds,
		});
		broadcast(userId, {
			type: 'chat:impersonation',
			chatId,
			status: 'done',
			swipes: result.swipes,
			swipeIndex: result.swipeIndex,
		});
		broadcast(userId, {
			type: 'chat:patched',
			id: chatId,
			patch: { activeLeafId: result.newActiveLeafId },
		});
	}

	return result;
}
