import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { userSettings } from '$lib/db/schema.js';
import { requireUser } from '$lib/server/auth.js';
import * as themeCache from '$lib/server/themeCache.js';

// PUT update color mode (light/dark/system) — per-user
export const PUT: RequestHandler = async (event) => {
	const user = requireUser(event);
	const body = await event.request.json();
	const { colorMode } = body;

	if (!['light', 'dark', 'system'].includes(colorMode)) {
		return json({ error: 'Invalid color mode' }, { status: 400 });
	}

	// Upsert atomically — see CRUD-H1 in /api/themes/[id]/activate for context.
	db.insert(userSettings)
		.values({ userId: user.id, key: 'colorMode', value: colorMode })
		.onConflictDoUpdate({
			target: [userSettings.userId, userSettings.key],
			set: { value: colorMode }
		})
		.run();

	themeCache.invalidateForUser(user.id);
	return json({ ok: true });
};
