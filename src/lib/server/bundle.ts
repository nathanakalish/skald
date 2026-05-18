import { createHash } from 'crypto';
import { deflateSync } from 'zlib';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import JSZip from 'jszip';
import { db } from '$lib/db/index.js';
import {
	characters,
	chats,
	messages,
	lorebooks,
	lorebookEntries,
	personas,
	providers,
	themes,
	userSettings,
	chatLorebooks
} from '$lib/db/schema.js';
import { eq, and, inArray } from 'drizzle-orm';
import { toCharaCardJSON, embedCharaCardInPNG } from '$lib/services/character.js';
import { getOriginalAvatarPath } from '$lib/services/imageOptimizer.js';

export const BUNDLE_VERSION = 2;

type BundleType = 'everything' | 'characters' | 'lorebooks' | 'chats';

/**
 * Stable fingerprint of a character's content. Two characters with identical
 * core fields hash to the same value regardless of id, timestamps, or owner.
 * Used to match chats to characters across installs.
 */
export function characterFingerprint(c: {
	name?: string | null;
	description?: string | null;
	personality?: string | null;
	firstMessage?: string | null;
	scenario?: string | null;
}): string {
	const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
	const payload = [
		norm(c.name),
		norm(c.description),
		norm(c.personality),
		norm(c.firstMessage),
		norm(c.scenario)
	].join('\x1f');
	return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

/** Read the original (uploaded) avatar bytes if we still have them. */
function readAvatarBytes(avatarPath: string | null | undefined): { bytes: Buffer; ext: string } | null {
	if (!avatarPath) return null;
	const basename = avatarPath.split('/').pop() || '';
	const originalPath = getOriginalAvatarPath(basename);
	if (originalPath && existsSync(originalPath)) {
		const ext = originalPath.match(/\.[^.]+$/)?.[0] ?? '.png';
		return { bytes: readFileSync(originalPath), ext };
	}
	const optimized = join(process.cwd(), 'static', avatarPath);
	if (existsSync(optimized)) {
		const ext = optimized.match(/\.[^.]+$/)?.[0] ?? '.webp';
		return { bytes: readFileSync(optimized), ext };
	}
	return null;
}

interface ExportedCharacter {
	id: number;
	fingerprint: string;
	card: ReturnType<typeof toCharaCardJSON>;
	avatarFile?: string;
	row: typeof characters.$inferSelect;
}

/** Add one character + its avatar PNG card to the zip. */
async function addCharacterToZip(zip: JSZip, character: typeof characters.$inferSelect): Promise<ExportedCharacter> {
	const card = toCharaCardJSON(character as Parameters<typeof toCharaCardJSON>[0]);
	const fingerprint = characterFingerprint({
		name: character.name,
		description: character.description,
		personality: character.personality,
		firstMessage: character.firstMessage,
		scenario: character.scenario
	});

	const safeName = character.name.replace(/[^a-zA-Z0-9_-]/g, '_') || `char_${character.id}`;
	const cardName = `${safeName}_${fingerprint}.png`;

	// Embed card data inside the PNG (Tavern card format).
	const avatar = readAvatarBytes(character.avatarPath);
	const pngBuffer = avatar?.bytes ?? createMinimalPNG();
	const cardPng = embedCharaCardInPNG(pngBuffer, card as Record<string, unknown>);
	zip.file(`characters/${cardName}`, new Uint8Array(cardPng));

	return { id: character.id, fingerprint, card, avatarFile: cardName, row: character };
}

/** Add a chat (with branches) to the zip under chats/. */
function addChatToZip(zip: JSZip, chat: typeof chats.$inferSelect, characterFp: string, prefetchedMessages?: typeof messages.$inferSelect[]): void {
	const allMessages = prefetchedMessages ?? db.select().from(messages).where(eq(messages.chatId, chat.id)).all();
	const chatJson = {
		schema: 'skald-chat',
		version: 2,
		id: chat.id,
		title: chat.title ?? '',
		mode: chat.mode ?? 'story',
		activeLeafId: chat.activeLeafId ?? null,
		createdAt: chat.createdAt ?? null,
		updatedAt: chat.updatedAt ?? null,
		character: { fingerprint: characterFp },
		messages: allMessages.map(m => ({
			id: m.id,
			role: m.role,
			content: m.content,
			swipes: safeJSON(m.swipes, []),
			swipeIndex: m.swipeIndex ?? 0,
			reasoning: safeJSON(m.reasoning, []),
			parentId: m.parentId,
			createdAt: m.createdAt ?? null
		}))
	};
	zip.file(`chats/chat_${chat.id}.json`, JSON.stringify(chatJson, null, 2));
}

/** Add a lorebook + entries to the zip under lorebooks/. */
function addLorebookToZip(
	zip: JSZip,
	lorebook: typeof lorebooks.$inferSelect,
	characterFp: string | null
): void {
	const entries = db.select().from(lorebookEntries).where(eq(lorebookEntries.lorebookId, lorebook.id)).all();
	const json = {
		schema: 'skald-lorebook',
		version: 1,
		name: lorebook.name,
		description: lorebook.description ?? '',
		enabled: lorebook.enabled ?? true,
		character: characterFp ? { fingerprint: characterFp } : null,
		entries: entries.map(e => ({
			keywords: e.keywords,
			content: e.content,
			insertionOrder: e.insertionOrder ?? 100,
			enabled: e.enabled ?? true,
			caseSensitive: e.caseSensitive ?? false,
			constant: e.constant ?? false
		}))
	};
	zip.file(`lorebooks/lorebook_${lorebook.id}.json`, JSON.stringify(json, null, 2));
}

export interface BundleOptions {
	includePersonas?: boolean;
	includeSettings?: boolean;
	includeThemes?: boolean;
	includeProviders?: boolean;
}

export interface BundleCounts {
	characters: number;
	chats: number;
	lorebooks: number;
	personas: number;
	providers: number;
	themes: number;
}

/** Build the "everything" zip for a user. */
export async function buildEverythingBundle(userId: number, opts: BundleOptions): Promise<{ buffer: Buffer; counts: BundleCounts }> {
	const zip = new JSZip();
	const counts: BundleCounts = { characters: 0, chats: 0, lorebooks: 0, personas: 0, providers: 0, themes: 0 };

	// Characters.
	const userChars = db.select().from(characters).where(eq(characters.userId, userId)).all();
	const charFpById = new Map<number, string>();
	for (const c of userChars) {
		const exported = await addCharacterToZip(zip, c);
		charFpById.set(c.id, exported.fingerprint);
		counts.characters++;
	}

	// Chats — load all messages in one query instead of N per-chat queries.
	const userChats = db.select().from(chats).where(eq(chats.userId, userId)).all();
	const allMessages = userChats.length > 0
		? db.select().from(messages).where(inArray(messages.chatId, userChats.map(c => c.id))).all()
		: [];
	const messagesByChatId = new Map<number, typeof messages.$inferSelect[]>();
	for (const m of allMessages) {
		const list = messagesByChatId.get(m.chatId);
		if (list) list.push(m);
		else messagesByChatId.set(m.chatId, [m]);
	}
	for (const chat of userChats) {
		const fp = charFpById.get(chat.characterId) ?? '';
		addChatToZip(zip, chat, fp, messagesByChatId.get(chat.id) ?? []);
		counts.chats++;
	}

	// Lorebooks (everything the user owns).
	const userLorebooks = db.select().from(lorebooks).where(eq(lorebooks.userId, userId)).all();
	for (const lb of userLorebooks) {
		const fp = lb.characterId ? charFpById.get(lb.characterId) ?? null : null;
		addLorebookToZip(zip, lb, fp);
		counts.lorebooks++;
	}

	// Chat-lorebook attachments — needed so import can re-link them.
	const allChatLorebooks = userChats.length > 0
		? db.select().from(chatLorebooks).where(inArray(chatLorebooks.chatId, userChats.map(c => c.id))).all()
		: [];
	zip.file('chat_lorebooks.json', JSON.stringify(allChatLorebooks, null, 2));

	if (opts.includePersonas !== false) {
		const userPersonas = db.select().from(personas).where(eq(personas.userId, userId)).all();
		const personaJson = userPersonas.map(p => ({
			name: p.name,
			displayName: p.displayName ?? '',
			description: p.description ?? '',
			isDefault: p.isDefault ?? false,
			avatarFile: null as string | null
		}));
		// Bundle persona avatars
		for (let i = 0; i < userPersonas.length; i++) {
			const p = userPersonas[i];
			if (!p.avatarPath) continue;
			const avatar = readAvatarBytes(p.avatarPath);
			if (!avatar) continue;
			const fname = `persona_${i}${avatar.ext}`;
			zip.file(`personas/avatars/${fname}`, new Uint8Array(avatar.bytes));
			personaJson[i].avatarFile = fname;
		}
		zip.file('personas/personas.json', JSON.stringify(personaJson, null, 2));
		counts.personas = userPersonas.length;
	}

	if (opts.includeProviders) {
		const userProviders = db.select().from(providers).where(eq(providers.userId, userId)).all();
		// Strip API keys — never export secrets.
		const sanitized = userProviders.map(p => {
			const { apiKey: _apiKey, id: _id, userId: _uid, ...rest } = p;
			return { ...rest, apiKey: '' };
		});
		zip.file('providers.json', JSON.stringify({ note: 'API keys are NOT included. Imported providers will be disabled until you re-enter their key.', providers: sanitized }, null, 2));
		counts.providers = userProviders.length;
	}

	if (opts.includeThemes !== false) {
		const userThemes = db.select().from(themes).where(eq(themes.userId, userId)).all();
		zip.file('themes.json', JSON.stringify(userThemes, null, 2));
		counts.themes = userThemes.length;
	}

	if (opts.includeSettings !== false) {
		const allSettings = db.select().from(userSettings).where(eq(userSettings.userId, userId)).all();
		zip.file('settings.json', JSON.stringify(allSettings.map(s => ({ key: s.key, value: s.value })), null, 2));
	}

	const manifest = {
		schema: 'skald-bundle',
		version: BUNDLE_VERSION,
		bundleType: 'everything' as BundleType,
		exportedAt: new Date().toISOString(),
		counts,
		options: opts
	};
	zip.file('manifest.json', JSON.stringify(manifest, null, 2));

	const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 3 } });
	return { buffer, counts };
}

