import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { requireUser } from '$lib/server/auth.js';
import { buildChatsBundle } from '$lib/server/bundle.js';
import { db } from '$lib/db/index.js';
import { chats, characters } from '$lib/db/schema.js';
import { eq, desc } from 'drizzle-orm';

/** Lightweight list of every chat the user owns — used by the export picker. */
export const GET: RequestHandler = async (event) => {
	const user = requireUser(event);
	const rows = db
		.select({
			id: chats.id,
			title: chats.title,
			characterId: chats.characterId,
			characterName: characters.name,
			characterAvatar: characters.avatarPath,
			updatedAt: chats.updatedAt
		})
		.from(chats)
		.leftJoin(characters, eq(characters.id, chats.characterId))
		.where(eq(chats.userId, user.id))
		.orderBy(desc(chats.updatedAt))
		.all();
	return json({ chats: rows });
};

export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const body = await event.request.json().catch(() => ({}));

	const ids = Array.isArray(body.chatIds)
		? body.chatIds.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n))
		: [];
	if (ids.length === 0) return json({ error: 'No chats selected' }, { status: 400 });

	const includeCharacterCard = body.includeCharacterCard !== false;

	const result = await buildChatsBundle(user.id, ids, { includeCharacterCard });
	if (result.counts.chats === 0) {
		return json({ error: 'No matching chats found' }, { status: 404 });
	}

	const stamp = new Date().toISOString().slice(0, 10);
	const name = result.counts.chats === 1
		? `skald-chat-${stamp}.skald.zip`
		: `skald-chats-${stamp}.skald.zip`;

	event.locals.logger?.info('export: chats', {
		requested: ids.length, bytes: result.buffer.byteLength, counts: result.counts, includeCharacterCard,
	});

	return new Response(new Uint8Array(result.buffer), {
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename="${name}"`,
			'X-Bundle-Counts': JSON.stringify(result.counts)
		}
	});
};
