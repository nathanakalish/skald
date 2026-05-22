<script lang="ts">
	import { X, Server, Palette, Users, MessageSquare, Settings2, Info, User, Bell, Sparkles, Type, PackageOpen } from 'lucide-svelte';
	import { untrack } from 'svelte';
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
	import FormattingPanel from '$lib/components/settings/FormattingPanel.svelte';
	import PromptsPanel from '$lib/components/settings/PromptsPanel.svelte';
	import NotificationsPanel from '$lib/components/settings/NotificationsPanel.svelte';
	import InstancePanel from '$lib/components/settings/InstancePanel.svelte';
	import { providersStore } from '$lib/stores/providers.svelte.js';

	interface Props {
		open: boolean;
		embedded?: boolean;
		mode?: 'modal' | 'embedded' | 'page';
		activeTab?: 'providers' | 'prompts' | 'formatting' | 'appearance' | 'chat' | 'notifications' | 'import-export' | 'account' | 'about' | 'instance' | 'users';
		providers: any[];
		user: { id: number; username: string; role: string } | null;
		onchatimported?: (chatId: number) => void;
		onclose: () => void;
	}

	let {
		open, embedded = false, mode: modeProp, activeTab: activeTabProp, providers,
		user = null, onchatimported, onclose
	}: Props = $props();
	const isAdmin = $derived(user?.role === 'admin');
	const mode = $derived(modeProp ?? (embedded ? 'embedded' : 'modal'));

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
						<FormattingPanel />

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
