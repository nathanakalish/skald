import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { themes, userSettings } from '$lib/db/schema.js';
import { eq, and, or } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth.js';
import { broadcast } from '$lib/server/realtime.js';
import * as themeCache from '$lib/server/themeCache.js';

// POST activate a theme (stores in user settings)
export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const id = Number(event.params.id);

	// Only allow activating builtin themes or themes owned by this user
	const theme = db.select().from(themes).where(
		and(eq(themes.id, id), or(eq(themes.isBuiltin, true), eq(themes.userId, user.id)))
	).get();
	if (!theme) {
		return json({ error: 'Theme not found' }, { status: 404 });
	}

	// Upsert in one statement — the (userId, key) PK guarantees uniqueness,
	// so concurrent activations can't double-insert and there's no
	// SELECT-then-write TOCTOU window. (CRUD-H1)
	db.insert(userSettings)
		.values({ userId: user.id, key: 'activeThemeId', value: String(id) })
		.onConflictDoUpdate({
			target: [userSettings.userId, userSettings.key],
			set: { value: String(id) }
		})
		.run();

	themeCache.invalidateForUser(user.id);
	broadcast(user.id, { type: 'theme:activated', theme: theme as any });
	event.locals.logger?.debug('themes: activated', { themeId: id, builtin: theme.isBuiltin });
	return json({ ok: true, theme });
};