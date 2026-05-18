import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { themes, userSettings } from '$lib/db/schema.js';
import { eq, and, or, isNull } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth.js';
import { broadcast } from '$lib/server/realtime.js';
import { validateLengths } from '$lib/server/fieldLimits.js';

const THEME_FIELD_LIMITS = { name: 'name' } as const;

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
	const { mode, colors } = body;

	// CRUD-L1: refuse empty/whitespace-only names at write time.
	const name = typeof body?.name === 'string' ? body.name.trim() : '';
	if (!name) return json({ error: 'Name is required' }, { status: 400 });
	if (!mode || !colors) {
		return json({ error: 'Missing required fields' }, { status: 400 });
	}

	const tooLong = validateLengths(body, THEME_FIELD_LIMITS);
	if (tooLong) return tooLong;

	// CRUD-L2: per-user name uniqueness for themes.
	const dupe = db
		.select({ id: themes.id })
		.from(themes)
		.where(and(eq(themes.userId, user.id), eq(themes.name, name)))
		.get();
	if (dupe) return json({ error: 'A theme with that name already exists' }, { status: 409 });

	const parsed = _validateThemeColors(colors);
	if ('error' in parsed) return json({ error: parsed.error }, { status: 400 });

	const theme = db
		.insert(themes)
		.values({
			userId: user.id,
			name,
			mode,
			colors: JSON.stringify(parsed.colors),
			isActive: false,
			isBuiltin: false
		})
		.returning()
		.get();

	broadcast(user.id, { type: 'theme:created', theme: theme as any });
	event.locals.logger.info('themes: created', { themeId: theme.id, mode });
	return json(theme);
};

// Validate a `colors` payload — both at write time and at SSR-render time we
// splat values into a `style="--key:value"` attribute, so rejecting anything
// outside `[\w-]` keys / `[\w\s().,#%-]` values keeps us safely on the right
// side of the CSS injection / XSS line (M15, CRUD-L6).
export function _validateThemeColors(colors: unknown): { colors: Record<string, string> } | { error: string } {
	let parsedColors: Record<string, unknown>;
	try {
		parsedColors = typeof colors === 'string' ? JSON.parse(colors) : (colors as Record<string, unknown>);
	} catch {
		return { error: 'colors must be valid JSON' };
	}
	if (!parsedColors || typeof parsedColors !== 'object' || Array.isArray(parsedColors)) {
		return { error: 'colors must be an object' };
	}
	const safeKey = /^[\w-]+$/;
	const safeValue = /^[\w\s().,#%-]+$/;
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(parsedColors)) {
		if (!safeKey.test(k)) return { error: `Invalid color key: ${k}` };
		if (typeof v !== 'string' || !safeValue.test(v)) {
			return { error: `Invalid color value for ${k}` };
		}
		out[k] = v;
	}
	return { colors: out };
}
