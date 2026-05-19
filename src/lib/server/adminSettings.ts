import { db } from '$lib/db/index.js';
import { adminSettings } from '$lib/db/schema.js';
import { eq } from 'drizzle-orm';

const DEFAULTS: Record<string, string> = {
	sessionDurationDays: '30',
	allowCharacterImport: 'true',
	allowCharacterExport: 'true',
	allowChubBrowse: 'true',
	disableImageCaching: 'false',
	// Soft character-length caps on text fields. When off, the UI stops
	// rendering the overflow-red overlay and the server skips validation —
	// useful for instances that need to ingest unbounded content.
	characterLimitsEnabled: 'true',
	// Per-user rate limits (requests per minute)
	chatRateLimit: '30',
	characterImportRateLimit: '10',
	lorebookImportRateLimit: '10',
	chubBrowseRateLimit: '30',
	// Server-wide outbound CHUB API throttle (requests per minute, summed across all users)
	chubGlobalRateLimit: '120',
	reformatRateLimit: '20',
	// Upload size caps (MiB)
	characterImportMaxMiB: '8',
	lorebookImportMaxMiB: '4',
	avatarUploadMaxMiB: '8',
	// Per-user resource quotas. 0 means "unlimited". Whichever ceiling is hit
	// first (count or MiB) blocks the next create/import.
	maxCharactersPerUser: '0',
	maxCharactersTotalMiB: '0',
	maxChatsPerUser: '0',
	maxChatsTotalMiB: '0',
	maxLorebooksPerUser: '0',
	maxLorebooksTotalMiB: '0'
};

function getAdminSetting(key: string): string {
	const row = db.select().from(adminSettings).where(eq(adminSettings.key, key)).get();
	return row?.value ?? DEFAULTS[key] ?? '';
}

export function getAdminSettingBool(key: string): boolean {
	return getAdminSetting(key) === 'true';
}

export function getAdminSettingNumber(key: string): number {
	return Number(getAdminSetting(key)) || Number(DEFAULTS[key]) || 0;
}
