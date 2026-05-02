import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { themes } from '$lib/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth.js';
import { broadcast } from '$lib/server/realtime.js';
import * as themeCache from '$lib/server/themeCache.js';

// PUT update a theme (only custom themes owned by user)
export const PUT: RequestHandler = async (event) => {
	const user = requireUser(event);
	const id = Number(event.params.id);
	const body = await event.request.json();
	const { name, mode, colors } = body;

	const existing = db.select().from(themes).where(eq(themes.id, id)).get();
	if (!existing) return json({ error: 'Theme not found' }, { status: 404 });
	if (existing.isBuiltin) return json({ error: 'Cannot edit built-in themes' }, { status: 400 });
	if (existing.userId !== user.id) return json({ error: 'Not found' }, { status: 404 });

	const updates: Record<string, unknown> = {};
	if (name !== undefined) updates.name = name;
	if (mode !== undefined) updates.mode = mode;
	if (colors !== undefined) updates.colors = typeof colors === 'string' ? colors : JSON.stringify(colors);

	db.update(themes).set(updates).where(eq(themes.id, id)).run();
	themeCache.invalidateForTheme(id);
	const updated = db.select().from(themes).where(eq(themes.id, id)).get();
	if (updated) broadcast(user.id, { type: 'theme:updated', id, theme: updated as any });
	return json({ ok: true, theme: updated });
};

// DELETE a theme (only custom themes owned by user)
export const DELETE: RequestHandler = async (event) => {
	const user = requireUser(event);
	const id = Number(event.params.id);

	const existing = db.select().from(themes).where(eq(themes.id, id)).get();
	if (!existing) return json({ error: 'Theme not found' }, { status: 404 });
	if (existing.isBuiltin) return json({ error: 'Cannot delete built-in themes' }, { status: 400 });
	if (existing.userId !== user.id) return json({ error: 'Not found' }, { status: 404 });

	db.delete(themes).where(eq(themes.id, id)).run();
	themeCache.invalidateForTheme(id);
	broadcast(user.id, { type: 'theme:deleted', id });
	return json({ ok: true });
};
