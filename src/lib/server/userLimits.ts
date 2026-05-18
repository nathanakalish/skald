import { db } from '$lib/db/index.js';
import { characters, chats, messages, lorebooks, lorebookEntries } from '$lib/db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { existsSync, statSync } from 'fs';
import { join } from 'path';
import { getAdminSettingNumber } from '$lib/server/adminSettings.js';
import { logger } from '$lib/server/logger.js';
import { getOriginalAvatarPath } from '$lib/services/imageOptimizer.js';

export type Resource = 'characters' | 'chats' | 'lorebooks';

interface Usage {
	count: number;
	bytes: number;
}

interface Limits {
	maxCount: number;
	maxBytes: number;
}

const COUNT_KEYS: Record<Resource, string> = {
	characters: 'maxCharactersPerUser',
	chats: 'maxChatsPerUser',
	lorebooks: 'maxLorebooksPerUser'
};

const SIZE_KEYS: Record<Resource, string> = {
	characters: 'maxCharactersTotalMiB',
	chats: 'maxChatsTotalMiB',
	lorebooks: 'maxLorebooksTotalMiB'
};

const RESOURCE_LABEL: Record<Resource, string> = {
	characters: 'characters',
	chats: 'chats',
	lorebooks: 'lorebooks'
};

function fileSizeBytes(path: string | null | undefined): number {
	if (!path) return 0;
	try {
		const file = join(process.cwd(), 'static', path.replace(/^\//, ''));
		if (!existsSync(file)) return 0;
		return statSync(file).size;
	} catch (err) {
		logger.debug('userLimits: file size read failed', { path, err: String(err) });
		return 0;
	}
}

function avatarOriginalSize(avatarPath: string | null | undefined): number {
	if (!avatarPath) return 0;
	const basename = avatarPath.split('/').pop() || '';
	const original = getOriginalAvatarPath(basename);
	if (!original || !existsSync(original)) return 0;
	try { return statSync(original).size; } catch { return 0; }
}

function getResourceLimits(resource: Resource): Limits {
	const maxCount = Math.max(0, Math.floor(getAdminSettingNumber(COUNT_KEYS[resource])));
	const maxMiB = Math.max(0, Math.floor(getAdminSettingNumber(SIZE_KEYS[resource])));
	return { maxCount, maxBytes: maxMiB * 1024 * 1024 };
}

function getCharactersUsage(userId: number): Usage {
	const row = db
		.select({
			count: sql<number>`count(*)`,
			textBytes: sql<number>`coalesce(sum(
				length(coalesce(${characters.name},'')) +
				length(coalesce(${characters.description},'')) +
				length(coalesce(${characters.personality},'')) +
				length(coalesce(${characters.firstMessage},'')) +
				length(coalesce(${characters.scenario},'')) +
				length(coalesce(${characters.systemPrompt},'')) +
				length(coalesce(${characters.creatorNotes},'')) +
				length(coalesce(${characters.tags},'')) +
				length(coalesce(${characters.mesExample},'')) +
				length(coalesce(${characters.postHistoryInstructions},'')) +
				length(coalesce(${characters.alternateGreetings},'')) +
				length(coalesce(${characters.extensions},''))
			), 0)`
		})
		.from(characters)
		.where(eq(characters.userId, userId))
		.get() as { count: number; textBytes: number } | undefined;

	let avatarBytes = 0;
	const avatarRows = db
		.select({ avatarPath: characters.avatarPath })
		.from(characters)
		.where(eq(characters.userId, userId))
		.all();
	for (const r of avatarRows) {
		avatarBytes += fileSizeBytes(r.avatarPath);
		avatarBytes += avatarOriginalSize(r.avatarPath);
	}

	return {
		count: row?.count ?? 0,
		bytes: (row?.textBytes ?? 0) + avatarBytes
	};
}

function getChatsUsage(userId: number): Usage {
	const row = db
		.select({
			count: sql<number>`count(*)`,
			titleBytes: sql<number>`coalesce(sum(length(coalesce(${chats.title},''))), 0)`
		})
		.from(chats)
		.where(eq(chats.userId, userId))
		.get() as { count: number; titleBytes: number } | undefined;

	const messageRow = db
		.select({
			msgBytes: sql<number>`coalesce(sum(length(coalesce(${messages.content},'')) + length(coalesce(${messages.swipes},'')) + length(coalesce(${messages.reasoning},''))), 0)`
		})
		.from(messages)
		.innerJoin(chats, eq(messages.chatId, chats.id))
		.where(eq(chats.userId, userId))
		.get() as { msgBytes: number } | undefined;

	return {
		count: row?.count ?? 0,
		bytes: (row?.titleBytes ?? 0) + (messageRow?.msgBytes ?? 0)
	};
}

function getLorebooksUsage(userId: number): Usage {
	const row = db
		.select({
			count: sql<number>`count(*)`,
			lbBytes: sql<number>`coalesce(sum(length(coalesce(${lorebooks.name},'')) + length(coalesce(${lorebooks.description},''))), 0)`
		})
		.from(lorebooks)
		.where(eq(lorebooks.userId, userId))
		.get() as { count: number; lbBytes: number } | undefined;

	const entryRow = db
		.select({
			entryBytes: sql<number>`coalesce(sum(length(coalesce(${lorebookEntries.keywords},'')) + length(coalesce(${lorebookEntries.content},''))), 0)`
		})
		.from(lorebookEntries)
		.innerJoin(lorebooks, eq(lorebookEntries.lorebookId, lorebooks.id))
		.where(eq(lorebooks.userId, userId))
		.get() as { entryBytes: number } | undefined;

	return {
		count: row?.count ?? 0,
		bytes: (row?.lbBytes ?? 0) + (entryRow?.entryBytes ?? 0)
	};
}

function getUsage(resource: Resource, userId: number): Usage {
	switch (resource) {
		case 'characters': return getCharactersUsage(userId);
		case 'chats': return getChatsUsage(userId);
		case 'lorebooks': return getLorebooksUsage(userId);
	}
}

/**
 * Returns a Response (HTTP 413, JSON error body) if creating one more resource
 * of `resource` would push the user past either ceiling. Returns null when
 * the create is permitted. Callers MUST early-return the Response.
 *
 * @param incomingBytes Best-effort estimate of how many bytes the new item
 *   will occupy. Pass 0 if you can't measure it ahead of time — the hard
 *   ceiling is "current usage already at limit", which still trips correctly.
 */
export function enforceCreate(resource: Resource, userId: number, incomingBytes = 0): Response | null {
	const limits = getResourceLimits(resource);
	if (limits.maxCount === 0 && limits.maxBytes === 0) return null;
	let usage: Usage;
	try {
		usage = getUsage(resource, userId);
	} catch (err) {
		// If usage calc blows up we still want creation to proceed rather than
		// brick the app — log loud and let it through.
		logger.warn('userLimits: usage query failed; allowing create', {
			resource, userId, err: err instanceof Error ? err.message : String(err)
		});
		return null;
	}

	if (limits.maxCount > 0 && usage.count >= limits.maxCount) {
		logger.info('userLimits: limit exceeded', { resource, userId, kind: 'count', current: usage.count, max: limits.maxCount });
		return createLimitError(resource, 'count', usage.count, limits.maxCount);
	}
	if (limits.maxBytes > 0 && usage.bytes + incomingBytes > limits.maxBytes) {
		logger.info('userLimits: limit exceeded', { resource, userId, kind: 'size', current: usage.bytes + incomingBytes, max: limits.maxBytes });
		return createLimitError(resource, 'size', usage.bytes + incomingBytes, limits.maxBytes);
	}
	return null;
}

function createLimitError(resource: Resource, kind: 'count' | 'size', current: number, max: number): Response {
	const label = RESOURCE_LABEL[resource];
	const message =
		kind === 'count'
			? `You've reached your maximum number of ${label} (${max}). Delete some to add more.`
			: `You've reached your storage limit for ${label} (${formatBytes(max)} used: ${formatBytes(current)}). Delete some to add more.`;
	return new Response(JSON.stringify({ error: message, kind, resource, current, max }), {
		status: 413,
		headers: { 'content-type': 'application/json' }
	});
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
