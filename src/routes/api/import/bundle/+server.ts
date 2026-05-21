import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import {
	characters, chats, messages, lorebooks, lorebookEntries,
	personas, providers, themes, userSettings, chatLorebooks
} from '$lib/db/schema.js';
import { and, eq } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth.js';
import { recomputeChatTail } from '$lib/db/chatTail.js';
import { parseCharaCardFromPNG } from '$lib/services/character.js';
import { cacheCharacterTextImages, cacheBackgroundFromExtensions } from '$lib/services/characterImageCache.js';
import { storeAvatarFromBuffer, isPlaceholderAvatar } from '$lib/services/imageOptimizer.js';
import { extractThemeFromAvatar } from '$lib/services/themeExtractor.js';
import { characterFingerprint, BUNDLE_VERSION } from '$lib/server/bundle.js';
import { logger } from '$lib/server/logger.js';
import { ALLOWED_SETTING_KEYS } from '$lib/server/settingsKeys.js';
import { lorebookEntryFingerprint } from '$lib/services/lorebook.js';
import { findLengthViolation, checkLength, type LengthViolation } from '$lib/server/fieldLimits.js';
import JSZip from 'jszip';

const MAX_BUNDLE_BYTES = 256 * 1024 * 1024; // 256 MB

const CHARACTER_CARD_FIELD_LIMITS = {
	name: 'name',
	description: 'description',
	personality: 'personality',
	scenario: 'scenario',
	firstMessage: 'firstMessage',
	mesExample: 'mesExample',
	systemPrompt: 'systemPrompt',
	postHistoryInstructions: 'postHistoryInstructions',
	creatorNotes: 'creatorNotes',
	creator: 'name',
	characterVersion: 'name',
} as const;

