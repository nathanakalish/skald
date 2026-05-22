<script lang="ts">
	import { X, Server, Palette, Users, MessageSquare, Settings2, Info, User, Bell, Sparkles, Type, PackageOpen } from 'lucide-svelte';
	import { untrack } from 'svelte';
	import { toasts } from '$lib/stores/toast.svelte.js';
	import { createModalState, createModalGestures } from '$lib/modal.svelte.js';
	import { focusTrap } from '$lib/focusTrap.js';
	import { tooltip } from '$lib/tooltip.js';
	import ToggleSwitch from '$lib/components/settings/ToggleSwitch.svelte';
	import AboutTab from '$lib/components/settings/AboutTab.svelte';
	import UserManagementPanel from '$lib/components/settings/UserManagementPanel.svelte';
	import ProviderListManager from '$lib/components/settings/ProviderListManager.svelte';
	import ImportExport from '$lib/components/settings/ImportExport.svelte';
	import AccountPanel from '$lib/components/settings/AccountPanel.svelte';
	import AppearancePanel from '$lib/components/settings/AppearancePanel.svelte';
	import ChatPanel from '$lib/components/settings/ChatPanel.svelte';
	import PromptsPanel from '$lib/components/settings/PromptsPanel.svelte';
	import NotificationsPanel from '$lib/components/settings/NotificationsPanel.svelte';
	import InstancePanel from '$lib/components/settings/InstancePanel.svelte';
	import { providersStore } from '$lib/stores/providers.svelte.js';
	import { settingsStore } from '$lib/stores/settings.svelte.js';

	interface Props {
		open: boolean;
		embedded?: boolean;
		mode?: 'modal' | 'embedded' | 'page';
		activeTab?: 'providers' | 'prompts' | 'formatting' | 'appearance' | 'chat' | 'notifications' | 'import-export' | 'account' | 'about' | 'instance' | 'users';
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
		notificationDuration: number;
		quietHoursEnabled: boolean;
		quietHoursStart: string;
		quietHoursEnd: string;
		renderMode: string;
		chatPageSize: number;
		autoLoadEarlierMessages: boolean;
		reformatterProviderId: string;
		reformatterModel: string;
		reformatterPrompt: string;
		characterCreatorProviderId: string;
		characterCreatorModel: string;
		characterCreatorPrompt: string;
		compactionEnabled: boolean;
		compactionThreshold: number;
		compactionMode: string;
		compactionWindowPercent: number;
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
		onchatimported?: (chatId: number) => void;
		onclose: () => void;
	}

	let {
		open, embedded = false, mode: modeProp, activeTab: activeTabProp, providers, themes = [], alwaysUseCharacterThemes = false, allowExternalCreatorNotes = false, colorCharacterCards = false,
		fontSize = 'medium', compactMode = false, reduceMotion = false,
		sendWithEnterDesktop = true, sendWithEnterMobile = true, autoScrollThreshold = 'normal', confirmDeletions = true,
		messageTimestamps = 'relative', showReasoning = false, notificationSound = false, notificationStyle = 'generic', notificationAvatar = true,
		inAppNotifications = true, notificationDuration = 5,
		quietHoursEnabled = false, quietHoursStart = '22:00', quietHoursEnd = '07:00',
		renderMode = 'roleplay',
		chatPageSize = 50,
		autoLoadEarlierMessages = false,
		reformatterProviderId = '', reformatterModel = '', reformatterPrompt = '',
		characterCreatorProviderId = '', characterCreatorModel = '', characterCreatorPrompt = '',
		compactionEnabled = false, compactionThreshold = 80, compactionMode = 'window',
		compactionWindowPercent = 30, compactionFixedCount = 20,
		compactionProviderId = '', compactionModel = '', compactionPrompt = '',
		speechOpacity = 100, speechBold = true, speechItalic = false,
		thoughtOpacity = 75, thoughtBold = false, thoughtItalic = true,
		linkOpacity = 100, linkBold = false, linkItalic = false,
		narrationOpacity = 100, narrationBold = false, narrationItalic = false,
		nestedEmphasisInSpeech = true,
		promptSlotOrder = '',
		user = null, onchatimported, onclose
	}: Props = $props();
	const isAdmin = $derived(user?.role === 'admin');
	const mode = $derived(modeProp ?? (embedded ? 'embedded' : 'modal'));

	let localRenderMode = $state('roleplay');

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

	$effect(() => {
		if (open) {
			untrack(() => {
				localRenderMode = renderMode;
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
			});
		}
	});

	async function saveSetting(key: string, value: string | boolean | number) {
		const ok = await settingsStore.save(key as any, value);
		if (ok) toasts.success('Setting saved');
	}

	async function toggleBoolSetting(key: string, getter: () => boolean, setter: (v: boolean) => void) {
		const newVal = !getter();
		setter(newVal);
		await saveSetting(key, newVal);
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
		{ id: 'import-export', label: 'Import / Export', icon: PackageOpen },
		{ id: 'account', label: 'Account', icon: User },
	] as const;

	const adminTabs = [
		{ id: 'instance', label: 'Instance', icon: Settings2 },
		{ id: 'users', label: 'Users', icon: Users }
	] as const;

	const aboutTab = { id: 'about', label: 'About', icon: Info } as const;

	type TabId = 'providers' | 'prompts' | 'formatting' | 'appearance' | 'chat' | 'notifications' | 'import-export' | 'account' | 'about' | 'instance' | 'users';

	const tabs = $derived(isAdmin ? [...baseTabs, ...adminTabs, aboutTab] : [...baseTabs, aboutTab]);

	let internalActiveTab = $state<TabId>(untrack(() => activeTabProp) ?? 'providers');
	const activeTab = $derived<TabId>(mode === 'embedded' && activeTabProp ? activeTabProp : internalActiveTab);

	$effect(() => {
		if (activeTabProp && mode === 'page') {
			internalActiveTab = activeTabProp;
		}
	});

	// User management state (admin only)

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
						<PromptsPanel />

					{:else if activeTab === 'chat'}
						<ChatPanel active={activeTab === 'chat'} />

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
													use:tooltip={'Bold'}
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
													use:tooltip={'Italic'}
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
					</div>

					{:else if activeTab === 'appearance'}
						<AppearancePanel />

					{:else if activeTab === 'users'}
						<!-- Users Tab (Admin only) -->
						{#if isAdmin}
							<UserManagementPanel currentUserId={user?.id} />
						{/if}

				{:else if activeTab === 'account'}
						<AccountPanel {user} />

				{:else if activeTab === 'import-export'}
						<ImportExport {onchatimported} />

				{:else if activeTab === 'notifications'}
						<NotificationsPanel active={activeTab === 'notifications'} />


						{:else if activeTab === 'instance'}
							{#if isAdmin}
								<InstancePanel active={activeTab === 'instance'} />
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
		<div class="@container flex-1 overflow-y-auto p-6">
			{@render settingsTabContent()}
		</div>
	</div>
{:else if mode === 'page' && open}
	<!-- Page mode: content only (mobile) — tab selection handled by drawer -->
	<div class="flex h-full flex-col overflow-hidden bg-background">
		<div class="@container flex-1 overflow-y-auto p-4">
			{@render settingsTabContent()}
		</div>
	</div>
{:else if modal.visible}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4 bg-black/60 {modal.closing ? 'backdrop-exit' : 'backdrop-enter'}"
		role="dialog" aria-modal="true" aria-label="Settings" tabindex="-1" use:focusTrap
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
						use:tooltip={tab.label}
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
				<div class="@container flex-1 overflow-y-auto p-4 sm:p-6 {gestures.contentClass}" style={gestures.contentStyle}>
					{@render settingsTabContent()}
				</div>
			</div>
		</div>
	</div>
{/if}
