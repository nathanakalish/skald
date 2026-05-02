import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { requireUser } from '$lib/server/auth.js';
import { getAdminSettingBool } from '$lib/server/adminSettings.js';
import { chubDownload } from '$lib/server/chub.js';
import { logger } from '$lib/server/logger.js';
import { db } from '$lib/db/index.js';
import { characters, lorebooks } from '$lib/db/schema.js';
import { and, eq } from 'drizzle-orm';

/**
 * Body: { type: 'character' | 'lorebook', fullPath: 'creator/slug' }
 *
 * Downloads from CHUB then forwards to our existing import endpoint via
 * `event.fetch`, which preserves the user's session cookie. This means the
 * character's avatar optimisation, image caching, theme extraction, and
 * embedded character_book linking all run exactly the same as a manual import.
 *
 * After the upstream import succeeds we tag the new row with `chub_full_path`
 * so future browse-modal sessions can detect duplicates.
 */
export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	if (!getAdminSettingBool('allowChubBrowse') && user.role !== 'admin') {
		return json({ error: 'CHUB browsing is disabled by the administrator' }, { status: 403 });
	}

	let body: { type?: string; fullPath?: string; lastActivityAt?: unknown; avatarUrl?: unknown };
	try {
		body = await event.request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const type = body.type === 'lorebook' ? 'lorebook' : 'character';
	const fullPath = (body.fullPath ?? '').trim();
	const lastActivityAt = typeof body.lastActivityAt === 'string' && body.lastActivityAt.length <= 64
		? body.lastActivityAt
		: null;
	// Lorebook icon URL — only persisted for lorebooks (characters embed their
	// own avatar in the card PNG). Limit length to avoid storing junk.
	const avatarUrl = typeof body.avatarUrl === 'string'
		&& /^https?:\/\//i.test(body.avatarUrl)
		&& body.avatarUrl.length <= 1024
		? body.avatarUrl
		: null;
	if (!fullPath || !fullPath.includes('/') || fullPath.length > 200) {
		return json({ error: 'Invalid fullPath' }, { status: 400 });
	}

	if (type === 'character' && !getAdminSettingBool('allowCharacterImport') && user.role !== 'admin') {
		return json({ error: 'Character import is disabled by the administrator' }, { status: 403 });
	}

	let downloaded;
	try {
		downloaded = await chubDownload({ type, fullPath });
	} catch (err) {
		logger.warn('chub import download failed', { fullPath, type, err: err instanceof Error ? err.message : String(err) });
		return json({ error: 'Failed to download from CHUB', message: err instanceof Error ? err.message : 'Unknown' }, { status: 502 });
	}

	const fileBlob = new Blob([new Uint8Array(downloaded.buffer)], { type: downloaded.contentType });
	const fd = new FormData();
	fd.append('file', fileBlob, downloaded.filename);

	const target = type === 'character' ? '/api/characters/import' : '/api/lorebooks/import';
	const res = await event.fetch(target, { method: 'POST', body: fd });
	const respText = await res.text();

	if (res.ok) {
		try {
			const parsed = JSON.parse(respText) as { id?: number };
			if (typeof parsed.id === 'number') {
				const table = type === 'character' ? characters : lorebooks;
				const patch: Record<string, unknown> = { chubFullPath: fullPath, chubLastActivityAt: lastActivityAt };
				if (type === 'lorebook' && avatarUrl) patch.iconUrl = avatarUrl;
				db.update(table)
					.set(patch)
					.where(and(eq(table.id, parsed.id), eq(table.userId, user.id)))
					.run();
			}
		} catch {
			// Response wasn't JSON or didn't include an id — non-fatal.
		}
	}

	return new Response(respText, {
		status: res.status,
		headers: { 'Content-Type': res.headers.get('content-type') || 'application/json' },
	});
};
