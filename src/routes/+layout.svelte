<script lang="ts">
	import '../app.css';
	import { chatsStore } from '$lib/stores/chats.svelte.js';
	import { charactersStore } from '$lib/stores/characters.svelte.js';
	import { providersStore } from '$lib/stores/providers.svelte.js';
	import { lorebooksStore } from '$lib/stores/lorebooks.svelte.js';
	import { personasStore } from '$lib/stores/personas.svelte.js';
	import { themesStore } from '$lib/stores/themes.svelte.js';
	import { settingsStore } from '$lib/stores/settings.svelte.js';
	import { generationsStore } from '$lib/stores/generations.svelte.js';
	import { haptic } from '$lib/utils/haptics.js';
	import { renderRoleplayPreview } from '$lib/utils/rp-format.js';
	import { staggerOnMount } from '$lib/utils/staggerOnMount';
	import { layoutTransitionState } from '$lib/utils/layoutTransition';
	import { applyRealtimeEvent } from '$lib/realtime/client.js';
	import { applyTheme } from '$lib/theme/apply.js';
	import { createOidcPopup } from '$lib/auth/oidcPopup.svelte.js';
	import { api } from '$lib/api.js';
	import LoginForm from '$lib/components/LoginForm.svelte';
	import { createChatReorder } from '$lib/ui/chatReorder.svelte.js';
	import { createChatMenu } from '$lib/ui/chatMenu.svelte.js';
	import { createMobileSidebarGestures } from '$lib/ui/mobileSidebarGestures.svelte.js';
	import { createRealtimeConnection } from '$lib/realtime/connection.svelte.js';
	import { createNotificationPermission } from '$lib/services/notificationPermission.svelte.js';
	import {
		Users,
		BookOpen,
		Settings,
		SquarePen,
		Plus,
		MessageSquare,
		Smartphone,
		Trash2,
		Search,
		User,
		Pin,
		PinOff,
		Menu,
		Bell,
		BellOff,
		X,
		ChevronLeft,
		LogOut,
		Shield,
		Pencil,
		ArrowUp,
		ArrowDown,
		Server,
		Palette,
		Settings2,
		Info,
		WifiOff,
		Sparkles,
		Type,
	} from 'lucide-svelte';
	import ImageModal from '$lib/components/ImageModal.svelte';
	import ConfirmModal from '$lib/components/ConfirmModal.svelte';
	import DialogHost from '$lib/components/DialogHost.svelte';
	import { confirm as confirmDialog } from '$lib/dialog.svelte.js';
	import { tooltip } from '$lib/tooltip.js';
	import ChatView from '$lib/components/ChatView.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import { toasts } from '$lib/stores/toast.svelte.js';

	import { tick, untrack, onMount } from 'svelte';
	import { slide } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { quintOut } from 'svelte/easing';
	import { browser } from '$app/environment';
	import { invalidateAll } from '$app/navigation';

	let { children, data } = $props();

	// Extract initial values from props (intentionally non-reactive)
	const initCollapsed = untrack(() => data.sidebarCollapsed ?? false);
	const initWidth = untrack(() => data.sidebarWidth ?? 320);
	const initMobile = browser ? window.matchMedia('(max-width: 767px)').matches : false;

	let sidebarCollapsed = $state(initCollapsed);
	let sidebarWidth = $state(initWidth);
	// Narrow desktop (768-1023px): sidebar auto-collapses and shows as an
	// overlay on top of content rather than as a column. Transient — does NOT
	// persist to settings; user's saved sidebarCollapsed survives.
	let narrowDesktop = $state(false);
	let sidebarOverlay = $state(false);
	const displayCollapsed = $derived(narrowDesktop ? !sidebarOverlay : sidebarCollapsed);
	let isResizing = $state(false);
	let searchQuery = $state('');
	let debouncedSearch = $state('');
	let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	let isMobile = $state(initMobile);
	let hydrated = $state(false);

	// Briefly disables CSS keyframes / SvelteKit transitions whenever the
	// viewport crosses a layout breakpoint, so panels resize smoothly
	// instead of replaying entrance animations as components mount/unmount.
	let layoutTransitionTimer: ReturnType<typeof setTimeout> | null = null;
	let layoutTransitioning = $state(false);
	function flashLayoutTransition() {
		if (typeof document === 'undefined') return;
		document.documentElement.classList.add('layout-transitioning');
		layoutTransitioning = true;
		layoutTransitionState.set(true);
		if (layoutTransitionTimer) clearTimeout(layoutTransitionTimer);
		layoutTransitionTimer = setTimeout(() => {
			document.documentElement.classList.remove('layout-transitioning');
			layoutTransitioning = false;
			layoutTransitionState.set(false);
			layoutTransitionTimer = null;
		}, 700);
	}
	let dragImportActive = $state(false);
	let dragImportTarget = $state<'characters' | 'lorebooks' | null>(null);
	let dragDepth = 0;

	type PersistedPanel = 'chat' | 'settings' | 'lorebooks' | 'characters' | 'personas';
	type PersistedMobileTab = 'chats' | 'characters' | 'lorebooks' | 'personas' | 'settings';
	type PersistedSettingsTab = 'providers' | 'prompts' | 'formatting' | 'appearance' | 'chat' | 'notifications' | 'account' | 'about' | 'instance' | 'users';

	const initialUiState = (() => {
		const fallback = {
			panel: 'chat' as PersistedPanel,
			mobileDrawerTab: 'chats' as PersistedMobileTab,
			settingsTab: 'providers' as PersistedSettingsTab,
			selectedCharacterId: null as number | null,
			selectedLorebookId: null as number | null,
			selectedPersonaId: null as number | null,
			characterEditMode: false
		};
		if (!browser) return fallback;
		try {
			const raw = localStorage.getItem('skald-last-page-state');
			if (!raw) return fallback;
			const parsed = JSON.parse(raw);
			return {
				panel: (parsed.panel ?? fallback.panel) as PersistedPanel,
				mobileDrawerTab: (parsed.mobileDrawerTab ?? fallback.mobileDrawerTab) as PersistedMobileTab,
				settingsTab: (parsed.settingsTab ?? fallback.settingsTab) as PersistedSettingsTab,
				selectedCharacterId: typeof parsed.selectedCharacterId === 'number' ? parsed.selectedCharacterId : null,
				selectedLorebookId: typeof parsed.selectedLorebookId === 'number' ? parsed.selectedLorebookId : null,
				selectedPersonaId: typeof parsed.selectedPersonaId === 'number' ? parsed.selectedPersonaId : null,
				characterEditMode: parsed.characterEditMode === true
			};
		} catch {
			return fallback;
		}
	})();

	// SPA state: which chat is active (restore from URL param, then localStorage).
	// We trust the hint optimistically; loadChat() handles 404 by clearing it.
	const initialChatId = (() => {
		if (!browser) return null;
		// Check URL ?chat= param (from notification click opening a new window)
		const urlChat = new URLSearchParams(window.location.search).get('chat');
		if (urlChat) {
			const id = Number(urlChat);
			if (id) {
				// Clean the URL param
				const clean = new URL(window.location.href);
				clean.searchParams.delete('chat');
				window.history.replaceState({}, '', clean.pathname + clean.search || '/');
				return id;
			}
		}
		const stored = localStorage.getItem('skald-last-chat');
		if (!stored) return null;
		const id = Number(stored);
		return id || null;
	})();
	let activeChatId: number | null = $state(initialChatId);

	// Becomes true once the initial sidebar paint settles. Used to gate the
	// chat-list intro transition so the first render doesn't slide every
	// item in (the existing chat-item-stagger CSS handles initial reveal);
	// only adds/removes after mount get the slide/flip animation.
	let chatListReady = $state(false);
	onMount(() => {
		chatListReady = true;
	});

	// Bfcache + PWA relaunch: macOS Safari Web Apps restore stale JS state on
	// relaunch, often without firing pageshow.persisted=true or even
	// visibilitychange (the window can already be 'visible' when the PWA
	// resumes from a suspended snapshot). So we hit it from every angle:
	// pageshow (any), visibilitychange, focus, and a one-shot check on mount
	// that re-validates if the restored snapshot shows no user but a cookie
	// might exist.
	onMount(() => {
		const refresh = () => invalidateAll();
		const onShow = () => refresh();
		const onVisible = () => {
			if (document.visibilityState === 'visible') refresh();
		};
		window.addEventListener('pageshow', onShow);
		window.addEventListener('focus', refresh);
		document.addEventListener('visibilitychange', onVisible);
		// On bfcache restore the snapshot may show !user even though the cookie
		// is still valid. Force one fresh load so we don't strand the user on
		// the login form.
		if (!data.user) refresh();
		return () => {
			window.removeEventListener('pageshow', onShow);
			window.removeEventListener('focus', refresh);
			document.removeEventListener('visibilitychange', onVisible);
		};
	});

	// Long-background recovery: if the tab was hidden for > 60s, the SSE
	// stream has likely gone stale (mobile browsers freeze sockets) and the
	// active chat may have drifted. Re-fetch the visible chat data and let
	// connection.svelte.ts handle the SSE reconnect on its own visibility
	// listener. Also drains any "while you were away" toast queue.
	const STALE_THRESHOLD_MS = 60_000;
	let hiddenSince: number | null = null;
	let pendingAwayToasts: { chatId: number; characterName: string; characterAvatar: string | null; preview: string }[] = [];
	function flushAwayToasts() {
		if (pendingAwayToasts.length === 0) return;
		const toShow = pendingAwayToasts;
		pendingAwayToasts = [];
		for (const t of toShow) {
			// Suppress if the user is now actively viewing this chat —
			// they don't need a "you missed something" pop-up for the
			// thread already on screen.
			if (t.chatId === activeChatId) continue;
			addChatNotification(t.chatId, t.characterName, t.characterAvatar, t.preview);
		}
	}
	onMount(() => {
		const handler = () => {
			if (document.hidden) {
				hiddenSince = Date.now();
				return;
			}
			const elapsed = hiddenSince ? Date.now() - hiddenSince : 0;
			hiddenSince = null;
			flushAwayToasts();
			if (elapsed > STALE_THRESHOLD_MS && activeChatId) {
				loadChat(activeChatId);
			}
		};
		document.addEventListener('visibilitychange', handler);
		return () => document.removeEventListener('visibilitychange', handler);
	});

	// Hydrate the chats store from SSR data so the sidebar paints instantly.
	// After this, the store is the single source of truth — every chat
	// mutation goes through chatsStore.{add,update,remove} and we never
	// invalidateAll() to refresh the sidebar.
	//
	// Phase 1.1: layout.server.ts no longer ships these lists in SSR. The
	// stores lazy-load on mount via $effect below. SSR paint shows an empty
	// sidebar; the first GET fills it within a single round trip.
	const sidebarChats = $derived(
		chatsStore.searchQuery ? chatsStore.searchResults : chatsStore.chats
	);
	const sidebarCharacters = $derived(charactersStore.characters);
	const sidebarProviders = $derived(providersStore.providers);
	const sidebarLorebooks = $derived(lorebooksStore.lorebooks);
	const sidebarPersonas = $derived(personasStore.personas);
	const sidebarThemes = $derived(themesStore.themes);

	// Hydrate the global settings store (keys + active theme). This stays
	// in SSR so html attributes (data-font-size etc.) and root CSS variables
	// are correct on first paint.
	settingsStore.hydrate(
		untrack(() => ({
			colorMode: data.colorMode,
			alwaysUseCharacterThemes: data.alwaysUseCharacterThemes,
			allowExternalCreatorNotes: data.allowExternalCreatorNotes,
			colorCharacterCards: data.colorCharacterCards ?? false,
			sidebarWidth: data.sidebarWidth ?? 320,
			sidebarCollapsed: data.sidebarCollapsed ?? false,
			fontSize: data.fontSize ?? 'medium',
			compactMode: data.compactMode ?? false,
			reduceMotion: data.reduceMotion ?? false,
			sendWithEnterDesktop: data.sendWithEnterDesktop ?? true,
			sendWithEnterMobile: data.sendWithEnterMobile ?? true,
			autoScrollThreshold: data.autoScrollThreshold ?? 'normal',
			confirmDeletions: data.confirmDeletions ?? true,
			messageTimestamps: data.messageTimestamps ?? 'relative',
			showReasoning: data.showReasoning ?? false,
			chatPageSize: data.chatPageSize ?? 50,
			notificationSound: data.notificationSound ?? false,
			notificationStyle: data.notificationStyle ?? 'generic',
			notificationAvatar: data.notificationAvatar ?? true,
			inAppNotifications: data.inAppNotifications ?? true,
			notificationDuration: (data as any).notificationDuration ?? 5,
			quietHoursEnabled: data.quietHoursEnabled ?? false,
			quietHoursStart: data.quietHoursStart ?? '22:00',
			quietHoursEnd: data.quietHoursEnd ?? '07:00',
			userTimezone: (data as any).userTimezone ?? '',
			renderMode: data.renderMode ?? 'roleplay',
			promptSlotOrder: data.promptSlotOrder ?? '',
			reformatterProviderId: data.reformatterProviderId ?? '',
			reformatterModel: data.reformatterModel ?? '',
			reformatterPrompt: data.reformatterPrompt ?? '',
			characterCreatorProviderId: (data as any).characterCreatorProviderId ?? '',
			characterCreatorModel: (data as any).characterCreatorModel ?? '',
			characterCreatorPrompt: (data as any).characterCreatorPrompt ?? '',
			compactionEnabled: (data as any).compactionEnabled ?? false,
			compactionThreshold: (data as any).compactionThreshold ?? 80,
			compactionMode: (data as any).compactionMode ?? 'threshold',
			compactionTargetPercent: (data as any).compactionTargetPercent ?? 50,
			compactionFixedCount: (data as any).compactionFixedCount ?? 20,
			compactionProviderId: (data as any).compactionProviderId ?? '',
			compactionModel: (data as any).compactionModel ?? '',
			compactionPrompt: (data as any).compactionPrompt ?? '',
			speechOpacity: (data as any).speechOpacity ?? 100,
			speechBold: (data as any).speechBold ?? true,
			speechItalic: (data as any).speechItalic ?? false,
			thoughtOpacity: (data as any).thoughtOpacity ?? 75,
			thoughtBold: (data as any).thoughtBold ?? false,
			thoughtItalic: (data as any).thoughtItalic ?? true,
			linkOpacity: (data as any).linkOpacity ?? 100,
			linkBold: (data as any).linkBold ?? false,
			linkItalic: (data as any).linkItalic ?? false,
			narrationOpacity: (data as any).narrationOpacity ?? 100,
			narrationBold: (data as any).narrationBold ?? false,
			narrationItalic: (data as any).narrationItalic ?? false,
			nestedEmphasisInSpeech: (data as any).nestedEmphasisInSpeech ?? true,
			systemDarkThemeId: (data as any).systemDarkThemeId ?? null,
			systemLightThemeId: (data as any).systemLightThemeId ?? null
		})),
		{
			systemDarkTheme: untrack(() => (data as any).systemDarkTheme ?? null),
			systemLightTheme: untrack(() => (data as any).systemLightTheme ?? null)
		}
	);
	const settings = $derived(settingsStore.settings);

	// settingsStore.hydrate() is gated by `_loaded` and only runs once. After
	// a login flow (invalidateAll), `data` is re-fetched with the real user
	// settings but hydrate is a no-op — leaving all settings stale. Force a
	// full re-hydrate whenever `data.user` becomes non-null (i.e., on login)
	// so every setting, including sidebar dimensions, renders correctly without
	// a page reload. Also sync sidebarWidth/sidebarCollapsed directly so the
	// layout state (which doesn't read from settingsStore) updates too.
	$effect(() => {
		if (!data.user) return;
		settingsStore.hydrate(
			{
				colorMode: data.colorMode,
				alwaysUseCharacterThemes: data.alwaysUseCharacterThemes,
				allowExternalCreatorNotes: data.allowExternalCreatorNotes,
				colorCharacterCards: data.colorCharacterCards ?? false,
				sidebarWidth: data.sidebarWidth ?? 320,
				sidebarCollapsed: data.sidebarCollapsed ?? false,
				fontSize: data.fontSize ?? 'medium',
				compactMode: data.compactMode ?? false,
				reduceMotion: data.reduceMotion ?? false,
				sendWithEnterDesktop: data.sendWithEnterDesktop ?? true,
				sendWithEnterMobile: data.sendWithEnterMobile ?? true,
				autoScrollThreshold: data.autoScrollThreshold ?? 'normal',
				confirmDeletions: data.confirmDeletions ?? true,
				messageTimestamps: data.messageTimestamps ?? 'relative',
				showReasoning: data.showReasoning ?? false,
				chatPageSize: data.chatPageSize ?? 50,
				notificationSound: data.notificationSound ?? false,
				notificationStyle: data.notificationStyle ?? 'generic',
				notificationAvatar: data.notificationAvatar ?? true,
				inAppNotifications: data.inAppNotifications ?? true,
				notificationDuration: (data as any).notificationDuration ?? 5,
				quietHoursEnabled: data.quietHoursEnabled ?? false,
				quietHoursStart: data.quietHoursStart ?? '22:00',
				quietHoursEnd: data.quietHoursEnd ?? '07:00',
				userTimezone: (data as any).userTimezone ?? '',
				renderMode: data.renderMode ?? 'roleplay',
				promptSlotOrder: data.promptSlotOrder ?? '',
				reformatterProviderId: data.reformatterProviderId ?? '',
				reformatterModel: data.reformatterModel ?? '',
				reformatterPrompt: data.reformatterPrompt ?? '',
				characterCreatorProviderId: (data as any).characterCreatorProviderId ?? '',
				characterCreatorModel: (data as any).characterCreatorModel ?? '',
				characterCreatorPrompt: (data as any).characterCreatorPrompt ?? '',
				compactionEnabled: (data as any).compactionEnabled ?? false,
				compactionThreshold: (data as any).compactionThreshold ?? 80,
				compactionMode: (data as any).compactionMode ?? 'threshold',
				compactionTargetPercent: (data as any).compactionTargetPercent ?? 50,
				compactionFixedCount: (data as any).compactionFixedCount ?? 20,
				compactionProviderId: (data as any).compactionProviderId ?? '',
				compactionModel: (data as any).compactionModel ?? '',
				compactionPrompt: (data as any).compactionPrompt ?? '',
				speechOpacity: (data as any).speechOpacity ?? 100,
				speechBold: (data as any).speechBold ?? true,
				speechItalic: (data as any).speechItalic ?? false,
				thoughtOpacity: (data as any).thoughtOpacity ?? 75,
				thoughtBold: (data as any).thoughtBold ?? false,
				thoughtItalic: (data as any).thoughtItalic ?? true,
				linkOpacity: (data as any).linkOpacity ?? 100,
				linkBold: (data as any).linkBold ?? false,
				linkItalic: (data as any).linkItalic ?? false,
				narrationOpacity: (data as any).narrationOpacity ?? 100,
				narrationBold: (data as any).narrationBold ?? false,
				narrationItalic: (data as any).narrationItalic ?? false,
				nestedEmphasisInSpeech: (data as any).nestedEmphasisInSpeech ?? true,
				systemDarkThemeId: (data as any).systemDarkThemeId ?? null,
				systemLightThemeId: (data as any).systemLightThemeId ?? null
			},
			{
				force: true,
				systemDarkTheme: (data as any).systemDarkTheme ?? null,
				systemLightTheme: (data as any).systemLightTheme ?? null
			}
		);
		sidebarWidth = data.sidebarWidth ?? 320;
		sidebarCollapsed = data.sidebarCollapsed ?? false;
	});

	// Kick off lazy loads for every per-resource store. Runs once on mount
	// (browser-only). All six fetches go in parallel; the sidebar renders
	// progressively as each lands.
	$effect(() => {
		void chatsStore.load();
		void charactersStore.load();
		void providersStore.load();
		void lorebooksStore.load();
		void personasStore.load();
		void themesStore.load();
	});

	// Chat data is fetched client-side via /api/chats/:id/data after mount.
	// Keeping it out of SSR makes the layout load much faster for users with
	// long active chats (no message tree walk on the server's critical path).
	let chatData: { chat: any; character: any; messages: any[]; messageSiblings: Record<number, { index: number; total: number }>; hiddenBranchCount: number; totalMessages?: number } | null = $state(null);
	let chatLoading = $state(!!initialChatId);
	// Gated visibility for the loading spinner — see loadChat() for the
	// short delay that keeps quick fetches from flashing it on screen.
	let showChatSpinner = $state(!!initialChatId);

	// On mobile with no active chat, start sidebar open (no flash)
	let mobileOpen = $state(initMobile && ((initialUiState.panel !== 'chat') || !initialChatId));

	// Mark initial chat as read on load (since it doesn't go through openChat())
	if (browser && initialChatId) {
		fetch(`/api/chats/${initialChatId}/read`, { method: 'POST' });
	}

	// Also re-open sidebar when chat is deselected on mobile
	$effect(() => {
		if (isMobile && !activeChatId) {
			untrack(() => { mobileOpen = true; });
		}
	});


	// ── SSE + Background streaming state ──────────────────────────────
	interface StreamEvent {
		seq: number;
		type: string;
		chatId: number;
		data: any;
	}

	let streamEvent: StreamEvent | null = $state(null);
	let streamSeq = 0;

	// Track which chats are currently generating (for spinner indicators)
	let streamingChats = $state(new Set<number>());

	// Inline chat title renaming
	let renamingChatId = $state<number | null>(null);
	let renameValue = $state('');

	// Per-row "more" menu (right-click on desktop / long-press on mobile).
	const chatMenu = createChatMenu();

	async function renameChat(chatId: number) {
		const trimmed = renameValue.trim();
		if (!trimmed) { renamingChatId = null; return; }
		const chat = chatsStore.chats.find((c: any) => c.id === chatId);
		if (chat && trimmed === chat.title) { renamingChatId = null; return; }
		// Optimistic — flip the title in the store immediately, then PATCH.
		chatsStore.update(chatId, { title: trimmed });
		const result = await api(`/api/chats/${chatId}`, {
			method: 'PATCH',
			json: { title: trimmed },
			silent: true
		});
		if (result) {
			toasts.success('Chat renamed');
		} else if (chat) {
			// Revert
			chatsStore.update(chatId, { title: chat.title ?? null });
		}
		renamingChatId = null;
	}

	// Per-chat unread counts (synced from server data + SSE updates)
	let unreadCounts: Record<number, number> = $state({});
	$effect(() => {
		const counts: Record<number, number> = {};
		for (const c of chatsStore.chats) {
			counts[c.id] = c.unread ?? 0;
		}
		// Active chat is always read
		if (activeChatId && counts[activeChatId]) {
			counts[activeChatId] = 0;
		}
		untrack(() => { unreadCounts = counts; });
	});

	// Total unread (for mobile indicator)
	let totalUnread = $derived(Object.values(unreadCounts).reduce((sum, n) => sum + n, 0));

	// Web App Badging: mirror total unread onto the home screen / taskbar icon.
	$effect(() => {
		const n = totalUnread;
		if (!('setAppBadge' in navigator)) return;
		if (n > 0) {
			(navigator as any).setAppBadge(n).catch(() => {});
		} else {
			(navigator as any).clearAppBadge().catch(() => {});
		}
	});

	// Notification permission + push subscribe — extracted into a composable.
	const notif = createNotificationPermission();

	// "Disable notifications on this device" from the Signed-in-devices list:
	// the server flips a per-session timestamp; on next load we compare it to
	// the value we last acknowledged and, if it changed, unsubscribe push +
	// reset the banner dismissal so the prompt reappears here.
	const NOTIF_DISABLE_ACK_KEY = 'skald-notif-disabled-ack';
	onMount(() => {
		const remoteAt = data.currentSessionNotificationsDisabledAt ?? null;
		let lastAck: string | null = null;
		try { lastAck = localStorage.getItem(NOTIF_DISABLE_ACK_KEY); } catch { /* ignore */ }
		const remoteDisableFired = remoteAt && lastAck !== remoteAt;
		(async () => {
			if (remoteDisableFired) {
				try {
					if ('serviceWorker' in navigator && 'PushManager' in window) {
						const reg = await navigator.serviceWorker.ready;
						const sub = await reg.pushManager.getSubscription();
						await sub?.unsubscribe();
					}
				} catch { /* ignore */ }
				notif.resetBannerDismissal();
				await notif.refreshPushSubscribed();
				try { localStorage.setItem(NOTIF_DISABLE_ACK_KEY, remoteAt!); } catch { /* ignore */ }
				return;
			}
			// Self-heal the session_id link on push subscriptions. Pre-existing
			// rows (created before push_subscriptions.session_id existed) have
			// NULL there, which means the Signed-in-devices list shows "Push
			// off" even when this device IS subscribed. Re-POSTing the same
			// endpoint upserts the row and attaches the current session id.
			if (data.user && 'serviceWorker' in navigator && 'PushManager' in window) {
				try {
					const reg = await navigator.serviceWorker.ready;
					const sub = await reg.pushManager.getSubscription();
					if (sub) {
						const subJson = sub.toJSON();
						await fetch('/api/push/subscribe', {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ endpoint: subJson.endpoint, keys: subJson.keys })
						}).catch(() => { /* best-effort */ });
					}
				} catch { /* ignore — page will still function without push */ }
			}
			// Re-probe so the banner condition reflects the live subscription
			// state, regardless of which branch ran.
			await notif.refreshPushSubscribed();
		})();
	});

	// Realtime SSE / presence / version-check connection lives in a composable.
	// Exposed below the event handler is defined.

	// Per-device "silence this device" toggle (local-only, set in SettingsModal).
	// Guard against SSR: Node 25 ships a partial localStorage global without
	// .getItem, so the typeof check alone is no longer sufficient.
	let deviceSilent = $state(false);
	if (browser) {
		deviceSilent = localStorage.getItem('skald-device-silent') === 'true';
	}

	// Listen for per-device silent toggle changes (fired by SettingsModal).
	$effect(() => {
		if (!browser) return;
		const handler = (e: Event) => { deviceSilent = (e as CustomEvent<boolean>).detail === true; };
		window.addEventListener('skald-device-silent-change', handler);
		return () => window.removeEventListener('skald-device-silent-change', handler);
	});

	function addChatNotification(chatId: number, characterName: string, characterAvatar: string | null, preview: string) {
		// Slider value: 1-30 = seconds, 31 = sticky (pass 0 to the toast store).
		const dur = Number((settings as any).notificationDuration ?? 5);
		const ms = dur >= 31 ? 0 : Math.max(1, Math.min(30, dur)) * 1000;
		toasts.chat({
			chatId,
			characterName,
			characterAvatar,
			preview,
			onclick: (id) => openChat(id),
		}, ms);
	}

	// Single SSE event handler — applies the event to client stores, the
	// chat-data cache, generation/streaming state, and gates in-app
	// notifications. The connection lifecycle (reconnect, version-check,
	// presence, etc.) lives in createRealtimeConnection.
	function handleRealtimeEvent(event: any) {
		// chat:patched can arrive without an `event.chatId` (the affected chat's
		// id lives in `payload.id`). Mirror it into the active ChatView's cache
		// so cross-device draft / inline-edit sync lands without a round-trip.
		// Must run BEFORE the applyRealtimeEvent early-return below, which
		// handles chat:patched for the sidebar store and exits immediately.
		if (chatData && event.type === 'chat:patched') {
			const payload = event.data;
			if (payload?.id === chatData.chat?.id && payload?.patch && typeof payload.patch === 'object') {
				chatData = {
					...chatData,
					chat: { ...chatData.chat, ...payload.patch }
				};
			}
		}

		// Realtime resource events (chat:*, character:*, provider:*,
		// lorebook:*, persona:*, theme:*, message:*) — dispatched
		// to the matching client store. Stops further processing
		// because they're not chat-stream events and the legacy
		// branch below would no-op anyway.
		if (typeof event.type === 'string' && event.type.includes(':')) {
			if (applyRealtimeEvent(event)) return;
		}

		// Patch the in-memory cached chat data for message:* events
		// so that when the user has settings/characters/etc open
		// (ChatView unmounted) and then returns, the cache is up
		// to date — no extra HTTP round-trip needed. The original
		// event payload lives under `event.data` (see eventBus emit
		// shape: { type, userId, chatId, data: <originalEvent> }).
		if (chatData && event.chatId === chatData.chat?.id) {
			const payload = event.data;
			if (event.type === 'message:created' && payload?.message) {
				const msg = payload.message as any;
				if (!chatData.messages.some((m: any) => m.id === msg.id)) {
					chatData = { ...chatData, messages: [...chatData.messages, msg] };
				}
			} else if (event.type === 'message:patched' && payload?.id && payload?.patch) {
				const idx = chatData.messages.findIndex((m: any) => m.id === payload.id);
				if (idx >= 0) {
					const patched = { ...chatData.messages[idx], ...payload.patch };
					const next = chatData.messages.slice();
					next[idx] = patched;
					chatData = { ...chatData, messages: next };
				}
			} else if (event.type === 'message:deleted' && Array.isArray(payload?.ids)) {
				const ids = new Set(payload.ids);
				const next = chatData.messages.filter((m: any) => !ids.has(m.id));
				if (next.length !== chatData.messages.length) {
					chatData = { ...chatData, messages: next };
				}
			} else if (event.type === 'chat:impersonation') {
				// Mirror the persisted impersonation swipes into the cached
				// chat row so a remount picks them up without a round-trip.
				chatData = {
					...chatData,
					chat: {
						...chatData.chat,
						impersonationSwipes: payload?.swipes ? JSON.stringify(payload.swipes) : null,
						impersonationSwipeIndex: payload?.swipeIndex ?? 0,
						impersonationStatus: payload?.status ?? null,
					}
				};
			}
		}

		const chatId = event.chatId;

		// Track streaming state
		if (event.type === 'streaming') {
			if (event.data.active) {
				if (!streamingChats.has(chatId)) {
					streamingChats = new Set([...streamingChats, chatId]);
				}
				generationsStore.start(chatId, {
					isRegenerate: !!event.data.isRegenerate,
					isImpersonation: !!event.data.isImpersonation,
					originalMessageId: event.data.originalMessageId ?? null
				});
			} else {
				if (streamingChats.has(chatId)) {
					const newSet = new Set(streamingChats);
					newSet.delete(chatId);
					streamingChats = newSet;
				}
				// Impersonation aborts emit `streaming active:false` but
				// no `complete` (since there's no assistant message to
				// finalize). Without this, the generation stays in the
				// 'streaming' status forever and ChatView's live-mirror
				// never flips `isImpersonating` back off — leaving the
				// stop button stuck. Flag it done here so the mirror runs.
				if (event.data.isImpersonation) {
					generationsStore.complete(chatId);
				}
			}
		}

		// Mirror token / reasoning / stats / error / complete events into
		// the global generations store so a chat that was streaming while
		// the user is on another view (or another chat) can be resumed
		// when re-entered.
		if (event.type === 'token' && typeof event.data?.token === 'string') {
			generationsStore.pushToken(chatId, event.data.token);
		} else if (event.type === 'reasoning' && typeof event.data?.reasoning === 'string') {
			generationsStore.pushReasoning(chatId, event.data.reasoning);
		} else if (event.type === 'tokenStats') {
			generationsStore.setTokenStats(chatId, event.data);
		} else if (event.type === 'error') {
			const msg = typeof event.data?.error === 'string' ? event.data.error : 'Generation error';
			generationsStore.setError(chatId, msg);
		} else if (event.type === 'complete') {
			generationsStore.complete(chatId);
		}

		// Cross-device sync: mute state changed elsewhere — patch the store.
		if ((event.type as string) === 'chat-muted') {
			chatsStore.update(chatId, { muted: !!event.data?.muted });
		}

		// Update unread counts
		if (event.type === 'unread') {
			const count = event.data?.count ?? 0;
			// If this is the active chat, mark as read immediately
			if (chatId === activeChatId) {
				if (count > 0) {
					fetch(`/api/chats/${chatId}/read`, { method: 'POST' });
				}
				unreadCounts = { ...unreadCounts, [chatId]: 0 };
				chatsStore.update(chatId, { unread: 0 });
			} else {
				unreadCounts = { ...unreadCounts, [chatId]: count };
				chatsStore.update(chatId, { unread: count });
			}
			// Cross-device dismissal: when unread drops to 0 (e.g. read on another device),
			// clear any pending in-app toast and close OS notifications for this chat.
			if (count === 0) {
				toasts.removeChat(chatId);
				navigator.serviceWorker?.ready.then((reg) => {
					reg.getNotifications({ tag: `skald-chat-${chatId}` }).then(notifs => {
						notifs.forEach(n => n.close());
					}).catch(() => { /* ignore */ });
				}).catch(() => { /* ignore */ });
			}
		}

		// Notification gating for completed responses.
		// New rules (April 2026 redesign):
		//   • Muted chat                                          → nothing
		//   • Active chat + tab focused                            → only an
		//     in-chat indicator (dispatched as `new-message` so
		//   • App focused, THIS chat                               → nothing
		//     (ChatView can show it on the scroll-to-bottom button)
		//   • App focused, different chat                          → in-app toast
		//     (+ sound if enabled). No OS push.
		//   • App backgrounded/closed everywhere                   → OS push only,
		//     handled server-side via web-push.
		//   • App backgrounded here, open on a different chat on
		//     another device                                       → in-app toast
		//     on the OTHER device (server sees appOpenSomewhere,
		//     skips push). This device queues an away toast anyway.
		//   • Another device focused on this chat                  → suppress here
		//     (viewedElsewhere=true, server also skips push).
		//   • Quiet hours                                          → suppress OS
		//     push only (server-side); in-app toasts/sound still happen.
		if (event.type === 'complete') {
			const muted = event.data?.muted === true;
			const viewedElsewhere = event.data?.viewedElsewhere === true;
			const isActiveChat = chatId === activeChatId;
			const tabFocused = !document.hidden;

			const chatInfo = chatsStore.chats.find((c: any) => c.id === chatId);

			// Sidebar sync: bump the chat's lastMessage + updatedAt so its
			// preview row refreshes without an invalidateAll round-trip.
			if (event.data?.preview) {
				chatsStore.update(chatId, {
					lastMessage: event.data.preview.length > 200 ? event.data.preview.slice(0, 200) : event.data.preview,
					lastMessageRole: 'assistant',
					updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19)
				});
			}

			if (!muted && chatInfo) {
				if (isActiveChat && tabFocused) {
					// Indicator only — handled inside ChatView via the
					// streamEvent forwarding below.
				} else if (tabFocused && !viewedElsewhere) {
					// App is focused but on a different chat (and no other
					// device is viewing this chat) → in-app toast.
					if (settings.notificationSound && !deviceSilent) {
						try {
							const ctx = new AudioContext();
							const osc = ctx.createOscillator();
							const gain = ctx.createGain();
							osc.connect(gain);
							gain.connect(ctx.destination);
							osc.frequency.value = 880;
							osc.type = 'sine';
							gain.gain.setValueAtTime(0.3, ctx.currentTime);
							gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
							osc.start(ctx.currentTime);
							osc.stop(ctx.currentTime + 0.3);
						} catch { /* ignore */ }
					}
					if (settings.inAppNotifications !== false) {
						const preview = (settings.notificationStyle === 'preview' && event.data?.preview)
							? event.data.preview
							: 'New message';
						addChatNotification(chatId, chatInfo.characterName, chatInfo.characterAvatar, preview);
					}
				} else if (!tabFocused && !viewedElsewhere && settings.inAppNotifications !== false) {
					// Tab is hidden — OS push covers the immediate notification,
					// but we ALSO queue an in-app toast so when the user comes
					// back the completion is visible without checking history.
					const preview = (settings.notificationStyle === 'preview' && event.data?.preview)
						? event.data.preview
						: 'New message';
					pendingAwayToasts.push({
						chatId,
						characterName: chatInfo.characterName,
						characterAvatar: chatInfo.characterAvatar,
						preview
					});
				}
			}
		}

		// Forward all events for the active chat to ChatView
		if (event.chatId === activeChatId) {
			streamEvent = { seq: ++streamSeq, type: event.type, chatId: event.chatId, data: event.data };
		}
	}

	const realtime = createRealtimeConnection({
		getEnabled: () => !!data.user,
		sessionId: crypto.randomUUID(),
		getActiveChatId: () => activeChatId,
		onEvent: handleRealtimeEvent,
		onSwOpenChat: (chatId) => openChat(chatId),
		getInitialUserTimezone: () => (data as any).userTimezone ?? null
	});

	function setLastChatCookie(id: number | null) {
		if (id) {
			document.cookie = `skald-last-chat=${id};path=/;max-age=31536000;SameSite=Lax`;
		} else {
			document.cookie = 'skald-last-chat=;path=/;max-age=0';
		}
	}

	function showOnlyPanel(panel: 'chats' | 'characters' | 'lorebooks' | 'settings' | 'personas') {
		showCharacters = panel === 'characters';
		showLorebooks = panel === 'lorebooks';
		showSettings = panel === 'settings';
		showPersonas = panel === 'personas';
		if (panel !== 'characters') selectedCharacterId = null;
		if (panel !== 'lorebooks') selectedLorebookId = null;
		if (panel !== 'personas') {
			selectedPersonaId = null;
			creatingPersona = false;
		}
	}

	function currentDropTarget(): 'characters' | 'lorebooks' | null {
		if (isMobile || narrowDesktop) {
			if (mobileOpen) {
				if (mobileDrawerTab === 'characters') return 'characters';
				if (mobileDrawerTab === 'lorebooks') return 'lorebooks';
			}
			if (narrowDesktop && sidebarOverlay) {
				if (mobileDrawerTab === 'characters') return 'characters';
				if (mobileDrawerTab === 'lorebooks') return 'lorebooks';
				return null;
			}
			if (showCharacters) return 'characters';
			if (showLorebooks) return 'lorebooks';
			return null;
		}
		if (showCharacters) return 'characters';
		if (showLorebooks) return 'lorebooks';
		return null;
	}

	function hasFilePayload(e: DragEvent): boolean {
		const types = e.dataTransfer?.types;
		if (!types) return false;
		return Array.from(types).includes('Files');
	}

	type ImportKind = 'character' | 'lorebook' | 'chat' | 'unknown';

	async function classifyImportFile(file: File): Promise<ImportKind> {
		const lower = file.name.toLowerCase();
		if (lower.endsWith('.png')) return 'character';
		if (lower.endsWith('.jsonl')) return 'chat';
		if (!lower.endsWith('.json')) return 'unknown';

		try {
			const text = await file.text();
			const parsed = JSON.parse(text);
			if (!parsed || typeof parsed !== 'object') return 'unknown';
			const obj = parsed as Record<string, any>;
			const dataObj = obj.data && typeof obj.data === 'object' ? obj.data : null;

			if (obj.schema === 'skald-chat' || Array.isArray(obj.messages)) return 'chat';

			const hasCharacterSignals =
				!!obj.spec ||
				!!obj.spec_version ||
				typeof obj.first_mes === 'string' ||
				typeof obj.personality === 'string' ||
				(typeof obj.name === 'string' && (typeof obj.description === 'string' || typeof obj.scenario === 'string')) ||
				(!!dataObj && (typeof dataObj.first_mes === 'string' || typeof dataObj.personality === 'string' || typeof dataObj.name === 'string'));
			if (hasCharacterSignals) return 'character';

			const hasLorebookSignals =
				Array.isArray(obj.entries) ||
				(Array.isArray(dataObj?.entries)) ||
				(Array.isArray(obj.character_book?.entries));
			if (hasLorebookSignals) return 'lorebook';
		} catch {
			return 'unknown';
		}

		return 'unknown';
	}

	async function importDroppedCharacter(file: File): Promise<boolean> {
		const formData = new FormData();
		formData.append('file', file);
		const res = await fetch('/api/characters/import', { method: 'POST', body: formData });
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			toasts.error(`${file.name}: ${err.error || 'Character import failed'}`);
			return false;
		}
		try {
			const body = await res.json();
			if (body?.light) charactersStore.upsert(body.light);
			else if (body?.id) charactersStore.upsert(body);
		} catch {
			await charactersStore.load(true);
		}
		return true;
	}

	async function importDroppedLorebook(file: File): Promise<boolean> {
		const formData = new FormData();
		formData.append('file', file);
		const res = await fetch('/api/lorebooks/import', { method: 'POST', body: formData });
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			toasts.error(`${file.name}: ${err.error || 'Lorebook import failed'}`);
			return false;
		}
		try {
			const body = await res.json();
			if (body?.lorebook) lorebooksStore.add(body.lorebook);
			else if (body?.id) lorebooksStore.add(body);
		} catch {
			await lorebooksStore.load(true);
		}
		return true;
	}

	async function handleDroppedFiles(files: FileList) {
		const activeTarget = currentDropTarget();
		if (!activeTarget) {
			toasts.error('Open Characters or Lorebooks first to import by drag-and-drop.');
			return;
		}

		const list = Array.from(files);
		if (list.length === 0) return;

		let imported = 0;
		let skipped = 0;
		for (const file of list) {
			let target: 'characters' | 'lorebooks' = activeTarget;
			const kind = await classifyImportFile(file);

			if (activeTarget === 'characters' && kind === 'lorebook') {
				const ok = await confirmDialog({
					title: 'Looks like a lorebook',
					message: `${file.name} looks like a lorebook. Import it as a lorebook instead?`,
					confirmLabel: 'Import as lorebook',
					variant: 'info',
				});
				if (!ok) { skipped++; continue; }
				target = 'lorebooks';
			} else if (activeTarget === 'lorebooks' && kind === 'character') {
				const ok = await confirmDialog({
					title: 'Looks like a character',
					message: `${file.name} looks like a character card. Import it as a character instead?`,
					confirmLabel: 'Import as character',
					variant: 'info',
				});
				if (!ok) { skipped++; continue; }
				target = 'characters';
			}

			if (kind === 'chat') {
				toasts.error(`${file.name}: chat import is not available from drag-and-drop yet.`);
				skipped++;
				continue;
			}

			const lower = file.name.toLowerCase();
			if (target === 'characters' && !(lower.endsWith('.png') || lower.endsWith('.json'))) {
				toasts.error(`${file.name}: characters import supports .png or .json.`);
				skipped++;
				continue;
			}
			if (target === 'lorebooks' && !lower.endsWith('.json')) {
				toasts.error(`${file.name}: lorebook import supports .json only.`);
				skipped++;
				continue;
			}

			const ok = target === 'characters'
				? await importDroppedCharacter(file)
				: await importDroppedLorebook(file);
			if (ok) imported++;
			else skipped++;
		}

		if (imported > 0) {
			toasts.success(`Imported ${imported} file${imported === 1 ? '' : 's'}.${skipped ? ` Skipped ${skipped}.` : ''}`);
		}
	}

	// Load chat data when activeChatId changes
	async function loadChat(id: number | null) {
		if (!id) {
			chatData = null;
			chatLoading = false;
			return;
		}
		if (!chatData) chatLoading = true;
		// Delay the visible spinner so fast loads don't flash. The actual
		// chat content swaps in on `chatData` regardless.
		const spinnerDelay = setTimeout(() => { showChatSpinner = chatLoading; }, 180);
		try {
			const pageSize = settings.chatPageSize ?? 50;
			const url = pageSize > 0 ? `/api/chats/${id}/data?limit=${pageSize}` : `/api/chats/${id}/data`;
			const res = await fetch(url);
			if (res.ok) {
				chatData = await res.json();
			} else {
				chatData = null;
				activeChatId = null;
				localStorage.removeItem('skald-last-chat');
				setLastChatCookie(null);
			}
		} catch {
			chatData = null;
		} finally {
			clearTimeout(spinnerDelay);
			chatLoading = false;
			showChatSpinner = false;
		}
	}

	// Abort a chat's in-flight generation. Usable from anywhere (sidebar
	// stop button, etc). Server fires a `streaming` active=false + `complete`
	// (or `error`) which clears the local store.
	async function abortChatById(id: number) {
		const result = await api('/api/chat/abort', {
			method: 'POST',
			json: { chatId: id },
			errorLabel: 'Failed to stop generation'
		});
		if (result) haptic('light');
	}

	// Navigate to a chat
	function openChat(id: number) {
		activeChatId = id;
		localStorage.setItem('skald-last-chat', String(id));
		setLastChatCookie(id);
		if (isMobile) mobileOpen = false;
		showOnlyPanel('chats');
		dismissOverlay();

		// Mark chat as read
		if (unreadCounts[id]) {
			unreadCounts = { ...unreadCounts, [id]: 0 };
			fetch(`/api/chats/${id}/read`, { method: 'POST' });
		}
	}

	// Called by ChatView when it needs data refreshed
	async function handleChatRefresh() {
		if (!activeChatId) return;
		await loadChat(activeChatId);
		// Sync the sidebar row's last-message preview + updatedAt from the
		// freshly-loaded chat data — no full layout reload needed.
		if (chatData?.chat) {
			const lastMsg = chatData.messages?.[chatData.messages.length - 1];
			const content = lastMsg?.content ?? '';
			chatsStore.update(activeChatId, {
				updatedAt: chatData.chat.updatedAt,
				title: chatData.chat.title,
				lastMessage: content.length > 200 ? content.slice(0, 200) : content,
				lastMessageRole: lastMsg?.role ?? ''
			});
		}
	}

	// Fetch chat data whenever activeChatId changes (skip if SSR-preloaded)
	$effect(() => {
		const id = activeChatId;
		untrack(() => {
			if (chatData && chatData.chat?.id === id) return;
			loadChat(id);
		});
	});

	// When the chat view re-appears (panel closed) AND a generation is in
	// flight for this chat, force a fresh fetch so ChatView remounts with
	// up-to-date messages — including the user's most recent message and,
	// for regenerations, the original assistant message at its real id (so
	// hydration can target it precisely instead of appending a duplicate).
	// We skip the refetch when no stream is in flight because the SSE
	// message:* patching keeps the cache fresh.
	let prevChatViewShown = false;
	$effect(() => {
		const shown = !!activeChatId && !showSettings && !showCharacters && !showLorebooks && !showPersonas;
		untrack(() => {
			if (shown && !prevChatViewShown && activeChatId && generationsStore.has(activeChatId)) {
				loadChat(activeChatId);
			}
			prevChatViewShown = shown;
		});
	});

	// Detect mobile viewport
	$effect(() => {
		const mq = window.matchMedia('(max-width: 767px)');
		const mqNarrow = window.matchMedia('(min-width: 768px) and (max-width: 1023px)');
		const mqDesktopInput = window.matchMedia('(hover: hover) and (pointer: fine)');
		isMobile = mq.matches;
		narrowDesktop = mqNarrow.matches;
		isDesktopClassInput = mqDesktopInput.matches;

		// Drawer-state bridging across breakpoint transitions. The active
		// panel itself (showSettings / showCharacters / etc.) is layout-
		// independent and preserved as-is — only the transient drawer
		// visibility (mobileOpen vs sidebarOverlay) needs reconciling.
		function bridgePanels(wasMobile: boolean, wasNarrow: boolean) {
			const nowMobile = mq.matches;
			const nowNarrow = mqNarrow.matches;
			const nowWide = !nowMobile && !nowNarrow;
			const wasWide = !wasMobile && !wasNarrow;
			const hasPanel = showCharacters || showLorebooks || showSettings || showPersonas;

			if (nowWide) {
				// Full desktop has no overlay drawer concept; promote any
				// open drawer to a visible sidebar.
				const wantOpen = mobileOpen || sidebarOverlay || hasPanel;
				sidebarOverlay = false;
				mobileOpen = false;
				if (wantOpen) setSidebarVisible(true);
			} else if (nowNarrow) {
				if (wasMobile) {
					// Promote mobile drawer → narrow-desktop overlay.
					if (mobileOpen) sidebarOverlay = true;
					mobileOpen = false;
				} else if (wasWide) {
					// Demote pinned sidebar → overlay drawer iff a panel
					// is selected (so user keeps quick access to the list).
					if (hasPanel) sidebarOverlay = true;
				}
			} else if (nowMobile) {
				if (wasNarrow && sidebarOverlay) mobileOpen = true;
				else if (wasWide && hasPanel) mobileOpen = true;
				sidebarOverlay = false;
			}
		}

		const handler = (e: MediaQueryListEvent) => {
			const wasMobile = isMobile;
			const wasNarrow = narrowDesktop;
			isMobile = e.matches;
			flashLayoutTransition();
			bridgePanels(wasMobile, wasNarrow);
		};
		mq.addEventListener('change', handler);

		const desktopInputHandler = (e: MediaQueryListEvent) => {
			isDesktopClassInput = e.matches;
		};
		mqDesktopInput.addEventListener('change', desktopInputHandler);

		const narrowHandler = (e: MediaQueryListEvent) => {
			const wasMobile = isMobile;
			const wasNarrow = narrowDesktop;
			narrowDesktop = e.matches;
			flashLayoutTransition();
			bridgePanels(wasMobile, wasNarrow);
		};
		mqNarrow.addEventListener('change', narrowHandler);
		// Mark hydrated after first frame to enable transitions
		requestAnimationFrame(() => { hydrated = true; });
		// Preload sidebar components — these are first-paint-critical because
		// CharactersModal is shown on every nav and LorebooksModal renders inside
		// the sidebar drawer; both are large enough that the network round-trip
		// is visible if we wait for the user click. Other modals (SettingsModal,
		// PersonasModal, ChubBrowseModal, etc.) are lazy-loaded on first open
		// via `{#await import(...)}` because they're rarely opened and don't
		// need to feel instant. See CODEBASE_AUDIT.md §6.10.
		import('$lib/components/CharactersModal.svelte');
		import('$lib/components/LorebooksModal.svelte');

		// Handle PWA shortcut deeplinks: /?panel=chats|characters|lorebooks
		const shortcutPanel = new URLSearchParams(window.location.search).get('panel');
		if (shortcutPanel === 'chats') {
			untrack(() => {
				showOnlyPanel('chats');
				if (isMobile) mobileOpen = true;
				else setSidebarVisible(true);
			});
		} else if (shortcutPanel === 'characters') {
			untrack(() => {
				showOnlyPanel('characters');
				if (isMobile) mobileOpen = true;
				else setSidebarVisible(true);
			});
		} else if (shortcutPanel === 'lorebooks') {
			untrack(() => {
				showOnlyPanel('lorebooks');
				if (isMobile) mobileOpen = true;
				else setSidebarVisible(true);
			});
		}

		return () => {
			mq.removeEventListener('change', handler);
			mqNarrow.removeEventListener('change', narrowHandler);
			mqDesktopInput.removeEventListener('change', desktopInputHandler);
		};
	});

	// Mobile sidebar swipe-to-open / drag-to-close — extracted into a composable.
	const sidebarGestures = createMobileSidebarGestures({
		getIsMobile: () => isMobile,
		getMobileOpen: () => mobileOpen,
		setMobileOpen: (v) => { mobileOpen = v; },
		isReordering: () => reorder.touchDragChatId !== null
	});

	// Modal states
	let showCharacters = $state(initialUiState.panel === 'characters');

	async function handleLogout() {
		// Best-effort: unregister this device's push subscription locally before
		// the server tears down the session. Server also drops the row, but
		// this releases the browser-side endpoint immediately.
		try {
			if ('serviceWorker' in navigator && 'PushManager' in window) {
				const reg = await navigator.serviceWorker.ready;
				const sub = await reg.pushManager.getSubscription();
				await sub?.unsubscribe();
			}
		} catch { /* ignore — server cleans up anyway */ }
		await api('/api/auth/logout', { method: 'POST', silent: true });
		window.location.reload();
	}

	$effect(() => {
		const handler = () => {
			showOnlyPanel('characters');
			if (isMobile) mobileOpen = true;
		};
		window.addEventListener('skald:open-characters', handler);
		return () => window.removeEventListener('skald:open-characters', handler);
	});

	$effect(() => {
		const onDragEnter = (e: DragEvent) => {
			if (!hasFilePayload(e)) return;
			e.preventDefault();
			dragDepth += 1;
			dragImportTarget = currentDropTarget();
			dragImportActive = dragImportTarget !== null;
		};
		const onDragOver = (e: DragEvent) => {
			if (!hasFilePayload(e)) return;
			e.preventDefault();
			dragImportTarget = currentDropTarget();
			dragImportActive = dragImportTarget !== null;
			if (e.dataTransfer) {
				e.dataTransfer.dropEffect = dragImportTarget ? 'copy' : 'none';
			}
		};
		const onDragLeave = (e: DragEvent) => {
			if (!hasFilePayload(e)) return;
			dragDepth = Math.max(0, dragDepth - 1);
			if (dragDepth === 0) {
				dragImportActive = false;
				dragImportTarget = null;
			}
		};
		const onDrop = async (e: DragEvent) => {
			if (!hasFilePayload(e)) return;
			e.preventDefault();
			dragDepth = 0;
			dragImportActive = false;
			dragImportTarget = null;
			const files = e.dataTransfer?.files;
			if (files && files.length > 0) await handleDroppedFiles(files);
		};

		window.addEventListener('dragenter', onDragEnter);
		window.addEventListener('dragover', onDragOver);
		window.addEventListener('dragleave', onDragLeave);
		window.addEventListener('drop', onDrop);
		return () => {
			window.removeEventListener('dragenter', onDragEnter);
			window.removeEventListener('dragover', onDragOver);
			window.removeEventListener('dragleave', onDragLeave);
			window.removeEventListener('drop', onDrop);
		};
	});
	let showLorebooks = $state(initialUiState.panel === 'lorebooks');
	let showSettings = $state(initialUiState.panel === 'settings');
	let showPersonas = $state(initialUiState.panel === 'personas');

	// Show/hide the desktop sidebar. In normal desktop, this persists to settings.
	// In narrow-desktop mode, this toggles the transient overlay state instead.
	function setSidebarVisible(visible: boolean) {
		if (narrowDesktop) {
			sidebarOverlay = visible;
			return;
		}
		const targetCollapsed = !visible;
		if (sidebarCollapsed !== targetCollapsed) {
			sidebarCollapsed = targetCollapsed;
			fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sidebarCollapsed: String(targetCollapsed) }) });
		}
	}
	function isSidebarVisible(): boolean {
		return narrowDesktop ? sidebarOverlay : !sidebarCollapsed;
	}
	function handleNarrowDesktopRailTab(tab: MobileDrawerTab) {
		if (!narrowDesktop) return;
		if (sidebarOverlay && mobileDrawerTab === tab) {
			setSidebarVisible(false);
			return;
		}
		showOnlyPanel(tab);
		setSidebarVisible(true);
	}
	// Dismiss the narrow-desktop overlay on any in-content navigation event.
	function dismissOverlay() {
		if (narrowDesktop) sidebarOverlay = false;
	}

	// In narrow-desktop mode with the overlay open, dismiss on outside-click
	// (anywhere except the sidebar itself or the desktop nav rail).
	$effect(() => {
		if (!narrowDesktop || !sidebarOverlay) return;
		const onClick = (e: MouseEvent) => {
			const t = e.target as HTMLElement;
			if (t.closest('[data-mobile-sidebar]')) return;
			if (t.closest('[data-desktop-rail]')) return;
			sidebarOverlay = false;
		};
		const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') sidebarOverlay = false; };
		setTimeout(() => document.addEventListener('click', onClick), 0);
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('click', onClick);
			document.removeEventListener('keydown', onKey);
		};
	});

	// Open the Personas pane.
	function openPersonas() {
		if (isMobile) {
			showOnlyPanel('personas');
			mobileOpen = true;
			return;
		}
		if (narrowDesktop) {
			showOnlyPanel('personas');
			setSidebarVisible(true);
			return;
		}
		if (showPersonas && isSidebarVisible()) {
			setSidebarVisible(false);
			return;
		}
		showOnlyPanel('personas');
		// Default to viewing the user's default persona (or the first one).
		if (selectedPersonaId === null && !creatingPersona) {
			const fallback = personasStore.defaultPersona ?? personasStore.personas[0] ?? null;
			if (fallback) selectedPersonaId = fallback.id;
		}
		setSidebarVisible(true);
	}

	// Mobile drawer tab state — derived from the active panel so navigation
	// state stays unified across mobile / narrow-desktop / full-desktop
	// layouts. To change the tab, call showOnlyPanel(...) instead of
	// assigning to mobileDrawerTab directly.
	type MobileDrawerTab = 'chats' | 'characters' | 'lorebooks' | 'personas' | 'settings';
	const mobileDrawerTab = $derived<MobileDrawerTab>(
		showSettings ? 'settings'
			: showLorebooks ? 'lorebooks'
				: showPersonas ? 'personas'
					: showCharacters ? 'characters'
						: 'chats'
	);

	// Keep CharactersModal alive once first shown to avoid re-mount lag
	let charEverShown = $state(false);
	let charDesktopActive = $derived(showCharacters && !isMobile && !narrowDesktop);
	let charMobileActive = $derived((isMobile || narrowDesktop) && mobileDrawerTab === 'characters');
	$effect(() => {
		if (charDesktopActive || charMobileActive) charEverShown = true;
	});

	// Settings panel state (desktop embedded)
	type SettingsTabId = 'providers' | 'prompts' | 'formatting' | 'appearance' | 'chat' | 'notifications' | 'account' | 'about' | 'instance' | 'users';
	let settingsActiveTab = $state<SettingsTabId>(initialUiState.settingsTab);
	const settingsBaseTabs = [
		{ id: 'providers' as const, label: 'Providers', icon: Server },
		{ id: 'prompts' as const, label: 'Prompts', icon: Sparkles },
		{ id: 'formatting' as const, label: 'Formatting', icon: Type },
		{ id: 'appearance' as const, label: 'Appearance', icon: Palette },
		{ id: 'chat' as const, label: 'Chat', icon: MessageSquare },
		{ id: 'notifications' as const, label: 'Notifications', icon: Bell },
		{ id: 'account' as const, label: 'Account', icon: User },
	];
	const settingsAdminTabs = [
		{ id: 'instance' as const, label: 'Instance', icon: Settings2 },
		{ id: 'users' as const, label: 'Users', icon: Users },
	];
	const settingsAboutTab = { id: 'about' as const, label: 'About', icon: Info };
	const settingsTabs = $derived(data.user?.role === 'admin' ? [...settingsBaseTabs, ...settingsAdminTabs, settingsAboutTab] : [...settingsBaseTabs, settingsAboutTab]);

	// Lorebooks panel state (desktop embedded)
	let selectedLorebookId: number | null = $state(initialUiState.selectedLorebookId);
	let selectedCharacterId: number | null = $state(initialUiState.selectedCharacterId);
	let selectedPersonaId: number | null = $state(initialUiState.selectedPersonaId);
	let creatingPersona = $state(false);

	// When the Personas pane is open and we have no selection, auto-pick the
	// default persona (or the first one) once the store is loaded. Keeps the
	// pane from getting stuck on the empty placeholder after a refresh.
	$effect(() => {
		if (!showPersonas) return;
		if (creatingPersona || selectedPersonaId !== null) return;
		const list = personasStore.personas;
		if (list.length === 0) return;
		const fallback = personasStore.defaultPersona ?? list[0];
		if (fallback) selectedPersonaId = fallback.id;
	});
	let characterEditMode: boolean = $state(initialUiState.characterEditMode);

	// AI character creator (lives in the same right pane as the editor)
	let aiCreatorOpen = $state(false);
	let aiCreatorSeed = $state<{ name?: string; description?: string } | undefined>(undefined);
	// When set, the creator runs in EDIT MODE for this character.
	let aiCreatorEditingId = $state<number | null>(null);
	let aiCreatorEditingChar = $state<any>(null);
	$effect(() => {
		const id = aiCreatorEditingId;
		untrack(() => {
			if (!id) { aiCreatorEditingChar = null; return; }
			fetch(`/api/characters/${id}`)
				.then(r => r.ok ? r.json() : null)
				.then(c => { if (aiCreatorEditingId === id) aiCreatorEditingChar = c; })
				.catch(() => { /* ignore */ });
		});
	});

	// Heavy character fields (firstMessage, alternateGreetings, personality,
	// scenario, systemPrompt, mesExample, postHistoryInstructions,
	// creatorNotes, extensions) are fetched on demand only when the editor
	// opens — keeps the sidebar / picker payloads small.
	let selectedCharFull = $state<any>(null);
	$effect(() => {
		const id = selectedCharacterId;
		untrack(() => {
			if (!id) { selectedCharFull = null; return; }
			selectedCharFull = null;
			fetch(`/api/characters/${id}`)
				.then(r => r.ok ? r.json() : null)
				.then(c => { if (selectedCharacterId === id) selectedCharFull = c; })
				.catch(() => { /* ignore */ });
		});
	});

	let enlargedImage: string | null = $state(null);
	let searchInputEl: HTMLInputElement | undefined = $state();
	let isDesktopClassInput = $state(false);

	const showDesktopMobileBackButton = $derived(
		isMobile
		&& isDesktopClassInput
		&& !mobileOpen
		&& (showCharacters || showLorebooks || showSettings || showPersonas)
	);

	// Global keyboard shortcuts
	function handleGlobalKeydown(e: KeyboardEvent) {
		const mod = e.metaKey || e.ctrlKey;
		if (mod && e.key === 'n') {
			e.preventDefault();
			showOnlyPanel('characters');
			if (isMobile) mobileOpen = true;
			else if (narrowDesktop) setSidebarVisible(true);
		} else if (mod && e.key === 'k') {
			e.preventDefault();
			if (sidebarCollapsed) sidebarCollapsed = false;
			tick().then(() => searchInputEl?.focus());
		} else if (e.key === 'Escape') {
			if (enlargedImage) { enlargedImage = null; return; }
			if (renamingChatId) { renamingChatId = null; return; }
			if (showSettings) {
				showOnlyPanel('chats');
				if (isMobile) mobileOpen = true;
				return;
			}
			if (showLorebooks) {
				selectedLorebookId = null;
				showOnlyPanel('chats');
				if (isMobile) mobileOpen = true;
				return;
			}
			if (showCharacters) {
				selectedCharacterId = null;
				showOnlyPanel('chats');
				if (isMobile) mobileOpen = true;
				return;
			}
			if (showPersonas) {
				showOnlyPanel('chats');
				if (isMobile) mobileOpen = true;
				return;
			}
		}
	}

	// Persist current panel/page state so refresh restores the same view
	$effect(() => {
		if (!browser) return;

		let panel: PersistedPanel = 'chat';
		if (isMobile) {
			panel = mobileDrawerTab === 'chats' ? 'chat' : (mobileDrawerTab as PersistedPanel);
		} else if (showSettings) {
			panel = 'settings';
		} else if (showLorebooks) {
			panel = 'lorebooks';
		} else if (showCharacters) {
			panel = 'characters';
		} else if (showPersonas) {
			panel = 'personas';
		}

		localStorage.setItem('skald-last-page-state', JSON.stringify({
			panel,
			mobileDrawerTab,
			settingsTab: settingsActiveTab,
			selectedCharacterId,
			selectedLorebookId,
			selectedPersonaId,
			characterEditMode
		}));
	});

	// Apply theme on load and when the user's slot picks change. The user
	// always has a preferred dark theme + light theme; colorMode picks which
	// one renders ('system' follows OS preference via matchMedia). Also keeps
	// settingsStore.effectiveMode in sync so per-character themes (and other
	// consumers) can pick their dark/light variant.
	$effect(() => {
		const colorMode = settings.colorMode;
		const darkTheme = settingsStore.systemDarkTheme;
		const lightTheme = settingsStore.systemLightTheme;
		if (colorMode === 'system') {
			const mq = window.matchMedia('(prefers-color-scheme: dark)');
			const apply = (e?: MediaQueryListEvent) => {
				const prefersDark = e ? e.matches : mq.matches;
				const next = prefersDark ? darkTheme : lightTheme;
				applyTheme(next);
				settingsStore.setEffectiveMode(prefersDark ? 'dark' : 'light');
			};
			apply();
			mq.addEventListener('change', apply);
			return () => mq.removeEventListener('change', apply);
		}
		const next = colorMode === 'light' ? lightTheme : darkTheme;
		applyTheme(next);
		settingsStore.setEffectiveMode(colorMode === 'light' ? 'light' : 'dark');
	});

	// Confirm modal state
	let confirmOpen = $state(false);
	let confirmTitle = $state('');
	let confirmMessage = $state('');
	let confirmAction: (() => void) | null = $state(null);
	let confirmSecondaryLabel = $state('');
	let confirmSecondaryAction: (() => void) | null = $state(null);

	function showConfirm(title: string, message: string, action: () => void, secondaryLabel?: string, secondaryAction?: () => void) {
		confirmTitle = title;
		confirmMessage = message;
		confirmAction = action;
		confirmSecondaryLabel = secondaryLabel ?? '';
		confirmSecondaryAction = secondaryAction ?? null;
		confirmOpen = true;
	}

	function handleConfirm() {
		confirmAction?.();
		confirmOpen = false;
	}

	function handleSecondary() {
		confirmSecondaryAction?.();
		confirmOpen = false;
	}

	// Pinned-chat reorder (mouse + touch) — extracted into a composable.
	// `getPinnedChats` reads through the closure so the composable always
	// sees the current $derived value despite the forward reference.
	const reorder = createChatReorder({ getPinnedChats: () => pinnedChats });

	async function performReorder(fromChatId: number, toChatId: number, position: 'above' | 'below') {
		return reorder.performReorder(fromChatId, toChatId, position);
	}

	const MIN_WIDTH = 300;
	const MAX_WIDTH = 480;

	function startResize(e: MouseEvent) {
		e.preventDefault();
		isResizing = true;
		let rafId = 0;

		const onMouseMove = (e: MouseEvent) => {
			if (rafId) return;
			rafId = requestAnimationFrame(() => {
				rafId = 0;
				const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX));
				sidebarWidth = newWidth;
			});
		};

		const onMouseUp = () => {
			if (rafId) cancelAnimationFrame(rafId);
			isResizing = false;
			document.removeEventListener('mousemove', onMouseMove);
			document.removeEventListener('mouseup', onMouseUp);
			document.body.style.cursor = '';
			document.body.style.userSelect = '';
			fetch('/api/settings', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ sidebarWidth: sidebarWidth })
			});
		};

		document.body.style.cursor = 'col-resize';
		document.body.style.userSelect = 'none';
		document.addEventListener('mousemove', onMouseMove);
		document.addEventListener('mouseup', onMouseUp);
	}

	// Memoization caches for sidebar rendering (keyed by chat.id + chat.updatedAt)
	const formatTimeCache = new Map<string, string>();
	const formatPreviewCache = new Map<string, string>();

	function formatTime(dateStr: string) {
		const cached = formatTimeCache.get(dateStr);
		if (cached !== undefined) return cached;
		const date = new Date(dateStr.replace(' ', 'T') + 'Z');
		const now = new Date();
		const diff = now.getTime() - date.getTime();
		const days = Math.floor(diff / (1000 * 60 * 60 * 24));

		let result: string;
		if (days === 0) {
			result = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
		} else if (days === 1) {
			result = 'Yesterday';
		} else if (days < 7) {
			result = date.toLocaleDateString([], { weekday: 'short' });
		} else {
			result = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
		}
		formatTimeCache.set(dateStr, result);
		return result;
	}

	// Clear time cache periodically (times like "3:42 PM" become stale)
	if (browser) setInterval(() => formatTimeCache.clear(), 60_000);

	function formatPreview(chat: any): string {
		const cacheKey = `${chat.id}:${chat.lastMessage ?? ''}`;
		const cached = formatPreviewCache.get(cacheKey);
		if (cached !== undefined) return cached;
		const html = renderRoleplayPreview(chat.lastMessage || '', {
			isTexting: chat.mode === 'texting',
			nestedEmphasisInSpeech: settings.nestedEmphasisInSpeech ?? true
		});
		formatPreviewCache.set(cacheKey, html);
		return html;
	}

	async function deleteChat(id: number, e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		const chat = chatsStore.chats.find((c: any) => c.id === id);

		async function performDelete() {
			// Optimistic: hide immediately
			deletedChatIds = new Set([...deletedChatIds, id]);
			const wasActive = activeChatId === id;
			if (wasActive) {
				activeChatId = null;
				chatData = null;
			}
			localStorage.removeItem('skald-last-chat');
			setLastChatCookie(null);

			try {
				const res = await fetch(`/api/chats/${id}`, { method: 'DELETE' });
				if (res.ok) {
					chatsStore.remove(id);
					deletedChatIds = new Set([...deletedChatIds].filter(x => x !== id));
				} else {
					// Revert
					deletedChatIds = new Set([...deletedChatIds].filter(x => x !== id));
					if (wasActive) {
						activeChatId = id;
						await loadChat(id);
					}
				}
			} catch {
				// Revert
				deletedChatIds = new Set([...deletedChatIds].filter(x => x !== id));
				if (wasActive) {
					activeChatId = id;
					await loadChat(id);
				}
			}
		}

		if (settings.confirmDeletions === false) {
			performDelete();
			return;
		}

		showConfirm(
			'Delete Chat',
			`Delete "${chat?.title || 'this chat'}"? This cannot be undone.`,
			performDelete,
			'Reset',
			() => performResetChat(id)
		);
	}

	async function performResetChat(id: number) {
		try {
			const res = await fetch(`/api/chats/${id}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'reset' })
			});
			if (res.ok) {
				try {
					const body = await res.json();
					if (body?.chat) chatsStore.upsert(body.chat);
				} catch { /* ignore */ }
				if (activeChatId === id) {
					await loadChat(id);
				}
			}
		} catch { /* ignore */ }
	}

	function movePinned(chatId: number, direction: 'up' | 'down') {
		const idx = pinnedChats.findIndex((c: any) => c.id === chatId);
		if (idx === -1) return;
		const newIdx = direction === 'up' ? idx - 1 : idx + 1;
		if (newIdx < 0 || newIdx >= pinnedChats.length) return;
		const targetId = pinnedChats[newIdx].id;
		performReorder(chatId, targetId, direction === 'up' ? 'above' : 'below');
	}

	async function togglePin(chatId: number, currentlyPinned: boolean, e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();

		// Optimistic: flip pin state immediately
		const newOverrides = new Map(pinStateOverrides);
		newOverrides.set(chatId, !currentlyPinned);
		pinStateOverrides = newOverrides;

		// Optimistic: set pin order so it sorts correctly immediately
		const newPinOrder = currentlyPinned ? 0 : Date.now();
		if (!currentlyPinned) {
			reorder.setPinOrderOverride(chatId, newPinOrder);
		}

		try {
			const res = await fetch(`/api/chats/${chatId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ pinned: !currentlyPinned, pinOrder: newPinOrder })
			});
			if (res.ok) {
				try {
					const body = await res.json();
					if (body?.chat) chatsStore.upsert(body.chat);
				} catch { /* ignore */ }
			} else {
				await chatsStore.load(true);
			}
		} catch {
			await chatsStore.load(true);
		} finally {
			// Clear overrides — server data is now authoritative
			const cleaned = new Map(pinStateOverrides);
			cleaned.delete(chatId);
			pinStateOverrides = cleaned;
			reorder.clearPinOrderOverride(chatId);
		}
	}

	// Chat import lives in Settings → Account; the layout just needs a callback
	// to refresh the sidebar and open the new chat after import.

	async function toggleMute(chatId: number, currentlyMuted: boolean) {
		// Optimistic flip — keep the menu/UI snappy.
		chatsStore.update(chatId, { muted: !currentlyMuted });
		const result = await api(`/api/chats/${chatId}/mute`, {
			method: 'POST',
			json: { muted: !currentlyMuted },
			silent: true
		});
		if (!result) chatsStore.update(chatId, { muted: currentlyMuted });
	}

	async function handleImportedChat(id: number) {
		await chatsStore.load();
		openChat(id);
	}

	// Optimistic pin state overrides: chatId -> pinned
	let pinStateOverrides: Map<number, boolean> = $state(new Map());

	// Optimistic deleted chats
	let deletedChatIds: Set<number> = $state(new Set());

	// Single-pass filter + partition into pinned/unpinned
	let chatPartition = $derived.by(() => {
		const query = debouncedSearch.trim().toLowerCase();
		const pinned: any[] = [];
		const unpinned: any[] = [];
		for (const c of sidebarChats) {
			if (deletedChatIds.has(c.id)) continue;
			if (query && !(c.title ?? '').toLowerCase().includes(query) && !c.characterName.toLowerCase().includes(query)) continue;
			const isPinned = pinStateOverrides.has(c.id) ? pinStateOverrides.get(c.id) : c.pinned;
			if (isPinned) {
				pinned.push(c);
			} else {
				unpinned.push(c);
			}
		}
		const overrides = reorder.pinOrderOverrides;
		pinned.sort((a: any, b: any) =>
			(overrides?.get(a.id) ?? a.pinOrder) - (overrides?.get(b.id) ?? b.pinOrder)
		);
		return { pinned, unpinned, total: pinned.length + unpinned.length };
	});

	let filteredChatCount = $derived(chatPartition.total);
	let pinnedChats = $derived(chatPartition.pinned);
	let unpinnedChats = $derived(chatPartition.unpinned);

	// All visible chats sorted by most-recently-updated. Pinned chats appear
	// here too (in addition to the horizontal pinned bar) — pinning is now a
	// shortcut, not a separate list.
	let allRecentChats = $derived.by(() => {
		const arr = [...pinnedChats, ...unpinnedChats];
		arr.sort((a: any, b: any) => {
			const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
			const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
			return tb - ta;
		});
		return arr;
	});

	// Horizontal pinned shortcuts row (mobile + desktop)
	let recentCharacters = $derived.by(() => {
		return pinnedChats.map((c: any) => ({
			chatId: c.id,
			name: c.characterName,
			avatar: c.characterAvatar
		}));
	});

	// OIDC sign-in: popup, dev bypass, redirect-error parsing.
	const oidc = createOidcPopup();
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

