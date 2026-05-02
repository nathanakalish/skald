import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { characters, chats, messages, lorebooks } from '$lib/db/schema.js';
import { eq, and, inArray } from 'drizzle-orm';
import { unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { deleteCachedImagesFromContent } from '$lib/services/imageCache.js';
import {
	cacheCharacterTextImages,
	ensureCharacterImagesCached
} from '$lib/services/characterImageCache.js';
import { requireUser } from '$lib/server/auth.js';
import { requireOwned } from '$lib/server/ownership.js';
import { getOriginalAvatarPath } from '$lib/services/imageOptimizer.js';
import { broadcast } from '$lib/server/realtime.js';

export const GET: RequestHandler = async (event) => {
	const { row: character } = requireOwned(event, characters, event.params.id);

	await ensureCharacterImagesCached(character);

	return json(character);
};

export const PUT: RequestHandler = async (event) => {
	const user = requireUser(event);
	const id = Number(event.params.id);
	const body = await event.request.json();

	// Cache any new remote images introduced via the editor
	const cached = await cacheCharacterTextImages({
		firstMessage: body.firstMessage,
		alternateGreetings: body.alternateGreetings,
		creatorNotes: body.creatorNotes
	});

	// If the editor is sending a non-empty theme payload, treat that as a
	// manual customization and lock out the avatar-upload auto-extractor.
	// (The "mark manual" flag survives even if the user later clears all
	// colors — they can reset by uploading a fresh avatar.)
	const incomingTheme = typeof body.theme === 'string' ? body.theme : '';
	let themeUserModifiedFlag: boolean | undefined;
	if (incomingTheme) {
		try {
			const parsed = JSON.parse(incomingTheme);
			const dark = parsed?.dark && typeof parsed.dark === 'object' ? parsed.dark : {};
			const light = parsed?.light && typeof parsed.light === 'object' ? parsed.light : {};
			const hasAny = Object.values(dark).some((v) => !!v) || Object.values(light).some((v) => !!v);
			if (hasAny) themeUserModifiedFlag = true;
		} catch { /* malformed JSON — leave flag alone */ }
	}

	db.update(characters)
		.set({
			name: body.name,
			description: body.description,
			personality: body.personality,
			firstMessage: cached.firstMessage,
			scenario: body.scenario,
			systemPrompt: body.systemPrompt,
			creatorNotes: cached.creatorNotes,
			tags: body.tags,
			mesExample: body.mesExample,
			postHistoryInstructions: body.postHistoryInstructions,
			alternateGreetings: cached.alternateGreetings,
			creator: body.creator,
			characterVersion: body.characterVersion,
			extensions: body.extensions,
			theme: body.theme,
			...(themeUserModifiedFlag ? { themeUserModified: true } : {}),
			updatedAt: new Date().toISOString()
		})
		.where(and(eq(characters.id, id), eq(characters.userId, user.id)))
		.run();

	const updated = db.select().from(characters).where(and(eq(characters.id, id), eq(characters.userId, user.id))).get();
	const light = updated ? {
		id: updated.id,
		name: updated.name,
		avatarPath: updated.avatarPath,
		description: updated.description,
		tags: updated.tags,
		creator: updated.creator,
		characterVersion: updated.characterVersion,
		theme: updated.theme,
		backgroundPath: updated.backgroundPath,
		createdAt: updated.createdAt,
		updatedAt: updated.updatedAt
	} : null;
	if (light) broadcast(user.id, { type: 'character:updated', id, character: light as any });
	return json({ ...updated, light });
};

export const DELETE: RequestHandler = async (event) => {
	const user = requireUser(event);
	const id = Number(event.params.id);

	const character = db.select().from(characters).where(and(eq(characters.id, id), eq(characters.userId, user.id))).get();
	if (!character) return json({ error: 'Not found' }, { status: 404 });

	// Collect all message content from this character's chats for image cleanup
	const charChats = db.select({ id: chats.id }).from(chats).where(eq(chats.characterId, id)).all();
	const chatIds = charChats.map((c) => c.id);

	if (chatIds.length > 0) {
		const allMessages = db
			.select({ content: messages.content })
			.from(messages)
			.where(inArray(messages.chatId, chatIds))
			.all();
		// Delete cached inline images referenced in messages
		deleteCachedImagesFromContent(allMessages.map((m) => m.content));
	}

	// Delete cached images from character card fields (first message, greetings, creator notes)
	const charContents: string[] = [];
	if (character.firstMessage) charContents.push(character.firstMessage);
	if (character.creatorNotes) charContents.push(character.creatorNotes);
	if (character.alternateGreetings) {
		try {
			const alts = JSON.parse(character.alternateGreetings);
			if (Array.isArray(alts)) {
				for (const g of alts) { if (g) charContents.push(g); }
			}
		} catch { /* not valid JSON — skip */ }
	}
	if (charContents.length > 0) {
		deleteCachedImagesFromContent(charContents);
	}

	// Delete the character avatar file
	if (character.avatarPath) {
		const avatarFile = join(process.cwd(), 'static', character.avatarPath.replace(/^\//, ''));
		if (existsSync(avatarFile)) {
			unlinkSync(avatarFile);
		}
		// Also delete the original
		const basename = character.avatarPath.split('/').pop() || '';
		const originalPath = getOriginalAvatarPath(basename);
		if (originalPath && existsSync(originalPath)) {
			unlinkSync(originalPath);
		}
	}

	// Delete associated lorebooks (unless keepLorebook is requested)
	const keepLorebook = event.url.searchParams.get('keepLorebook') === 'true';
	if (!keepLorebook) {
		db.delete(lorebooks).where(and(eq(lorebooks.characterId, id), eq(lorebooks.userId, user.id))).run();
	}

	// Delete character (cascades to chats → messages via FK)
	db.delete(characters).where(eq(characters.id, id)).run();

	broadcast(user.id, { type: 'character:deleted', id });
	return json({ ok: true });
};
