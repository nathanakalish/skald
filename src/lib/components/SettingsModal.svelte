<script lang="ts">
	import { Plus, Check, X, Server, Pencil, Trash2, Palette, Copy, Bell, GripVertical, Users, MessageSquare, Settings2, Info, User, RotateCcw, Sparkles, Type } from 'lucide-svelte';
	import Combobox, { type ComboboxItem } from '$lib/components/Combobox.svelte';
	import { modelsToItems } from '$lib/components/modelItems.js';
	import { untrack } from 'svelte';
	import { slide } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import { toasts } from '$lib/stores/toast.svelte.js';
	import { haptic } from '$lib/utils/haptics.js';
	import { urlBase64ToUint8Array } from '$lib/utils.js';
	import { createModalState, createModalGestures } from '$lib/modal.svelte.js';
	import ConfirmModal from '$lib/components/ConfirmModal.svelte';
	import ThemeEditModal from '$lib/components/ThemeEditModal.svelte';
	import ToggleSwitch from '$lib/components/settings/ToggleSwitch.svelte';
	import AboutTab from '$lib/components/settings/AboutTab.svelte';
	import UserManagementPanel from '$lib/components/settings/UserManagementPanel.svelte';
	import ProviderListManager from '$lib/components/settings/ProviderListManager.svelte';
	import DataExportImport from '$lib/components/settings/DataExportImport.svelte';
	import SignedInDevices from '$lib/components/settings/SignedInDevices.svelte';
	import { providersStore } from '$lib/stores/providers.svelte.js';
	import { themesStore } from '$lib/stores/themes.svelte.js';
	import { settingsStore } from '$lib/stores/settings.svelte.js';

	interface Props {
		open: boolean;
		embedded?: boolean;
		mode?: 'modal' | 'embedded' | 'page';
		activeTab?: 'providers' | 'prompts' | 'formatting' | 'appearance' | 'chat' | 'notifications' | 'account' | 'about' | 'instance' | 'users';
		providers: any[];
		themes: any[];
		alwaysUseCharacterThemes: boolean;
		allowExternalCreatorNotes: boolean;
		colorCharacterCards: boolean;
		fontSize: string;
		compactMode: boolean;
		reduceMotion: boolean;
		sendWithEnterDesktop: boolean;
		sendWithEnterMobile: boolean;
		autoScrollThreshold: string;
		confirmDeletions: boolean;
		messageTimestamps: string;
		showReasoning: boolean;
		notificationSound: boolean;
		notificationStyle: string;
		notificationAvatar: boolean;
		inAppNotifications: boolean;
		quietHoursEnabled: boolean;
		quietHoursStart: string;
		quietHoursEnd: string;
		renderMode: string;
		chatPageSize: number;
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
		promptSlotOrder: string;
		user: { id: number; username: string; role: string } | null;
		activeChatId?: number | null;
		onchatimported?: (chatId: number) => void;
		onclose: () => void;
	}

	let {
		open, embedded = false, mode: modeProp, activeTab: activeTabProp, providers, themes = [], alwaysUseCharacterThemes = false, allowExternalCreatorNotes = false, colorCharacterCards = false,
		fontSize = 'medium', compactMode = false, reduceMotion = false,
		sendWithEnterDesktop = true, sendWithEnterMobile = true, autoScrollThreshold = 'normal', confirmDeletions = true,
		messageTimestamps = 'relative', showReasoning = false, notificationSound = false, notificationStyle = 'generic', notificationAvatar = true,
		inAppNotifications = true,
		quietHoursEnabled = false, quietHoursStart = '22:00', quietHoursEnd = '07:00',
		renderMode = 'roleplay',
		chatPageSize = 50,
		reformatterProviderId = '', reformatterModel = '', reformatterPrompt = '',
		characterCreatorProviderId = '', characterCreatorModel = '', characterCreatorPrompt = '',
		compactionEnabled = false, compactionThreshold = 80, compactionMode = 'threshold',
		compactionTargetPercent = 50, compactionFixedCount = 20,
		compactionProviderId = '', compactionModel = '', compactionPrompt = '',
		speechOpacity = 100, speechBold = true, speechItalic = false,
		thoughtOpacity = 75, thoughtBold = false, thoughtItalic = true,
		linkOpacity = 100, linkBold = false, linkItalic = false,
		narrationOpacity = 100, narrationBold = false, narrationItalic = false,
		nestedEmphasisInSpeech = true,
		promptSlotOrder = '',
		user = null, activeChatId = null, onchatimported, onclose
	}: Props = $props();
	const isAdmin = $derived(user?.role === 'admin');
	const mode = $derived(modeProp ?? (embedded ? 'embedded' : 'modal'));

	let alwaysThemes = $state(false);
	let allowExternal = $state(false);
	let localColorCards = $state(false);
	let localFontSize = $state('medium');
	let localCompact = $state(false);
	let localReduceMotion = $state(false);
	let localSendWithEnterDesktop = $state(true);
	let localSendWithEnterMobile = $state(true);
	let localAutoScroll = $state('normal');
	let localConfirmDeletions = $state(true);
	let localTimestamps = $state('relative');
	let localShowReasoning = $state(false);
	let localNotifSound = $state(false);
	let localNotifStyle = $state('generic');
	let localNotifAvatar = $state(true);
	let localInAppNotif = $state(true);
	let localDeviceSilent = $state(false);
	let localQuietEnabled = $state(false);
	let localQuietStart = $state('22:00');
	let localQuietEnd = $state('07:00');
	let localRenderMode = $state('roleplay');
	let localChatPageSize = $state(50);
	let localReformatterProviderId = $state('');
	let localReformatterModel = $state('');
	let localReformatterPrompt = $state('');
	let reformatterModels: string[] = $state([]);
	let loadingReformatterModels = $state(false);
	let localCreatorProviderId = $state('');
	let localCreatorModel = $state('');
	let localCreatorPrompt = $state('');
	let creatorModels: string[] = $state([]);
	let loadingCreatorModels = $state(false);

	let localCompactionEnabled = $state(false);
	let localCompactionThreshold = $state(80);
	let localCompactionMode = $state('threshold');
	let localCompactionTargetPercent = $state(50);
	let localCompactionFixedCount = $state(20);
	let localCompactionProviderId = $state('');
	let localCompactionModel = $state('');
	let localCompactionPrompt = $state('');
	let compactionModels: string[] = $state([]);
	let loadingCompactionModels = $state(false);

	// Combobox-derived view models for provider/model pickers
	const providerComboboxItems = $derived(providers.map((p: any) => ({ value: String(p.id), label: p.name, hint: p.type })) as ComboboxItem[]);
	const creatorProviderType = $derived(providers.find((p: any) => String(p.id) === localCreatorProviderId)?.type ?? null);
	const reformatterProviderType = $derived(providers.find((p: any) => String(p.id) === localReformatterProviderId)?.type ?? null);
	const compactionProviderType = $derived(providers.find((p: any) => String(p.id) === localCompactionProviderId)?.type ?? null);

	let localSpeechOpacity = $state(100);
	let localSpeechBold = $state(true);
	let localSpeechItalic = $state(false);
	let localThoughtOpacity = $state(75);
	let localThoughtBold = $state(false);
	let localThoughtItalic = $state(true);
	let localLinkOpacity = $state(100);
	let localLinkBold = $state(false);
	let localLinkItalic = $state(false);
	let localNarrationOpacity = $state(100);
	let localNarrationBold = $state(false);
	let localNarrationItalic = $state(false);
	let localNestedEmphasis = $state(true);

	// Prompt slot ordering state
	const DEFAULT_SLOT_ORDER = ['system', 'persona', 'character', 'examples', 'history', 'postHistory'];
	let localSlotOrder = $state<string[]>([...DEFAULT_SLOT_ORDER]);
	let slotDragIdx = $state<number | null>(null);

	$effect(() => {
		if (open) {
			untrack(() => {
				alwaysThemes = alwaysUseCharacterThemes;
				allowExternal = allowExternalCreatorNotes;
				localColorCards = colorCharacterCards;
				localFontSize = fontSize;
				localCompact = compactMode;
				localReduceMotion = reduceMotion;
				localSendWithEnterDesktop = sendWithEnterDesktop;
				localSendWithEnterMobile = sendWithEnterMobile;
				localAutoScroll = autoScrollThreshold;
				localConfirmDeletions = confirmDeletions;
				localTimestamps = messageTimestamps;
				localShowReasoning = showReasoning;
				localNotifSound = notificationSound;
				localNotifStyle = notificationStyle;
				localNotifAvatar = notificationAvatar;
				localInAppNotif = inAppNotifications;
				localQuietEnabled = quietHoursEnabled;
				localQuietStart = quietHoursStart;
				localQuietEnd = quietHoursEnd;
				if (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function') {
					localDeviceSilent = localStorage.getItem('skald-device-silent') === 'true';
				}
				localRenderMode = renderMode;
				localChatPageSize = chatPageSize;
				localReformatterProviderId = reformatterProviderId;
				localReformatterModel = reformatterModel;
				localReformatterPrompt = reformatterPrompt;
				localCreatorProviderId = characterCreatorProviderId;
				localCreatorModel = characterCreatorModel;
				localCreatorPrompt = characterCreatorPrompt;
				localCompactionEnabled = compactionEnabled;
				localCompactionThreshold = compactionThreshold;
				localCompactionMode = compactionMode;
				localCompactionTargetPercent = compactionTargetPercent;
				localCompactionFixedCount = compactionFixedCount;
				localCompactionProviderId = compactionProviderId;
				localCompactionModel = compactionModel;
				localCompactionPrompt = compactionPrompt;
				localSpeechOpacity = speechOpacity;
				localSpeechBold = speechBold;
				localSpeechItalic = speechItalic;
				localThoughtOpacity = thoughtOpacity;
				localThoughtBold = thoughtBold;
				localThoughtItalic = thoughtItalic;
				localLinkOpacity = linkOpacity;
				localLinkBold = linkBold;
				localLinkItalic = linkItalic;
				localNarrationOpacity = narrationOpacity;
				localNarrationBold = narrationBold;
				localNarrationItalic = narrationItalic;
				localNestedEmphasis = nestedEmphasisInSpeech;
				localColorMode = (settingsStore.settings.colorMode as 'light' | 'dark' | 'system') ?? 'dark';
				if (localReformatterProviderId) {
					fetchReformatterModels(localReformatterProviderId);
				}
				if (localCreatorProviderId) {
					fetchCreatorModels(localCreatorProviderId);
				}
				if (localCompactionProviderId) {
					fetchCompactionModels(localCompactionProviderId);
				}
				// Load prompt slot order
				if (promptSlotOrder) {
					try { localSlotOrder = JSON.parse(promptSlotOrder); } catch { localSlotOrder = [...DEFAULT_SLOT_ORDER]; }
				} else {
					localSlotOrder = [...DEFAULT_SLOT_ORDER];
				}
			});
		}
	});

	async function fetchReformatterModels(pid: string) {
		if (!pid) { reformatterModels = []; return; }
		loadingReformatterModels = true;
		try {
			const res = await fetch(`/api/providers/${pid}/models`);
			if (res.ok) {
				const data = await res.json();
				reformatterModels = data.models ?? [];
			}
		} catch { /* ignore */ }
		loadingReformatterModels = false;
	}

	async function fetchCreatorModels(pid: string) {
		if (!pid) { creatorModels = []; return; }
		loadingCreatorModels = true;
		try {
			const res = await fetch(`/api/providers/${pid}/models`);
			if (res.ok) {
				const data = await res.json();
				creatorModels = data.models ?? [];
			}
		} catch { /* ignore */ }
		loadingCreatorModels = false;
	}

	async function fetchCompactionModels(pid: string) {
		if (!pid) { compactionModels = []; return; }
		loadingCompactionModels = true;
		try {
			const res = await fetch(`/api/providers/${pid}/models`);
			if (res.ok) {
				const data = await res.json();
				compactionModels = data.models ?? [];
			}
		} catch { /* ignore */ }
		loadingCompactionModels = false;
	}

	async function toggleAlwaysThemes() {
		alwaysThemes = !alwaysThemes;
		await settingsStore.save('alwaysUseCharacterThemes', alwaysThemes);
	}

	async function toggleAllowExternal() {
		allowExternal = !allowExternal;
		await settingsStore.save('allowExternalCreatorNotes', allowExternal);
	}

	async function saveSetting(key: string, value: string | boolean | number) {
		const ok = await settingsStore.save(key as any, value);
		if (ok) toasts.success('Setting saved');
	}

	async function toggleBoolSetting(key: string, getter: () => boolean, setter: (v: boolean) => void) {
		const newVal = !getter();
		setter(newVal);
		await saveSetting(key, newVal);
	}

	function toggleDeviceSilent() {
		localDeviceSilent = !localDeviceSilent;
		try {
			localStorage.setItem('skald-device-silent', String(localDeviceSilent));
			window.dispatchEvent(new CustomEvent('skald-device-silent-change', { detail: localDeviceSilent }));
		} catch { /* ignore */ }
	}

	// Sidebar order follows the data-flow: connect → generate → display →
	// alerts → you → admin → meta. Prompts/Formatting are upstream of how
	// the model's output reaches you; Appearance/Chat are how you see/use it.
	const baseTabs = [
		{ id: 'providers', label: 'Providers', icon: Server },
		{ id: 'prompts', label: 'Prompts', icon: Sparkles },
		{ id: 'formatting', label: 'Formatting', icon: Type },
		{ id: 'appearance', label: 'Appearance', icon: Palette },
		{ id: 'chat', label: 'Chat', icon: MessageSquare },
		{ id: 'notifications', label: 'Notifications', icon: Bell },
		{ id: 'account', label: 'Account', icon: User },
	] as const;

	const adminTabs = [
		{ id: 'instance', label: 'Instance', icon: Settings2 },
		{ id: 'users', label: 'Users', icon: Users }
	] as const;

	const aboutTab = { id: 'about', label: 'About', icon: Info } as const;

	type TabId = 'providers' | 'prompts' | 'formatting' | 'appearance' | 'chat' | 'notifications' | 'account' | 'about' | 'instance' | 'users';

	const tabs = $derived(isAdmin ? [...baseTabs, ...adminTabs, aboutTab] : [...baseTabs, aboutTab]);

	let internalActiveTab = $state<TabId>(untrack(() => activeTabProp) ?? 'providers');
	const activeTab = $derived<TabId>(mode === 'embedded' && activeTabProp ? activeTabProp : internalActiveTab);

	$effect(() => {
		if (activeTabProp && mode === 'page') {
			internalActiveTab = activeTabProp;
		}
	});

	// User management state (admin only)

	// Admin instance settings state
	let instanceSettings = $state<Record<string, string>>({});
	let instanceLoading = $state(false);

	async function loadInstanceSettings() {
		instanceLoading = true;
		try {
			const res = await fetch('/api/admin/settings');
			if (res.ok) instanceSettings = await res.json();
		} finally {
			instanceLoading = false;
		}
	}

	async function saveInstanceSetting(key: string, value: string) {
		instanceSettings = { ...instanceSettings, [key]: value };
		const res = await fetch('/api/admin/settings', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ [key]: value })
		});
		if (res.ok) toasts.success('Setting saved');
	}

	// Image cache state
	let cacheStats = $state<{ fileCount: number; totalBytes: number } | null>(null);
	let cacheStatsLoading = $state(false);
	let clearingCache = $state(false);
	let showClearCacheConfirm = $state(false);
	let showDisableCacheConfirm = $state(false);

	function formatBytes(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
		return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
	}

	async function loadCacheStats() {
		cacheStatsLoading = true;
		try {
			const res = await fetch('/api/admin/cache');
			if (res.ok) cacheStats = await res.json();
		} finally {
			cacheStatsLoading = false;
		}
	}

	async function clearCache() {
		clearingCache = true;
		try {
			const res = await fetch('/api/admin/cache', { method: 'DELETE' });
			if (res.ok) {
				const data = await res.json();
				toasts.success(`Cleared ${data.removed} cached file${data.removed === 1 ? '' : 's'}`);
				await loadCacheStats();
			} else {
				toasts.error('Failed to clear cache');
			}
		} finally {
			clearingCache = false;
			showClearCacheConfirm = false;
		}
	}

	function toggleImageCaching() {
		const currentlyDisabled = instanceSettings.disableImageCaching === 'true';
		if (currentlyDisabled) {
			// Re-enabling — no confirmation needed
			saveInstanceSetting('disableImageCaching', 'false');
		} else {
			// Disabling — offer to also clear the existing cache
			showDisableCacheConfirm = true;
		}
	}

	async function confirmDisableCaching(alsoClear: boolean) {
		showDisableCacheConfirm = false;
		await saveInstanceSetting('disableImageCaching', 'true');
		if (alsoClear) await clearCache();
	}

	// Regex scripts state
	let regexScripts = $state<any[]>([]);
	let regexLoading = $state(false);
	let editingRegex = $state<any | null>(null);
	let regexName = $state('');
	let regexFind = $state('');
	let regexReplace = $state('');
	let regexUserInput = $state(false);
	let regexAiResponse = $state(true);
	let regexEnabled = $state(true);

	async function loadRegexScripts() {
		regexLoading = true;
		try {
			const res = await fetch('/api/regex-scripts');
			if (res.ok) regexScripts = await res.json();
		} finally {
			regexLoading = false;
		}
	}

	function resetRegexForm() {
		editingRegex = null;
		regexName = '';
		regexFind = '';
		regexReplace = '';
		regexUserInput = false;
		regexAiResponse = true;
		regexEnabled = true;
	}

	function startEditRegex(script: any) {
		editingRegex = script;
		regexName = script.name;
		regexFind = script.findRegex;
		regexReplace = script.replaceString;
		regexUserInput = script.affectUserInput;
		regexAiResponse = script.affectAiResponse;
		regexEnabled = script.enabled;
	}

	async function saveRegexScript() {
		if (!regexName.trim() || !regexFind.trim()) {
			toasts.error('Name and find pattern are required');
			return;
		}

		const body = {
			name: regexName.trim(),
			findRegex: regexFind,
			replaceString: regexReplace,
			affectUserInput: regexUserInput,
			affectAiResponse: regexAiResponse,
			enabled: regexEnabled
		};

		if (editingRegex) {
			const res = await fetch(`/api/regex-scripts/${editingRegex.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (res.ok) {
				toasts.success('Script updated');
				resetRegexForm();
				await loadRegexScripts();
			} else {
				const data = await res.json();
				toasts.error(data.error || 'Failed to update');
			}
		} else {
			const res = await fetch('/api/regex-scripts', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (res.ok) {
				toasts.success('Script created');
				resetRegexForm();
				await loadRegexScripts();
			} else {
				const data = await res.json();
				toasts.error(data.error || 'Failed to create');
			}
		}
	}

	async function deleteRegexScript(id: number) {
		const res = await fetch(`/api/regex-scripts/${id}`, { method: 'DELETE' });
		if (res.ok) {
			toasts.success('Script deleted');
			if (editingRegex?.id === id) resetRegexForm();
			await loadRegexScripts();
		}
	}

	async function toggleRegexEnabled(script: any) {
		await fetch(`/api/regex-scripts/${script.id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ enabled: !script.enabled })
		});
		await loadRegexScripts();
	}

	$effect(() => {
		if (open && activeTab === 'formatting') {
			loadRegexScripts();
		}
	});

	$effect(() => {
		if (open && activeTab === 'instance' && isAdmin) {
			loadInstanceSettings();
			loadCacheStats();
		}
	});

	// Notification permission state
	let notifPermission = $state<string>('unsupported');
	let notifStatus = $state('');
	let isSecureCtx = $state(true);
	$effect(() => {
		if (open && 'Notification' in window) {
			notifPermission = Notification.permission;
		}
		if (open) {
			isSecureCtx = typeof window.isSecureContext === 'boolean' ? window.isSecureContext : true;
		}
	});

	function requestNotifPermission() {
		Notification.requestPermission().then((result) => {
			notifPermission = result;
			if (result !== 'granted') {
				notifStatus = `Permission returned "${result}". On iOS, go to Settings → Notifications → Skald and enable Allow Notifications, then try again.`;
			} else {
				notifStatus = '';
				// Auto-subscribe to web push when permission is granted
				subscribeToPush();
			}
		}).catch((err) => {
			notifStatus = `Error: ${err instanceof Error ? err.message : String(err)}`;
		});
	}

	// Web push subscription state
	let pushSubscribed = $state(false);
	let pushLoading = $state(false);
	let pushStatus = $state('');

	// Check push subscription status on open
	$effect(() => {
		if (open && notifPermission === 'granted' && 'PushManager' in window) {
			navigator.serviceWorker?.ready.then(async (reg) => {
				const sub = await reg.pushManager.getSubscription();
				pushSubscribed = !!sub;
			});
		}
	});

	async function subscribeToPush() {
		if (!('PushManager' in window)) { pushStatus = 'Push not supported in this browser.'; return; }
		pushLoading = true;
		pushStatus = '';
		try {
			const keyRes = await fetch('/api/push/vapid-key');
			const { key } = await keyRes.json();
			if (!key) { pushStatus = 'Server has no VAPID key configured.'; return; }

			const reg = await navigator.serviceWorker.ready;
			const sub = await reg.pushManager.subscribe({
				userVisibleOnly: true,
				applicationServerKey: urlBase64ToUint8Array(key)
			});

			const subJson = sub.toJSON();
			await fetch('/api/push/subscribe', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					endpoint: subJson.endpoint,
					keys: subJson.keys
				})
			});

			pushSubscribed = true;
			pushStatus = '';
		} catch (err) {
			pushStatus = `Failed: ${err instanceof Error ? err.message : String(err)}`;
		} finally {
			pushLoading = false;
		}
	}

	async function unsubscribeFromPush() {
		pushLoading = true;
		pushStatus = '';
		try {
			const reg = await navigator.serviceWorker.ready;
			const sub = await reg.pushManager.getSubscription();
			if (sub) {
				await fetch('/api/push/unsubscribe', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ endpoint: sub.endpoint })
				});
				await sub.unsubscribe();
			}
			pushSubscribed = false;
		} catch (err) {
			pushStatus = `Failed: ${err instanceof Error ? err.message : String(err)}`;
		} finally {
			pushLoading = false;
		}
	}

	async function testPush() {
		pushLoading = true;
		pushStatus = '';
		try {
			const res = await fetch('/api/push/test', { method: 'POST' });
			const data = await res.json();
			if (!res.ok) {
				pushStatus = `Test failed: ${data.error || res.statusText}`;
			} else {
				pushStatus = 'Test sent — you should receive a notification shortly.';
			}
		} catch (err) {
			pushStatus = `Test failed: ${err instanceof Error ? err.message : String(err)}`;
		} finally {
			pushLoading = false;
		}
	}

	// Theme state — the user picks a preferred dark theme + light theme. The
	// 3-way mode toggle (light/dark/system) decides which one renders.
	const themeList = $derived<any[]>(themes ?? []);
	const darkThemes = $derived(themeList.filter((t: any) => t.mode === 'dark'));
	const lightThemes = $derived(themeList.filter((t: any) => t.mode === 'light'));
	let localColorMode = $state<'light' | 'dark' | 'system'>(settingsStore.settings.colorMode as 'light' | 'dark' | 'system' ?? 'dark');
	let darkDropdownOpen = $state(false);
	let lightDropdownOpen = $state(false);
	let themeEditOpen = $state(false);
	let themeEditMode = $state<'create' | 'edit'>('edit');
	let themeEditTarget: any = $state(null);
	let themeEditInitialMode = $state<'dark' | 'light'>('dark');
	// Track which slot a freshly-created theme should auto-select.
	let pendingCreateSlot: 'dark' | 'light' | null = $state(null);

	function getThemeColors(theme: any): Record<string, string> {
		if (!theme) return {};
		return typeof theme.colors === 'string' ? JSON.parse(theme.colors) : theme.colors;
	}

	async function saveColorMode(mode: 'light' | 'dark' | 'system') {
		localColorMode = mode;
		settingsStore.patch({ colorMode: mode });
		await fetch('/api/themes/color-mode', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ colorMode: mode })
		});
		location.reload();
	}

	async function setSlotTheme(slot: 'dark' | 'light', id: number) {
		const theme = themeList.find((t: any) => t.id === id) ?? null;
		const key = slot === 'dark' ? 'systemDarkThemeId' : 'systemLightThemeId';
		if (slot === 'dark') settingsStore.setSystemDarkTheme(theme);
		else settingsStore.setSystemLightTheme(theme);
		await settingsStore.save(key, id);
		if (slot === 'dark') darkDropdownOpen = false;
		else lightDropdownOpen = false;
		location.reload();
	}

	function openEdit(theme: any) {
		themeEditMode = 'edit';
		themeEditTarget = theme;
		themeEditOpen = true;
		darkDropdownOpen = false;
		lightDropdownOpen = false;
	}

	function openCreate(slot: 'dark' | 'light') {
		themeEditMode = 'create';
		themeEditTarget = null;
		themeEditInitialMode = slot;
		pendingCreateSlot = slot;
		themeEditOpen = true;
		darkDropdownOpen = false;
		lightDropdownOpen = false;
	}

	async function duplicateTheme(theme: any) {
		const colors = getThemeColors(theme);
		const res = await fetch('/api/themes', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				name: `${theme.name} (Copy)`,
				mode: theme.mode,
				colors
			})
		});
		if (res.ok) {
			const body = await res.json().catch(() => null);
			if (body?.id) themesStore.add(body);
			else await themesStore.load(true);
			toasts.success('Theme duplicated');
		}
	}

	async function deleteTheme(theme: any) {
		// Refuse to delete the last theme of either mode — there'd be nothing
		// for the slot to fall back to and the dropdown would render empty.
		const sameModeThemes = themesStore.themes.filter((t: any) => t.mode === theme.mode);
		if (sameModeThemes.length <= 1) {
			toasts.error(`Can't delete the last ${theme.mode} theme`);
			return;
		}
		const res = await fetch(`/api/themes/${theme.id}`, { method: 'DELETE' });
		if (!res.ok) {
			toasts.error('Failed to delete theme');
			return;
		}
		themesStore.remove(theme.id);
		// If this theme was filling a slot, drop back to the first builtin of
		// the same mode (or the first remaining one of that mode).
		const slotKey = theme.mode === 'dark' ? 'systemDarkThemeId' : 'systemLightThemeId';
		const currentSlotId = settingsStore.settings[slotKey] as number | null;
		if (currentSlotId === theme.id) {
			const fallback = themesStore.themes.find((t: any) => t.isBuiltin && t.mode === theme.mode)
				?? themesStore.themes.find((t: any) => t.mode === theme.mode)
				?? null;
			if (fallback) {
				await setSlotTheme(theme.mode, fallback.id);
			}
		}
		toasts.success('Theme deleted');
	}

	function onThemeCreated(created: any) {
		if (pendingCreateSlot && created?.id) {
			setSlotTheme(pendingCreateSlot, created.id);
		}
		pendingCreateSlot = null;
	}


	const modal = createModalState(() => open && mode === 'modal');
	const gestures = createModalGestures({
		onclose: () => onclose(),
		modal,
		tabs: {
			ids: () => tabs.map(t => t.id),
			active: () => activeTab,
			set: (id) => { internalActiveTab = id as TabId; },
		},
	});
