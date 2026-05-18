import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { chats, characters, messages } from '$lib/db/schema.js';
import { eq, and, asc } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth.js';
import { characterFingerprint } from '$lib/server/bundle.js';
import { loadActivePath, findDeepestLeaf } from '$lib/server/chatTree.js';

/**
 * Skald-native chat export. Returns the full message tree (parentId, swipes,
 * swipeIndex preserved) plus the character's content fingerprint so importers
 * can match the chat to the right character even if names collide.
 */
export const GET: RequestHandler = async (event) => {
	const user = requireUser(event);
	const id = Number(event.params.id);
	const format = event.url.searchParams.get('format') || 'json';

	const chat = db.select().from(chats).where(and(eq(chats.id, id), eq(chats.userId, user.id))).get();
	if (!chat) return json({ error: 'Chat not found' }, { status: 404 });

	const character = db.select().from(characters).where(eq(characters.id, chat.characterId)).get();
	if (!character) return json({ error: 'Character not found' }, { status: 404 });

	const fp = characterFingerprint({
		name: character.name,
		description: character.description,
		personality: character.personality,
		firstMessage: character.firstMessage,
		scenario: character.scenario
	});

	if (format === 'md') {
		// Markdown can't represent branches, so we follow the active leaf
		// (or fall back to the deepest leaf if the chat never had an active
		// pointer set) back to the root. Previously this iterated every row
		// in the chat — branches and abandoned swipes leaked into the export.
		const leafId = chat.activeLeafId ?? findDeepestLeaf(chat.id);
		const path = leafId ? loadActivePath(leafId) : [];
		const lines = [`# Chat with ${character.name}`, ''];
		for (const m of path) {
			if (m.role === 'system') continue;
			const name = m.role === 'assistant' ? character.name : 'You';
			lines.push(`**${name}:**`, m.content, '');
		}
		const content = lines.join('\n');
		const safeName = character.name.replace(/[^a-zA-Z0-9_-]/g, '_');
		return new Response(content, {
			headers: {
				'Content-Type': 'text/markdown',
				'Content-Disposition': `attachment; filename="${safeName}.md"`
			}
		});
	}

	const body = {
		schema: 'skald-chat',
		version: 2,
		exportedAt: new Date().toISOString(),
		id: chat.id,
		title: chat.title ?? '',
		mode: chat.mode ?? 'story',
		activeLeafId: chat.activeLeafId ?? null,
		character: { name: character.name, fingerprint: fp },
		messages: db.select().from(messages).where(eq(messages.chatId, id)).orderBy(asc(messages.id)).all().map(m => ({
			id: m.id,
			role: m.role,
			content: m.content,
			swipes: safeJSON(m.swipes, [m.content]),
			swipeIndex: m.swipeIndex ?? 0,
			reasoning: safeJSON(m.reasoning, []),
			parentId: m.parentId,
			createdAt: m.createdAt ?? null
		}))
	};

	const safeName = character.name.replace(/[^a-zA-Z0-9_-]/g, '_');
	return new Response(JSON.stringify(body, null, 2), {
		headers: {
			'Content-Type': 'application/json',
			'Content-Disposition': `attachment; filename="${safeName}_${chat.id}.json"`
		}
	});
};

function safeJSON<T>(s: string | null | undefined, fallback: T): T {
	if (!s) return fallback;
	try { return JSON.parse(s) as T; } catch { return fallback; }
}
