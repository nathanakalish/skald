import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { requireUser } from '$lib/server/auth.js';
import { getAdminSettingBool } from '$lib/server/adminSettings.js';
import { db } from '$lib/db/index.js';
import { characters, lorebooks } from '$lib/db/schema.js';
import { and, eq } from 'drizzle-orm';

/**
 * POST /api/chub/link
 * Body: { type: 'character' | 'lorebook', fullPath: string, id: number }
 *
 * Stamps an existing local row with `chub_full_path = fullPath` so the CHUB
 * browse modal will show it as Owned. Used when the user manually associates
 * a character/lorebook they imported by hand with its CHUB origin.
 *
 * Pass an empty fullPath ('') to clear the link.
 */
export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	if (!getAdminSettingBool('allowChubBrowse') && user.role !== 'admin') {
		return json({ error: 'CHUB browsing is disabled by the administrator' }, { status: 403 });
	}

	let body: { type?: string; fullPath?: unknown; id?: unknown; lastActivityAt?: unknown };
	try {
		body = await event.request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const type = body.type === 'lorebook' ? 'lorebook' : 'character';
	const id = typeof body.id === 'number' && Number.isInteger(body.id) ? body.id : null;
	const rawPath = typeof body.fullPath === 'string' ? body.fullPath.trim() : '';
	if (id == null) return json({ error: 'id required' }, { status: 400 });
	if (rawPath.length > 200) return json({ error: 'fullPath too long' }, { status: 400 });
	const fullPath = rawPath.length > 0 ? rawPath : null;
	const lastActivityAt = typeof body.lastActivityAt === 'string' && body.lastActivityAt.length <= 64
		? body.lastActivityAt
		: null;

	const table = type === 'character' ? characters : lorebooks;
	const row = db
		.select({ id: table.id, name: table.name })
		.from(table)
		.where(and(eq(table.id, id), eq(table.userId, user.id)))
		.get();
	if (!row) return json({ error: 'Not found' }, { status: 404 });

	db.update(table)
		.set({ chubFullPath: fullPath, chubLastActivityAt: fullPath ? lastActivityAt : null })
		.where(and(eq(table.id, id), eq(table.userId, user.id)))
		.run();

	event.locals.logger?.info('chub: link updated', { type, id, fullPath, cleared: fullPath === null });

	return json({ id: row.id, name: row.name, fullPath, lastActivityAt: fullPath ? lastActivityAt : null });
};