function formatViolation(v: LengthViolation): string {
	return `field "${v.field}" exceeds ${v.limit} chars (got ${v.length})`;
}

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

	// Zip-bomb guard (IMPORT-M3). Sum every entry's UNCOMPRESSED size before
	// any extraction. JSZip exposes this on `_data.uncompressedSize` (no
	// public accessor — fragile across versions). If a single entry is missing
	// that field we refuse rather than assume zero, because "assume zero"
	// gives an attacker a free pass to ship a bomb past this check. Operators
	// who hit a false positive can pre-extract and re-zip.
	const ZIP_UNCOMPRESSED_LIMIT = 256 * 1024 * 1024; // 256 MiB
	let totalUncompressed = 0;
	for (const [path, entry] of Object.entries(zip.files)) {
		if (entry.dir) continue;
		const data = (entry as unknown as { _data?: { uncompressedSize?: number } })._data;
		const sz = data?.uncompressedSize;
		if (typeof sz !== 'number' || sz < 0) {
			logger.warn('import: zip entry missing uncompressedSize — refusing', { userId: user.id, path });
			return json({ error: 'Could not verify uncompressed size for every entry in zip — refusing to extract.' }, { status: 400 });
		}
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

	// IMPORT-M5: warn (don't reject) when the bundle was written by a newer
	// schema than this server knows about. We're conservatively forward-
	// compatible — unknown keys get dropped by the existing allowlists, but
	// the operator should know so they can interpret missing data correctly.
	const importWarnings: string[] = [];
	const manifestVersion = typeof manifest?.version === 'number' ? manifest.version : null;
	if (manifestVersion != null && manifestVersion > BUNDLE_VERSION) {
		const msg = `Bundle was exported by a newer version of Skald (v${manifestVersion}) than this server supports (v${BUNDLE_VERSION}). Some fields may be silently dropped.`;
		logger.warn('import: bundle version newer than server', { userId: user.id, manifestVersion, supported: BUNDLE_VERSION });
		importWarnings.push(msg);
	}

	logger.info('import: bundle start', {
		userId: user.id,
		bundleType: manifest?.bundleType ?? 'unknown',
		fileSize: file.size,
		zipEntries: Object.values(zip.files).filter(f => !f.dir).length,
	});

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

				// Enforce field-length caps. Bundle imports skip the bad item
				// (and surface a warning) rather than aborting the whole zip.
				const cardViolation = findLengthViolation(
					cardData as unknown as Record<string, unknown>,
					CHARACTER_CARD_FIELD_LIMITS,
				);
				if (cardViolation) {
					const msg = `Skipped character "${cardData.name}" (${path}): ${formatViolation(cardViolation)}`;
					logger.warn('import: character skipped (field too long)', { path, name: cardData.name, ...cardViolation });
					importWarnings.push(msg);
					continue;
				}
				const tagsJson = JSON.stringify(cardData.tags ?? []);
				const tagsViolation = checkLength(tagsJson, 'tags', 'tags');
				if (tagsViolation) {
					importWarnings.push(`Skipped character "${cardData.name}" (${path}): ${formatViolation(tagsViolation)}`);
					logger.warn('import: character skipped (tags too long)', { path, name: cardData.name, ...tagsViolation });
					continue;
				}
				let oversizedGreeting: LengthViolation | null = null;
				for (let i = 0; i < (cardData.alternateGreetings ?? []).length; i++) {
					const gv = checkLength(cardData.alternateGreetings[i], 'firstMessage', `alternateGreetings[${i}]`);
					if (gv) { oversizedGreeting = gv; break; }
				}
				if (oversizedGreeting) {
					importWarnings.push(`Skipped character "${cardData.name}" (${path}): ${formatViolation(oversizedGreeting)}`);
					logger.warn('import: character skipped (greeting too long)', { path, name: cardData.name, ...oversizedGreeting });
					continue;
				}

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
					logger.info('import: character skipped (duplicate)', { path, name: cardData.name });
					fingerprintToNewId.set(fp, existingId);
					continue;
				}

				// Save the original avatar. Skip 1x1 placeholder PNGs and corrupt
				// image data — both fall back to the initial-letter placeholder in the UI.
				let avatarPath: string | null = null;
				if (!(await isPlaceholderAvatar(bytes))) {
					try {
						avatarPath = await storeAvatarFromBuffer(bytes, 'image/png');
					} catch (avatarErr) {
						logger.warn('import: avatar processing failed, importing without avatar', { path, name: cardData.name, err: String(avatarErr) });
					}
				}

				let theme: string | undefined;
				if (avatarPath) {
					const extracted = await extractThemeFromAvatar(bytes);
					if (extracted) theme = JSON.stringify(extracted);
				}

				const backgroundPath = await cacheBackgroundFromExtensions(cardData.extensions as any);
				const cachedText = await cacheCharacterTextImages({
					firstMessage: cardData.firstMessage,
					alternateGreetings: cardData.alternateGreetings,
					creatorNotes: cardData.creatorNotes
				});

				const finalName = dedupeName(cardData.name, existingCharNames);
				existingCharNames.add(finalName);

				const inserted = db.insert(characters).values({
					userId: user.id,
					name: finalName,
					description: cardData.description,
					personality: cardData.personality,
					firstMessage: cachedText.firstMessage ?? '',
					scenario: cardData.scenario,
					systemPrompt: cardData.systemPrompt,
					avatarPath,
					backgroundPath,
					theme,
					creatorNotes: cachedText.creatorNotes ?? '',
					tags: JSON.stringify(cardData.tags),
					mesExample: cardData.mesExample,
					postHistoryInstructions: cardData.postHistoryInstructions,
					alternateGreetings: cachedText.alternateGreetings,
					creator: cardData.creator,
					characterVersion: cardData.characterVersion,
					extensions: JSON.stringify(cardData.extensions)
				}).returning().get();

				fingerprintToNewId.set(fp, inserted.id);
				existingCharsByFp.set(fp, inserted.id);
				logger.info('import: character imported', { path, name: finalName, id: inserted.id });
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
			const desiredName = lb.name || 'Imported Lorebook';

			// Drop oversized entries individually so a single bloated entry
			// doesn't lose the rest of the lorebook. Whole lorebook is skipped
			// only if its name is over cap (rare).
			const lbNameV = checkLength(desiredName, 'name', 'name');
			if (lbNameV) {
				importWarnings.push(`Skipped lorebook "${desiredName}" (${f.name}): ${formatViolation(lbNameV)}`);
				logger.warn('import: lorebook skipped (name too long)', { path: f.name, ...lbNameV });
				continue;
			}
			const rawEntries: any[] = Array.isArray(lb.entries) ? lb.entries : [];
			const validEntries: any[] = [];
			let droppedEntries = 0;
			for (let i = 0; i < rawEntries.length; i++) {
				const e = rawEntries[i];
				const kv = checkLength(e?.keywords ?? '', 'lorebookEntryKeys', `entries[${i}].keywords`);
				const cv = checkLength(e?.content ?? '', 'lorebookEntryContent', `entries[${i}].content`);
				if (kv || cv) {
					droppedEntries++;
					logger.warn('import: lorebook entry dropped (too long)', { path: f.name, index: i, keys: kv ?? null, content: cv ?? null });
					continue;
				}
				validEntries.push(e);
			}
			if (droppedEntries > 0) {
				importWarnings.push(`Lorebook "${desiredName}": dropped ${droppedEntries} oversized entr${droppedEntries === 1 ? 'y' : 'ies'}.`);
			}
			lb.entries = validEntries;

			const charFp = lb.character?.fingerprint as string | undefined;
			const linkedCharId = charFp ? fingerprintToNewId.get(charFp) ?? null : null;

			// IMPORT-M6: parity with single-character import — reuse an
			// existing lorebook by name (per user) and merge entries by
			// (keywords, content-hash) fingerprint. Re-importing the same
			// bundle twice should be a no-op, not a fragmenting rename.
			const existing = db.select().from(lorebooks)
				.where(and(eq(lorebooks.userId, user.id), eq(lorebooks.name, desiredName)))
				.get();

			const inserted = db.transaction(() => {
				const row = existing ?? db.insert(lorebooks).values({
					userId: user.id,
					name: desiredName,
					description: lb.description ?? '',
					characterId: linkedCharId,
					enabled: lb.enabled ?? true
				}).returning().get();

				// If we're reusing an existing lorebook, late-bind it to the
				// freshly-imported character when it wasn't linked before.
				if (existing && !existing.characterId && linkedCharId) {
					db.update(lorebooks).set({ characterId: linkedCharId }).where(eq(lorebooks.id, existing.id)).run();
				}

				const existingFingerprints = existing
					? new Set(db.select().from(lorebookEntries).where(eq(lorebookEntries.lorebookId, row.id)).all().map(e => lorebookEntryFingerprint(e.keywords, e.content)))
					: new Set<string>();

				for (const e of (lb.entries ?? [])) {
					const keywords = e.keywords ?? '';
					const content = e.content ?? '';
					const fp = lorebookEntryFingerprint(keywords, content);
					if (existingFingerprints.has(fp)) continue;
					existingFingerprints.add(fp);
					db.insert(lorebookEntries).values({
						lorebookId: row.id,
						keywords,
						content,
						insertionOrder: e.insertionOrder ?? 100,
						enabled: e.enabled ?? true,
						caseSensitive: e.caseSensitive ?? false,
						constant: e.constant ?? false
					}).run();
				}
				return row;
			});

			// Track old→new id mapping via the lorebook_<oldId>.json filename
			// so chat_lorebooks links re-bind to the (possibly reused) row.
			const m = f.name.match(/lorebook_(\d+)\.json$/);
			if (m) oldIdToNewId.lorebooks.set(Number(m[1]), inserted.id);

			// Keep the name dedupe set accurate for any later collisions.
			existingLorebookNames.add(desiredName);

			logger.info('import: lorebook imported', { path: f.name, name: desiredName, id: inserted.id, reused: !!existing, entryCount: (lb.entries ?? []).length });
			if (!existing) counts.lorebooks++;
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

			// Check message content caps. Dropping an individual message would
			// orphan its branch children, so we skip the entire chat instead.
			const rawMessages: any[] = Array.isArray(chatJson.messages) ? chatJson.messages : [];
			let oversizedMessage: { index: number; v: LengthViolation } | null = null;
			for (let i = 0; i < rawMessages.length; i++) {
				const m = rawMessages[i];
				const mv = checkLength(m?.content ?? '', 'messageContent', `messages[${i}].content`);
				if (mv) { oversizedMessage = { index: i, v: mv }; break; }
				if (Array.isArray(m?.swipes)) {
					for (let s = 0; s < m.swipes.length; s++) {
						const sv = checkLength(m.swipes[s], 'messageContent', `messages[${i}].swipes[${s}]`);
						if (sv) { oversizedMessage = { index: i, v: sv }; break; }
					}
					if (oversizedMessage) break;
				}
			}
			if (oversizedMessage) {
				importWarnings.push(`Skipped chat "${chatJson.title ?? '(untitled)'}" (${f.name}): ${formatViolation(oversizedMessage.v)}`);
				logger.warn('import: chat skipped (message too long)', { path: f.name, ...oversizedMessage.v });
				continue;
			}

			if (!charId) {
				// No character matched — defer. Keep raw bytes for the client-side resolver.
				logger.info('import: chat unresolved (no character match)', { path: f.name, title: chatJson.title, charName, charFp: fp ?? null });
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

			// Atomic per-chat: chat row + every message + leaf update either all
			// land or none. A partial chat (header with no messages) shows up as
			// an empty stub in the sidebar and confuses the branch logic.
			const { insertedChatId, idMap, lastId } = db.transaction(() => {
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
				return { insertedChatId: insertedChat.id, idMap, lastId };
			});
			void idMap; void lastId;

			try {
				recomputeChatTail(insertedChatId);
			} catch (err) {
				logger.warn('import: recomputeChatTail failed', { chatId: insertedChatId, err: String(err) });
			}

			// Track old→new for chat_lorebooks linking
			const m = f.name.match(/chat_(\d+)\.json$/);
			if (m) oldIdToNewId.chats.set(Number(m[1]), insertedChatId);

			logger.info('import: chat imported', { path: f.name, title: chatJson.title, charId, newChatId: insertedChatId });
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
						avatarPath = await storeAvatarFromBuffer(bytes, 'image/png');
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
		warnings: importWarnings,
		availableCharacters: db.select({ id: characters.id, name: characters.name }).from(characters).where(eq(characters.userId, user.id)).all()
	});
};

export const config = { bodyParser: false };
