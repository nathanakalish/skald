import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { eq, and, asc } from 'drizzle-orm';
import { db } from '$lib/db/index.js';
import { messages, chats, providers, messageImages, userSettings, characters, personas } from '$lib/db/schema.js';
import { requireUser } from '$lib/server/auth.js';
import { broadcast } from '$lib/server/realtime.js';
import { ApiError } from '$lib/server/apiError.js';
import { providerProfiles } from '$lib/providers/profiles.js';
import { generateImage, ImageGenError } from '$lib/server/imageGen.js';
import { parseSwipes } from '$lib/messageJson.js';
import { getOriginalAvatarPath, optimizeCachedImage } from '$lib/services/imageOptimizer.js';
import { activeImageGenerations } from '$lib/server/activeImageGenerations.js';
import { logger } from '$lib/server/logger.js';

const CACHE_DIR = join(process.cwd(), 'data', 'image-cache');

function publicImage(row: typeof messageImages.$inferSelect) {
	return {
		id: row.id,
		messageId: row.messageId,
		swipeIndex: row.swipeIndex ?? 0,
		filePath: row.filePath,
		prompt: row.prompt,
		model: row.model ?? '',
		providerId: row.providerId,
		isActive: !!row.isActive,
		createdAt: row.createdAt ?? null
	};
}

function extToMime(ext: string): string {
	switch (ext) {
		case '.png': return 'image/png';
		case '.jpg': case '.jpeg': return 'image/jpeg';
		case '.webp': return 'image/webp';
		case '.gif': return 'image/gif';
		default: return 'image/png';
	}
}

// GET: list every image swipe attached to this message (active first, then by creation).
export const GET: RequestHandler = async (event) => {
	const user = requireUser(event);
	const id = Number(event.params.id);
	const message = db.select().from(messages).where(eq(messages.id, id)).get();
	if (!message) return ApiError.notFound('Message not found');
	const chat = db.select().from(chats).where(and(eq(chats.id, message.chatId), eq(chats.userId, user.id))).get();
	if (!chat) return ApiError.notFound('Not found');

	const rows = db.select().from(messageImages).where(eq(messageImages.messageId, id)).orderBy(asc(messageImages.createdAt)).all();
	return json({ images: rows.map(publicImage) });
};