/**
 * Build a zip containing a selected set of characters. Lorebooks attached to those
 * characters are always included. Chats are optional.
 *
 * Any IDs the user doesn't own are silently skipped — the DB query filters by userId,
 * so passing a stranger's id just means it won't appear in the bundle.
 */
export async function buildCharactersBundle(
	userId: number,
	characterIds: number[],
	opts: { includeChats?: boolean } = {}
): Promise<{ buffer: Buffer; counts: BundleCounts }> {
	const zip = new JSZip();
	const counts: BundleCounts = { characters: 0, chats: 0, lorebooks: 0, personas: 0, providers: 0, themes: 0 };

	const rows = characterIds.length > 0
		? db.select().from(characters).where(and(eq(characters.userId, userId), inArray(characters.id, characterIds))).all()
		: [];

	const fpById = new Map<number, string>();
	for (const c of rows) {
		const exported = await addCharacterToZip(zip, c);
		fpById.set(c.id, exported.fingerprint);
		counts.characters++;
	}

	// Lorebooks attached to any of these characters — always included.
	const ownedIds = rows.map(r => r.id);
	const attachedLorebooks = ownedIds.length > 0
		? db.select().from(lorebooks).where(and(eq(lorebooks.userId, userId), inArray(lorebooks.characterId, ownedIds))).all()
		: [];
	for (const lb of attachedLorebooks) {
		const fp = lb.characterId ? fpById.get(lb.characterId) ?? null : null;
		addLorebookToZip(zip, lb, fp);
		counts.lorebooks++;
	}

	if (opts.includeChats && ownedIds.length > 0) {
		const charChats = db.select().from(chats).where(and(eq(chats.userId, userId), inArray(chats.characterId, ownedIds))).all();
		const chatIds = charChats.map(c => c.id);
		const allMessages = chatIds.length > 0
			? db.select().from(messages).where(inArray(messages.chatId, chatIds)).all()
			: [];
		const msgsByChat = new Map<number, typeof messages.$inferSelect[]>();
		for (const m of allMessages) {
			const list = msgsByChat.get(m.chatId);
			if (list) list.push(m); else msgsByChat.set(m.chatId, [m]);
		}
		for (const c of charChats) {
			const fp = fpById.get(c.characterId) ?? '';
			addChatToZip(zip, c, fp, msgsByChat.get(c.id) ?? []);
			counts.chats++;
		}

		// chat_lorebooks for re-linking on import
		const clb = chatIds.length > 0
			? db.select().from(chatLorebooks).where(inArray(chatLorebooks.chatId, chatIds)).all()
			: [];
		zip.file('chat_lorebooks.json', JSON.stringify(clb, null, 2));
	}

	const manifest = {
		schema: 'skald-bundle',
		version: BUNDLE_VERSION,
		bundleType: 'characters' as BundleType,
		exportedAt: new Date().toISOString(),
		counts,
		options: { includeChats: !!opts.includeChats }
	};
	zip.file('manifest.json', JSON.stringify(manifest, null, 2));

	const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 3 } });
	return { buffer, counts };
}

