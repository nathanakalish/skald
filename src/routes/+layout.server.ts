import type { LayoutServerLoad } from './$types.js';
import { db } from '$lib/db/index.js';
import { themes, userSettings, sessions, users } from '$lib/db/schema.js';
import { eq, and, or, isNull } from 'drizzle-orm';
import { isOidcEnabled } from '$lib/server/oidc.js';
import { isDevAuthBypassEnabled } from '$lib/server/devAuth.js';
import { getSessionCookieName, hashSessionToken } from '$lib/server/auth.js';
import { logger } from '$lib/server/logger.js';
import { getAdminSettingBool } from '$lib/server/adminSettings.js';

// Phase 1.1 — slim root layout load.
//
// This used to query chats, characters, providers, lorebooks, personas, and
// the full themes list on every navigation. Those are now lazy-loaded by
// per-resource client stores (src/lib/stores/*.svelte.ts) which fetch from
// dedicated GET endpoints after first paint.
//
// What's left here is the small set of values the root layout itself reads
// during SSR so the first byte includes the user's identity, theme colors
// (CSS variables on <html>), and html-level setting attributes.
export const load: LayoutServerLoad = async (event) => {
	const t0 = Date.now();
	const user = event.locals.user;

	if (!user) {
		return {
			currentSessionId: null as string | null,
			currentSessionNotificationsDisabledAt: null as string | null,
			systemDarkTheme: null,
			systemLightTheme: null,
			colorMode: 'dark',
			alwaysUseCharacterThemes: false,
			allowExternalCreatorNotes: false,
			colorCharacterCards: false,
			sidebarWidth: 320,
			sidebarCollapsed: false,
			fontSize: 'medium',
			compactMode: false,
			reduceMotion: false,
			sendWithEnterDesktop: true,
			sendWithEnterMobile: true,
			autoScrollThreshold: 'normal',
			confirmDeletions: true,
			messageTimestamps: 'relative',
			showReasoning: false,
			notificationStyle: 'generic',
			notificationAvatar: true,
			inAppNotifications: true,
			notificationDuration: 5,
			quietHoursEnabled: false,
			quietHoursStart: '22:00',
			quietHoursEnd: '07:00',
			renderMode: 'roleplay',
			chatPageSize: 50,
			autoLoadEarlierMessages: false,
			notificationSound: false,
			reformatterProviderId: '',
			reformatterModel: '',
			reformatterPrompt: '',
			characterCreatorProviderId: '',
			characterCreatorModel: '',
			characterCreatorPrompt: '',
			compactionEnabled: false,
			compactionThreshold: 80,
			compactionMode: 'window',
			compactionWindowPercent: 30,
			compactionFixedCount: 20,
			compactionProviderId: '',
			compactionModel: '',
			compactionPrompt: '',
			speechOpacity: 100,
			speechBold: true,
			speechItalic: false,
			thoughtOpacity: 75,
			thoughtBold: false,
			thoughtItalic: true,
			linkOpacity: 100,
			linkBold: false,
			linkItalic: false,
			narrationOpacity: 100,
			narrationBold: false,
			narrationItalic: false,
			nestedEmphasisInSpeech: true,
			pinnedMessageActions: '',
			imagePromptTemplate: '',
			imageIncludeAvatar: false,
			imageIncludeCharacterDesc: false,
			imageIncludePersonaDesc: false,
			dismissKeyboardOnScroll: true,
			showTokenRing: true,
			translucencyOpacity: 70,
			promptSlotOrder: '',
			user: null,
			oidcEnabled: isOidcEnabled(),
			devAuthEnabled: isDevAuthBypassEnabled(),
			pinEnabled: false,
			pinPolicy: 'disabled' as 'disabled' | 'on-focus' | 'on-open' | 'timeout',
			pinTimeoutMinutes: null as number | null,
			characterLimitsEnabled: getAdminSettingBool('characterLimitsEnabled'),
		};
	}

	const userId = user.id;

	// Surface the current session's id + notification-disabled timestamp so
	// the client can detect a remote toggle ("disable notifications on this
	// device" from the Signed-in-devices list) and reset its banner-dismissal
	// flag / unsubscribe push.
	const currentSessionToken = event.cookies.get(getSessionCookieName()) ?? null;
	let currentSessionNotificationsDisabledAt: string | null = null;
	if (currentSessionToken) {
		// sessions.id stores SHA-256(token); the cookie holds the raw token.
		const row = db.select({ disabledAt: sessions.notificationsDisabledAt })
			.from(sessions)
			.where(eq(sessions.id, hashSessionToken(currentSessionToken)))
			.get();
		currentSessionNotificationsDisabledAt = row?.disabledAt ?? null;
	}

	// Load all per-user settings in a single query.
	const allSettings = db.select().from(userSettings).where(eq(userSettings.userId, userId)).all();
	const settingsMap = new Map(allSettings.map(s => [s.key, s.value]));
	const getSetting = (key: string) => settingsMap.get(key);

	// Surface the PIN lock status (but never the hash itself). The client uses
	// this to render the lock overlay and arm the right trigger.
	const pinRow = db
		.select({ pinHash: users.pinHash, pinPolicy: users.pinPolicy, pinTimeoutMinutes: users.pinTimeoutMinutes })
		.from(users)
		.where(eq(users.id, userId))
		.get();

	// Theme model: user always picks a preferred dark theme + light theme.
	// `colorMode` decides which one renders (system follows OS preference,
	// swapped client-side on mount via matchMedia).
	const colorMode = getSetting('colorMode') ?? 'dark';
	const systemDarkThemeId = getSetting('systemDarkThemeId');
	const systemLightThemeId = getSetting('systemLightThemeId');
	const loadSlotTheme = (id: string | undefined, fallbackMode: 'dark' | 'light') => {
		if (id) {
			return db.select().from(themes).where(
				and(eq(themes.id, Number(id)), or(isNull(themes.userId), eq(themes.userId, userId)))
			).get() ?? null;
		}
		return db.select().from(themes).where(and(eq(themes.isBuiltin, true), eq(themes.mode, fallbackMode))).limit(1).get() ?? null;
	};
	const systemDarkTheme = loadSlotTheme(systemDarkThemeId, 'dark');
	const systemLightTheme = loadSlotTheme(systemLightThemeId, 'light');

	const totalMs = Date.now() - t0;
	if (totalMs > 100) {
		logger.warn('slow layout load', { userId, totalMs });
	}

	return {
		currentSessionId: currentSessionToken ? hashSessionToken(currentSessionToken) : null,
		currentSessionNotificationsDisabledAt,
		systemDarkTheme,
		systemLightTheme,
		colorMode,
		systemDarkThemeId: systemDarkThemeId ? Number(systemDarkThemeId) : null,
		systemLightThemeId: systemLightThemeId ? Number(systemLightThemeId) : null,
		alwaysUseCharacterThemes: getSetting('alwaysUseCharacterThemes') === 'true',
		allowExternalCreatorNotes: getSetting('allowExternalCreatorNotes') === 'true',
		colorCharacterCards: getSetting('colorCharacterCards') === 'true',
		sidebarWidth: getSetting('sidebarWidth') ? Number(getSetting('sidebarWidth')) : 320,
		sidebarCollapsed: getSetting('sidebarCollapsed') === 'true',
		fontSize: getSetting('fontSize') ?? 'medium',
		compactMode: getSetting('compactMode') === 'true',
		reduceMotion: getSetting('reduceMotion') === 'true',
		sendWithEnterDesktop: getSetting('sendWithEnterDesktop') !== 'false',
		sendWithEnterMobile: getSetting('sendWithEnterMobile') !== 'false',
		autoScrollThreshold: getSetting('autoScrollThreshold') ?? 'normal',
		confirmDeletions: getSetting('confirmDeletions') !== 'false',
		messageTimestamps: getSetting('messageTimestamps') ?? 'relative',
		showReasoning: getSetting('showReasoning') === 'true',
		chatPageSize: getSetting('chatPageSize') ? Number(getSetting('chatPageSize')) : 50,
		autoLoadEarlierMessages: getSetting('autoLoadEarlierMessages') === 'true',
		notificationSound: getSetting('notificationSound') === 'true',
		notificationStyle: getSetting('notificationStyle') ?? 'generic',
		notificationAvatar: getSetting('notificationAvatar') !== 'false',
		inAppNotifications: getSetting('inAppNotifications') !== 'false',
		notificationDuration: getSetting('notificationDuration') != null ? Number(getSetting('notificationDuration')) : 5,
		quietHoursEnabled: getSetting('quietHoursEnabled') === 'true',
		quietHoursStart: getSetting('quietHoursStart') ?? '22:00',
		quietHoursEnd: getSetting('quietHoursEnd') ?? '07:00',
		userTimezone: getSetting('userTimezone') ?? '',
		renderMode: getSetting('renderMode') ?? 'roleplay',
		promptSlotOrder: getSetting('promptSlotOrder') ?? '',
		reformatterProviderId: getSetting('reformatterProviderId') ?? '',
		reformatterModel: getSetting('reformatterModel') ?? '',
		reformatterPrompt: getSetting('reformatterPrompt') ?? '',
		characterCreatorProviderId: getSetting('characterCreatorProviderId') ?? '',
		characterCreatorModel: getSetting('characterCreatorModel') ?? '',
		characterCreatorPrompt: getSetting('characterCreatorPrompt') ?? '',
		compactionEnabled: getSetting('compactionEnabled') === 'true',
		compactionThreshold: getSetting('compactionThreshold') != null ? Number(getSetting('compactionThreshold')) : 80,
		compactionMode: getSetting('compactionMode') ?? 'window',
		compactionWindowPercent: getSetting('compactionWindowPercent') != null ? Number(getSetting('compactionWindowPercent')) : 30,
		compactionFixedCount: getSetting('compactionFixedCount') != null ? Number(getSetting('compactionFixedCount')) : 20,
		compactionProviderId: getSetting('compactionProviderId') ?? '',
		compactionModel: getSetting('compactionModel') ?? '',
		compactionPrompt: getSetting('compactionPrompt') ?? '',
		speechOpacity: getSetting('speechOpacity') != null ? Number(getSetting('speechOpacity')) : 100,
		speechBold: getSetting('speechBold') != null ? getSetting('speechBold') === 'true' : true,
		speechItalic: getSetting('speechItalic') === 'true',
		thoughtOpacity: getSetting('thoughtOpacity') != null ? Number(getSetting('thoughtOpacity')) : 75,
		thoughtBold: getSetting('thoughtBold') === 'true',
		thoughtItalic: getSetting('thoughtItalic') != null ? getSetting('thoughtItalic') === 'true' : true,
		linkOpacity: getSetting('linkOpacity') != null ? Number(getSetting('linkOpacity')) : 100,
		linkBold: getSetting('linkBold') === 'true',
		linkItalic: getSetting('linkItalic') === 'true',
		narrationOpacity: getSetting('narrationOpacity') != null ? Number(getSetting('narrationOpacity')) : 100,
		narrationBold: getSetting('narrationBold') === 'true',
		narrationItalic: getSetting('narrationItalic') === 'true',
		nestedEmphasisInSpeech: getSetting('nestedEmphasisInSpeech') != null ? getSetting('nestedEmphasisInSpeech') === 'true' : true,
		pinnedMessageActions: getSetting('pinnedMessageActions') ?? '',
		imagePromptTemplate: getSetting('imagePromptTemplate') ?? '',
		imageIncludeAvatar: getSetting('imageIncludeAvatar') === 'true',
		imageIncludeCharacterDesc: getSetting('imageIncludeCharacterDesc') === 'true',
		imageIncludePersonaDesc: getSetting('imageIncludePersonaDesc') === 'true',
		dismissKeyboardOnScroll: getSetting('dismissKeyboardOnScroll') !== 'false',
		showTokenRing: getSetting('showTokenRing') !== 'false',
		translucencyOpacity: getSetting('translucencyOpacity') != null ? Number(getSetting('translucencyOpacity')) : 70,
		user,
		oidcEnabled: isOidcEnabled(),
		devAuthEnabled: isDevAuthBypassEnabled(),
		pinEnabled: !!pinRow?.pinHash,
		pinPolicy: (pinRow?.pinPolicy ?? 'disabled') as 'disabled' | 'on-focus' | 'on-open' | 'timeout',
		pinTimeoutMinutes: pinRow?.pinTimeoutMinutes ?? null,
		characterLimitsEnabled: getAdminSettingBool('characterLimitsEnabled'),
	};
};
