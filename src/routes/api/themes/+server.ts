import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { themes, userSettings } from '$lib/db/schema.js';
import { eq, and, or, isNull } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth.js';
import { broadcast } from '$lib/server/realtime.js';

// GET all themes (builtins + user's) + user's settings
export const GET: RequestHandler = async (event) => {
	const user = requireUser(event);
	const themeList = db.select().from(themes).where(or(isNull(themes.userId), eq(themes.userId, user.id))).all();
	const colorModeSetting = db.select().from(userSettings).where(and(eq(userSettings.userId, user.id), eq(userSettings.key, 'colorMode'))).get();
	const activeThemeSetting = db.select().from(userSettings).where(and(eq(userSettings.userId, user.id), eq(userSettings.key, 'activeThemeId'))).get();

	return json({
		themes: themeList,
		colorMode: colorModeSetting?.value ?? 'dark',
		activeThemeId: activeThemeSetting ? Number(activeThemeSetting.value) : null
	});
};

// POST create a new custom theme
export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const body = await event.request.json();
	const { name, mode, colors } = body;

	if (!name || !mode || !colors) {
		return json({ error: 'Missing required fields' }, { status: 400 });
	}

	// Validate the colours object — both at write time and at SSR-render
	// time we splat values into a `style="--key:value"` attribute, so
	// rejecting anything outside [\w-] keys / [\w\s().,#%-] values keeps
	// us safely on the right side of the CSS injection / XSS line (M15).
	let parsedColors: Record<string, unknown>;
	try {
		parsedColors = typeof colors === 'string' ? JSON.parse(colors) : colors;
	} catch {
		return json({ error: 'colors must be valid JSON' }, { status: 400 });
	}
	if (!parsedColors || typeof parsedColors !== 'object' || Array.isArray(parsedColors)) {
		return json({ error: 'colors must be an object' }, { status: 400 });
	}
	const safeKey = /^[\w-]+$/;
	const safeValue = /^[\w\s().,#%-]+$/;
	for (const [k, v] of Object.entries(parsedColors)) {
		if (!safeKey.test(k)) return json({ error: `Invalid color key: ${k}` }, { status: 400 });
		if (typeof v !== 'string' || !safeValue.test(v)) {
			return json({ error: `Invalid color value for ${k}` }, { status: 400 });
		}
	}

	const theme = db
		.insert(themes)
		.values({
			userId: user.id,
			name,
			mode,
			colors: JSON.stringify(parsedColors),
			isActive: false,
			isBuiltin: false
		})
		.returning()
		.get();

	broadcast(user.id, { type: 'theme:created', theme: theme as any });
	return json(theme);
};