/** Build a zip containing only selected lorebooks. */
export async function buildLorebooksBundle(
	userId: number,
	lorebookIds: number[]
): Promise<{ buffer: Buffer; counts: BundleCounts }> {
	const zip = new JSZip();
	const counts: BundleCounts = { characters: 0, chats: 0, lorebooks: 0, personas: 0, providers: 0, themes: 0 };

	const rows = lorebookIds.length > 0
		? db.select().from(lorebooks).where(and(eq(lorebooks.userId, userId), inArray(lorebooks.id, lorebookIds))).all()
		: [];

	// We need character fingerprints for any linked characters so the import side
	// can re-attach them. Look those characters up (filtered to this user) and
	// compute fingerprints without bundling the character card itself.
	const linkedCharIds = Array.from(new Set(rows.map(r => r.characterId).filter((x): x is number => x != null)));
	const linkedChars = linkedCharIds.length > 0
		? db.select().from(characters).where(and(eq(characters.userId, userId), inArray(characters.id, linkedCharIds))).all()
		: [];
	const fpByCharId = new Map<number, string>();
	for (const c of linkedChars) {
		fpByCharId.set(c.id, characterFingerprint({
			name: c.name, description: c.description, personality: c.personality,
			firstMessage: c.firstMessage, scenario: c.scenario
		}));
	}

	for (const lb of rows) {
		const fp = lb.characterId ? fpByCharId.get(lb.characterId) ?? null : null;
		addLorebookToZip(zip, lb, fp);
		counts.lorebooks++;
	}

	const manifest = {
		schema: 'skald-bundle',
		version: BUNDLE_VERSION,
		bundleType: 'lorebooks' as BundleType,
		exportedAt: new Date().toISOString(),
		counts
	};
	zip.file('manifest.json', JSON.stringify(manifest, null, 2));

	const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 3 } });
	return { buffer, counts };
}

