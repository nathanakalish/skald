import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { chats, messages, characters } from '$lib/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth.js';
import { recomputeChatTail } from '$lib/db/chatTail.js';
import { characterFingerprint } from '$lib/server/bundle.js';
import { enforceCreate } from '$lib/server/userLimits.js';
import { checkLength } from '$lib/server/fieldLimits.js';
import { ApiError } from '$lib/server/apiError.js';

interface SkaldV1Message { role: string; content: string; createdAt?: string; }
interface SkaldV1Export { character: string; chatId?: number; exportedAt?: string; messages: SkaldV1Message[]; }

interface SkaldV2Message {
	id: number;
	role: string;
	content: string;
	swipes?: string[];
	swipeIndex?: number;
	reasoning?: unknown[];
	parentId: number | null;
	createdAt?: string | null;
}
interface SkaldV2Export {
	schema: 'skald-chat';
	version: 2;
	id?: number;
	title?: string;
	mode?: string;
	activeLeafId?: number | null;
	character: { name?: string; fingerprint?: string };
	messages: SkaldV2Message[];
}

interface SillyTavernMeta { user_name?: string; character_name?: string; create_date?: string; }
interface SillyTavernMessage {
	name?: string; is_user?: boolean; is_system?: boolean; mes?: string;
	send_date?: string | number; swipes?: string[]; swipe_id?: number;
}

type ParsedChat = {
	characterName: string;
	characterFingerprint: string | null;
	mode: string;
	title: string | null;
	v2?: SkaldV2Export;
	linearMessages?: { role: string; content: string; swipes?: string[]; swipeIndex?: number; createdAt?: string }[];
};

function parseSkaldV1(data: SkaldV1Export): ParsedChat {
	const importMessages = (data.messages || [])
		.filter(m => m.role === 'user' || m.role === 'assistant')
		.map(m => ({ role: m.role, content: m.content || '', createdAt: m.createdAt }));
	if (importMessages.length === 0) throw new Error('No user or assistant messages found');
	return {
		characterName: data.character || 'Unknown',
		characterFingerprint: null,
		mode: 'story',
		title: null,
		linearMessages: importMessages
	};
}

function parseSkaldV2(data: SkaldV2Export): ParsedChat {
	if (!Array.isArray(data.messages) || data.messages.length === 0) throw new Error('No messages found in import file');
	return {
		characterName: data.character?.name || 'Unknown',
		characterFingerprint: data.character?.fingerprint ?? null,
		mode: data.mode || 'story',
		title: data.title ?? null,
		v2: data
	};
}

function parseSillyTavernJsonl(text: string): ParsedChat {
	const lines = text.split('\n').filter(l => l.trim());
	if (lines.length === 0) throw new Error('Empty JSONL file');
	let meta: SillyTavernMeta;
	try { meta = JSON.parse(lines[0]); } catch { throw new Error('Invalid JSONL: could not parse metadata line'); }

	const characterName = meta.character_name || 'Unknown';
	const importMessages: { role: string; content: string; swipes?: string[]; swipeIndex?: number; createdAt?: string }[] = [];
	for (let i = 1; i < lines.length; i++) {
		let msg: SillyTavernMessage;
		try { msg = JSON.parse(lines[i]); } catch { continue; }
		if (!msg.mes && (!msg.swipes || msg.swipes.length === 0)) continue;
		const role = msg.is_user ? 'user' : msg.is_system ? 'system' : 'assistant';
		if (role === 'system') continue;
		const content = msg.mes || '';
		const createdAt = msg.send_date
			? typeof msg.send_date === 'string' ? msg.send_date : new Date(msg.send_date).toISOString()
			: undefined;
		importMessages.push({
			role, content,
			...(msg.swipes && msg.swipes.length > 0 ? { swipes: msg.swipes, swipeIndex: msg.swipe_id ?? 0 } : {}),
			createdAt
		});
	}
	if (importMessages.length === 0) throw new Error('No messages found in JSONL file');
	return { characterName, characterFingerprint: null, mode: 'story', title: null, linearMessages: importMessages };
}

