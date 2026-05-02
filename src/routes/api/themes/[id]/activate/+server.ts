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

	// Store active theme in user settings
	const existing = db.select().from(userSettings).where(and(eq(userSettings.userId, user.id), eq(userSettings.key, 'activeThemeId'))).get();
	if (existing) {
		db.update(userSettings).set({ value: String(id) }).where(and(eq(userSettings.userId, user.id), eq(userSettings.key, 'activeThemeId'))).run();
	} else {
		db.insert(userSettings).values({ userId: user.id, key: 'activeThemeId', value: String(id) }).run();
	}

	themeCache.invalidateForUser(user.id);
	broadcast(user.id, { type: 'theme:activated', theme: theme as any });
	return json({ ok: true, theme });
};