/** Build a zip containing selected chats. Optionally bundles the character card(s). */
export async function buildChatsBundle(
	userId: number,
	chatIds: number[],
	opts: { includeCharacterCard?: boolean } = {}
): Promise<{ buffer: Buffer; counts: BundleCounts }> {
	const zip = new JSZip();
	const counts: BundleCounts = { characters: 0, chats: 0, lorebooks: 0, personas: 0, providers: 0, themes: 0 };

	const chatRows = chatIds.length > 0
		? db.select().from(chats).where(and(eq(chats.userId, userId), inArray(chats.id, chatIds))).all()
		: [];
	const ownedChatIds = chatRows.map(c => c.id);

	const charIds = Array.from(new Set(chatRows.map(c => c.characterId)));
	const charRows = charIds.length > 0
		? db.select().from(characters).where(and(eq(characters.userId, userId), inArray(characters.id, charIds))).all()
		: [];

	const fpByCharId = new Map<number, string>();
	if (opts.includeCharacterCard) {
		// Bundle the cards AND remember fingerprints.
		for (const c of charRows) {
			const exported = await addCharacterToZip(zip, c);
			fpByCharId.set(c.id, exported.fingerprint);
			counts.characters++;
		}
	} else {
		// Skip cards, but still emit fingerprints so import can match existing characters.
		for (const c of charRows) {
			fpByCharId.set(c.id, characterFingerprint({
				name: c.name, description: c.description, personality: c.personality,
				firstMessage: c.firstMessage, scenario: c.scenario
			}));
		}
	}

	const allMessages = ownedChatIds.length > 0
		? db.select().from(messages).where(inArray(messages.chatId, ownedChatIds)).all()
		: [];
	const msgsByChat = new Map<number, typeof messages.$inferSelect[]>();
	for (const m of allMessages) {
		const list = msgsByChat.get(m.chatId);
		if (list) list.push(m); else msgsByChat.set(m.chatId, [m]);
	}
	for (const c of chatRows) {
		const fp = fpByCharId.get(c.characterId) ?? '';
		addChatToZip(zip, c, fp, msgsByChat.get(c.id) ?? []);
		counts.chats++;
	}

	// Bundle chat_lorebooks links so import re-attaches them when both sides exist.
	const clb = ownedChatIds.length > 0
		? db.select().from(chatLorebooks).where(inArray(chatLorebooks.chatId, ownedChatIds)).all()
		: [];
	zip.file('chat_lorebooks.json', JSON.stringify(clb, null, 2));

	const manifest = {
		schema: 'skald-bundle',
		version: BUNDLE_VERSION,
		bundleType: 'chats' as BundleType,
		exportedAt: new Date().toISOString(),
		counts,
		options: { includeCharacterCard: !!opts.includeCharacterCard }
	};
	zip.file('manifest.json', JSON.stringify(manifest, null, 2));

	const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 3 } });
	return { buffer, counts };
}

