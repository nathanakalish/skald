// Global user-settings store. Holds the small key/value bag of preferences
// rendered into the root layout (font size, compact mode, etc.) plus the
// active theme row whose colors drive the root CSS variable rewrite.
//
// Mutations PATCH /api/settings (or POST /api/themes/:id/activate) and
// update local state; no invalidateAll() round-trip required.

import type { Theme } from './themes.svelte.js';

export interface Settings {
	colorMode: string;
	systemDarkThemeId: number | null;
	systemLightThemeId: number | null;
	alwaysUseCharacterThemes: boolean;
	allowExternalCreatorNotes: boolean;
	colorCharacterCards: boolean;
	sidebarWidth: number;
	sidebarCollapsed: boolean;
	fontSize: string;
	compactMode: boolean;
	reduceMotion: boolean;
	sendWithEnterDesktop: boolean;
	sendWithEnterMobile: boolean;
	autoScrollThreshold: string;
	confirmDeletions: boolean;
	messageTimestamps: string;
	showReasoning: boolean;
	chatPageSize: number;
	notificationSound: boolean;
	notificationStyle: string;
	notificationAvatar: boolean;
	inAppNotifications: boolean;
	quietHoursEnabled: boolean;
	quietHoursStart: string;
	quietHoursEnd: string;
	userTimezone: string;
	renderMode: string;
	promptSlotOrder: string;
	reformatterProviderId: string;
	reformatterModel: string;
	reformatterPrompt: string;
	characterCreatorProviderId: string;
	characterCreatorModel: string;
	characterCreatorPrompt: string;
	compactionEnabled: boolean;
	compactionThreshold: number;
	compactionMode: string;
	compactionTargetPercent: number;
	compactionFixedCount: number;
	compactionProviderId: string;
	compactionModel: string;
	compactionPrompt: string;
	speechOpacity: number;
	speechBold: boolean;
	speechItalic: boolean;
	thoughtOpacity: number;
	thoughtBold: boolean;
	thoughtItalic: boolean;
	linkOpacity: number;
	linkBold: boolean;
	linkItalic: boolean;
	narrationOpacity: number;
	narrationBold: boolean;
	narrationItalic: boolean;
	nestedEmphasisInSpeech: boolean;
	[k: string]: unknown;
}

const defaults: Settings = {
	colorMode: 'dark',
	systemDarkThemeId: null,
	systemLightThemeId: null,
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
	chatPageSize: 50,
	notificationSound: false,
	notificationStyle: 'generic',
	notificationAvatar: true,
	inAppNotifications: true,
	quietHoursEnabled: false,
	quietHoursStart: '22:00',
	quietHoursEnd: '07:00',
	userTimezone: '',
	renderMode: 'roleplay',
	promptSlotOrder: '',
	reformatterProviderId: '',
	reformatterModel: '',
	reformatterPrompt: '',
	characterCreatorProviderId: '',
	characterCreatorModel: '',
	characterCreatorPrompt: '',
	compactionEnabled: false,
	compactionThreshold: 80,
	compactionMode: 'threshold',
	compactionTargetPercent: 50,
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
	nestedEmphasisInSpeech: true
};

let _settings = $state<Settings>({ ...defaults });
let _systemDarkTheme = $state<Theme | null>(null);
let _systemLightTheme = $state<Theme | null>(null);
let _effectiveMode = $state<'dark' | 'light'>('dark');
let _loaded = $state(false);

export const settingsStore = {
	get settings() { return _settings; },
	// Derived: the slot picked by the user for the currently effective mode.
	// `effectiveMode` tracks OS preference when colorMode is 'system'.
	get activeTheme() {
		return _effectiveMode === 'light' ? _systemLightTheme : _systemDarkTheme;
	},
	get systemDarkTheme() { return _systemDarkTheme; },
	get systemLightTheme() { return _systemLightTheme; },
	get effectiveMode() { return _effectiveMode; },
	get loaded() { return _loaded; },

	hydrate(
		initial: Partial<Settings>,
		opts?: { force?: boolean; systemDarkTheme?: Theme | null; systemLightTheme?: Theme | null }
	) {
		if (_loaded && !opts?.force) return;
		_settings = { ...defaults, ...initial };
		_systemDarkTheme = opts?.systemDarkTheme ?? null;
		_systemLightTheme = opts?.systemLightTheme ?? null;
		_loaded = true;
	},

	patch(partial: Partial<Settings>) {
		_settings = { ..._settings, ...partial };
	},

	setSystemDarkTheme(theme: Theme | null) {
		_systemDarkTheme = theme;
	},

	setSystemLightTheme(theme: Theme | null) {
		_systemLightTheme = theme;
	},

	setEffectiveMode(mode: 'dark' | 'light') {
		_effectiveMode = mode;
	},

	// PATCH /api/settings with the given key/value, then update local state.
	// Server stores everything as a string; coerce booleans/numbers back here.
	async save(key: keyof Settings, value: string | boolean | number) {
		const prev = (_settings as Record<string, unknown>)[key as string];
		_settings = { ..._settings, [key]: value } as Settings;
		const res = await fetch('/api/settings', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ [key]: typeof value === 'boolean' ? String(value) : value })
		});
		if (!res.ok) {
			_settings = { ..._settings, [key]: prev } as Settings;
			return false;
		}
		return true;
	},

	reset() {
		_settings = { ...defaults };
		_systemDarkTheme = null;
		_systemLightTheme = null;
		_loaded = false;
	}
};
