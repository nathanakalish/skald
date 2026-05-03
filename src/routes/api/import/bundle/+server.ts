import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import {
	characters, chats, messages, lorebooks, lorebookEntries,
	personas, providers, themes, userSettings, chatLorebooks
} from '$lib/db/schema.js';
import { eq } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth.js';
import { recomputeChatTail } from '$lib/db/chatTail.js';
import { parseCharaCardFromPNG } from '$lib/services/character.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { optimizeAvatar, getAvatarOriginalsDir } from '$lib/services/imageOptimizer.js';
import { extractThemeFromAvatar } from '$lib/services/themeExtractor.js';
import { characterFingerprint } from '$lib/server/bundle.js';
import { logger } from '$lib/server/logger.js';
import { ALLOWED_SETTING_KEYS } from '$lib/server/settingsKeys.js';
import JSZip from 'jszip';

const MAX_BUNDLE_BYTES = 256 * 1024 * 1024; // 256 MB

interface UnresolvedChat {
	zipPath: string;
	title: string;
	characterName: string;
	characterFingerprint: string | null;
	messageCount: number;
}

function dedupeName(desired: string, existing: Set<string>): string {
	if (!existing.has(desired)) return desired;
	const base = desired.replace(/\s*\(imported(?:\s+\d+)?\)$/, '');
	let candidate = `${base} (imported)`;
	let n = 2;
	while (existing.has(candidate)) candidate = `${base} (imported ${n++})`;
	return candidate;
}

