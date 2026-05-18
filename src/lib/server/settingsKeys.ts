/**
 * Single source of truth for allowed user-settings keys. The PATCH
 * /api/settings endpoint and the bundle import path both filter against
 * this list (M13) so importers can never write keys the public API
 * wouldn't accept.
 */
export const ALLOWED_SETTING_KEYS = [
	'alwaysUseCharacterThemes', 'allowExternalCreatorNotes', 'colorCharacterCards',
	'sidebarWidth', 'sidebarCollapsed',
	'fontSize', 'compactMode', 'reduceMotion',
	'sendWithEnterDesktop', 'sendWithEnterMobile', 'autoScrollThreshold', 'confirmDeletions',
	'messageTimestamps', 'showReasoning', 'notificationSound',
	'notificationStyle', 'notificationAvatar',
	'inAppNotifications', 'notificationDuration',
	'quietHoursEnabled', 'quietHoursStart', 'quietHoursEnd',
	'userTimezone',
	'chatPageSize', 'renderMode',
	'promptSlotOrder',
	'reformatterProviderId', 'reformatterModel', 'reformatterPrompt',
	'characterCreatorProviderId', 'characterCreatorModel', 'characterCreatorPrompt',
	'compactionEnabled', 'compactionThreshold', 'compactionMode',
	'compactionWindowPercent', 'compactionFixedCount',
	'compactionProviderId', 'compactionModel', 'compactionPrompt',
	'systemDarkThemeId', 'systemLightThemeId',
	// Roleplay formatting: per-style appearance settings used by the chat
	// renderer. Patched one-key-at-a-time from the Formatting tab. These were
	// missing from the allowlist, which silently dropped writes (settings
	// looked saved in the UI but reverted on next login/page reload).
	'speechOpacity', 'speechBold', 'speechItalic',
	'thoughtOpacity', 'thoughtBold', 'thoughtItalic',
	'linkOpacity', 'linkBold', 'linkItalic',
	'narrationOpacity', 'narrationBold', 'narrationItalic',
	'nestedEmphasisInSpeech',
];