function detect(text: string): 'skald-v2' | 'skald-v1' | 'sillytavern-jsonl' {
	const trimmed = text.trim();
	if (trimmed.startsWith('{')) {
		try {
			const parsed = JSON.parse(trimmed);
			if (parsed.schema === 'skald-chat' && parsed.version === 2) return 'skald-v2';
			if (parsed.messages && Array.isArray(parsed.messages)) return 'skald-v1';
		} catch { /* fall through */ }
	}
	return 'sillytavern-jsonl';
}

export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const body = await event.request.json();
	const { content, characterId, mode: requestedMode } = body as { content: string; characterId?: number; mode?: string };

	if (!content || typeof content !== 'string') {
		return ApiError.badRequest('No file content provided');
	}

	const limitResponse = enforceCreate('chats', user.id, content.length);
	if (limitResponse) return limitResponse;

	let parsed: ParsedChat;
	let format: string;
	try {
		format = detect(content);
		if (format === 'skald-v2') parsed = parseSkaldV2(JSON.parse(content.trim()));
		else if (format === 'skald-v1') parsed = parseSkaldV1(JSON.parse(content.trim()));
		else parsed = parseSillyTavernJsonl(content);
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : 'Failed to parse import file';
		return json({ error: msg }, { status: 400 });
	}

	if (requestedMode) parsed.mode = requestedMode;

	// Resolve character: explicit id > fingerprint match > name match > error
	let character;
	if (characterId) {
		character = db.select().from(characters)
			.where(and(eq(characters.id, characterId), eq(characters.userId, user.id)))
			.get();
		if (!character) return ApiError.notFound('Character not found');
	} else {
		const userChars = db.select().from(characters).where(eq(characters.userId, user.id)).all();
		if (parsed.characterFingerprint) {
			character = userChars.find(c => characterFingerprint({
				name: c.name, description: c.description, personality: c.personality,
				firstMessage: c.firstMessage, scenario: c.scenario
			}) === parsed.characterFingerprint);
		}
		if (!character) {
			character = userChars.find(c => c.name.toLowerCase() === parsed.characterName.toLowerCase());
		}
		if (!character) {
			return json({
				error: 'character_not_found',
				characterName: parsed.characterName,
				characterFingerprint: parsed.characterFingerprint,
				availableCharacters: userChars.map(c => ({ id: c.id, name: c.name }))
			}, { status: 404 });
		}
	}

	// Enforce per-message content cap. Reject up front rather than truncating —
	// people importing a chat want round-trip fidelity, not silent mangling.
	const titleSource = parsed.title || `Imported: ${character.name}`;
	const titleV = checkLength(titleSource, 'name', 'title');
	if (titleV) {
		return ApiError.badRequest(`Chat title exceeds maximum length of ${titleV.limit} characters (got ${titleV.length}).`);
	}
	const messageList: { content: string; swipes?: string[] }[] = parsed.v2?.messages
		? parsed.v2.messages.map(m => ({ content: m.content || '', swipes: m.swipes }))
		: (parsed.linearMessages ?? []).map(m => ({ content: m.content || '', swipes: m.swipes }));
	for (let i = 0; i < messageList.length; i++) {
		const m = messageList[i];
		const mv = checkLength(m.content, 'messageContent', `messages[${i}].content`);
		if (mv) {
			return json({
				error: `Message #${i + 1} exceeds maximum length of ${mv.limit} characters (got ${mv.length}).`,
			}, { status: 400 });
		}
		if (m.swipes) {
			for (let s = 0; s < m.swipes.length; s++) {
				const sv = checkLength(m.swipes[s], 'messageContent', `messages[${i}].swipes[${s}]`);
				if (sv) {
					return json({
						error: `Message #${i + 1} swipe #${s + 1} exceeds maximum length of ${sv.limit} characters (got ${sv.length}).`,
					}, { status: 400 });
				}
			}
		}
	}

	// Create chat + bulk-insert messages atomically. A partial chat (rows
	// inserted, leaf not yet set) leaves a broken sidebar entry behind.
	const { chatId, messageCount, lastMessageId } = db.transaction(() => {
		const chat = db.insert(chats).values({
			userId: user.id,
			characterId: character.id,
			title: parsed.title || `Imported: ${character.name}`,
			mode: parsed.mode
		}).returning().get();

		let messageCount = 0;
		let lastMessageId: number | null = null;

		if (parsed.v2) {
			// Preserve branches: insert all messages, remap parent ids
			const idMap = new Map<number, number>();
			// Sort by original id so a parent is always inserted before its children
			const sorted = [...parsed.v2.messages].sort((a, b) => a.id - b.id);
			for (const m of sorted) {
				if (m.role !== 'user' && m.role !== 'assistant' && m.role !== 'system') continue;
				const remappedParent = m.parentId != null ? idMap.get(m.parentId) ?? null : null;
				const inserted = db.insert(messages).values({
					chatId: chat.id,
					role: m.role as 'user' | 'assistant' | 'system',
					content: m.content || '',
					swipes: JSON.stringify(m.swipes && m.swipes.length > 0 ? m.swipes : [m.content || '']),
					swipeIndex: m.swipeIndex ?? 0,
					reasoning: JSON.stringify(m.reasoning ?? []),
					parentId: remappedParent,
					...(m.createdAt ? { createdAt: m.createdAt } : {})
				}).returning().get();
				idMap.set(m.id, inserted.id);
				lastMessageId = inserted.id;
				messageCount++;
			}
			// Restore active leaf if known
			if (parsed.v2.activeLeafId != null) {
				const remappedLeaf = idMap.get(parsed.v2.activeLeafId);
				if (remappedLeaf) lastMessageId = remappedLeaf;
			}
		} else if (parsed.linearMessages) {
			// Linear chain (v1 / SillyTavern)
			for (const msg of parsed.linearMessages) {
				const swipes = msg.swipes && msg.swipes.length > 0 ? msg.swipes : [msg.content];
				const inserted = db.insert(messages).values({
					chatId: chat.id,
					role: msg.role as 'user' | 'assistant',
					content: msg.content,
					swipes: JSON.stringify(swipes),
					swipeIndex: msg.swipeIndex ?? 0,
					parentId: lastMessageId,
					...(msg.createdAt ? { createdAt: msg.createdAt } : {})
				}).returning().get();
				lastMessageId = inserted.id;
				messageCount++;
			}
		}

		if (lastMessageId) {
			db.update(chats).set({ activeLeafId: lastMessageId }).where(eq(chats.id, chat.id)).run();
		}

		return { chatId: chat.id, messageCount, lastMessageId };
	});
	void lastMessageId;
	recomputeChatTail(chatId);

	const fresh = db.select().from(chats).where(eq(chats.id, chatId)).get();
	if (!fresh) return ApiError.server('Chat vanished after import');
	event.locals.logger?.info('chats: imported', {
		chatId, characterId: character.id, format, messageCount, bytes: content.length,
	});
	return json({
		id: chatId,
		messageCount,
		format,
		chat: {
			id: chatId,
			title: fresh.title,
			characterId: character.id,
			characterName: character.name,
			characterAvatar: character.avatarPath,
			mode: fresh.mode,
			pinned: fresh.pinned ?? 0,
			pinOrder: fresh.pinOrder ?? 0,
			updatedAt: fresh.updatedAt,
			unread: 0,
			muted: false,
			lastMessage: fresh.lastMessage ?? '',
			lastMessageRole: fresh.lastMessageRole ?? ''
		}
	});
};
