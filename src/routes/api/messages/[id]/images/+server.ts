import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { eq, and, asc } from 'drizzle-orm';
import { db } from '$lib/db/index.js';
import { messages, chats, providers, messageImages, userSettings } from '$lib/db/schema.js';
import { requireUser } from '$lib/server/auth.js';
import { broadcast } from '$lib/server/realtime.js';
import { ApiError } from '$lib/server/apiError.js';
import { providerProfiles } from '$lib/providers/profiles.js';
import { generateImage, ImageGenError } from '$lib/server/imageGen.js';
import { parseSwipes } from '$lib/messageJson.js';

const CACHE_DIR = join(process.cwd(), 'data', 'image-cache');

function publicImage(row: typeof messageImages.$inferSelect) {
	return {
		id: row.id,
		messageId: row.messageId,
		filePath: row.filePath,
		prompt: row.prompt,
		model: row.model ?? '',
		providerId: row.providerId,
		isActive: !!row.isActive,
		createdAt: row.createdAt ?? null
	};
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

	// Use the currently active swipe content as the source.
	const swipes = parseSwipes(message.swipes);
	const source = swipes[message.swipeIndex ?? 0] ?? message.content ?? '';
	const finalPrompt = template.replaceAll('{{message}}', source);

	// Generate.
	let result;
	try {
		result = await generateImage(capability, {
			endpoint: provider.endpoint,
			apiKey: provider.apiKey || '',
			model,
			prompt: finalPrompt,
			comfyWorkflow: provider.imageComfyWorkflow ?? '',
			comfyPromptNodeId: provider.imageComfyPromptNodeId ?? ''
		});
	} catch (err) {
		const msg = err instanceof ImageGenError ? err.message : (err instanceof Error ? err.message : 'Image generation failed');
		event.locals.logger?.warn('image gen failed', { messageId: id, providerId, model, err: msg });
		return ApiError.badRequest(msg);
	}

	// Persist file.
	await mkdir(CACHE_DIR, { recursive: true });
	const filename = `genimg_${randomUUID()}${result.ext}`;
	await writeFile(join(CACHE_DIR, filename), result.buffer);

	// Insert row + flip prior actives off (single transaction).
	const inserted = db.transaction((tx) => {
		tx.update(messageImages).set({ isActive: false }).where(eq(messageImages.messageId, id)).run();
		const row = tx.insert(messageImages).values({
			messageId: id,
			filePath: filename,
			prompt: finalPrompt,
			model,
			providerId,
			isActive: true
		}).returning().get();
		return row;
	});

	const payload = publicImage(inserted);
	broadcast(user.id, { type: 'messageImage:created', chatId: chat.id, messageId: id, image: payload });

	return json({ image: payload });
};
