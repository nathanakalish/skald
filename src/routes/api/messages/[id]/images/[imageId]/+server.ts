import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { unlink } from 'fs/promises';
import { join } from 'path';
import { eq, and, ne, desc } from 'drizzle-orm';
import { db } from '$lib/db/index.js';
import { messages, chats, messageImages } from '$lib/db/schema.js';
import { requireUser } from '$lib/server/auth.js';
import { broadcast } from '$lib/server/realtime.js';
import { ApiError } from '$lib/server/apiError.js';

const CACHE_DIR = join(process.cwd(), 'data', 'image-cache');

type Loaded =
	| { ok: false; response: Response }
	| { ok: true; user: ReturnType<typeof requireUser>; message: typeof messages.$inferSelect; chat: typeof chats.$inferSelect; image: typeof messageImages.$inferSelect };

async function loadOwned(event: Parameters<RequestHandler>[0]): Promise<Loaded> {
	const user = requireUser(event);
	const messageId = Number(event.params.id);
	const imageId = Number(event.params.imageId);
	const message = db.select().from(messages).where(eq(messages.id, messageId)).get();
	if (!message) return { ok: false, response: ApiError.notFound('Message not found') };
	const chat = db.select().from(chats).where(and(eq(chats.id, message.chatId), eq(chats.userId, user.id))).get();
	if (!chat) return { ok: false, response: ApiError.notFound('Not found') };
	const image = db.select().from(messageImages).where(eq(messageImages.id, imageId)).get();
	if (!image || image.messageId !== messageId) return { ok: false, response: ApiError.notFound('Image not found') };
	return { ok: true, user, message, chat, image };
}

// PATCH: activate this swipe (deactivate all others on the same message).
// Body is currently unused — the action is implied by the route.
export const PATCH: RequestHandler = async (event) => {
	const loaded = await loadOwned(event);
	if (!loaded.ok) return loaded.response;
	const { user, image } = loaded;

	db.transaction((tx) => {
		// Only deactivate siblings within the same swipe — each swipe owns
		// its own active image, so activating swipe 1's image must not
		// touch swipe 0's selection.
		tx.update(messageImages)
			.set({ isActive: false })
			.where(and(
				eq(messageImages.messageId, image.messageId),
				eq(messageImages.swipeIndex, image.swipeIndex ?? 0)
			))
			.run();
		tx.update(messageImages).set({ isActive: true }).where(eq(messageImages.id, image.id)).run();
	});

	broadcast(user.id, {
		type: 'messageImage:activated',
		chatId: loaded.chat.id,
		messageId: image.messageId,
		imageId: image.id
	});

	return json({ ok: true });
};

// DELETE: remove the swipe (file + row). If the deleted swipe was active and
// another swipe exists, activate the most recent remaining one so the bubble
// keeps showing something.
export const DELETE: RequestHandler = async (event) => {
	const loaded = await loadOwned(event);
	if (!loaded.ok) return loaded.response;
	const { user, image, chat } = loaded;

	const wasActive = !!image.isActive;
	db.delete(messageImages).where(eq(messageImages.id, image.id)).run();

	// Best-effort file removal; absence isn't fatal. Also drop the sibling
	// original (e.g. genimg_<uuid>.png next to the stored .webp) so generated
	// images don't accumulate as orphans on disk.
	try { await unlink(join(CACHE_DIR, image.filePath)); } catch { /* already gone */ }
	if (image.filePath.endsWith('.webp')) {
		const base = image.filePath.replace(/\.webp$/, '');
		for (const ext of ['.png', '.jpg', '.jpeg', '.gif']) {
			try { await unlink(join(CACHE_DIR, base + ext)); break; } catch { /* try next */ }
		}
	}

	let newlyActiveId: number | null = null;
	if (wasActive) {
		// Promote the most recent remaining swipe within the same parent swipe;
		// other swipes' selections are independent.
		const next = db.select().from(messageImages)
			.where(and(
				eq(messageImages.messageId, image.messageId),
				eq(messageImages.swipeIndex, image.swipeIndex ?? 0),
				ne(messageImages.id, image.id)
			))
			.orderBy(desc(messageImages.createdAt))
			.get();
		if (next) {
			db.update(messageImages).set({ isActive: true }).where(eq(messageImages.id, next.id)).run();
			newlyActiveId = next.id;
		}
	}

	broadcast(user.id, {
		type: 'messageImage:deleted',
		chatId: chat.id,
		messageId: image.messageId,
		imageId: image.id
	});

	if (newlyActiveId !== null) {
		broadcast(user.id, {
			type: 'messageImage:activated',
			chatId: chat.id,
			messageId: image.messageId,
			imageId: newlyActiveId
		});
	}

	return json({ ok: true });
};