// POST: generate a new image swipe for this message.
//
// Resolves the effective image config in this order:
//   1. chat.overrideImageProviderId (+ overrideImageModel if set)
//   2. chat.providerId — but only if that provider has imageModel configured
//   3. error: tell the user to set one up
//
// The prompt template comes from chat.overrideImagePromptTemplate ||
// user setting `imagePromptTemplate` || a baked-in default. {{message}} in
// the template is replaced with the source message content.
export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const id = Number(event.params.id);
	const message = db.select().from(messages).where(eq(messages.id, id)).get();
	if (!message) return ApiError.notFound('Message not found');
	const chat = db.select().from(chats).where(and(eq(chats.id, message.chatId), eq(chats.userId, user.id))).get();
	if (!chat) return ApiError.notFound('Not found');

	if (message.role !== 'assistant') {
		return ApiError.badRequest('Images can only be generated for assistant messages');
	}

	// Server-side de-dup. Without this, a double-click on the generate button
	// (or two devices triggering at once) would each kick off a job and both
	// would insert rows. The client also tracks this, but only as a UX hint —
	// the authoritative check lives here.
	if (activeImageGenerations.has(id)) {
		return ApiError.conflict('An image is already being generated for this message');
	}

	// Resolve effective provider + model.
	//
	// Fallback order: image override > chat's text provider override > user's
	// first enabled provider. Falling back through the text provider is the
	// most ergonomic — if the user configured one provider with both text and
	// image, no per-chat override is needed.
	let providerId: number | null = chat.overrideImageProviderId ?? null;
	let model: string | null = chat.overrideImageModel ?? null;

	if (providerId === null) {
		if (chat.overrideProviderId) {
			providerId = chat.overrideProviderId;
		} else {
			const def = db.select({ id: providers.id }).from(providers)
				.where(and(eq(providers.userId, user.id), eq(providers.enabled, true)))
				.orderBy(asc(providers.sortOrder), asc(providers.id))
				.get();
			providerId = def?.id ?? null;
		}
	}

	if (!providerId) {
		return ApiError.badRequest(
			'No image provider configured. Set an image model in the provider profile, or override it in this chat\'s settings.'
		);
	}

	const provider = db.select().from(providers).where(and(eq(providers.id, providerId), eq(providers.userId, user.id))).get();
	if (!provider) {
		return ApiError.badRequest('Configured image provider was not found. Please update this chat\'s image settings.');
	}

	const profile = providerProfiles.find((p) => p.id === provider.type);
	const capability = profile?.imageGeneration ?? 'none';
	if (capability === 'none') {
		return ApiError.badRequest(
			`Provider "${provider.name}" does not support image generation. Pick a different provider in this chat's settings.`
		);
	}

	// Model resolution: explicit override > provider's imageModel > error.
	// ComfyUI is special: the "model" is the workflow, not a discrete string.
	if (capability === 'comfyui') {
		if (!provider.imageComfyWorkflow || !provider.imageComfyPromptNodeId) {
			return ApiError.badRequest('ComfyUI provider is missing its workflow JSON or prompt-node id.');
		}
		// Use a fake model label so the DB row records the workflow source.
		if (!model) model = 'comfyui-workflow';
	} else {
		if (!model) model = provider.imageModel ?? '';
		if (!model) {
			return ApiError.badRequest(
				'No image model configured for this provider. Set one in the provider profile, or override it in this chat\'s settings.'
			);
		}
	}

	// Build the prompt from the template.
	const tmplOverride = chat.overrideImagePromptTemplate ?? null;
	const tmplGlobalRow = db.select().from(userSettings)
		.where(and(eq(userSettings.userId, user.id), eq(userSettings.key, 'imagePromptTemplate')))
		.get();
	const tmplGlobal = tmplGlobalRow?.value ?? '';
	const template = (tmplOverride && tmplOverride.trim())
		? tmplOverride
		: (tmplGlobal && tmplGlobal.trim()
			? tmplGlobal
			: 'Generate a single illustration that best depicts the scene described in this message. Capture the setting, mood, characters, and key actions:\n\n{{message}}');

	// Resolve the character + persona toggles. Per-chat override wins; null
	// means "inherit global".
	const includeAvatarGlobal = db.select().from(userSettings)
		.where(and(eq(userSettings.userId, user.id), eq(userSettings.key, 'imageIncludeAvatar')))
		.get()?.value === 'true';
	const includeDescGlobal = db.select().from(userSettings)
		.where(and(eq(userSettings.userId, user.id), eq(userSettings.key, 'imageIncludeCharacterDesc')))
		.get()?.value === 'true';
	const includePersonaDescGlobal = db.select().from(userSettings)
		.where(and(eq(userSettings.userId, user.id), eq(userSettings.key, 'imageIncludePersonaDesc')))
		.get()?.value === 'true';
	const includeAvatar = chat.overrideImageIncludeAvatar == null
		? includeAvatarGlobal
		: !!chat.overrideImageIncludeAvatar;
	const includeDesc = chat.overrideImageIncludeCharacterDesc == null
		? includeDescGlobal
		: !!chat.overrideImageIncludeCharacterDesc;
	const includePersonaDesc = chat.overrideImageIncludePersonaDesc == null
		? includePersonaDescGlobal
		: !!chat.overrideImageIncludePersonaDesc;

	// Pull character row only if we actually need it.
	let character: typeof characters.$inferSelect | undefined;
	if (includeAvatar || includeDesc) {
		character = db.select().from(characters).where(eq(characters.id, chat.characterId)).get();
	}

	// Resolve the active persona: chat override wins, otherwise fall back to
	// the user's default persona. Only fetched if we actually need it.
	let persona: typeof personas.$inferSelect | undefined;
	if (includePersonaDesc) {
		if (chat.overridePersonaId != null) {
			persona = db.select().from(personas)
				.where(and(eq(personas.id, chat.overridePersonaId), eq(personas.userId, user.id)))
				.get();
		}
		if (!persona) {
			persona = db.select().from(personas)
				.where(and(eq(personas.userId, user.id), eq(personas.isDefault, true)))
				.get();
		}
	}

	// Use the currently active swipe content as the source.
	const swipes = parseSwipes(message.swipes);
	const source = swipes[message.swipeIndex ?? 0] ?? message.content ?? '';
	let finalPrompt = template.replaceAll('{{message}}', source);

	// Prepend a character context block. If we're also sending the avatar as a
	// reference image, tell the model explicitly to use it — otherwise it may
	// just describe the reference back at you instead of using it.
	if (includeDesc && character?.description?.trim()) {
		const charBlock = includeAvatar
			? `The character in the reference image is ${character.name}. Description: ${character.description.trim()}\n\nUse this character (matching the reference image and description) as the subject of the following scene:\n\n`
			: `Character: ${character.name}. Description: ${character.description.trim()}\n\nDepict this character in the following scene:\n\n`;
		finalPrompt = charBlock + finalPrompt;
	} else if (includeAvatar && character) {
		finalPrompt = `Use the character shown in the reference image as the subject of the following scene. Match their appearance closely.\n\n${finalPrompt}`;
	}

	// Prepend the persona (user-side) context block. Goes above the character
	// block so the model reads "user" then "scene character" in order.
	if (includePersonaDesc && persona?.description?.trim()) {
		const personaName = (persona.displayName?.trim() || persona.name).trim();
		finalPrompt = `User-side character: ${personaName}. Description: ${persona.description.trim()}\n\n${finalPrompt}`;
	}

	// Resolve the reference image bytes if requested + available.
	let referenceImage: { bytes: Buffer; mime: string } | undefined;
	if (includeAvatar && character?.avatarPath) {
		const basename = character.avatarPath.split('/').pop() || '';
		const originalPath = getOriginalAvatarPath(basename);
		try {
			if (originalPath && existsSync(originalPath)) {
				const ext = originalPath.match(/\.[^.]+$/)?.[0]?.toLowerCase() ?? '.png';
				referenceImage = { bytes: await readFile(originalPath), mime: extToMime(ext) };
			} else {
				const optimized = join(process.cwd(), 'static', character.avatarPath);
				if (existsSync(optimized)) {
					const ext = optimized.match(/\.[^.]+$/)?.[0]?.toLowerCase() ?? '.webp';
					referenceImage = { bytes: await readFile(optimized), mime: extToMime(ext) };
				}
			}
		} catch (err) {
			event.locals.logger?.warn('image gen: failed to read avatar', { err: (err as Error).message });
		}
	}

	// Reference image is only meaningful for capabilities that can actually
	// consume one. ComfyUI is workflow-dependent (would need an image-load
	// node id from the user), so skip there.
	if (referenceImage && capability === 'comfyui') {
		referenceImage = undefined;
	}

	const swipeIndex = message.swipeIndex ?? 0;

	// Register the job + tell every connected client it's started so the
	// bubble/lightbox spinners reappear after a reload or on a second device.
	activeImageGenerations.start({ messageId: id, chatId: chat.id, userId: user.id, swipeIndex });
	broadcast(user.id, { type: 'messageImage:started', chatId: chat.id, messageId: id, swipeIndex });

	// Snapshot everything the background job needs. We deliberately don't
	// hold any per-request resources (response, event.locals) past this
	// point — the response goes out immediately and the promise survives
	// independently.
	const jobChatId = chat.id;
	const jobUserId = user.id;
	const jobMessageId = id;

	// Fire and forget. The HTTP response returns once we've registered the
	// job; the actual provider call runs in the background and broadcasts a
	// `messageImage:created` (or `messageImage:error`) when it finishes.
	void (async () => {
		try {
			const result = await generateImage(capability, {
				endpoint: provider.endpoint,
				apiKey: provider.apiKey || '',
				model,
				prompt: finalPrompt,
				referenceImage,
				comfyWorkflow: provider.imageComfyWorkflow ?? '',
				comfyPromptNodeId: provider.imageComfyPromptNodeId ?? ''
			});

			// Persist file. Mirror the inline-image cache pattern: keep the
			// original bytes and, when sharp can re-encode them, write an
			// optimized .webp sibling that the bubble can use as a thumbnail.
			// The lightbox keeps requesting ?original=1 for full quality.
			await mkdir(CACHE_DIR, { recursive: true });
			const uuid = randomUUID();
			const originalFilename = `genimg_${uuid}${result.ext}`;
			await writeFile(join(CACHE_DIR, originalFilename), result.buffer);

			let storedFilename = originalFilename;
			try {
				const optimized = await optimizeCachedImage(result.buffer, result.ext);
				if (optimized) {
					const webpFilename = `genimg_${uuid}${optimized.ext}`;
					await writeFile(join(CACHE_DIR, webpFilename), optimized.buffer);
					storedFilename = webpFilename;
				}
			} catch (err) {
				logger.warn('image gen: optimize failed; serving original', { err: (err as Error).message });
			}

			// Insert row + flip prior actives off within the same (message, swipe).
			const inserted = db.transaction((tx) => {
				tx.update(messageImages)
					.set({ isActive: false })
					.where(and(eq(messageImages.messageId, jobMessageId), eq(messageImages.swipeIndex, swipeIndex)))
					.run();
				const row = tx.insert(messageImages).values({
					messageId: jobMessageId,
					swipeIndex,
					filePath: storedFilename,
					prompt: finalPrompt,
					model,
					providerId: providerId!,
					isActive: true
				}).returning().get();
				return row;
			});

			broadcast(jobUserId, {
				type: 'messageImage:created',
				chatId: jobChatId,
				messageId: jobMessageId,
				image: publicImage(inserted)
			});
		} catch (err) {
			const msg = err instanceof ImageGenError ? err.message
				: (err instanceof Error ? err.message : 'Image generation failed');
			logger.warn('image gen failed', { messageId: jobMessageId, providerId, model, err: msg });
			broadcast(jobUserId, {
				type: 'messageImage:error',
				chatId: jobChatId,
				messageId: jobMessageId,
				error: msg
			});
		} finally {
			activeImageGenerations.clear(jobMessageId);
		}
	})();

	return json({ status: 'started', messageId: id, swipeIndex }, { status: 202 });
};