export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const startedAt = Date.now();
	const ctype = event.request.headers.get('content-type') || '';
	if (!ctype.includes('multipart/form-data')) {
		return json({ error: 'Expected multipart/form-data' }, { status: 400 });
	}

	const form = await event.request.formData();
	const file = form.get('file') as File | null;
	if (!file) return json({ error: 'No file uploaded' }, { status: 400 });
	if (file.size > MAX_BUNDLE_BYTES) {
		return json({ error: `File too large — max ${MAX_BUNDLE_BYTES / 1024 / 1024} MiB` }, { status: 413 });
	}

	const arrayBuf = await file.arrayBuffer();

	let zip: JSZip;
	try {
		zip = await JSZip.loadAsync(arrayBuf);
	} catch {
		return json({ error: 'Could not read zip file' }, { status: 400 });
	}

	// Zip-bomb guard (M12). Sum every entry's UNCOMPRESSED size before doing
	// any extraction. JSZip exposes this on the private _data._uncompressedSize
	// (no public accessor), so we tolerate it being missing.
	const ZIP_UNCOMPRESSED_LIMIT = 256 * 1024 * 1024; // 256 MiB
	let totalUncompressed = 0;
	for (const entry of Object.values(zip.files)) {
		if (entry.dir) continue;
		const data = (entry as unknown as { _data?: { uncompressedSize?: number } })._data;
		const sz = data?.uncompressedSize ?? 0;
		totalUncompressed += sz;
		if (totalUncompressed > ZIP_UNCOMPRESSED_LIMIT) {
			return json({ error: 'Zip would expand beyond 256 MiB \u2014 refusing to extract.' }, { status: 413 });
		}
	}

	let manifest: any = null;
	const manifestEntry = zip.file('manifest.json');
	if (manifestEntry) {
		try { manifest = JSON.parse(await manifestEntry.async('string')); } catch { /* ignore */ }
	}

	const counts = { characters: 0, chats: 0, lorebooks: 0, personas: 0, providers: 0, themes: 0, settings: 0 };
	const unresolvedChats: UnresolvedChat[] = [];
	const messages_unresolved: { zipPath: string; bytes: string }[] = [];

	// Existing-name sets, used to dedupe collisions.
	const existingCharNames = new Set(db.select({ name: characters.name }).from(characters).where(eq(characters.userId, user.id)).all().map(r => r.name));
	const existingLorebookNames = new Set(db.select({ name: lorebooks.name }).from(lorebooks).where(eq(lorebooks.userId, user.id)).all().map(r => r.name));
	const existingPersonaNames = new Set(db.select({ name: personas.name }).from(personas).where(eq(personas.userId, user.id)).all().map(r => r.name));
	const existingThemeNames = new Set(db.select({ name: themes.name }).from(themes).where(eq(themes.userId, user.id)).all().map(r => r.name));
	const existingProviderNames = new Set(db.select({ name: providers.name }).from(providers).where(eq(providers.userId, user.id)).all().map(r => r.name));

	// Map content fingerprint → new character id
	const fingerprintToNewId = new Map<string, number>();
	const oldIdToNewId = {
		// id maps for re-linking chat_lorebooks at the end
		chats: new Map<number, number>(),
		lorebooks: new Map<number, number>()
	};

	// Map of existing characters by fingerprint — lets re-importing the same
	// bundle skip dupes instead of creating new rows.
	const existingCharsByFp = new Map<string, number>();
	for (const c of db.select().from(characters).where(eq(characters.userId, user.id)).all()) {
		const fp = characterFingerprint({
			name: c.name, description: c.description, personality: c.personality,
			firstMessage: c.firstMessage, scenario: c.scenario
		});
		existingCharsByFp.set(fp, c.id);
	}

	// 1. Characters — import each PNG card.
	const charFolder = zip.folder('characters');
	if (charFolder) {
		const charFiles: { path: string; file: JSZip.JSZipObject }[] = [];
		zip.forEach((relPath, file) => {
			if (relPath.startsWith('characters/') && !file.dir && relPath.toLowerCase().endsWith('.png')) {
				charFiles.push({ path: relPath, file });
			}
		});

		for (const { path, file } of charFiles) {
			try {
				const bytes = await file.async('nodebuffer');
				const cardData = parseCharaCardFromPNG(bytes);
				const fp = characterFingerprint({
					name: cardData.name,
					description: cardData.description,
					personality: cardData.personality,
					firstMessage: cardData.firstMessage,
					scenario: cardData.scenario
				});

				// Skip if we already have an identical character (matching fingerprint).
				const existingId = existingCharsByFp.get(fp);
				if (existingId) {
					fingerprintToNewId.set(fp, existingId);
					continue;
				}

				// Save the original avatar.
				const avatarDir = join(process.cwd(), 'static', 'avatars');
				mkdirSync(avatarDir, { recursive: true });
				const uuid = randomUUID();
				writeFileSync(join(getAvatarOriginalsDir(), `${uuid}.png`), bytes);
				const optimized = await optimizeAvatar(bytes);
				writeFileSync(join(avatarDir, `${uuid}.webp`), optimized);
				const avatarPath = `/avatars/${uuid}.webp`;

				let theme: string | undefined;
				const extracted = await extractThemeFromAvatar(bytes);
				if (extracted) theme = JSON.stringify(extracted);

				const finalName = dedupeName(cardData.name, existingCharNames);
				existingCharNames.add(finalName);

				const inserted = db.insert(characters).values({
					userId: user.id,
					name: finalName,
					description: cardData.description,
					personality: cardData.personality,
					firstMessage: cardData.firstMessage,
					scenario: cardData.scenario,
					systemPrompt: cardData.systemPrompt,
					avatarPath,
					theme,
					creatorNotes: cardData.creatorNotes,
					tags: JSON.stringify(cardData.tags),
					mesExample: cardData.mesExample,
					postHistoryInstructions: cardData.postHistoryInstructions,
					alternateGreetings: JSON.stringify(cardData.alternateGreetings ?? []),
					creator: cardData.creator,
					characterVersion: cardData.characterVersion,
					extensions: JSON.stringify(cardData.extensions)
				}).returning().get();

				fingerprintToNewId.set(fp, inserted.id);
				existingCharsByFp.set(fp, inserted.id);
				counts.characters++;
			} catch (err) {
				logger.warn('bundle import: failed to import character', { path, err: String(err) });
			}
		}
	}

	// 2. Lorebooks.
	const lorebookFiles: JSZip.JSZipObject[] = [];
	zip.forEach((relPath, f) => {
		if (relPath.startsWith('lorebooks/') && !f.dir && relPath.toLowerCase().endsWith('.json')) {
			lorebookFiles.push(f);
		}
	});

	for (const f of lorebookFiles) {
		try {
			const lb = JSON.parse(await f.async('string'));
			const finalName = dedupeName(lb.name || 'Imported Lorebook', existingLorebookNames);
			existingLorebookNames.add(finalName);

			const charFp = lb.character?.fingerprint as string | undefined;
			const linkedCharId = charFp ? fingerprintToNewId.get(charFp) ?? null : null;

			const inserted = db.insert(lorebooks).values({
				userId: user.id,
				name: finalName,
				description: lb.description ?? '',
				characterId: linkedCharId,
				enabled: lb.enabled ?? true
			}).returning().get();

			// Track old→new id mapping via the lorebook_<oldId>.json filename.
			const m = f.name.match(/lorebook_(\d+)\.json$/);
			if (m) oldIdToNewId.lorebooks.set(Number(m[1]), inserted.id);

			for (const e of (lb.entries ?? [])) {
				db.insert(lorebookEntries).values({
					lorebookId: inserted.id,
					keywords: e.keywords ?? '',
					content: e.content ?? '',
					insertionOrder: e.insertionOrder ?? 100,
					enabled: e.enabled ?? true,
					caseSensitive: e.caseSensitive ?? false,
					constant: e.constant ?? false
				}).run();
			}
			counts.lorebooks++;
		} catch (err) {
			logger.warn('bundle import: failed to import lorebook', { path: f.name, err: String(err) });
		}
	}

	// 3. Chats — preserve the branch tree.
	const chatFiles: JSZip.JSZipObject[] = [];
	zip.forEach((relPath, f) => {
		if (relPath.startsWith('chats/') && !f.dir && relPath.toLowerCase().endsWith('.json')) {
			chatFiles.push(f);
		}
	});

	for (const f of chatFiles) {
		try {
			const chatJson = JSON.parse(await f.async('string'));
			const fp: string | undefined = chatJson.character?.fingerprint;
			const charName: string = chatJson.character?.name ?? 'Unknown';
			const charId = fp ? fingerprintToNewId.get(fp) : undefined;

			if (!charId) {
				// No character matched — defer. Keep raw bytes for the client-side resolver.
				const bytes = await f.async('string');
				messages_unresolved.push({ zipPath: f.name, bytes });
				unresolvedChats.push({
					zipPath: f.name,
					title: chatJson.title ?? '',
					characterName: charName,
					characterFingerprint: fp ?? null,
					messageCount: Array.isArray(chatJson.messages) ? chatJson.messages.length : 0
				});
				continue;
			}

			const insertedChat = db.insert(chats).values({
				userId: user.id,
				characterId: charId,
				title: chatJson.title || `Imported chat`,
				mode: chatJson.mode || 'story'
			}).returning().get();

			const idMap = new Map<number, number>();
			const sorted = (Array.isArray(chatJson.messages) ? chatJson.messages : []).slice().sort((a: any, b: any) => a.id - b.id);
			let lastId: number | null = null;
			for (const m of sorted) {
				if (m.role !== 'user' && m.role !== 'assistant' && m.role !== 'system') continue;
				const remappedParent = m.parentId != null ? idMap.get(m.parentId) ?? null : null;
				const inserted = db.insert(messages).values({
					chatId: insertedChat.id,
					role: m.role,
					content: m.content || '',
					swipes: JSON.stringify(Array.isArray(m.swipes) && m.swipes.length > 0 ? m.swipes : [m.content || '']),
					swipeIndex: m.swipeIndex ?? 0,
					reasoning: JSON.stringify(m.reasoning ?? []),
					parentId: remappedParent,
					...(m.createdAt ? { createdAt: m.createdAt } : {})
				}).returning().get();
				idMap.set(m.id, inserted.id);
				lastId = inserted.id;
			}

			let leafId = lastId;
			if (chatJson.activeLeafId != null) {
				const remapped = idMap.get(chatJson.activeLeafId);
				if (remapped) leafId = remapped;
			}
			if (leafId) {
				db.update(chats).set({ activeLeafId: leafId }).where(eq(chats.id, insertedChat.id)).run();
			}
			recomputeChatTail(insertedChat.id);

			// Track old→new for chat_lorebooks linking
			const m = f.name.match(/chat_(\d+)\.json$/);
			if (m) oldIdToNewId.chats.set(Number(m[1]), insertedChat.id);

			counts.chats++;
		} catch (err) {
			logger.warn('bundle import: failed to import chat', { path: f.name, err: String(err) });
		}
	}

	// 4. chat_lorebooks (re-link)
	const clbEntry = zip.file('chat_lorebooks.json');
	if (clbEntry) {
		try {
			const rows = JSON.parse(await clbEntry.async('string')) as Array<{ chatId: number; lorebookId: number }>;
			for (const r of rows) {
				const newChatId = oldIdToNewId.chats.get(r.chatId);
				const newLorebookId = oldIdToNewId.lorebooks.get(r.lorebookId);
				if (newChatId && newLorebookId) {
					db.insert(chatLorebooks).values({ chatId: newChatId, lorebookId: newLorebookId }).run();
				}
			}
		} catch (err) {
			logger.warn('bundle import: failed to import chat_lorebooks', { err: String(err) });
		}
	}

	// 5. Personas
	const personaEntry = zip.file('personas/personas.json');
	if (personaEntry) {
		try {
			const list = JSON.parse(await personaEntry.async('string')) as Array<{
				name: string; displayName: string; description: string; isDefault: boolean; avatarFile: string | null;
			}>;
			for (const p of list) {
				const finalName = dedupeName(p.name || 'Imported persona', existingPersonaNames);
				existingPersonaNames.add(finalName);

				let avatarPath: string | null = null;
				if (p.avatarFile) {
					const avatarEntry = zip.file(`personas/avatars/${p.avatarFile}`);
					if (avatarEntry) {
						const bytes = await avatarEntry.async('nodebuffer');
						const avatarDir = join(process.cwd(), 'static', 'avatars');
						mkdirSync(avatarDir, { recursive: true });
						const uuid = randomUUID();
						writeFileSync(join(getAvatarOriginalsDir(), `${uuid}.png`), bytes);
						const optimized = await optimizeAvatar(bytes);
						writeFileSync(join(avatarDir, `${uuid}.webp`), optimized);
						avatarPath = `/avatars/${uuid}.webp`;
					}
				}

				db.insert(personas).values({
					userId: user.id,
					name: finalName,
					displayName: p.displayName ?? '',
					description: p.description ?? '',
					avatarPath,
					isDefault: false // never override default on import
				}).run();
				counts.personas++;
			}
		} catch (err) {
			logger.warn('bundle import: failed to import personas', { err: String(err) });
		}
	}

	// 6. Themes
	const themesEntry = zip.file('themes.json');
	if (themesEntry) {
		try {
			const list = JSON.parse(await themesEntry.async('string')) as Array<typeof themes.$inferSelect>;
			for (const t of list) {
				if (t.isBuiltin) continue; // never import builtins
				const finalName = dedupeName(t.name, existingThemeNames);
				existingThemeNames.add(finalName);
				db.insert(themes).values({
					userId: user.id,
					name: finalName,
					mode: t.mode,
					colors: t.colors,
					isActive: false,
					isBuiltin: false
				}).run();
				counts.themes++;
			}
		} catch (err) {
			logger.warn('bundle import: failed to import themes', { err: String(err) });
		}
	}

	// 7. Settings — merge into user_settings, overwriting existing keys.
	// Filter through the same allow-list the PATCH /api/settings endpoint
	// uses (M13) so a malicious bundle can't inject arbitrary key/value
	// rows (e.g. fake feature flags, internal-only keys).
	const settingsEntry = zip.file('settings.json');
	if (settingsEntry) {
		try {
			const allowed = new Set(ALLOWED_SETTING_KEYS);
			const list = JSON.parse(await settingsEntry.async('string')) as Array<{ key: string; value: string }>;
			for (const s of list) {
				if (!s.key || !allowed.has(s.key)) continue;
				db.insert(userSettings)
					.values({ userId: user.id, key: s.key, value: s.value ?? '' })
					.onConflictDoUpdate({
						target: [userSettings.userId, userSettings.key],
						set: { value: s.value ?? '' }
					})
					.run();
				counts.settings++;
			}
		} catch (err) {
			logger.warn('bundle import: failed to import settings', { err: String(err) });
		}
	}

	// 8. Providers — keys NOT included in exports; force enabled=false
	let providersWarning = false;
	const providersEntry = zip.file('providers.json');
	if (providersEntry) {
		try {
			const wrap = JSON.parse(await providersEntry.async('string'));
			const list = (wrap.providers ?? []) as Array<typeof providers.$inferSelect>;
			for (const p of list) {
				const finalName = dedupeName(p.name, existingProviderNames);
				existingProviderNames.add(finalName);
				db.insert(providers).values({
					userId: user.id,
					name: finalName,
					type: p.type,
					endpoint: p.endpoint ?? '',
					apiKey: '', // never trust imported keys
					defaultModel: p.defaultModel ?? '',
					enabled: false, // disabled until user adds key
					maxConcurrent: p.maxConcurrent ?? 1,
					temperature: p.temperature ?? 0.8,
					topP: p.topP ?? 1.0,
					topK: p.topK ?? 0,
					maxTokens: p.maxTokens ?? 1024,
					contextSize: p.contextSize ?? 32768,
					repetitionPenalty: p.repetitionPenalty ?? 1.0,
					frequencyPenalty: p.frequencyPenalty ?? 0.0,
					presencePenalty: p.presencePenalty ?? 0.0,
					storyContextMessages: p.storyContextMessages ?? 40,
					textingContextMessages: p.textingContextMessages ?? 20,
					customPrompt: p.customPrompt ?? '',
					lorebookDepth: p.lorebookDepth ?? 4,
					streamingEnabled: p.streamingEnabled ?? true,
					includeReasoning: p.includeReasoning ?? false,
					reasoningEffort: p.reasoningEffort ?? 'off',
					textingTypingSpeed: p.textingTypingSpeed ?? 35,
					textingTypingMax: p.textingTypingMax ?? 4000,
					textingInitialDelay: p.textingInitialDelay ?? 1500,
					sortOrder: p.sortOrder ?? 0
				}).run();
				counts.providers++;
				providersWarning = true;
			}
		} catch (err) {
			logger.warn('bundle import: failed to import providers', { err: String(err) });
		}
	}

	event.locals.logger.info('import: bundle complete', {
		userId: user.id,
		bytes: file.size,
		durationMs: Date.now() - startedAt,
		counts,
		unresolvedChats: unresolvedChats.length,
	});

	return json({
		ok: true,
		manifest,
		counts,
		unresolvedChats,
		unresolvedChatPayloads: messages_unresolved, // raw v2 JSON for resolver
		providersWarning,
		availableCharacters: db.select({ id: characters.id, name: characters.name }).from(characters).where(eq(characters.userId, user.id)).all()
	});
};

function _logBundleImportComplete(
	event: Parameters<RequestHandler>[0],
	userId: number,
	startedAt: number,
	counts: Record<string, number>,
	bytes: number,
) {
	event.locals.logger.info('import: bundle complete', {
		userId,
		bytes,
		durationMs: Date.now() - startedAt,
		counts,
	});
}

export const config = { bodyParser: false };
