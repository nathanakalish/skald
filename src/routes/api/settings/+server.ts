import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { userSettings } from '$lib/db/schema.js';
import { requireUser } from '$lib/server/auth.js';
import * as themeCache from '$lib/server/themeCache.js';
import { ALLOWED_SETTING_KEYS } from '$lib/server/settingsKeys.js';

const ALLOWED_KEYS = ALLOWED_SETTING_KEYS;

const THEME_AFFECTING_KEYS = new Set(['systemDarkThemeId', 'systemLightThemeId']);

export const PATCH: RequestHandler = async (event) => {
	const user = requireUser(event);
	const body = await event.request.json();

	const allKeys = Object.keys(body);
	const entries = Object.entries(body).filter(([key]) => ALLOWED_KEYS.includes(key));
	const rejected = allKeys.filter((k) => !ALLOWED_KEYS.includes(k));
	if (rejected.length > 0) {
		event.locals.logger?.warn('settings: rejected unknown keys', { rejected });
	}
	if (entries.length > 0) {
		db.transaction((tx) => {
			for (const [key, value] of entries) {
				const strValue = String(value);
				tx.insert(userSettings)
					.values({ userId: user.id, key, value: strValue })
					.onConflictDoUpdate({
						target: [userSettings.userId, userSettings.key],
						set: { value: strValue }
					})
					.run();
			}
		});
		if (entries.some(([k]) => THEME_AFFECTING_KEYS.has(k))) {
			themeCache.invalidateForUser(user.id);
		}
		event.locals.logger?.debug('settings: updated', {
			keys: entries.map(([k]) => k),
			themeAffected: entries.some(([k]) => THEME_AFFECTING_KEYS.has(k)),
		});
	}

	return json({ ok: true });
};