function safeJSON<T>(s: string | null | undefined, fallback: T): T {
	if (!s) return fallback;
	try { return JSON.parse(s) as T; } catch { return fallback; }
}

function createMinimalPNG(): Buffer {
	// 1x1 transparent RGBA PNG.
	const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
	const ihdrData = Buffer.alloc(13);
	ihdrData.writeUInt32BE(1, 0); // width
	ihdrData.writeUInt32BE(1, 4); // height
	ihdrData[8] = 8;  // bit depth
	ihdrData[9] = 6;  // color type: RGBA
	const ihdr = makeChunk('IHDR', ihdrData);
	// Scanline: filter byte (0 = None) + R G B A all zero = transparent pixel.
	const idat = makeChunk('IDAT', deflateSync(Buffer.from([0, 0, 0, 0, 0])));
	const iend = makeChunk('IEND', Buffer.alloc(0));
	return Buffer.concat([sig, ihdr, idat, iend]);
}

function makeChunk(type: string, data: Buffer): Buffer {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length, 0);
	const typeBuf = Buffer.from(type, 'ascii');
	const crcInput = Buffer.concat([typeBuf, data]);
	const crc = crc32(crcInput);
	const crcBuf = Buffer.alloc(4);
	crcBuf.writeUInt32BE(crc >>> 0, 0);
	return Buffer.concat([len, typeBuf, data, crcBuf]);
}

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c;
	}
	return table;
})();

function crc32(buf: Buffer): number {
	let c = 0xffffffff;
	for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}