</script>

{#snippet settingsTabNav()}
	{#each tabs as tab (tab.id)}
		<button
			onclick={() => { internalActiveTab = tab.id; }}
			class="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors {activeTab === tab.id
				? 'bg-primary/10 text-primary'
				: 'text-muted-foreground hover:bg-accent hover:text-foreground'}"
		>
			<tab.icon class="h-4 w-4" />
			{tab.label}
		</button>
	{/each}
{/snippet}

{#snippet settingsTabContent()}
	{#key activeTab}
	<div class="slide-up">
	{#if activeTab === 'providers'}
						<!-- Providers Tab -->
						<ProviderListManager {providers} />

					{:else if activeTab === 'prompts'}
						<!-- Prompts Tab -->
						<div class="space-y-6">
							<div>
								<h3 class="text-base font-semibold">Prompts</h3>
								<p class="text-sm text-muted-foreground">Control how prompts are assembled and pre-processed before sending to the model</p>
							</div>

							<!-- Prompt Slot Ordering -->
							<div class="space-y-3">
								<div>
									<span class="block text-sm font-medium">Prompt Order</span>
									<span class="block text-xs text-muted-foreground">Drag to reorder how prompt sections are assembled. Changes apply to all chats.</span>
								</div>
								<div class="space-y-1" role="list">
									{#each localSlotOrder as slotName, i (slotName)}
										{@const labels: Record<string, string> = { system: 'System Prompt', persona: 'Persona', character: 'Character Card', examples: 'Example Messages', history: 'Chat History', postHistory: 'Post-History Instructions' }}
										<!-- svelte-ignore a11y_no_static_element_interactions -->
										<div
											role="listitem"
											draggable="true"
											ondragstart={(e: DragEvent) => { slotDragIdx = i; e.dataTransfer!.effectAllowed = 'move'; }}
											ondragover={(e: DragEvent) => { e.preventDefault(); }}
											ondrop={async (e: DragEvent) => {
												e.preventDefault();
												if (slotDragIdx === null || slotDragIdx === i) return;
												const newOrder = [...localSlotOrder];
												const [moved] = newOrder.splice(slotDragIdx, 1);
												newOrder.splice(i, 0, moved);
												localSlotOrder = newOrder;
												slotDragIdx = null;
												await saveSetting('promptSlotOrder', JSON.stringify(newOrder));
											}}
											ondragend={() => { slotDragIdx = null; }}
											class="flex cursor-grab items-center gap-2 rounded-md border border-border bg-card/50 px-3 py-2 text-sm transition-colors hover:bg-accent/30 active:cursor-grabbing {slotDragIdx === i ? 'opacity-40' : ''}"
										>
											<GripVertical class="h-4 w-4 shrink-0 text-muted-foreground" />
											<span>{labels[slotName] ?? slotName}</span>
										</div>
									{/each}
								</div>
								{#if JSON.stringify(localSlotOrder) !== JSON.stringify(DEFAULT_SLOT_ORDER)}
									<button
										onclick={async () => { localSlotOrder = [...DEFAULT_SLOT_ORDER]; await saveSetting('promptSlotOrder', JSON.stringify(DEFAULT_SLOT_ORDER)); }}
										class="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
									>
										<RotateCcw class="h-3 w-3" /> Reset to default
									</button>
								{/if}
							</div>

							<!-- Character Creator -->
							<div class="mt-8 border-t border-border pt-6">
								<div class="mb-4">
									<h3 class="text-base font-semibold">Character Creator</h3>
									<p class="text-sm text-muted-foreground">LLM used to generate and refine characters via the AI creator (the sparkles button in the new-character form).</p>
								</div>

								<div class="space-y-4">
									<!-- Provider -->
									<div class="space-y-1.5">
										<label for="creator-provider" class="block text-sm font-medium">Provider</label>
										<Combobox
											id="creator-provider"
											value={localCreatorProviderId}
											onchange={async (v) => {
												localCreatorProviderId = v;
												localCreatorModel = '';
												creatorModels = [];
												await saveSetting('characterCreatorProviderId', localCreatorProviderId);
												await saveSetting('characterCreatorModel', '');
												if (localCreatorProviderId) fetchCreatorModels(localCreatorProviderId);
											}}
											items={providerComboboxItems}
											placeholder="Default (active provider)"
											searchPlaceholder="Filter providers…"
										/>
									</div>

									<!-- Model -->
									<div class="space-y-1.5">
										<label for="creator-model" class="block text-sm font-medium">Model</label>
										<Combobox
											id="creator-model"
											value={localCreatorModel}
											onchange={async (v) => {
												localCreatorModel = v;
												await saveSetting('characterCreatorModel', localCreatorModel);
											}}
											items={modelsToItems(creatorModels, creatorProviderType)}
											loading={loadingCreatorModels}
											placeholder={`Default (${localCreatorProviderId ? 'provider default' : 'active provider model'})`}
											searchPlaceholder="Filter models…"
											emptyText="No matching models"
										/>
									</div>

									<!-- System Prompt -->
									<div class="space-y-1.5">
										<label for="creator-prompt" class="block text-sm font-medium">System Prompt</label>
										<textarea
											id="creator-prompt"
											class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring resize-y"
											rows={6}
											value={localCreatorPrompt}
											placeholder="Leave blank for default prompt. The default instructs the LLM to return JSON with minimal field changes."
											onchange={async (e) => {
												localCreatorPrompt = e.currentTarget.value;
												await saveSetting('characterCreatorPrompt', localCreatorPrompt);
											}}
										></textarea>
									</div>
								</div>
							</div>

							<!-- Greeting Reformatter -->
							<div class="mt-8 border-t border-border pt-6">
								<div class="mb-4">
									<h3 class="text-base font-semibold">Greeting Reformatter</h3>
									<p class="text-sm text-muted-foreground">LLM used to reformat character greetings on demand. Available per-character in the edit modal.</p>
								</div>

								<div class="space-y-4">
									<!-- Provider -->
									<div class="space-y-1.5">
										<label for="reformatter-provider" class="block text-sm font-medium">Provider</label>
										<Combobox
											id="reformatter-provider"
											value={localReformatterProviderId}
											onchange={async (v) => {
												localReformatterProviderId = v;
												localReformatterModel = '';
												reformatterModels = [];
												await saveSetting('reformatterProviderId', localReformatterProviderId);
												await saveSetting('reformatterModel', '');
												if (localReformatterProviderId) fetchReformatterModels(localReformatterProviderId);
											}}
											items={providerComboboxItems}
											placeholder="Default (active provider)"
											searchPlaceholder="Filter providers…"
										/>
									</div>

									<!-- Model -->
									<div class="space-y-1.5">
										<label for="reformatter-model" class="block text-sm font-medium">Model</label>
										<Combobox
											id="reformatter-model"
											value={localReformatterModel}
											onchange={async (v) => {
												localReformatterModel = v;
												await saveSetting('reformatterModel', localReformatterModel);
											}}
											items={modelsToItems(reformatterModels, reformatterProviderType)}
											loading={loadingReformatterModels}
											placeholder={`Default (${localReformatterProviderId ? 'provider default' : 'active provider model'})`}
											searchPlaceholder="Filter models…"
											emptyText="No matching models"
										/>
									</div>

									<!-- System Prompt -->
									<div class="space-y-1.5">
										<label for="reformatter-prompt" class="block text-sm font-medium">System Prompt</label>
										<textarea
											id="reformatter-prompt"
											class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring resize-y"
											rows={6}
											value={localReformatterPrompt}
											placeholder="Leave blank for default prompt. The default instructs the LLM to reformat narration as plain text, speech in &quot;quotes&quot;, and thoughts in *asterisks*."
											onchange={async (e) => {
												localReformatterPrompt = e.currentTarget.value;
												await saveSetting('reformatterPrompt', localReformatterPrompt);
											}}
										></textarea>
									</div>
								</div>
							</div>

							<!-- Conversation Compaction -->
							<div class="mt-8 border-t border-border pt-6">
								<div class="mb-4">
									<h3 class="text-base font-semibold">Conversation Compaction</h3>
									<p class="text-sm text-muted-foreground">When a chat starts crowding the context window, summarize the oldest messages into a rolling summary placed right after the system prompt. Subsequent compactions feed the previous summary back in, so context stays continuous.</p>
								</div>

								<div class="space-y-4">
									<ToggleSwitch
										label="Auto-compact long chats"
										description="Automatically run a compaction pass when prompt usage crosses the threshold below. The manual button in the chat menu always works regardless of this setting."
										checked={localCompactionEnabled}
										onchange={async () => {
											localCompactionEnabled = !localCompactionEnabled;
											await saveSetting('compactionEnabled', localCompactionEnabled);
										}}
									/>

									<!-- Threshold -->
									<div class="space-y-1.5">
										<label for="compaction-threshold" class="flex items-center justify-between text-sm font-medium">
											<span>Trigger threshold</span>
											<span class="text-muted-foreground">{localCompactionThreshold}% of context</span>
										</label>
										<input
											id="compaction-threshold"
											type="range" min="50" max="95" step="5"
											value={localCompactionThreshold}
											oninput={(e) => { localCompactionThreshold = Number(e.currentTarget.value); }}
											onchange={async () => { await saveSetting('compactionThreshold', localCompactionThreshold); }}
											class="w-full"
										/>
									</div>

									<!-- Mode -->
									<div class="space-y-1.5">
										<label for="compaction-mode" class="block text-sm font-medium">What to compact</label>
										<Combobox
											id="compaction-mode"
											value={localCompactionMode}
											onchange={async (v) => {
												localCompactionMode = v;
												await saveSetting('compactionMode', localCompactionMode);
											}}
											items={[
												{ value: 'threshold', label: 'Oldest, until context drops to a target %' },
												{ value: 'fixed', label: 'Fixed number of oldest messages' }
											]}
										/>
									</div>

									{#if localCompactionMode === 'threshold'}
										<div class="space-y-1.5">
											<label for="compaction-target" class="flex items-center justify-between text-sm font-medium">
												<span>Target after compaction</span>
												<span class="text-muted-foreground">{localCompactionTargetPercent}% of context</span>
											</label>
											<input
												id="compaction-target"
												type="range" min="20" max="70" step="5"
												value={localCompactionTargetPercent}
												oninput={(e) => { localCompactionTargetPercent = Number(e.currentTarget.value); }}
												onchange={async () => { await saveSetting('compactionTargetPercent', localCompactionTargetPercent); }}
												class="w-full"
											/>
										</div>
									{:else}
										<div class="space-y-1.5">
											<label for="compaction-fixed" class="block text-sm font-medium">Messages to compact per run</label>
											<input
												id="compaction-fixed"
												type="number" min="2" max="500"
												value={localCompactionFixedCount}
												onchange={async (e) => {
													localCompactionFixedCount = Math.max(2, Math.min(500, Number(e.currentTarget.value) || 20));
													await saveSetting('compactionFixedCount', localCompactionFixedCount);
												}}
												class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
											/>
										</div>
									{/if}

									<!-- Provider -->
									<div class="space-y-1.5">
										<label for="compaction-provider" class="block text-sm font-medium">Provider</label>
										<Combobox
											id="compaction-provider"
											value={localCompactionProviderId}
											onchange={async (v) => {
												localCompactionProviderId = v;
												localCompactionModel = '';
												compactionModels = [];
												await saveSetting('compactionProviderId', localCompactionProviderId);
												await saveSetting('compactionModel', '');
												if (localCompactionProviderId) fetchCompactionModels(localCompactionProviderId);
											}}
											items={providerComboboxItems}
											placeholder="Default (chat's active provider)"
											searchPlaceholder="Filter providers…"
										/>
									</div>

									<!-- Model -->
									<div class="space-y-1.5">
										<label for="compaction-model" class="block text-sm font-medium">Model</label>
										<Combobox
											id="compaction-model"
											value={localCompactionModel}
											onchange={async (v) => {
												localCompactionModel = v;
												await saveSetting('compactionModel', localCompactionModel);
											}}
											items={modelsToItems(compactionModels, compactionProviderType)}
											loading={loadingCompactionModels}
											placeholder={`Default (${localCompactionProviderId ? 'provider default' : 'active provider model'})`}
											searchPlaceholder="Filter models…"
											emptyText="No matching models"
										/>
									</div>

									<!-- System Prompt -->
									<div class="space-y-1.5">
										<label for="compaction-prompt" class="block text-sm font-medium">System Prompt</label>
										<textarea
											id="compaction-prompt"
											class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring resize-y"
											rows={8}
											value={localCompactionPrompt}
											placeholder="Leave blank for default prompt. The default tells the LLM to summarize setting, important objects, relationships, plot, and emotional state in terse third-person prose."
											onchange={async (e) => {
												localCompactionPrompt = e.currentTarget.value;
												await saveSetting('compactionPrompt', localCompactionPrompt);
											}}
										></textarea>
									</div>
								</div>
							</div>
						</div>

					{:else if activeTab === 'chat'}
						<!-- Chat Tab -->
						<div class="space-y-6">
							<div>
								<h3 class="text-base font-semibold">Chat</h3>
								<p class="text-sm text-muted-foreground">Customize chat behavior and display</p>
							</div>

							<!-- Send with Enter (Desktop) -->
							<ToggleSwitch
								label="Send with Enter (Desktop)"
								description="Press Enter to send on desktop. When off, use Shift+Enter or the send button."
								checked={localSendWithEnterDesktop}
								onchange={() => toggleBoolSetting('sendWithEnterDesktop', () => localSendWithEnterDesktop, (v) => { localSendWithEnterDesktop = v; })}
							/>

							<!-- Send with Enter (Mobile) -->
							<ToggleSwitch
								label="Send with Enter (Mobile)"
								description="Press Enter to send on mobile. When off, use the send button."
								checked={localSendWithEnterMobile}
								onchange={() => toggleBoolSetting('sendWithEnterMobile', () => localSendWithEnterMobile, (v) => { localSendWithEnterMobile = v; })}
							/>

							<!-- Confirm Deletions -->
							<ToggleSwitch
								label="Confirm deletions"
								description="Show a confirmation dialog before deleting chats and messages."
								checked={localConfirmDeletions}
								onchange={() => toggleBoolSetting('confirmDeletions', () => localConfirmDeletions, (v) => { localConfirmDeletions = v; })}
							/>

							<!-- Show Reasoning -->
							<ToggleSwitch
								label="Auto-show reasoning"
								description="Automatically open the reasoning panel when model reasoning is available."
								checked={localShowReasoning}
								onchange={() => toggleBoolSetting('showReasoning', () => localShowReasoning, (v) => { localShowReasoning = v; })}
							/>

							<!-- Message Timestamps -->
							<div class="space-y-2">
								<span class="block text-sm font-medium">Message timestamps</span>
								<div class="flex gap-2">
									{#each [{ value: 'relative', label: 'Relative' }, { value: 'absolute', label: 'Absolute' }, { value: 'off', label: 'Off' }] as opt}
										<button
											onclick={async () => { localTimestamps = opt.value; await saveSetting('messageTimestamps', opt.value); }}
											class="flex-1 rounded-lg border px-3 py-1.5 text-sm {localTimestamps === opt.value ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-accent'}"
										>{opt.label}</button>
									{/each}
								</div>
								<p class="text-xs text-muted-foreground">
									{localTimestamps === 'relative' ? '"Today", "Yesterday", etc.' : localTimestamps === 'absolute' ? 'Shows exact date and time.' : 'Hides date separators.'}
								</p>
							</div>

							<!-- Auto-scroll Threshold -->
							<div class="space-y-2">
								<span class="block text-sm font-medium">Auto-scroll sensitivity</span>
								<div class="flex gap-2">
									{#each [{ value: 'tight', label: 'Tight' }, { value: 'normal', label: 'Normal' }, { value: 'relaxed', label: 'Relaxed' }] as opt}
										<button
											onclick={async () => { localAutoScroll = opt.value; await saveSetting('autoScrollThreshold', opt.value); }}
											class="flex-1 rounded-lg border px-3 py-1.5 text-sm {localAutoScroll === opt.value ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-accent'}"
										>{opt.label}</button>
									{/each}
								</div>
								<p class="text-xs text-muted-foreground">How close to the bottom you need to be for new messages to auto-scroll into view.</p>
							</div>

							<!-- Chat Page Size -->
							<div class="space-y-2">
								<span class="block text-sm font-medium">Messages per page</span>
								<div class="flex gap-2">
									{#each [{ value: '25', label: '25' }, { value: '50', label: '50' }, { value: '100', label: '100' }, { value: '200', label: '200' }, { value: '0', label: 'All' }] as opt}
										<button
											onclick={async () => { localChatPageSize = Number(opt.value); await saveSetting('chatPageSize', opt.value); }}
											class="flex-1 rounded-lg border px-3 py-1.5 text-sm {String(localChatPageSize) === opt.value ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-accent'}"
										>{opt.label}</button>
									{/each}
								</div>
								<p class="text-xs text-muted-foreground">How many messages to load initially. Older messages can be loaded on demand by scrolling up.</p>
							</div>

						</div>

					{:else if activeTab === 'formatting'}
						<!-- Formatting Tab -->
						<div class="space-y-6">
							<div>
								<h3 class="text-base font-semibold">Formatting</h3>
								<p class="text-sm text-muted-foreground">How model output is rendered and transformed</p>
							</div>

							<!-- Text Rendering -->
							<div class="space-y-2">
								<span class="block text-sm font-medium">Text rendering</span>
								<div class="flex gap-2">
									{#each [{ value: 'roleplay', label: 'Roleplay' }, { value: 'markdown', label: 'Markdown' }] as opt}
										<button
											onclick={async () => { localRenderMode = opt.value; await saveSetting('renderMode', opt.value); }}
											class="flex-1 rounded-lg border px-3 py-1.5 text-sm {localRenderMode === opt.value ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-accent'}"
										>{opt.label}</button>
									{/each}
								</div>
								<p class="text-xs text-muted-foreground">Roleplay: *thoughts*, "speech", and plain narration. Markdown: full formatting with bold, italic, headings, lists, code blocks, etc. The AI will be told which formatting to use.</p>
							</div>

							<!-- Roleplay Formatting -->
							<div class="space-y-3 rounded-xl border border-border bg-background/40 p-4">
								<div>
									<span class="block text-sm font-medium">Roleplay formatting</span>
									<p class="text-xs text-muted-foreground">Tune how "speech", *thoughts*, [links], and plain narration appear inside chat bubbles.</p>
								</div>
								{#each [
									{ key: 'speech', label: 'Speech', sample: '"Hello there"', op: localSpeechOpacity, bold: localSpeechBold, italic: localSpeechItalic },
									{ key: 'thought', label: 'Thoughts', sample: '*A quiet thought*', op: localThoughtOpacity, bold: localThoughtBold, italic: localThoughtItalic },
									{ key: 'narration', label: 'Narration', sample: 'She walked across the room.', op: localNarrationOpacity, bold: localNarrationBold, italic: localNarrationItalic },
									{ key: 'link', label: 'Links', sample: '[a link](https://example.com)', op: localLinkOpacity, bold: localLinkBold, italic: localLinkItalic }
								] as row (row.key)}
									<div class="space-y-2 rounded-lg border border-border/60 bg-card px-3 py-3">
										<div class="flex items-center justify-between gap-3">
											<div class="min-w-0 flex-1">
												<span class="block text-sm font-medium">{row.label}</span>
												<span
													class="mt-0.5 block truncate text-xs text-muted-foreground"
													style="opacity: {row.op / 100}; font-weight: {row.bold ? 700 : 400}; font-style: {row.italic ? 'italic' : 'normal'};"
												>{row.sample}</span>
											</div>
											<div class="flex shrink-0 items-center gap-1.5">
												<button
													type="button"
													onclick={async () => {
														if (row.key === 'speech') { localSpeechBold = !localSpeechBold; await saveSetting('speechBold', localSpeechBold); }
														else if (row.key === 'thought') { localThoughtBold = !localThoughtBold; await saveSetting('thoughtBold', localThoughtBold); }
														else if (row.key === 'narration') { localNarrationBold = !localNarrationBold; await saveSetting('narrationBold', localNarrationBold); }
														else { localLinkBold = !localLinkBold; await saveSetting('linkBold', localLinkBold); }
													}}
													class="flex h-8 w-8 items-center justify-center rounded-md border text-sm font-bold transition-colors {row.bold ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent'}"
													title="Bold"
													aria-label="Bold"
													aria-pressed={row.bold}
												>B</button>
												<button
													type="button"
													onclick={async () => {
														if (row.key === 'speech') { localSpeechItalic = !localSpeechItalic; await saveSetting('speechItalic', localSpeechItalic); }
														else if (row.key === 'thought') { localThoughtItalic = !localThoughtItalic; await saveSetting('thoughtItalic', localThoughtItalic); }
														else if (row.key === 'narration') { localNarrationItalic = !localNarrationItalic; await saveSetting('narrationItalic', localNarrationItalic); }
														else { localLinkItalic = !localLinkItalic; await saveSetting('linkItalic', localLinkItalic); }
													}}
													class="flex h-8 w-8 items-center justify-center rounded-md border text-sm italic transition-colors {row.italic ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent'}"
													title="Italic"
													aria-label="Italic"
													aria-pressed={row.italic}
												>I</button>
											</div>
										</div>
										<div class="flex items-center gap-3">
											<span class="text-[11px] text-muted-foreground">Opacity</span>
											<input
												type="range"
												min="10"
												max="100"
												step="5"
												value={row.op}
												oninput={(e) => {
													const v = Number((e.target as HTMLInputElement).value);
													if (row.key === 'speech') localSpeechOpacity = v;
													else if (row.key === 'thought') localThoughtOpacity = v;
													else if (row.key === 'narration') localNarrationOpacity = v;
													else localLinkOpacity = v;
												}}
												onchange={async (e) => {
													const v = Number((e.target as HTMLInputElement).value);
													const k = row.key === 'speech' ? 'speechOpacity'
														: row.key === 'thought' ? 'thoughtOpacity'
														: row.key === 'narration' ? 'narrationOpacity'
														: 'linkOpacity';
													await saveSetting(k, v);
												}}
												class="flex-1 accent-primary"
											/>
											<span class="w-10 text-right text-[11px] tabular-nums text-muted-foreground">{row.op}%</span>
										</div>
									</div>
								{/each}

								<button
									type="button"
									onclick={() => toggleBoolSetting('nestedEmphasisInSpeech', () => localNestedEmphasis, (v) => { localNestedEmphasis = v; })}
									class="flex w-full items-center justify-between rounded-lg border border-border/60 bg-card px-3 py-2.5 text-left transition-colors hover:bg-accent/50"
								>
									<div class="min-w-0 flex-1">
										<span class="block text-sm font-medium">Nested emphasis in speech</span>
										<span class="block text-xs text-muted-foreground">Apply <em>thought</em> styling to <code class="rounded bg-muted px-1">*asterisks*</code> that appear inside <code class="rounded bg-muted px-1">"quotes"</code>.</span>
									</div>
									<div class="ml-3 h-5 w-9 shrink-0 rounded-full transition-colors {localNestedEmphasis ? 'bg-primary' : 'bg-muted'}">
										<div class="h-5 w-5 rounded-full border-2 bg-white transition-transform {localNestedEmphasis ? 'translate-x-4 border-primary' : 'translate-x-0 border-muted'}"></div>
									</div>
								</button>
							</div>

							<!-- Regex Scripts -->
							<div class="mt-8 border-t border-border pt-6">
								<div class="mb-4">
									<h3 class="text-base font-semibold">Regex Scripts</h3>
									<p class="text-sm text-muted-foreground">Find and replace patterns in messages.</p>
								</div>

							<!-- Script Form -->
							<div class="space-y-3 rounded-lg border border-border bg-card/50 p-4">
								<h4 class="text-sm font-medium">{editingRegex ? 'Edit Script' : 'New Script'}</h4>
								<div class="grid gap-3 sm:grid-cols-2">
									<div>
										<label for="regex-name" class="mb-1 block text-xs font-medium text-muted-foreground">Name</label>
										<input id="regex-name" bind:value={regexName} placeholder="Script name" class="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring" />
									</div>
									<div class="flex items-end gap-2">
										<label class="flex items-center gap-2 text-sm">
											<input type="checkbox" bind:checked={regexEnabled} class="accent-primary" />
											Enabled
										</label>
									</div>
								</div>
								<div>
									<label for="regex-find" class="mb-1 block text-xs font-medium text-muted-foreground">Find Regex <span class="text-muted-foreground/60">(e.g. /pattern/gi or plain text)</span></label>
									<input id="regex-find" bind:value={regexFind} placeholder="/pattern/flags or literal text" class="w-full rounded-md border border-input bg-background px-3 py-1.5 font-mono text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring" />
								</div>
								<div>
									<label for="regex-replace" class="mb-1 block text-xs font-medium text-muted-foreground">Replace With <span class="text-muted-foreground/60">($1, $2 for capture groups)</span></label>
									<input id="regex-replace" bind:value={regexReplace} placeholder="Replacement text" class="w-full rounded-md border border-input bg-background px-3 py-1.5 font-mono text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring" />
								</div>
								<div class="flex flex-wrap gap-4">
									<label class="flex items-center gap-2 text-sm">
										<input type="checkbox" bind:checked={regexUserInput} class="accent-primary" />
										User Input
									</label>
									<label class="flex items-center gap-2 text-sm">
										<input type="checkbox" bind:checked={regexAiResponse} class="accent-primary" />
										AI Response
									</label>
								</div>
								<div class="flex gap-2">
									<button onclick={saveRegexScript} class="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
										{editingRegex ? 'Update' : 'Add Script'}
									</button>
									{#if editingRegex}
										<button onclick={resetRegexForm} class="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent/50">
											Cancel
										</button>
									{/if}
								</div>
							</div>

							<!-- Script List -->
							{#if regexLoading}
								<p class="text-sm text-muted-foreground">Loading...</p>
							{:else if regexScripts.length === 0}
								<p class="text-sm text-muted-foreground">No regex scripts yet. Create one above.</p>
							{:else}
								<div class="space-y-2">
									{#each regexScripts as script (script.id)}
										<div class="flex items-center gap-3 rounded-lg border border-border p-3 {script.enabled ? '' : 'opacity-50'}">
											<button onclick={() => toggleRegexEnabled(script)} class="shrink-0" title={script.enabled ? 'Disable' : 'Enable'}>
												{#if script.enabled}
													<Check class="h-4 w-4 text-green-500" />
												{:else}
													<X class="h-4 w-4 text-muted-foreground" />
												{/if}
											</button>
											<div class="min-w-0 flex-1">
												<div class="flex items-center gap-2">
													<span class="text-sm font-medium {script.enabled ? '' : 'line-through'}">{script.name}</span>
													<span class="text-xs text-muted-foreground">
														{[script.affectUserInput && 'Input', script.affectAiResponse && 'Output'].filter(Boolean).join(', ')}
													</span>
												</div>
												<p class="truncate font-mono text-xs text-muted-foreground">{script.findRegex} → {script.replaceString || '(empty)'}</p>
											</div>
											<button onclick={() => startEditRegex(script)} class="shrink-0 rounded p-1 hover:bg-accent/50" title="Edit">
												<Pencil class="h-3.5 w-3.5" />
											</button>
											<button onclick={() => deleteRegexScript(script.id)} class="shrink-0 rounded p-1 text-destructive hover:bg-destructive/10" title="Delete">
												<Trash2 class="h-3.5 w-3.5" />
											</button>
										</div>
									{/each}
								</div>
							{/if}
						</div>
					</div>

					{:else if activeTab === 'appearance'}
						<!-- Appearance Tab -->
						<div class="space-y-6">
							<div>
								<h3 class="text-base font-semibold">Appearance</h3>
								<p class="text-sm text-muted-foreground">Customize the look and feel of Skald</p>
							</div>

							<!-- Character Themes -->
							<div class="space-y-3">
								<span class="block text-sm font-medium">Character Themes</span>
								<ToggleSwitch
									label="Always apply character themes"
									description="Skip the prompt when starting a new chat. Can still be overridden per-conversation."
									checked={alwaysThemes}
									onchange={toggleAlwaysThemes}
								/>
								<p class="text-xs text-muted-foreground">Theme colors are automatically derived from the character's avatar. Background images are provided by the character's creator. Themes can be disabled per-chat in chat settings.</p>
								<ToggleSwitch
									label="Color character cards"
									description="Tint character cards in the character list with their extracted theme colors."
									checked={localColorCards}
									onchange={() => toggleBoolSetting('colorCharacterCards', () => localColorCards, (v) => localColorCards = v)}
								/>
							</div>

							<!-- External Content -->
							<div class="space-y-3">
								<span class="block text-sm font-medium">External Content</span>
								<ToggleSwitch
									label="Load external content"
									description="Allow remote images, fonts, and other external resources to load. When disabled, only locally cached images are shown."
									checked={allowExternal}
									onchange={toggleAllowExternal}
								/>
								<p class="text-xs text-muted-foreground">Disabling this blocks all external requests — images in chats and creator notes will only display if they were cached by the server. Useful for privacy and for verifying image caching is working.</p>
							</div>

							<!-- Font Size -->
							<div class="space-y-2">
								<span class="block text-sm font-medium">Font size</span>
								<div class="flex gap-2">
									{#each [{ value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' }] as opt}
										<button
											onclick={async () => { localFontSize = opt.value; await saveSetting('fontSize', opt.value); }}
											class="flex-1 rounded-lg border px-3 py-1.5 text-sm {localFontSize === opt.value ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-accent'}"
										>{opt.label}</button>
									{/each}
								</div>
							</div>

							<!-- Compact Mode -->
							<ToggleSwitch
								label="Compact mode"
								description="Reduce spacing between messages for a denser layout."
								checked={localCompact}
								onchange={() => toggleBoolSetting('compactMode', () => localCompact, (v) => { localCompact = v; })}
							/>

							<!-- Reduce Motion -->
							<ToggleSwitch
								label="Reduce motion"
								description="Minimize animations and transitions. Streaming text appears all at once instead of token-by-token."
								checked={localReduceMotion}
								onchange={() => toggleBoolSetting('reduceMotion', () => localReduceMotion, (v) => { localReduceMotion = v; })}
							/>

							<!-- Theme Selection -->
							<div class="space-y-3">
								<!-- Color mode selector -->
								<div>
									<span class="mb-2 block text-sm font-medium">Color Mode</span>
									<div class="flex gap-1 rounded-xl border border-border p-1">
										<button
											onclick={() => saveColorMode('light')}
											class="flex-1 rounded-lg px-3 py-1.5 text-sm transition-colors {localColorMode === 'light' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}"
										>Light</button>
										<button
											onclick={() => saveColorMode('dark')}
											class="flex-1 rounded-lg px-3 py-1.5 text-sm transition-colors {localColorMode === 'dark' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}"
										>Dark</button>
										<button
											onclick={() => saveColorMode('system')}
											class="flex-1 rounded-lg px-3 py-1.5 text-sm transition-colors {localColorMode === 'system' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}"
										>System</button>
									</div>
									{#if localColorMode === 'system'}
										<p class="mt-1.5 text-xs text-muted-foreground">Follows your OS dark/light preference automatically.</p>
									{/if}
								</div>

								{#snippet themeSlot(slot: 'dark' | 'light', list: any[], selectedId: number | null | undefined, isOpen: boolean, setOpen: (v: boolean) => void)}
									{@const selected = list.find((t: any) => t.id === selectedId) ?? list[0] ?? null}
									{@const selectedColors = getThemeColors(selected)}
									{@const canDelete = !!selected && !selected.isBuiltin && list.length > 1}
									<div class="space-y-2">
										<span class="block text-xs font-medium uppercase tracking-wide text-muted-foreground">{slot === 'dark' ? 'Dark Theme' : 'Light Theme'}</span>
										<div class="flex gap-1">
											<!-- Custom dropdown -->
											<div class="relative min-w-0 flex-1">
												<button
													type="button"
													onclick={() => setOpen(!isOpen)}
													class="flex h-full w-full items-center gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:bg-accent/50 {isOpen ? 'ring-1 ring-primary/30' : ''}"
												>
													{#if selected}
														<div class="flex shrink-0 -space-x-1.5">
															<span class="h-6 w-6 rounded-full border-2 border-background" style="background-color: {selectedColors.background}"></span>
															<span class="h-6 w-6 rounded-full border-2 border-background" style="background-color: {selectedColors.primary}"></span>
															<span class="h-6 w-6 rounded-full border-2 border-background" style="background-color: {selectedColors.secondary}"></span>
															<span class="h-6 w-6 rounded-full border-2 border-background" style="background-color: {selectedColors.accent}"></span>
														</div>
														<div class="min-w-0 flex-1">
															<span class="block truncate text-sm font-medium">{selected.name}</span>
															<span class="block text-xs text-muted-foreground">{selected.isBuiltin ? 'Built-in' : 'Custom'}</span>
														</div>
													{:else}
														<span class="flex-1 text-sm text-muted-foreground">No theme</span>
													{/if}
													<svg class="h-4 w-4 shrink-0 text-muted-foreground transition-transform {isOpen ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
												</button>
												{#if isOpen}
													<button
														type="button"
														aria-label="Close dropdown"
														tabindex="-1"
														class="fixed inset-0 z-10 cursor-default"
														onclick={() => setOpen(false)}
													></button>
													<!-- Open upward: the slots sit near the bottom of the modal,
													     so opening down would clip past the modal's overflow. -->
													<div class="absolute bottom-[calc(100%+4px)] left-0 right-0 z-20 max-h-72 overflow-y-auto rounded-xl border border-border bg-popover shadow-lg">
														{#each list as theme (theme.id)}
															{@const colors = getThemeColors(theme)}
															{@const isSelected = theme.id === selected?.id}
															<button
																type="button"
																onclick={() => setSlotTheme(slot, theme.id)}
																class="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors {isSelected ? 'bg-primary/10' : 'hover:bg-accent'}"
															>
																<div class="flex shrink-0 -space-x-1.5">
																	<span class="h-5 w-5 rounded-full border-2 border-background" style="background-color: {colors.background}"></span>
																	<span class="h-5 w-5 rounded-full border-2 border-background" style="background-color: {colors.primary}"></span>
																	<span class="h-5 w-5 rounded-full border-2 border-background" style="background-color: {colors.secondary}"></span>
																	<span class="h-5 w-5 rounded-full border-2 border-background" style="background-color: {colors.accent}"></span>
																</div>
																<div class="min-w-0 flex-1">
																	<span class="block truncate text-sm">{theme.name}</span>
																	<span class="block text-xs text-muted-foreground">{theme.isBuiltin ? 'Built-in' : 'Custom'}</span>
																</div>
																{#if isSelected}
																	<Check class="h-4 w-4 shrink-0 text-primary" />
																{/if}
															</button>
														{/each}
														<button
															type="button"
															onclick={() => openCreate(slot)}
															class="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-sm text-primary transition-colors hover:bg-accent"
														>
															<Plus class="h-4 w-4" />
															New {slot} theme
														</button>
													</div>
												{/if}
											</div>
											<!-- Action buttons for the currently selected theme. self-stretch
											     keeps them the same height as the dropdown trigger. -->
											{#if selected}
												<button
													type="button"
													onclick={() => duplicateTheme(selected)}
													class="flex shrink-0 items-center justify-center rounded-xl border border-border px-3 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
													title="Duplicate theme"
												><Copy class="h-4 w-4" /></button>
												<button
													type="button"
													onclick={() => openEdit(selected)}
													class="flex shrink-0 items-center justify-center rounded-xl border border-border px-3 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
													title={selected.isBuiltin ? 'View colors' : 'Edit colors'}
												><Pencil class="h-4 w-4" /></button>
												{#if canDelete}
													<button
														type="button"
														onclick={() => deleteTheme(selected)}
														class="flex shrink-0 items-center justify-center rounded-xl border border-border px-3 text-muted-foreground transition-colors hover:bg-destructive/20 hover:text-destructive"
														title="Delete theme"
													><Trash2 class="h-4 w-4" /></button>
												{/if}
											{/if}
										</div>
									</div>
								{/snippet}

								<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
									{@render themeSlot('dark', darkThemes, settingsStore.systemDarkTheme?.id ?? settingsStore.settings.systemDarkThemeId, darkDropdownOpen, (v: boolean) => (darkDropdownOpen = v))}
									{@render themeSlot('light', lightThemes, settingsStore.systemLightTheme?.id ?? settingsStore.settings.systemLightThemeId, lightDropdownOpen, (v: boolean) => (lightDropdownOpen = v))}
								</div>

							</div>
						</div>

					{:else if activeTab === 'users'}
						<!-- Users Tab (Admin only) -->
						{#if isAdmin}
							<UserManagementPanel currentUserId={user?.id} />
						{/if}

				{:else if activeTab === 'account'}
						<!-- Account Tab -->
						<div class="space-y-6">
							<div>
								<h3 class="text-base font-semibold">Account</h3>
								<p class="text-sm text-muted-foreground">Manage your account settings</p>
							</div>

							<!-- Account info -->
							<div class="rounded-xl border border-border p-4">
								<div class="flex items-center gap-3">
									<div class="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-base font-semibold text-primary">
										{user?.username?.[0]?.toUpperCase() ?? '?'}
									</div>
									<div>
										<p class="font-medium">{user?.username}</p>
										<div class="flex items-center gap-2 text-xs text-muted-foreground">
											<span class="capitalize">{user?.role}</span>
										</div>
									</div>
								</div>
							</div>

							<SignedInDevices />

							<DataExportImport activeChatId={activeChatId ?? null} {onchatimported} />
						</div>

				{:else if activeTab === 'notifications'}
						<!-- Notifications Tab -->
						<div class="space-y-6">
							<div>
								<h3 class="text-base font-semibold">Notifications</h3>
								<p class="text-sm text-muted-foreground">Manage notification preferences</p>
							</div>

							{#if !isSecureCtx}
								<div class="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 space-y-1">
									<p class="text-sm font-medium text-amber-500">Notifications require HTTPS</p>
									<p class="text-xs text-muted-foreground">Web Push uses VAPID, which browsers only allow on secure origins (HTTPS or <code>localhost</code>). Reach Skald over HTTPS to enable notifications.</p>
								</div>
								<button
									type="button"
									disabled
									aria-disabled="true"
									title="HTTPS required for notifications"
									class="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground opacity-50 cursor-not-allowed"
								>
									<Bell class="h-4 w-4" />
									Enable Notifications
								</button>
							{:else if notifPermission === 'unsupported'}
								<div class="rounded-lg border border-border px-4 py-3">
									<p class="text-sm text-muted-foreground">Notifications are not supported in this browser.</p>
								</div>
							{:else if notifPermission === 'granted'}
								<div class="flex items-center gap-2 rounded-lg border border-green-500/20 bg-green-500/5 px-4 py-3 text-sm text-green-500">
									<Bell class="h-4 w-4" />
									<span>Notifications enabled</span>
								</div>
								<p class="text-sm text-muted-foreground">You'll receive alerts when background responses complete.</p>
							{:else}
								<button
									onclick={requestNotifPermission}
									class="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
								>
									<Bell class="h-4 w-4" />
									Enable Notifications
								</button>
								<p class="text-sm text-muted-foreground">Get alerts when background responses complete.</p>
								{#if notifStatus}
									<p class="text-xs text-amber-500">{notifStatus}</p>
								{/if}
							{/if}

							<!-- Notification content -->
							<div class="space-y-2 {!isSecureCtx ? 'pointer-events-none opacity-50' : ''}" aria-disabled={!isSecureCtx}>
								<span class="block text-sm font-medium">Notification content</span>
								<span class="block text-xs text-muted-foreground">What to show in the notification body.</span>
								<div class="flex gap-2 flex-wrap">
									{#each [{ value: 'generic', label: 'Generic' }, { value: 'preview', label: 'Message preview' }] as opt}
										<button
											class="rounded-lg border px-3 py-1.5 text-sm transition-colors {localNotifStyle === opt.value ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent'}"
											onclick={async () => { localNotifStyle = opt.value; await saveSetting('notificationStyle', opt.value); }}
										>
											{opt.label}
										</button>
									{/each}
								</div>
							</div>

							<div class="{!isSecureCtx ? 'pointer-events-none opacity-50 space-y-3' : 'space-y-3'}" aria-disabled={!isSecureCtx}>
								<!-- Notification Sound -->
								<ToggleSwitch
									label="Notification sound"
									description="Play a sound when a background response completes."
									checked={localNotifSound}
									onchange={() => toggleBoolSetting('notificationSound', () => localNotifSound, (v) => { localNotifSound = v; })}
								/>

								<!-- Character avatar in notifications -->
								<ToggleSwitch
									label="Show character avatar"
									description="Use the character's avatar as the notification icon. Not supported on Safari or iOS."
									checked={localNotifAvatar}
									onchange={() => toggleBoolSetting('notificationAvatar', () => localNotifAvatar, (v) => { localNotifAvatar = v; })}
								/>

								<!-- In-app notifications -->
								<ToggleSwitch
									label="In-app notifications"
									description="Show a brief toast when a message arrives for a different chat while you're using the app."
									checked={localInAppNotif}
									onchange={() => toggleBoolSetting('inAppNotifications', () => localInAppNotif, (v) => { localInAppNotif = v; })}
								/>
								<!-- Silence this device (per-device, local-only) -->
								<button
									type="button"
									onclick={toggleDeviceSilent}
									class="flex w-full items-center justify-between rounded-lg border border-border px-4 py-3 text-left transition-colors hover:bg-accent/50"
								>
									<div>
										<span class="block text-sm font-medium">Silence this device</span>
										<span class="block text-xs text-muted-foreground">Mute toast, sound, and OS notifications on <em>this</em> device only. Other devices unaffected.</span>
									</div>
									<div class="ml-3 h-5 w-9 shrink-0 rounded-full transition-colors {localDeviceSilent ? 'bg-primary' : 'bg-muted'}">
										<div class="h-5 w-5 rounded-full border-2 bg-white transition-transform {localDeviceSilent ? 'translate-x-4 border-primary' : 'translate-x-0 border-muted'}"></div>
									</div>
								</button>

								<!-- Quiet hours -->
								<div class="rounded-lg border border-border">
									<ToggleSwitch
										label="Quiet hours"
										description="Suppress all notifications (push + in-app) during this window."
										checked={localQuietEnabled}
										onchange={() => toggleBoolSetting('quietHoursEnabled', () => localQuietEnabled, (v) => { localQuietEnabled = v; })}
									/>
									{#if localQuietEnabled}
										<div
											class="flex items-center gap-3 border-t border-border px-4 py-3"
											transition:slide={{ duration: localReduceMotion ? 0 : 200, easing: quintOut, axis: 'y' }}
										>
											<label class="flex items-center gap-2 text-sm">
												<span class="text-muted-foreground">From</span>
												<input
													type="time"
													bind:value={localQuietStart}
													onchange={() => saveSetting('quietHoursStart', localQuietStart)}
													class="rounded-md border border-border bg-background px-2 py-1 text-sm"
												/>
											</label>
											<label class="flex items-center gap-2 text-sm">
												<span class="text-muted-foreground">to</span>
												<input
													type="time"
													bind:value={localQuietEnd}
													onchange={() => saveSetting('quietHoursEnd', localQuietEnd)}
													class="rounded-md border border-border bg-background px-2 py-1 text-sm"
												/>
											</label>
										</div>
									{/if}
								</div>
							</div>

							<!-- Web Push Notifications -->
							{#if notifPermission === 'granted' && 'PushManager' in globalThis}
								<div class="space-y-2">
									<span class="block text-sm font-medium">Background push notifications</span>
									<span class="block text-xs text-muted-foreground">Receive notifications even when Skald isn't open. Works on mobile and desktop.</span>
									{#if pushSubscribed}
										<div class="flex items-center gap-3">
											<div class="flex items-center gap-2 text-sm text-green-500">
												<Bell class="h-4 w-4" />
												<span>Push active on this device</span>
											</div>
											<button
												onclick={unsubscribeFromPush}
												disabled={pushLoading}
												class="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50"
											>
												{pushLoading ? 'Working...' : 'Disable'}
											</button>
										</div>
										<button
											onclick={testPush}
											disabled={pushLoading}
											class="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50"
										>
											Send test notification
										</button>
									{:else}
										<button
											onclick={subscribeToPush}
											disabled={pushLoading}
											class="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
										>
											<Bell class="h-4 w-4" />
											{pushLoading ? 'Setting up...' : 'Enable push for this device'}
										</button>
									{/if}
									{#if pushStatus}
										<p class="text-xs text-amber-500">{pushStatus}</p>
									{/if}
								</div>
							{/if}
						</div>

					{:else if activeTab === 'instance'}
						<!-- Instance Tab (Admin only) -->
						{#if isAdmin}
						<div class="space-y-6">
							<div>
								<h3 class="text-base font-semibold">Instance Settings</h3>
								<p class="text-sm text-muted-foreground">Server-wide settings that apply to all users</p>
							</div>

							{#if instanceLoading}
								<div class="flex justify-center py-8">
									<div class="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
								</div>
							{:else}
								<!-- Session Duration -->
								<div class="space-y-2">
									<span class="block text-sm font-medium">Session duration</span>
									<div class="flex gap-2">
										{#each [{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }, { value: '365', label: '1 year' }] as opt}
											<button
												onclick={() => saveInstanceSetting('sessionDurationDays', opt.value)}
												class="flex-1 rounded-lg border px-3 py-1.5 text-sm {String(instanceSettings.sessionDurationDays ?? '30') === opt.value ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-accent'}"
											>{opt.label}</button>
										{/each}
									</div>
									<p class="text-xs text-muted-foreground">How long until users need to log in again. Applies to new sessions only.</p>
								</div>

								<!-- Rate Limits -->
								<div class="space-y-3 rounded-xl border border-border p-4">
									<div>
										<h4 class="text-sm font-semibold">Rate limits</h4>
										<p class="text-xs text-muted-foreground">Per-user requests allowed per minute on expensive endpoints.</p>
									</div>
									{#each [
										{ key: 'chatRateLimit', label: 'Chat send / stream', def: '30' },
										{ key: 'characterImportRateLimit', label: 'Character import', def: '10' },
										{ key: 'lorebookImportRateLimit', label: 'Lorebook import', def: '10' },
										{ key: 'chubBrowseRateLimit', label: 'CHUB browse / import (per user)', def: '30' },
										{ key: 'chubGlobalRateLimit', label: 'CHUB outbound (server-wide)', def: '120' },
										{ key: 'reformatRateLimit', label: 'Greeting reformat', def: '20' }
									] as item}
										<div class="flex items-center gap-3">
											<label for="rl-{item.key}" class="flex-1 text-sm">{item.label}</label>
											<input
												id="rl-{item.key}"
												type="number"
												min="1"
												max="1000"
												value={instanceSettings[item.key] ?? item.def}
												oninput={(e) => { const v = (e.target as HTMLInputElement).value; instanceSettings = { ...instanceSettings, [item.key]: v }; }}
												onchange={(e) => { const v = (e.target as HTMLInputElement).value; const n = Number(v); if (Number.isFinite(n) && n >= 1 && n <= 1000) saveInstanceSetting(item.key, String(n)); }}
												class="w-24 rounded-lg border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
											/>
											<span class="w-12 text-xs text-muted-foreground">/min</span>
										</div>
									{/each}
								</div>

								<!-- Upload Size Caps -->
								<div class="space-y-3 rounded-xl border border-border p-4">
									<div>
										<h4 class="text-sm font-semibold">Upload size limits</h4>
										<p class="text-xs text-muted-foreground">Maximum file sizes for character and lorebook imports (MiB).</p>
									</div>
									{#each [
										{ key: 'characterImportMaxMiB', label: 'Character PNG max size', def: '8' },
										{ key: 'lorebookImportMaxMiB', label: 'Lorebook JSON max size', def: '4' },
										{ key: 'avatarUploadMaxMiB', label: 'Avatar upload max size', def: '8' }
									] as item}
										<div class="flex items-center gap-3">
											<label for="sz-{item.key}" class="flex-1 text-sm">{item.label}</label>
											<input
												id="sz-{item.key}"
												type="number"
												min="1"
												max="256"
												value={instanceSettings[item.key] ?? item.def}
												oninput={(e) => { const v = (e.target as HTMLInputElement).value; instanceSettings = { ...instanceSettings, [item.key]: v }; }}
												onchange={(e) => { const v = (e.target as HTMLInputElement).value; const n = Number(v); if (Number.isFinite(n) && n >= 1 && n <= 256) saveInstanceSetting(item.key, String(n)); }}
												class="w-24 rounded-lg border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
											/>
											<span class="w-12 text-xs text-muted-foreground">MiB</span>
										</div>
									{/each}
								</div>

								<!-- Per-user resource quotas -->
								<div class="space-y-3 rounded-xl border border-border p-4">
									<div>
										<h4 class="text-sm font-semibold">Per-user quotas</h4>
										<p class="text-xs text-muted-foreground">Whichever ceiling is reached first blocks new creates and imports. <span class="font-medium">0 = unlimited</span>.</p>
									</div>
									{#each [
										{ resource: 'Characters', countKey: 'maxCharactersPerUser', sizeKey: 'maxCharactersTotalMiB' },
										{ resource: 'Chats', countKey: 'maxChatsPerUser', sizeKey: 'maxChatsTotalMiB' },
										{ resource: 'Lorebooks', countKey: 'maxLorebooksPerUser', sizeKey: 'maxLorebooksTotalMiB' }
									] as quota}
										<div class="space-y-2">
											<p class="text-sm font-medium">{quota.resource}</p>
											<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
												<div class="flex items-center gap-2">
													<label for="q-{quota.countKey}" class="flex-1 text-xs text-muted-foreground">Max count</label>
													<input
														id="q-{quota.countKey}"
														type="number"
														min="0"
														max="1000000"
														value={instanceSettings[quota.countKey] ?? '0'}
														oninput={(e) => { const v = (e.target as HTMLInputElement).value; instanceSettings = { ...instanceSettings, [quota.countKey]: v }; }}
														onchange={(e) => { const v = (e.target as HTMLInputElement).value; const n = Number(v); if (Number.isFinite(n) && n >= 0 && n <= 1_000_000) saveInstanceSetting(quota.countKey, String(Math.floor(n))); }}
														class="w-24 rounded-lg border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
													/>
												</div>
												<div class="flex items-center gap-2">
													<label for="q-{quota.sizeKey}" class="flex-1 text-xs text-muted-foreground">Max total size</label>
													<input
														id="q-{quota.sizeKey}"
														type="number"
														min="0"
														max="1000000"
														value={instanceSettings[quota.sizeKey] ?? '0'}
														oninput={(e) => { const v = (e.target as HTMLInputElement).value; instanceSettings = { ...instanceSettings, [quota.sizeKey]: v }; }}
														onchange={(e) => { const v = (e.target as HTMLInputElement).value; const n = Number(v); if (Number.isFinite(n) && n >= 0 && n <= 1_000_000) saveInstanceSetting(quota.sizeKey, String(Math.floor(n))); }}
														class="w-24 rounded-lg border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
													/>
													<span class="w-12 text-xs text-muted-foreground">MiB</span>
												</div>
											</div>
										</div>
									{/each}
								</div>

								<!-- Allow Character Import -->
								<ToggleSwitch
									label="Allow character import"
									description="Users can import character cards (PNG/JSON)."
									checked={(instanceSettings.allowCharacterImport ?? 'true') === 'true'}
									onchange={() => saveInstanceSetting('allowCharacterImport', (instanceSettings.allowCharacterImport ?? 'true') === 'true' ? 'false' : 'true')}
								/>

								<!-- Allow Character Export -->
								<ToggleSwitch
									label="Allow character export"
									description="Users can export character cards from the app."
									checked={(instanceSettings.allowCharacterExport ?? 'true') === 'true'}
									onchange={() => saveInstanceSetting('allowCharacterExport', (instanceSettings.allowCharacterExport ?? 'true') === 'true' ? 'false' : 'true')}
								/>

								<!-- Image Cache -->
								<div class="rounded-lg border border-border px-4 py-3 space-y-3">
									<div>
										<span class="block text-sm font-medium">Image cache</span>
										<span class="block text-xs text-muted-foreground">
											{#if cacheStatsLoading && !cacheStats}
												Loading…
											{:else if cacheStats}
												{cacheStats.fileCount} file{cacheStats.fileCount === 1 ? '' : 's'} · {formatBytes(cacheStats.totalBytes)}
											{:else}
												—
											{/if}
										</span>
									</div>
									<button
										type="button"
										onclick={() => (showClearCacheConfirm = true)}
										disabled={clearingCache || !cacheStats || cacheStats.fileCount === 0}
										class="rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
									>
										{clearingCache ? 'Clearing…' : 'Clear cache'}
									</button>
								</div>

								<!-- Disable Image Caching -->
								<ToggleSwitch
									label="Disable image caching"
									description="Serve remote images directly instead of caching them locally."
									checked={(instanceSettings.disableImageCaching ?? 'false') === 'true'}
									onchange={toggleImageCaching}
								/>
							{/if}
						</div>
						{/if}
					{/if}

					{#if activeTab === 'about'}
						<AboutTab />
					{/if}
					</div>
					{/key}
{/snippet}

{#if mode === 'embedded' && open}
	<!-- Embedded content-only mode (desktop: parent handles nav in sidebar card) -->
	<div class="flex min-h-0 flex-1 flex-col overflow-hidden md:rounded-2xl md:bg-background">
		<div class="flex-1 overflow-y-auto p-6">
			{@render settingsTabContent()}
		</div>
	</div>
{:else if mode === 'page' && open}
	<!-- Page mode: content only (mobile) — tab selection handled by drawer -->
	<div class="flex h-full flex-col overflow-hidden bg-background">
		<div class="flex-1 overflow-y-auto p-4">
			{@render settingsTabContent()}
		</div>
	</div>
{:else if modal.visible}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4 bg-black/60 {modal.closing ? 'backdrop-exit' : 'backdrop-enter'}"
		role="dialog" aria-modal="true" aria-label="Settings" tabindex="-1"
		onkeydown={(e) => e.key === 'Escape' && onclose()}
	>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div class="absolute inset-0" onclick={onclose}></div>
		<div
			class="{modal.closing ? 'modal-exit' : 'modal-enter'} relative z-10 flex h-full max-h-[85vh] w-full max-w-4xl flex-col rounded-t-2xl border border-border bg-card shadow-xl sm:rounded-xl sm:h-auto"
			style={gestures.panelStyle}
			ontouchstart={gestures.handlers.onTouchStart}
			ontouchmove={gestures.handlers.onTouchMove}
			ontouchend={gestures.handlers.onTouchEnd}
		>
			<!-- Header -->
			<div class="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6 sm:py-4">
				<h2 class="text-lg font-semibold">Settings</h2>
				<button
					onclick={onclose}
					class="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent"
				>
					<X class="h-4 w-4" />
				</button>
			</div>

			<!-- Tabbed body -->
			<!-- Mobile tab bar -->
			<div class="flex overflow-x-auto border-b border-border sm:hidden">
				{#each tabs as tab (tab.id)}
					<button
						onclick={() => { internalActiveTab = tab.id; }}
						title={tab.label}
						class="flex shrink-0 flex-1 items-center justify-center gap-1.5 px-2 py-2.5 text-xs font-medium transition-colors {activeTab === tab.id
							? 'border-b-2 border-primary text-primary'
							: 'text-muted-foreground'}"
					>
						<tab.icon class="h-4 w-4" />
					</button>
				{/each}
			</div>

			<div class="relative flex flex-1 overflow-hidden">
				<!-- Tab sidebar (desktop only) -->
				<nav class="hidden sm:flex flex-col gap-1 border-r border-border bg-background/50 p-3 w-48 shrink-0">
					{@render settingsTabNav()}
				</nav>

				<!-- Tab content -->
				<div class="flex-1 overflow-y-auto p-4 sm:p-6 {gestures.contentClass}" style={gestures.contentStyle}>
					{@render settingsTabContent()}
				</div>
			</div>
		</div>
	</div>
{/if}

<ConfirmModal
	open={showClearCacheConfirm}
	title="Clear image cache"
	message="Delete all cached images? Remote images will need to be re-downloaded the next time they're accessed."
	confirmLabel="Clear cache"
	onconfirm={clearCache}
	oncancel={() => (showClearCacheConfirm = false)}
/>

<ConfirmModal
	open={showDisableCacheConfirm}
	title="Disable image caching"
	message="Disable image caching for this instance? Would you also like to delete the existing cached images?"
	confirmLabel="Disable & clear cache"
	secondaryLabel="Disable only"
	onconfirm={() => confirmDisableCaching(true)}
	onsecondary={() => confirmDisableCaching(false)}
	oncancel={() => (showDisableCacheConfirm = false)}
/>

<ThemeEditModal
	open={themeEditOpen}
	mode={themeEditMode}
	theme={themeEditTarget}
	initialMode={themeEditInitialMode}
	onclose={() => { themeEditOpen = false; pendingCreateSlot = null; }}
	oncreated={onThemeCreated}
/>
