import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { themes } from '$lib/db/schema.js';
import { eq, and, ne } from 'drizzle-orm';
import { nameAlreadyExists } from '$lib/server/queryHelpers.js';
import { requireUser } from '$lib/server/auth.js';
import { broadcast } from '$lib/server/realtime.js';
import * as themeCache from '$lib/server/themeCache.js';
import { _validateThemeColors } from '../+server.js';
import { validateLengths } from '$lib/server/fieldLimits.js';
import { ApiError } from '$lib/server/apiError.js';

const THEME_FIELD_LIMITS = { name: 'name' } as const;

// PUT update a theme (only custom themes owned by user)
export const PUT: RequestHandler = async (event) => {
	const user = requireUser(event);
	const id = Number(event.params.id);
	const body = await event.request.json();
	const { mode, colors } = body;

	const tooLong = validateLengths(body, THEME_FIELD_LIMITS);
	if (tooLong) return tooLong;

	const existing = db.select().from(themes).where(eq(themes.id, id)).get();
	if (!existing) return ApiError.notFound('Theme not found');
	if (existing.isBuiltin) return ApiError.badRequest('Cannot edit built-in themes');
	if (existing.userId !== user.id) return ApiError.notFound('Not found');

	const updates: Record<string, unknown> = {};
	if (body?.name !== undefined) {
		// CRUD-L1: refuse empty/whitespace-only names at write time.
		const name = typeof body.name === 'string' ? body.name.trim() : '';
		if (!name) return ApiError.badRequest('Name is required');
		// CRUD-L2: per-user name uniqueness (excluding self).
		if (nameAlreadyExists(themes, user.id, name, id)) {
			return ApiError.conflict('A theme with that name already exists');
		}
		updates.name = name;
	}
	if (mode !== undefined) updates.mode = mode;
	if (colors !== undefined) {
		// CRUD-L6: validate colour key/value shape so the SSR `<style>` splat
		// stays on the safe side of the CSS injection line. POST already does
		// this; PUT used to silently accept anything.
		const parsed = _validateThemeColors(colors);
		if ('error' in parsed) return json({ error: parsed.error }, { status: 400 });
		updates.colors = JSON.stringify(parsed.colors);
	}

	db.update(themes).set(updates).where(eq(themes.id, id)).run();
	themeCache.invalidateForTheme(id);
	const updated = db.select().from(themes).where(eq(themes.id, id)).get();
	if (updated) broadcast(user.id, { type: 'theme:updated', id, theme: updated as any });
	event.locals.logger.debug('themes: updated', { themeId: id, keys: Object.keys(updates) });
	return json({ ok: true, theme: updated });
};

// DELETE a theme (only custom themes owned by user)
export const DELETE: RequestHandler = async (event) => {
	const user = requireUser(event);
	const id = Number(event.params.id);

	const existing = db.select().from(themes).where(eq(themes.id, id)).get();
	if (!existing) return ApiError.notFound('Theme not found');
	if (existing.isBuiltin) return ApiError.badRequest('Cannot delete built-in themes');
	if (existing.userId !== user.id) return ApiError.notFound('Not found');

	db.delete(themes).where(eq(themes.id, id)).run();
	themeCache.invalidateForTheme(id);
	broadcast(user.id, { type: 'theme:deleted', id });
	event.locals.logger.warn('themes: deleted', { themeId: id });
	return json({ ok: true });
};