{#snippet chatItem(chat: any, i: number, isActive: boolean, isPinned: boolean)}
	{@const dragOver = reorder.dragOverChatId === chat.id && reorder.dragChatId !== chat.id}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		onclick={() => { if (!chatMenu.longPressFired) openChat(chat.id); }}
		oncontextmenu={(e: MouseEvent) => chatMenu.open(chat.id, e)}
		use:staggerOnMount={{ enabled: !debouncedSearch && chatListReady, index: i }}
		class="group relative mb-0.5 flex w-full cursor-pointer items-center gap-3 rounded-2xl px-2 py-2 text-left transition-[background-color,transform] duration-100 {isActive
			? 'bg-accent text-accent-foreground'
			: 'hover:bg-accent/40 active:scale-[0.98]'}"
		style="-webkit-touch-callout: none; -webkit-user-select: none; user-select: none;"
		ontouchstart={(e: TouchEvent) => chatMenu.startLongPress(chat.id, e)}
		ontouchmove={(e: TouchEvent) => chatMenu.moveLongPress(e)}
		ontouchend={() => chatMenu.endLongPress()}
		ontouchcancel={() => chatMenu.endLongPress()}
	>
		<!-- Avatar with online/streaming dot -->
		<div class="relative shrink-0">
			{#if chat.characterAvatar}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
				<img
					src={chat.characterAvatar}
					alt={chat.characterName}
					loading="lazy"
					draggable="false"
					class="h-12 w-12 cursor-pointer rounded-full object-cover transition-opacity hover:opacity-80"
					style="-webkit-touch-callout: none; -webkit-user-select: none; user-select: none;"
					onclick={(e) => { e.preventDefault(); e.stopPropagation(); enlargedImage = chat.characterAvatar?.replace('/avatars/', '/avatars/original/') ?? null; }}
				/>
			{:else}
				<div class="flex h-12 w-12 items-center justify-center rounded-full bg-primary/20 text-base font-semibold text-primary">
					{chat.characterName[0]}
				</div>
			{/if}
			{#if streamingChats.has(chat.id)}
				<button
					type="button"
					onclick={(e) => { e.preventDefault(); e.stopPropagation(); abortChatById(chat.id); }}
					use:tooltip={'Stop generating'}
					aria-label="Stop generating"
					class="group/stop absolute -bottom-0.5 -right-0.5 flex items-center gap-0.5 rounded-full bg-sidebar/95 px-1 py-0.5 ring-1 ring-border transition-colors hover:bg-destructive hover:ring-destructive"
				>
					<span class="flex items-center gap-0.5 group-hover/stop:hidden">
						<span class="sidebar-typing-dot h-1 w-1 rounded-full bg-emerald-500" style="animation-delay: 0ms"></span>
						<span class="sidebar-typing-dot h-1 w-1 rounded-full bg-emerald-500" style="animation-delay: 160ms"></span>
						<span class="sidebar-typing-dot h-1 w-1 rounded-full bg-emerald-500" style="animation-delay: 320ms"></span>
					</span>
					<X class="hidden h-2.5 w-2.5 text-destructive-foreground group-hover/stop:block" strokeWidth={3} />
				</button>
			{:else if isPinned}
				<span class="absolute -right-0.5 -bottom-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-sidebar text-primary ring-2 ring-sidebar">
					<Pin class="h-2.5 w-2.5 fill-current" />
				</span>
			{/if}
		</div>

		<!-- Title + preview -->
		<div class="min-w-0 flex-1">
			<div class="flex items-center justify-between gap-2">
				<div class="flex min-w-0 items-center gap-1.5">
					{#if chat.mode === 'texting'}<Smartphone class="inline h-3 w-3 shrink-0 text-emerald-500" />{:else}<BookOpen class="inline h-3 w-3 shrink-0 text-blue-400" />{/if}
					{#if renamingChatId === chat.id}
						<!-- svelte-ignore a11y_autofocus -->
						<input
							type="text"
							bind:value={renameValue}
							autofocus
							class="w-full rounded border border-border bg-background px-1 py-0.5 text-sm font-semibold outline-none focus:ring-1 focus:ring-primary"
							onclick={(e) => e.stopPropagation()}
							onkeydown={(e) => { if (e.key === 'Enter') renameChat(chat.id); if (e.key === 'Escape') renamingChatId = null; }}
							onblur={() => renameChat(chat.id)}
						/>
					{:else}
						<span class="truncate text-[15px] font-semibold leading-tight" ondblclick={(e) => { e.stopPropagation(); renamingChatId = chat.id; renameValue = chat.title; }}>{chat.title !== `Chat with ${chat.characterName}` ? chat.title : chat.characterName}</span>
					{/if}
				</div>
				<span class="shrink-0 text-[11px] text-muted-foreground">{formatTime(chat.updatedAt ?? '')}</span>
			</div>
			<div class="mt-0.5 flex items-center justify-between gap-2">
				<p class="truncate text-[13px] {unreadCounts[chat.id] && !isActive ? 'font-semibold text-foreground' : 'text-muted-foreground'}">{@html formatPreview(chat) || '\u00A0'}</p>
				<div class="flex shrink-0 items-center gap-1">
					{#if chat.muted}
						<BellOff class="h-3 w-3 text-muted-foreground" />
					{/if}
					{#if unreadCounts[chat.id] && !isActive}
						{#key unreadCounts[chat.id]}
							<span class="badge-pop flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">{unreadCounts[chat.id]}</span>
						{/key}
					{/if}
				</div>
			</div>
		</div>

		<!-- Hover ⋯ menu (desktop only; mobile uses long-press / drag for pin) -->
		<button
			onclick={(e) => chatMenu.open(chat.id, e)}
			class="hidden md:flex absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 items-center justify-center rounded-full bg-card/90 text-muted-foreground shadow-md opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100 {chatMenu.openChatId === chat.id ? '!opacity-100' : ''}"
			use:tooltip={'More'}
			aria-label="More actions"
		>
			<svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>
		</button>
	</div>
{/snippet}

<svelte:head>
	<title>Skald</title>
</svelte:head>

{#if !data.user}
	<LoginForm oidcEnabled={!!data.oidcEnabled} devAuthEnabled={!!data.devAuthEnabled} {oidc} />
{:else}
<div
	class="flex h-dvh overflow-hidden bg-sidebar md:gap-2 md:bg-sidebar md:p-2"
	data-font-size={settings.fontSize ?? 'medium'}
	data-compact={settings.compactMode ? '' : undefined}
	data-reduce-motion={settings.reduceMotion ? '' : undefined}
	style="
		--rp-speech-opacity: {(Number(settings.speechOpacity) || 0) / 100};
		--rp-speech-weight: {settings.speechBold ? 700 : 400};
		--rp-speech-style: {settings.speechItalic ? 'italic' : 'normal'};
		--rp-thought-opacity: {(Number(settings.thoughtOpacity) || 0) / 100};
		--rp-thought-weight: {settings.thoughtBold ? 700 : 400};
		--rp-thought-style: {settings.thoughtItalic ? 'italic' : 'normal'};
		--rp-link-opacity: {(Number(settings.linkOpacity) || 0) / 100};
		--rp-link-weight: {settings.linkBold ? 700 : 400};
		--rp-link-style: {settings.linkItalic ? 'italic' : 'normal'};
		--rp-narration-opacity: {(Number(settings.narrationOpacity) || 0) / 100};
		--rp-narration-weight: {settings.narrationBold ? 700 : 400};
		--rp-narration-style: {settings.narrationItalic ? 'italic' : 'normal'};
	"
>
	<!-- Mobile backdrop -->
	{#if mobileOpen || sidebarGestures.dragging}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="fixed inset-0 z-40 md:hidden {sidebarGestures.dragging ? '' : 'transition-opacity duration-300'}"
			style="background: rgba(0,0,0,{sidebarGestures.dragging && sidebarGestures.touchX !== null ? Math.max(0, 0.6 * (1 + sidebarGestures.touchX / 320)) : mobileOpen ? 0.6 : 0})"
			onclick={() => (mobileOpen = false)}
		></div>
	{/if}

	<!-- Narrow-desktop (hybrid) backdrop -->
	{#if narrowDesktop && sidebarOverlay}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="fixed inset-y-0 right-0 z-20 hidden bg-black/45 backdrop-blur-[1px] md:block"
			style="left: 72px"
			onclick={() => (sidebarOverlay = false)}
		></div>
	{/if}
	<!-- Rail-colored frame around drawer (above backdrop, below drawer). Always rendered in hybrid mode so its opacity can transition with the drawer; left corners are square so it merges with the rail without leaving triangular gaps. -->
	{#if narrowDesktop}
		<div
			class="pointer-events-none fixed z-[29] hidden md:block transition-[width,opacity] duration-300 ease-out"
			style="left: 64px; top: 0; bottom: 0; width: {displayCollapsed ? 0 : sidebarWidth + 16}px; background: var(--sidebar); border-radius: 0 24px 24px 0; opacity: {displayCollapsed ? 0 : 1};"
		></div>
	{/if}

	{#if dragImportActive && dragImportTarget}
		<div class="pointer-events-none fixed inset-0 z-[120] flex items-center justify-center bg-black/45 backdrop-blur-[1px]">
			<div class="rounded-2xl border border-primary/40 bg-card/95 px-6 py-4 text-center shadow-2xl">
				<p class="text-sm font-medium text-foreground">
					{dragImportTarget === 'characters' ? 'Drop files to import characters' : 'Drop files to import lorebooks'}
				</p>
				<p class="mt-1 text-xs text-muted-foreground">
					{dragImportTarget === 'characters' ? '.png or .json character cards' : '.json lorebook exports'}
				</p>
			</div>
		</div>
	{/if}

	<!-- Permanent desktop rail (Messenger-style narrow nav column) -->
	<aside data-desktop-rail class="flex w-0 shrink-0 -translate-x-full flex-col items-center overflow-hidden bg-sidebar opacity-0 {hydrated ? 'transition-[width,transform,opacity] duration-300 ease-out' : ''} md:w-14 md:translate-x-0 md:opacity-100">
		<!-- Top: app icon -->
		<div class="flex h-14 w-full shrink-0 items-center justify-center">
			<div class="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-md shadow-primary/30">
				<span class="text-lg font-extrabold">S</span>
			</div>
		</div>

		<!-- Middle: nav (account → chats → characters → lorebooks),
		     'New Chat' lives in the chat-list header on desktop now. -->
		<nav class="flex flex-1 flex-col items-center gap-1 py-3">
			{#if data.user}
				<button
					onclick={openPersonas}
					class="group relative mb-1 flex h-10 w-10 items-center justify-center rounded-full text-primary transition-colors"
					use:tooltip={`${data.user.username} — Personas`}
					aria-label="Personas"
				>
						<span class="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-primary/15 transition-colors group-hover:bg-primary/25 {(narrowDesktop ? (sidebarOverlay && mobileDrawerTab === 'personas') : (showPersonas && isSidebarVisible())) ? 'ring-2 ring-primary ring-offset-2 ring-offset-sidebar' : ''}">
						{#if data.user.pictureUrl}
							<img
								src={data.user.pictureUrl}
								alt=""
								class="h-full w-full object-cover"
								referrerpolicy="no-referrer"
								onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
							/>
						{:else}
							<span class="text-sm font-semibold uppercase">{data.user.username[0]}</span>
						{/if}
					</span>
					{#if data.user.role === 'admin'}
						<span class="pointer-events-none absolute -right-0.5 -bottom-0.5 z-10 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-sidebar text-primary shadow" use:tooltip={'Admin'}>
							<Shield class="h-2.5 w-2.5" />
						</span>
					{/if}
				</button>
			{/if}
			<button
				onclick={() => {
					if (narrowDesktop) {
						handleNarrowDesktopRailTab('chats');
						return;
					}
					const isChatsActive = !showSettings && !showLorebooks && !showCharacters && !showPersonas;
					if (isChatsActive && isSidebarVisible()) {
						setSidebarVisible(false);
					} else {
						if (showSettings) showSettings = false;
						if (showLorebooks) { showLorebooks = false; selectedLorebookId = null; }
						if (showCharacters) { showCharacters = false; selectedCharacterId = null; }
						if (showPersonas) showPersonas = false;
						setSidebarVisible(true);
					}
				}}
				class="relative flex h-10 w-10 items-center justify-center rounded-xl text-foreground transition-colors {narrowDesktop ? (sidebarOverlay && mobileDrawerTab === 'chats' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground') : (isSidebarVisible() && !showSettings && !showLorebooks && !showCharacters && !showPersonas ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground')}"
				use:tooltip={'Chats'}
				aria-label="Chats"
			>
				<MessageSquare class="h-5 w-5" />
				{#if totalUnread > 0}
					<span class="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">{totalUnread}</span>
				{/if}
			</button>
			<button
				onclick={() => {
					if (narrowDesktop) {
						handleNarrowDesktopRailTab('characters');
						return;
					}
					if (showCharacters && isSidebarVisible()) {
						setSidebarVisible(false);
					} else {
						showCharacters = true;
						showSettings = false;
						showLorebooks = false;
						showPersonas = false;
						selectedLorebookId = null;
						selectedCharacterId = null;
						setSidebarVisible(true);
					}
				}}
				class="flex h-10 w-10 items-center justify-center rounded-xl transition-colors {narrowDesktop ? (sidebarOverlay && mobileDrawerTab === 'characters' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground') : (showCharacters && isSidebarVisible() ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground')}"
				use:tooltip={'Characters'}
				aria-label="Characters"
			>
				<Users class="h-5 w-5" />
			</button>
			<button
				onclick={() => {
					if (narrowDesktop) {
						handleNarrowDesktopRailTab('lorebooks');
						return;
					}
					if (showLorebooks && isSidebarVisible()) {
						setSidebarVisible(false);
					} else {
						showLorebooks = true;
						showSettings = false;
						showCharacters = false;
						showPersonas = false;
						selectedCharacterId = null;
						selectedLorebookId = null;
						setSidebarVisible(true);
					}
				}}
				class="flex h-10 w-10 items-center justify-center rounded-xl transition-colors {narrowDesktop ? (sidebarOverlay && mobileDrawerTab === 'lorebooks' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground') : (showLorebooks && isSidebarVisible() ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground')}"
				use:tooltip={'Lorebooks'}
				aria-label="Lorebooks"
			>
				<BookOpen class="h-5 w-5" />
			</button>
		</nav>

		<!-- Bottom: settings + user -->
		<div class="flex w-full shrink-0 flex-col items-center gap-1 py-2">
			<button
				onclick={() => {
					if (narrowDesktop) {
						handleNarrowDesktopRailTab('settings');
						return;
					}
					if (showSettings && isSidebarVisible()) {
						setSidebarVisible(false);
					} else {
						showSettings = true;
						showLorebooks = false;
						showCharacters = false;
						showPersonas = false;
						selectedLorebookId = null;
						selectedCharacterId = null;
						setSidebarVisible(true);
					}
				}}
				class="flex h-10 w-10 items-center justify-center rounded-xl transition-colors {narrowDesktop ? (sidebarOverlay && mobileDrawerTab === 'settings' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground') : (showSettings && isSidebarVisible() ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground')}"
				use:tooltip={'Settings'}
				aria-label="Settings"
			>
				<Settings class="h-5 w-5" />
			</button>
			{#if data.user}
				<button
					onclick={handleLogout}
					class="flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
					use:tooltip={'Log out'}
					aria-label="Log out"
				>
					<LogOut class="h-5 w-5" />
				</button>
			{/if}
		</div>
	</aside>

	<!-- Sidebar -->
		<aside
			data-mobile-sidebar
			data-ssr={hydrated ? undefined : ''}
			class="bg-card text-sidebar-foreground
				{mobileOpen || sidebarGestures.dragging ? 'fixed inset-y-0 left-0 z-50 flex flex-col w-[90vw] max-w-md rounded-r-2xl shadow-2xl' : isMobile ? 'fixed inset-y-0 left-0 z-50 flex flex-col w-[90vw] max-w-md rounded-r-2xl shadow-2xl pointer-events-none' : ''}
				md:flex md:flex-col md:max-w-none md:pointer-events-auto md:rounded-2xl md:overflow-hidden md:bg-card
				{narrowDesktop ? 'md:fixed md:inset-y-2 md:left-[72px] md:z-30 md:shadow-2xl md:w-auto' : 'md:relative md:z-auto md:shadow-none md:w-auto'}
				{!hydrated || sidebarGestures.dragging ? '' : 'transition-transform duration-300 ease-out md:transition-[width,min-width,opacity] md:duration-300'}
				{displayCollapsed && !isMobile ? 'md:overflow-hidden' : ''}"
			style="{isMobile ? (sidebarGestures.dragging && sidebarGestures.touchX !== null ? `transform: translateX(${sidebarGestures.touchX}px)` : mobileOpen ? 'transform: translateX(0)' : 'transform: translateX(-100%)') : `width: ${displayCollapsed ? 0 : sidebarWidth}px; min-width: ${displayCollapsed ? 0 : sidebarWidth}px; opacity: ${displayCollapsed ? 0 : 1}`}"
		>
			<div class="relative flex flex-1 flex-col min-h-0">
			{#if showSettings && !isMobile && !narrowDesktop}
			<!-- Settings tab nav (desktop only) -->
			<div class="flex h-14 items-center px-5">
				<h1 class="text-2xl font-extrabold tracking-tight text-primary md:text-foreground">Settings</h1>
			</div>
			<nav class="flex-1 overflow-y-auto px-3 py-2" style="overscroll-behavior: contain;">
				<div class="flex flex-col gap-1.5">
					{#each settingsTabs as tab, i (tab.id)}
						<button
							onclick={() => { settingsActiveTab = tab.id; dismissOverlay(); }}
							use:staggerOnMount={{ index: i }}
							class="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors
								{settingsActiveTab === tab.id
									? 'bg-primary/10 text-primary'
									: 'bg-accent/40 text-muted-foreground hover:bg-accent hover:text-foreground'}"
						>
							<tab.icon class="h-4.5 w-4.5" />
							{tab.label}
						</button>
					{/each}
				</div>
			</nav>
			{:else if showLorebooks && !isMobile && !narrowDesktop}
			<!-- Lorebooks list (desktop only) -->
			{#await import('$lib/components/LorebooksModal.svelte') then { default: LorebooksModal }}
				<LorebooksModal
					open={showLorebooks}
					embedded={true}
					selectedId={selectedLorebookId}
					characters={sidebarCharacters}
					onclose={() => { showLorebooks = false; selectedLorebookId = null; }}
					onselect={(id) => { selectedLorebookId = id; if (id != null) dismissOverlay(); }}
				/>
			{/await}
			{:else if showPersonas && !isMobile && !narrowDesktop}
			<!-- Personas list (desktop only) -->
			{#await import('$lib/components/PersonasModal.svelte') then { default: PersonasModal }}
				<PersonasModal
					open={true}
					embedded={true}
					selectedId={creatingPersona ? null : selectedPersonaId}
					oncreatenew={() => { creatingPersona = true; selectedPersonaId = null; dismissOverlay(); }}
					onselect={(id) => { selectedPersonaId = id; creatingPersona = false; if (id != null) dismissOverlay(); }}
					onclose={() => { showPersonas = false; selectedPersonaId = null; creatingPersona = false; }}
				/>
			{/await}
			{:else if showCharacters && !isMobile && !narrowDesktop}
			<!-- Characters panel rendered below as keep-alive -->
			<div></div>
			{:else if (isMobile || narrowDesktop) && mobileDrawerTab === 'characters'}
			<!-- Characters panel rendered below as keep-alive -->
			<div></div>
			{:else if (isMobile || narrowDesktop) && mobileDrawerTab === 'lorebooks'}
			{#await import('$lib/components/LorebooksModal.svelte') then { default: LorebooksModal }}
				<LorebooksModal
					open={true}
					embedded={true}
					selectedId={null}
					characters={sidebarCharacters}
					onclose={() => { showOnlyPanel('chats'); }}
					onselect={(id) => {
						selectedLorebookId = id;
						showOnlyPanel('lorebooks');
						if (isMobile) mobileOpen = false;
						if (narrowDesktop) setSidebarVisible(false);
					}}
				/>
			{/await}
			{:else if (isMobile || narrowDesktop) && mobileDrawerTab === 'personas'}
			{#await import('$lib/components/PersonasModal.svelte') then { default: PersonasModal }}
				<PersonasModal
					open={true}
					embedded={true}
					selectedId={null}
					oncreatenew={() => {
						creatingPersona = true;
						selectedPersonaId = null;
						showOnlyPanel('personas');
						if (isMobile) mobileOpen = false;
						if (narrowDesktop) setSidebarVisible(false);
					}}
					onselect={(id) => {
						selectedPersonaId = id;
						creatingPersona = false;
						showOnlyPanel('personas');
						if (isMobile) mobileOpen = false;
						if (narrowDesktop) setSidebarVisible(false);
					}}
					onclose={() => { showOnlyPanel('chats'); }}
				/>
			{/await}
			<!-- User info + logout -->
			<div class="shrink-0 border-t border-sidebar-border/50 px-4 py-3">
				<div class="flex items-center gap-3">
					<div class="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/15 text-primary">
						{#if data.user?.pictureUrl}
							<img
								src={data.user.pictureUrl}
								alt=""
								class="h-full w-full object-cover"
								referrerpolicy="no-referrer"
								onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
							/>
						{:else}
							<span class="text-sm font-semibold uppercase">{data.user?.username?.[0]}</span>
						{/if}
					</div>
					<div class="min-w-0 flex-1">
						<p class="truncate text-sm font-medium">{data.user?.username}</p>
						{#if data.user?.role === 'admin'}
							<p class="flex items-center gap-1 text-xs text-primary"><Shield class="h-3 w-3" />Admin</p>
						{/if}
					</div>
					<button
						onclick={handleLogout}
						class="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
						use:tooltip={'Log out'}
						aria-label="Log out"
					>
						<LogOut class="h-4 w-4" />
					</button>
				</div>
			</div>
			{:else if (isMobile || narrowDesktop) && mobileDrawerTab === 'settings'}
			<!-- Mobile settings category nav -->
			<div class="flex h-14 items-center px-5">
				<h1 class="text-2xl font-extrabold tracking-tight text-primary md:text-foreground">Settings</h1>
			</div>
			<nav class="flex-1 overflow-y-auto px-3 py-2" style="overscroll-behavior: contain;">
				<div class="flex flex-col gap-1.5">
					{#each settingsTabs as tab, i (tab.id)}
						<button
							onclick={() => {
								settingsActiveTab = tab.id;
								showOnlyPanel('settings');
								if (isMobile) mobileOpen = false;
								if (narrowDesktop) setSidebarVisible(false);
							}}
							use:staggerOnMount={{ index: i }}
							class="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors
								{settingsActiveTab === tab.id
									? 'bg-primary/10 text-primary'
									: 'bg-accent/40 text-muted-foreground hover:bg-accent hover:text-foreground'}"
						>
							<tab.icon class="h-4.5 w-4.5" />
							{tab.label}
						</button>
					{/each}
				</div>
			</nav>
			{:else}
			<!-- Logo / header bar -->
			<div class="flex h-14 items-center justify-between px-5">
				<h1 class="text-2xl font-extrabold tracking-tight text-primary md:text-foreground">
					<span class="md:hidden">Skald</span>
					<span class="hidden md:inline">Chats</span>
				</h1>
				<button
					onclick={() => { showOnlyPanel('characters'); }}
					class="hidden h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md shadow-primary/30 transition-transform hover:bg-primary/90 hover:scale-105 active:scale-95 md:flex"
					use:tooltip={'New Chat'}
					aria-label="New Chat"
				>
					<SquarePen class="h-4 w-4" />
				</button>
			</div>

			<!-- Search (Messenger-style pill) -->
			<div class="px-3 pt-1 pb-2">
				<div class="relative">
					<Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
					<input
						bind:this={searchInputEl}
						bind:value={searchQuery}
						oninput={() => {
							if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
							if (!searchQuery) {
								debouncedSearch = '';
								chatsStore.clearSearch();
								return;
							}
							searchDebounceTimer = setTimeout(() => {
								debouncedSearch = searchQuery;
								void chatsStore.search(searchQuery);
							}, 150);
						}}
						placeholder="Search chats"
						class="w-full rounded-full border border-transparent bg-accent/40 py-2 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:border-primary/30 focus:bg-background focus:outline-none focus:ring-2 focus:ring-ring/40"
					/>
				</div>
			</div>

			<!-- Pinned chats horizontal shortcut row (mobile + desktop) -->
			{#if recentCharacters.length > 0}
				<div class="shrink-0 px-2 pb-2" data-no-sidebar-swipe>
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="flex gap-3 overflow-x-auto px-1 pt-2 pb-1 scrollbar-none"
						style="scrollbar-width: none;"
						ondragover={reorder.handlePinnedRowDragOver}
						ondrop={reorder.handlePinnedRowDrop}
					>
						{#each recentCharacters as rc (rc.chatId)}
							{@const isDragging = reorder.dragChatId === rc.chatId}
							{@const isDragOver = reorder.dragOverChatId === rc.chatId && reorder.dragChatId !== rc.chatId}
							<!-- Rendered as a div+role=button rather than a real <button> because
							     Chromium and WebKit both treat draggable="true" on form controls
							     unreliably — clicking and dragging a real <button> wins the
							     form-activation gesture and never fires dragstart on desktop. -->
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<div
								role="button"
								tabindex="0"
								onclick={() => { if (!chatMenu.longPressFired) openChat(rc.chatId); }}
								oncontextmenu={(e) => chatMenu.open(rc.chatId, e)}
								ontouchstart={(e) => chatMenu.startLongPress(rc.chatId, e)}
								ontouchmove={(e) => chatMenu.moveLongPress(e)}
								ontouchend={() => chatMenu.endLongPress()}
								ontouchcancel={() => chatMenu.endLongPress()}
								data-pinned-chat-id={rc.chatId}
								draggable="true"
								ondragstart={(e: DragEvent) => reorder.handleDragStart(rc.chatId, e)}
								ondragend={reorder.handleDragEnd}
								class="no-callout relative flex shrink-0 cursor-pointer flex-col items-center gap-1 transition-opacity {isDragging ? 'opacity-40' : ''}"
								style="-webkit-touch-callout: none; -webkit-user-select: none; user-select: none; -webkit-user-drag: element;"
								aria-label={rc.name}
							>
								{#if isDragOver && reorder.dropPosition === 'above'}
									<span class="pointer-events-none absolute -left-1.5 top-1 bottom-5 w-0.5 rounded bg-primary"></span>
								{/if}
								{#if isDragOver && reorder.dropPosition === 'below'}
									<span class="pointer-events-none absolute -right-1.5 top-1 bottom-5 w-0.5 rounded bg-primary"></span>
								{/if}
								<div class="relative pointer-events-none">
									{#if rc.avatar}
										<img src={rc.avatar} alt={rc.name} draggable="false" loading="lazy" decoding="async" class="h-16 w-16 rounded-full object-cover {activeChatId === rc.chatId ? 'ring-2 ring-primary ring-offset-2 ring-offset-sidebar' : ''}" />
									{:else}
										<div class="flex h-16 w-16 items-center justify-center rounded-full bg-primary/20 text-base font-semibold text-primary {activeChatId === rc.chatId ? 'ring-2 ring-primary ring-offset-2 ring-offset-sidebar' : ''}">{rc.name[0]}</div>
									{/if}
									{#if streamingChats.has(rc.chatId)}
										<span class="absolute -bottom-0.5 -right-0.5 flex items-center gap-0.5 rounded-full bg-sidebar/95 px-1 py-0.5 ring-1 ring-border">
											<span class="sidebar-typing-dot h-1 w-1 rounded-full bg-emerald-500" style="animation-delay: 0ms"></span>
											<span class="sidebar-typing-dot h-1 w-1 rounded-full bg-emerald-500" style="animation-delay: 160ms"></span>
											<span class="sidebar-typing-dot h-1 w-1 rounded-full bg-emerald-500" style="animation-delay: 320ms"></span>
										</span>
									{:else if unreadCounts[rc.chatId]}
										{#key unreadCounts[rc.chatId]}
											<span class="badge-pop absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground ring-2 ring-sidebar">{unreadCounts[rc.chatId]}</span>
										{/key}
									{/if}
								</div>
								<span class="max-w-[72px] truncate text-xs text-foreground/80">{rc.name.split(' ')[0]}</span>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Chat list -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<nav
				class="flex-1 overflow-y-auto px-2 py-2"
				style="overscroll-behavior: contain;"
				ondragover={(e) => reorder.handleNavDragOver(e)}
				ondrop={(e) => reorder.handleNavDrop(e)}
			>
				{#if filteredChatCount === 0}
					{#if chatsStore.loading && !searchQuery.trim()}
						<div class="space-y-1 px-1 py-1">
							{#each Array(6) as _, i}
								<div class="flex items-center gap-3 rounded-lg px-2 py-2">
									<div class="skeleton-pulse h-9 w-9 shrink-0 rounded-full" style="animation-delay: {i * 80}ms"></div>
									<div class="flex-1 space-y-1.5">
										<div class="skeleton-pulse h-3 w-1/2 rounded" style="animation-delay: {i * 80 + 40}ms"></div>
										<div class="skeleton-pulse h-2.5 w-4/5 rounded" style="animation-delay: {i * 80 + 80}ms"></div>
									</div>
								</div>
							{/each}
						</div>
					{:else}
						<div class="px-3 py-8 text-center text-sm text-muted-foreground">
							{#if searchQuery.trim()}
								No matching chats
							{:else}
								<MessageSquare class="mx-auto mb-2 h-8 w-8 opacity-30" />
								<p>No conversations yet</p>
								<p class="mt-1 text-xs">Start a new chat to begin</p>
							{/if}
						</div>
					{/if}
				{:else}
					{#each allRecentChats as chat, i (chat.id)}
						{@const isPinned = pinStateOverrides.has(chat.id) ? !!pinStateOverrides.get(chat.id) : !!chat.pinned}
						<div
							animate:flip={{ duration: settings.reduceMotion ? 0 : 250, easing: quintOut }}
							transition:slide|local={{
								duration: chatListReady && !settings.reduceMotion && !layoutTransitioning ? 220 : 0,
								easing: quintOut,
								axis: 'y'
							}}
						>
							{@render chatItem(chat, i, activeChatId === chat.id, isPinned)}
						</div>
					{/each}
					{#if chatsStore.hasMore && !searchQuery.trim()}
						<button
							type="button"
							class="my-2 w-full rounded-lg border border-dashed border-border/60 px-3 py-2 text-xs text-muted-foreground hover:bg-muted/50 disabled:opacity-50"
							disabled={chatsStore.loadingMore}
							onclick={() => chatsStore.loadMore()}
						>
							{chatsStore.loadingMore ? 'Loading…' : 'Load more chats'}
						</button>
					{/if}
				{/if}
			</nav>
			{/if}

			<!-- Keep-alive CharactersModal (survives tab switches) -->
			{#if charEverShown}
			{#await import('$lib/components/CharactersModal.svelte') then { default: CharactersModal }}
				<div class="flex flex-1 flex-col min-h-0 {!charDesktopActive && !charMobileActive ? 'invisible pointer-events-none absolute inset-0' : ''}">
					<CharactersModal
						open={charDesktopActive || charMobileActive}
						embedded={true}
						selectedId={charDesktopActive ? selectedCharacterId : null}
						lorebooks={sidebarLorebooks}
						alwaysUseCharacterThemes={settings.alwaysUseCharacterThemes}
						colorCharacterCards={settings.colorCharacterCards ?? false}
						onclose={() => {
							if (isMobile || narrowDesktop) {
								showOnlyPanel('chats');
							} else {
								showCharacters = false;
								selectedCharacterId = null;
							}
						}}
						onnavigate={(id, chat) => { if (chat) chatsStore.add(chat); openChat(id); }}
						onselect={(id, edit) => {
							if (isMobile || narrowDesktop) {
								selectedCharacterId = id;
								characterEditMode = !!edit;
								showOnlyPanel('characters');
								if (isMobile) mobileOpen = false;
								if (narrowDesktop) setSidebarVisible(false);
							} else {
								selectedCharacterId = id; characterEditMode = !!edit;
							}
							if (id != null) dismissOverlay();
						}}
						onaicreate={(seed) => {
							aiCreatorSeed = seed;
							aiCreatorOpen = true;
							selectedCharacterId = null;
							if (isMobile || narrowDesktop) {
								showOnlyPanel('characters');
								if (isMobile) mobileOpen = false;
								if (narrowDesktop) setSidebarVisible(false);
							}
						}}
					/>
				</div>
			{/await}
			{/if}

			</div>

			<!-- Mobile new chat FAB — always rendered so the appearance/disappearance
				 at the mobile breakpoint animates instead of popping. -->
			<button
				onclick={() => { showOnlyPanel('characters'); }}
				class="absolute bottom-20 right-4 z-10 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg {hydrated ? 'transition-[transform,opacity] duration-300' : ''} {isMobile && mobileDrawerTab === 'chats' ? 'translate-y-0 opacity-100 active:scale-95' : 'pointer-events-none translate-y-24 opacity-0'}"
				use:tooltip={'New Chat'}
				aria-label="New Chat"
				tabindex={isMobile && mobileDrawerTab === 'chats' ? 0 : -1}
			>
				<SquarePen class="h-5 w-5" />
			</button>

			<!-- Mobile bottom tab bar — always rendered so it slides in/out on
				 the mobile breakpoint instead of popping. Hidden via translate +
				 opacity + max-height collapse when not on mobile. -->
			<div class="shrink-0 overflow-hidden {isMobile ? 'border-t border-sidebar-border/50' : 'border-t-0'} {hydrated ? 'transition-[max-height,transform,opacity] duration-300 ease-out' : ''} {isMobile ? 'max-h-32 translate-y-0 opacity-100' : 'max-h-0 translate-y-full opacity-0'}">
				<div class="flex items-center justify-around px-1 pt-1 pb-5">
					<button
						onclick={() => { showOnlyPanel('chats'); selectedCharacterId = null; selectedLorebookId = null; }}
						class="flex flex-1 flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 transition-all active:scale-90 {mobileDrawerTab === 'chats' ? 'text-primary' : 'text-muted-foreground'}"
						aria-label="Chats"
					>
						<div class="relative">
							<MessageSquare class="h-5 w-5" />
							{#if totalUnread > 0}
								<span class="absolute -right-2 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[8px] font-bold text-primary-foreground">{totalUnread}</span>
							{/if}
						</div>
						<span class="text-[10px]">Chats</span>
					</button>
					<button
						onclick={() => { showOnlyPanel('characters'); }}
						class="flex flex-1 flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 transition-all active:scale-90 {mobileDrawerTab === 'characters' ? 'text-primary' : 'text-muted-foreground'}"
						aria-label="Characters"
					>
						<Users class="h-5 w-5" />
						<span class="text-[10px]">Characters</span>
					</button>
					<button
						onclick={() => { showOnlyPanel('lorebooks'); }}
						class="flex flex-1 flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 transition-all active:scale-90 {mobileDrawerTab === 'lorebooks' ? 'text-primary' : 'text-muted-foreground'}"
						aria-label="Lorebooks"
					>
						<BookOpen class="h-5 w-5" />
						<span class="text-[10px]">Lorebooks</span>
					</button>
					<button
						onclick={() => { showOnlyPanel('personas'); }}
						class="flex flex-1 flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 transition-all active:scale-90 {mobileDrawerTab === 'personas' ? 'text-primary' : 'text-muted-foreground'}"
						aria-label="Personas"
					>
						<User class="h-5 w-5" />
						<span class="text-[10px]">Personas</span>
					</button>
					<button
						onclick={() => { showOnlyPanel('settings'); }}
						class="flex flex-1 flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 transition-all active:scale-90 {mobileDrawerTab === 'settings' ? 'text-primary' : 'text-muted-foreground'}"
						aria-label="Settings"
					>
						<Settings class="h-5 w-5" />
						<span class="text-[10px]">Settings</span>
					</button>
				</div>
			</div>

			<!-- Resize handle (desktop only) -->
			{#if !isMobile}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize transition-colors hover:bg-primary/30 {isResizing ? 'bg-primary/40' : ''}"
				onmousedown={startResize}
			></div>
			{/if}
		</aside>

	<!-- Main content -->
	<main class="flex min-w-0 flex-1 flex-col overflow-hidden bg-background md:gap-2 md:overflow-visible md:bg-transparent">
		<!-- Notification permission banner. Show whenever push is NOT subscribed for this device (covers fresh sign-in, after "Disable notifications" from the Signed-in-devices list, and the original "permission not yet granted" case). Hidden on insecure (non-HTTPS) origins because Web Push won't work there anyway, or when the API isn't supported at all. -->
		{#if notif.pushSubscriptionReady && notif.secureContext && notif.permission !== 'unsupported' && !notif.pushSubscribed && !notif.bannerDismissed}
			<div class="flex shrink-0 flex-col gap-1 border-b border-border/50 bg-accent/30 px-4 py-2 md:rounded-2xl md:border-b-0">
				<div class="flex items-center gap-3">
					<Bell class="h-4 w-4 text-primary shrink-0" />
					<span class="flex-1 text-sm">Enable notifications to get alerts when background responses complete.</span>
					<button
						onclick={notif.enable}
						class="shrink-0 rounded-lg bg-primary px-3 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
					>
						Enable
					</button>
					<button
						onclick={notif.dismissBanner}
						class="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
						use:tooltip={'Dismiss'}
						aria-label="Dismiss notification"
					>
						<X class="h-3.5 w-3.5" />
					</button>
				</div>
				{#if notif.status}
					<p class="text-xs text-amber-500">{notif.status}</p>
				{/if}
			</div>
		{/if}

		<!-- In-app chat notifications now flow through the unified <Toast />
		     overlay (toasts.chat) so they share the same top-right stack as
		     system success/error toasts. -->

		<!-- Mobile header bar (only shown when no chat or view is active) -->
		{#if !(activeChatId && chatData) && !(isMobile && (showCharacters || showLorebooks || showSettings))}
			<div class="flex h-14 shrink-0 items-center gap-3 border-b border-border/50 px-4 shadow-sm shadow-black/5 md:hidden {hydrated ? 'transition-[height,opacity,padding] duration-300' : ''}">
				<button
					onclick={() => (mobileOpen = true)}
					class="relative rounded-lg p-3 -m-1.5 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
					aria-label="Open menu"
				>
					<Menu class="h-6 w-6" />
					{#if totalUnread > 0}
						<span class="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">{totalUnread}</span>
					{/if}
				</button>
				<span class="font-bold text-primary" style="font-size: 30px">Skald</span>
			</div>
		{/if}

		{#if showDesktopMobileBackButton}
			<div class="flex h-12 shrink-0 items-center border-b border-border/50 px-3">
				<button
					onclick={() => (mobileOpen = true)}
					class="relative inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
					aria-label="Open menu"
				>
					<ChevronLeft class="h-4 w-4" />
					<span>Back to menu</span>
					{#if totalUnread > 0}
						<span class="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">{totalUnread}</span>
					{/if}
				</button>
			</div>
		{/if}
		{#if showSettings}
			{#await import('$lib/components/SettingsModal.svelte') then { default: SettingsModal }}
				<SettingsModal
					open={showSettings}
					mode={isMobile ? 'page' : 'embedded'}
					activeTab={settingsActiveTab}
					providers={sidebarProviders}
					themes={sidebarThemes}
					alwaysUseCharacterThemes={settings.alwaysUseCharacterThemes}
					allowExternalCreatorNotes={settings.allowExternalCreatorNotes}
					colorCharacterCards={settings.colorCharacterCards ?? false}
					fontSize={settings.fontSize ?? 'medium'}
					compactMode={settings.compactMode ?? false}
					reduceMotion={settings.reduceMotion ?? false}
					sendWithEnterDesktop={settings.sendWithEnterDesktop ?? true}
					sendWithEnterMobile={settings.sendWithEnterMobile ?? true}
					autoScrollThreshold={settings.autoScrollThreshold ?? 'normal'}
					confirmDeletions={settings.confirmDeletions ?? true}
					messageTimestamps={settings.messageTimestamps ?? 'relative'}
					showReasoning={settings.showReasoning ?? false}
					notificationSound={settings.notificationSound ?? false}
					notificationStyle={settings.notificationStyle ?? 'generic'}
					notificationAvatar={settings.notificationAvatar ?? true}
					inAppNotifications={settings.inAppNotifications ?? true}
					notificationDuration={(settings as any).notificationDuration ?? 5}
					quietHoursEnabled={settings.quietHoursEnabled ?? false}
					quietHoursStart={settings.quietHoursStart ?? '22:00'}
					quietHoursEnd={settings.quietHoursEnd ?? '07:00'}
					renderMode={settings.renderMode ?? 'roleplay'}
					chatPageSize={settings.chatPageSize ?? 50}
					reformatterProviderId={settings.reformatterProviderId ?? ''}
					reformatterModel={settings.reformatterModel ?? ''}
					reformatterPrompt={settings.reformatterPrompt ?? ''}
					characterCreatorProviderId={settings.characterCreatorProviderId ?? ''}
					characterCreatorModel={settings.characterCreatorModel ?? ''}
					characterCreatorPrompt={settings.characterCreatorPrompt ?? ''}
					compactionEnabled={(settings as any).compactionEnabled ?? false}
					compactionThreshold={(settings as any).compactionThreshold ?? 80}
					compactionMode={(settings as any).compactionMode ?? 'threshold'}
					compactionTargetPercent={(settings as any).compactionTargetPercent ?? 50}
					compactionFixedCount={(settings as any).compactionFixedCount ?? 20}
					compactionProviderId={(settings as any).compactionProviderId ?? ''}
					compactionModel={(settings as any).compactionModel ?? ''}
					compactionPrompt={(settings as any).compactionPrompt ?? ''}
					speechOpacity={settings.speechOpacity ?? 100}
					speechBold={settings.speechBold ?? true}
					speechItalic={settings.speechItalic ?? false}
					thoughtOpacity={settings.thoughtOpacity ?? 75}
					thoughtBold={settings.thoughtBold ?? false}
					thoughtItalic={settings.thoughtItalic ?? true}
					linkOpacity={settings.linkOpacity ?? 100}
					linkBold={settings.linkBold ?? false}
					linkItalic={settings.linkItalic ?? false}
					narrationOpacity={settings.narrationOpacity ?? 100}
					narrationBold={settings.narrationBold ?? false}
					narrationItalic={settings.narrationItalic ?? false}
					nestedEmphasisInSpeech={settings.nestedEmphasisInSpeech ?? true}
					promptSlotOrder={settings.promptSlotOrder ?? ''}
					user={data.user ?? null}
					activeChatId={activeChatId}
					onchatimported={handleImportedChat}
					onclose={() => { showOnlyPanel('chats'); if (isMobile) mobileOpen = true; }}
				/>
			{/await}
		{:else if showLorebooks}
			{#if selectedLorebookId}
				{#await import('$lib/components/LorebookEditModal.svelte') then { default: LorebookEditModal }}
					<LorebookEditModal
						open={true}
						embedded={true}
						lorebookId={selectedLorebookId}
						onclose={() => { selectedLorebookId = null; if (isMobile) { showOnlyPanel('chats'); mobileOpen = true; } }}
					/>
				{/await}
			{:else}
				<div class="flex h-full flex-col items-center justify-center text-muted-foreground md:rounded-2xl md:bg-background">
					<BookOpen class="mb-4 h-12 w-12 opacity-20" />
					<p class="text-lg font-medium">Lorebooks</p>
					<p class="mt-2 text-sm">Select a lorebook from the sidebar to edit it</p>
				</div>
			{/if}
		{:else if showPersonas}
			{#if creatingPersona || selectedPersonaId !== null}
				{#await import('$lib/components/PersonaEditPane.svelte') then { default: PersonaEditPane }}
					<PersonaEditPane
						persona={creatingPersona
							? null
							: (sidebarPersonas.find((p: any) => p.id === selectedPersonaId) ?? null)}
						onsaved={(id) => { selectedPersonaId = id; creatingPersona = false; }}
						ondeleted={() => {
							creatingPersona = false;
							const fallback = personasStore.defaultPersona ?? sidebarPersonas[0] ?? null;
							selectedPersonaId = fallback ? fallback.id : null;
						}}
					/>
				{/await}
			{:else}
				<div class="flex h-full flex-col items-center justify-center text-muted-foreground md:rounded-2xl md:bg-background">
					<User class="mb-4 h-12 w-12 opacity-20" />
					<p class="text-lg font-medium">Personas</p>
					<p class="mt-2 max-w-xs text-center text-sm">Manage the personas the AI uses for <code class="rounded bg-muted px-1 py-0.5 text-xs">{'{{user}}'}</code>. Pick one from the sidebar or tap + to create a new one.</p>
				</div>
			{/if}
		{:else if showCharacters}
			{#if aiCreatorOpen}
				{#await import('$lib/components/CharacterAICreatorView.svelte') then { default: CharacterAICreatorView }}
					<CharacterAICreatorView
						open={true}
						seed={aiCreatorSeed}
						editingCharacter={aiCreatorEditingId ? aiCreatorEditingChar : null}
						onclose={() => {
							const wasEditingId = aiCreatorEditingId;
							aiCreatorOpen = false;
							aiCreatorSeed = undefined;
							aiCreatorEditingId = null;
							aiCreatorEditingChar = null;
							if (wasEditingId != null) {
								selectedCharacterId = wasEditingId;
								characterEditMode = false;
							}
						}}
						oncreated={(id) => {
							aiCreatorOpen = false;
							aiCreatorSeed = undefined;
							aiCreatorEditingId = null;
							aiCreatorEditingChar = null;
							selectedCharacterId = id;
							characterEditMode = false;
						}}
					/>
				{/await}
			{:else if selectedCharacterId}
				{#if selectedCharFull}
					{#await import('$lib/components/CharacterEditModal.svelte') then { default: CharacterEditModal }}
						<CharacterEditModal
							open={true}
							embedded={true}
							initialEditing={characterEditMode}
							character={selectedCharFull}
							userName={personasStore.defaultPersona?.name || 'User'}
							hasLorebook={sidebarLorebooks.some((l: any) => l.characterId === selectedCharacterId)}
							onclose={() => { selectedCharacterId = null; if (isMobile) { showOnlyPanel('chats'); mobileOpen = true; } }}
							ondelete={(keepLorebook) => {
								const id = selectedCharacterId;
								if (id == null) return;
								const url = keepLorebook ? `/api/characters/${id}?keepLorebook=true` : `/api/characters/${id}`;
								fetch(url, { method: 'DELETE' }).then((res) => {
									if (res.ok) {
										selectedCharacterId = null;
										charactersStore.remove(id);
									}
								});
							}}
							onstartchat={async (characterId, mode) => {
								const res = await fetch('/api/chats', {
									method: 'POST',
									headers: { 'Content-Type': 'application/json' },
									body: JSON.stringify({ characterId, mode })
								});
								if (res.ok) {
									const body = await res.json();
									showCharacters = false;
									selectedCharacterId = null;
									if (body.chat) chatsStore.add(body.chat);
									openChat(body.id);
								}
							}}
							onaiedit={(id) => {
								aiCreatorEditingId = id;
								aiCreatorEditingChar = selectedCharFull;
								aiCreatorOpen = true;
								selectedCharacterId = null;
							}}
						/>
					{/await}
				{:else}
					<div class="flex h-full flex-col items-center justify-center text-muted-foreground md:rounded-2xl md:bg-background">
						<Users class="mb-4 h-12 w-12 opacity-20" />
						<p class="text-lg font-medium">Loading…</p>
					</div>
				{/if}
			{:else}
				<div class="flex h-full flex-col items-center justify-center text-muted-foreground md:rounded-2xl md:bg-background">
					<Users class="mb-4 h-12 w-12 opacity-20" />
					<p class="text-lg font-medium">Characters</p>
					<p class="mt-2 text-sm">Select a character from the sidebar to edit it</p>
				</div>
			{/if}
		{:else if activeChatId && chatData}
			{#key chatData.chat.id}
				<ChatView
					chat={chatData.chat}
					character={chatData.character}
					initialMessages={chatData.messages}
					messageSiblingsData={chatData.messageSiblings}
					hiddenBranchData={chatData.hiddenBranchCount}
					totalMessageCount={chatData.totalMessages ?? chatData.messages.length}
					providers={sidebarProviders}
					personas={sidebarPersonas}
					onrefresh={handleChatRefresh}
					{streamEvent}
					ontogglemobile={() => (mobileOpen = true)}
					{totalUnread}
					sendWithEnterDesktop={settings.sendWithEnterDesktop ?? true}
					sendWithEnterMobile={settings.sendWithEnterMobile ?? true}
					autoScrollThreshold={settings.autoScrollThreshold ?? 'normal'}
					confirmDeletions={settings.confirmDeletions ?? true}
					messageTimestamps={settings.messageTimestamps ?? 'relative'}
					showReasoning={settings.showReasoning ?? false}
					chatPageSize={settings.chatPageSize ?? 50}
					allLorebooks={sidebarLorebooks}
					renderMode={settings.renderMode ?? 'roleplay'}
					reduceMotion={settings.reduceMotion ?? false}
					blockExternalContent={!(settings.allowExternalCreatorNotes ?? false)}
					nestedEmphasisInSpeech={settings.nestedEmphasisInSpeech ?? true}
					connectionState={realtime.connectionState}
				/>
			{/key}
		{:else if chatLoading}
			<div class="flex h-full flex-col items-center justify-center text-muted-foreground md:rounded-2xl md:bg-background">
				{#if showChatSpinner}
					<div class="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent fade-in"></div>
				{/if}
			</div>
		{:else}
			<div class="fade-in flex h-full flex-col items-center justify-center text-muted-foreground md:rounded-2xl md:bg-background">
				<MessageSquare class="mb-4 h-16 w-16 opacity-20" />
				<p class="text-xl font-medium">Welcome to Skald</p>
				<p class="mt-2 text-sm">Select a conversation from the sidebar or start a new chat</p>
				<button
					onclick={() => showOnlyPanel('characters')}
					class="mt-6 flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-md shadow-primary/25 transition-all hover:bg-primary/90 hover:scale-105 hover:shadow-lg hover:shadow-primary/30"
				>
					<Plus class="h-4 w-4" />
					New Chat
				</button>
			</div>
		{/if}
		<div class="hidden">{@render children()}</div>
	</main>
</div>
{/if}

<!-- Modals (lazy-loaded on demand) -->
{#if chatMenu.openChatId !== null && chatMenu.position}
	{@const menuChat = chatsStore.chats.find((c: any) => c.id === chatMenu.openChatId)}
	{#if menuChat}
		{@const isPinned = pinStateOverrides.has(menuChat.id) ? pinStateOverrides.get(menuChat.id) : menuChat.pinned}
		{@const pinIdx = pinnedChats.findIndex((c: any) => c.id === menuChat.id)}
		{@const menuChatId = menuChat.id}
		{@const menuChatTitle = menuChat.title ?? ''}
		{@const menuIsPinned = !!isPinned}
		<div
			data-chat-menu
			class="popup-menu fixed z-[60] w-48 rounded-xl border border-border bg-popover py-1 shadow-2xl"
			style="--popup-origin: {chatMenu.position.flipUp ? 'bottom' : 'top'} left; left: {chatMenu.position.x}px; {chatMenu.position.flipUp ? 'bottom' : 'top'}: {chatMenu.position.flipUp ? (window.innerHeight - chatMenu.position.y) + 'px' : chatMenu.position.y + 'px'}"
		>
			<button
				type="button"
				onclick={(e) => { togglePin(menuChatId, menuIsPinned, e); chatMenu.close(); }}
				class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
			>
				{#if isPinned}<PinOff class="h-4 w-4" />Unpin{:else}<Pin class="h-4 w-4" />Pin{/if}
			</button>
			{#if isPinned && pinIdx > 0}
				<button
					type="button"
					onclick={() => { movePinned(menuChatId, 'up'); chatMenu.close(); }}
					class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
				>
					<ArrowUp class="h-4 w-4" />Move up
				</button>
			{/if}
			{#if isPinned && pinIdx >= 0 && pinIdx < pinnedChats.length - 1}
				<button
					type="button"
					onclick={() => { movePinned(menuChatId, 'down'); chatMenu.close(); }}
					class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
				>
					<ArrowDown class="h-4 w-4" />Move down
				</button>
			{/if}
			<button
				type="button"
				onclick={(e) => { e.stopPropagation(); renamingChatId = menuChatId; renameValue = menuChatTitle; chatMenu.close(); }}
				class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
			>
				<Pencil class="h-4 w-4" />Rename
			</button>
			<button
				type="button"
				onclick={() => { toggleMute(menuChatId, !!menuChat.muted); chatMenu.close(); }}
				class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
			>
				{#if menuChat.muted}<Bell class="h-4 w-4" />Unmute{:else}<BellOff class="h-4 w-4" />Mute{/if}
			</button>
			<div class="my-1 h-px bg-border"></div>
			<button
				type="button"
				onclick={(e) => { deleteChat(menuChatId, e); chatMenu.close(); }}
				class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-destructive transition-colors hover:bg-destructive/10"
			>
				<Trash2 class="h-4 w-4" />Delete
			</button>
		</div>
	{/if}
{/if}
<ImageModal
	src={enlargedImage}
	onclose={() => (enlargedImage = null)}
/>
<ConfirmModal
	open={confirmOpen}
	title={confirmTitle}
	message={confirmMessage}
	onconfirm={handleConfirm}
	secondaryLabel={confirmSecondaryLabel}
	onsecondary={confirmSecondaryAction ? handleSecondary : undefined}
	oncancel={() => (confirmOpen = false)}
/>

<DialogHost />
<Toast />

{#if realtime.connectionState !== 'connected'}
	<div class="fixed inset-0 z-[300] flex items-center justify-center bg-background/80 backdrop-blur-md">
		<div class="mx-4 flex w-full max-w-sm flex-col items-center gap-5 rounded-2xl border border-border bg-card p-8 text-center shadow-2xl">
			<div class="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
				<WifiOff class="h-6 w-6 text-muted-foreground" />
			</div>
			<div class="flex flex-col gap-2">
				<h2 class="text-lg font-semibold text-foreground">No Server Connection</h2>
				<p class="text-sm leading-relaxed text-muted-foreground">
					{#if realtime.connectionState === 'failed'}
						Unable to reach the server after several minutes. Check that it's running, then retry.
					{:else}
						Lost connection to the server. Reconnecting automatically&hellip;
					{/if}
				</p>
			</div>
			<button
				onclick={() => realtime.manualReconnect()}
				class="rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 active:scale-95"
			>
				Retry Now
			</button>
		</div>
	</div>
{/if}

<style>
	.sidebar-typing-dot {
		animation: sidebar-typing-bounce 1.2s ease-in-out infinite;
	}

	@keyframes sidebar-typing-bounce {
		0%, 60%, 100% {
			transform: translateY(0);
			opacity: 0.45;
		}
		30% {
			transform: translateY(-2px);
			opacity: 1;
		}
	}

	@media (max-width: 767px) {
		:global([data-ssr][data-mobile-sidebar]) {
			position: fixed !important;
			top: 0 !important;
			bottom: 0 !important;
			left: 0 !important;
			z-index: 50 !important;
			display: flex !important;
			flex-direction: column !important;
			width: 85vw !important;
			max-width: 20rem !important;
			transform: translateX(-100%) !important;
			pointer-events: none !important;
		}
	}
</style>
