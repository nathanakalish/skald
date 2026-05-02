import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { adminSettings } from '$lib/db/schema.js';
import { eq } from 'drizzle-orm';
import { requireAdmin } from '$lib/server/auth.js';
import { invalidateAdminSettingsCache } from '$lib/server/adminSettings.js';
import { logger } from '$lib/server/logger.js';

const ALLOWED_KEYS = [
	'sessionDurationDays',
	'allowCharacterImport',
	'allowCharacterExport',
	'disableImageCaching',
	'chatRateLimit',
	'characterImportRateLimit',
	'lorebookImportRateLimit',
	'chubBrowseRateLimit',
	'chubGlobalRateLimit',
	'reformatRateLimit',
	'characterImportMaxMiB',
	'lorebookImportMaxMiB',
	'avatarUploadMaxMiB',
	'maxCharactersPerUser',
	'maxCharactersTotalMiB',
	'maxChatsPerUser',
	'maxChatsTotalMiB',
	'maxLorebooksPerUser',
	'maxLorebooksTotalMiB'
];

/** GET admin settings */
export const GET: RequestHandler = async (event) => {
	requireAdmin(event);

	const rows = db.select().from(adminSettings).all();
	const result: Record<string, string> = {};
	for (const row of rows) {
		result[row.key] = row.value;
	}
	return json(result);
};

/** PATCH admin settings */
export const PATCH: RequestHandler = async (event) => {
	const admin = requireAdmin(event);
	const body = await event.request.json();
	const changes: Record<string, { from: string | null; to: string }> = {};

	for (const [key, value] of Object.entries(body)) {
		if (!ALLOWED_KEYS.includes(key)) continue;
		const strValue = String(value);

		// Validate specific keys
		if (key === 'sessionDurationDays') {
			const num = Number(strValue);
			if (![7, 30, 90, 365].includes(num)) continue;
		}
		if (key === 'chatRateLimit' || key === 'characterImportRateLimit' || key === 'lorebookImportRateLimit' || key === 'chubBrowseRateLimit' || key === 'chubGlobalRateLimit' || key === 'reformatRateLimit') {
			const num = Number(strValue);
			if (!Number.isFinite(num) || num < 1 || num > 1000) continue;
		}
		if (key === 'characterImportMaxMiB' || key === 'lorebookImportMaxMiB' || key === 'avatarUploadMaxMiB') {
			const num = Number(strValue);
			if (!Number.isFinite(num) || num < 1 || num > 256) continue;
		}
		if (
			key === 'maxCharactersPerUser' || key === 'maxChatsPerUser' || key === 'maxLorebooksPerUser' ||
			key === 'maxCharactersTotalMiB' || key === 'maxChatsTotalMiB' || key === 'maxLorebooksTotalMiB'
		) {
			const num = Number(strValue);
			if (!Number.isFinite(num) || num < 0 || num > 1_000_000) continue;
		}

		const existing = db.select().from(adminSettings).where(eq(adminSettings.key, key)).get();
		const previous = existing?.value ?? null;
		if (previous === strValue) continue;
		if (existing) {
			db.update(adminSettings).set({ value: strValue }).where(eq(adminSettings.key, key)).run();
		} else {
			db.insert(adminSettings).values({ key, value: strValue }).run();
		}
		changes[key] = { from: previous, to: strValue };
	}

	if (Object.keys(changes).length > 0) {
		logger.info('admin settings updated', {
			adminId: admin.id,
			adminUsername: admin.username,
			changes
		});
	}

	invalidateAdminSettingsCache();
	return json({ ok: true });
};
