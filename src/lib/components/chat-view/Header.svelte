<script lang="ts">
	import { ChevronLeft, Smartphone, BookOpen, Search, X } from 'lucide-svelte';
	import { tick } from 'svelte';
	import ChatHeaderMenu from '$lib/components/ChatHeaderMenu.svelte';

	// Pure presentational header. No store access — the orchestrator passes
	// in everything that needs to render, including handlers. This keeps the
	// component reusable and trivially testable, and means we can drop it
	// straight into either the old ChatView or the new orchestrator.
	let {
		character,
		isTexting,
		lastTokenStats = null,
		showTokenRing = true,
		totalUnread = 0,
		showHeaderMenu,
		hasOverrides,
		hasCompactionSummary,
		compactingNow,
		searchOpen = false,
		searchQuery = $bindable(''),
		searchMatchCount = 0,
		ontogglemobile,
		onAvatarClick,
		onToggleHeaderMenu,
		onCloseHeaderMenu,
		onCharacterInfo,
		onSearchMessages,
		onSearchClose,
		onLorebooks,
		onCompactNow,
		onViewCompaction,
		onChatSettings
	}: {
		character: { name: string; avatarPath: string | null };
		isTexting: boolean;
		lastTokenStats?: { promptTokens: number; availableForPrompt: number } | null;
		showTokenRing?: boolean;
		totalUnread?: number;
		showHeaderMenu: boolean;
		hasOverrides: boolean;
		hasCompactionSummary: boolean;
		compactingNow: boolean;
		searchOpen?: boolean;
		searchQuery?: string;
		searchMatchCount?: number;
		ontogglemobile?: () => void;
		onAvatarClick: () => void;
		onToggleHeaderMenu: (e: MouseEvent) => void;
		onCloseHeaderMenu: () => void;
		onCharacterInfo: () => void;
		onSearchMessages: () => void;
		onSearchClose: () => void;
		onLorebooks: () => void;
		onCompactNow: () => void;
		onViewCompaction: () => void;
		onChatSettings: () => void;
	} = $props();

	// Ring around the avatar+name pill. pathLength=100 lets us use the
	// percentage value directly as stroke-dasharray without having to know
	// the actual perimeter of the rounded-rect. We bind the pill's rendered
	// size so the SVG always tracks it (handles long names, font scaling,
	// flex wrap). rx=height/2 gives true pill rounding.
	let pillW = $state(0);
	let pillH = $state(0);
	let ringVisible = $derived(showTokenRing && !!lastTokenStats);

	let ringPct = $derived(
		lastTokenStats
			? Math.min(Math.round((lastTokenStats.promptTokens / lastTokenStats.availableForPrompt) * 100), 100)
			: 0
	);

	// Auto-focus the search input on open. Tick() lets the DOM paint the
	// pill before we grab focus — matches MessageSearchBar's old behaviour.
	let searchInputEl: HTMLInputElement | undefined = $state();
	$effect(() => {
		if (searchOpen) void tick().then(() => searchInputEl?.focus());
	});
</script>

<!-- Fullscreen-mobile layout: the chat header floats over the messages
     with a translucent slab, and the bg-image bleeds through via the
     scrim + safe-area padding so messages don't read as a hard edge
     against the status bar. Safe-area insets evaluate to 0 on desktop,
     so the header looks identical there. -->
<header
	class="pointer-events-none absolute left-0 right-0 top-0 z-[3] flex min-h-16 flex-wrap items-center gap-2 md:gap-3"
	style="padding-top: max(0.5rem, var(--safe-area-top)); padding-bottom: 0.5rem; padding-left: max(0.75rem, var(--safe-area-left)); padding-right: max(0.75rem, var(--safe-area-right));"
>
	<!-- Back button only appears in the mobile layout (under md, where the
	     left tab bar is hidden) AND on hover-capable devices (mouse). Touch
	     mobile users have swipe-from-left for the drawer; desktop users
	     have the tab bar; only mouse-on-narrow needs this affordance. -->
	{#if ontogglemobile}
		<button
			onclick={ontogglemobile}
			class="pointer-events-auto relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border/40 bg-translucent text-muted-foreground shadow-sm backdrop-blur-md transition-colors hover:bg-accent hover:text-foreground active:scale-90 md:hidden [@media(hover:none)]:hidden"
			style="--translucent-base: 1;"
			aria-label="Back to chats"
		>
			<ChevronLeft class="h-5 w-5" />
			{#if totalUnread && totalUnread > 0}
				<span class="absolute right-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">{totalUnread}</span>
			{/if}
		</button>
	{/if}

	<!-- Avatar + name pill. Mirrors the compose row's translucent slab so
	     the two anchors visually balance, top and bottom. Picks up
	     --background / --card from the active character theme so themed
	     chats get a tinted pill automatically.
	     `shrink-0` keeps the avatar/name from ever truncating — when the
	     search pill won't fit alongside, it wraps to a new row instead. -->
	<div
		bind:clientWidth={pillW}
		bind:clientHeight={pillH}
		class="pointer-events-auto relative flex shrink-0 items-center gap-2.5 rounded-full border border-border/40 bg-translucent py-1 pl-1 pr-3 shadow-sm backdrop-blur-md md:gap-3 md:pr-4"
		style="--translucent-base: 1;"
	>
		{#if ringVisible && pillW > 0 && pillH > 0}
			<!-- Context-usage ring around the entire pill. pathLength=100
			     lets us treat the ring as a percentage track regardless of
			     the actual perimeter, so we don't need to recompute as the
			     pill resizes. Rx = half the pill height for true pill
			     rounding. Strokes are slightly inset (x/y = 1) so the ring
			     doesn't clip against the SVG bounding box. -->
			<svg
				class="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
				role="img"
				aria-label="Context: {lastTokenStats?.promptTokens.toLocaleString()} / {lastTokenStats?.availableForPrompt.toLocaleString()} tokens ({ringPct}%)"
			>
				<title>Context: {lastTokenStats?.promptTokens.toLocaleString()} / {lastTokenStats?.availableForPrompt.toLocaleString()} tokens ({ringPct}%)</title>
				<rect
					x="1"
					y="1"
					width={pillW - 2}
					height={pillH - 2}
					rx={(pillH - 2) / 2}
					fill="none"
					stroke-width="2"
					class="{ringPct > 90 ? 'text-destructive' : ringPct > 70 ? 'text-warning' : 'text-primary/70'} transition-all duration-500"
					stroke="currentColor"
					pathLength="100"
					stroke-dasharray="{ringPct} 100"
					stroke-linecap="round"
				/>
			</svg>
		{/if}
		<div class="pointer-events-auto relative h-12 w-12 shrink-0">
			{#if character.avatarPath}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
				<img
					src={character.avatarPath}
					alt={character.name}
					class="absolute inset-0 h-full w-full cursor-pointer rounded-full object-cover ring-2 ring-background transition-opacity hover:opacity-80"
					onclick={(e) => {
						e.stopPropagation();
						onAvatarClick();
					}}
				/>
			{:else}
				<div class="absolute inset-0 flex items-center justify-center rounded-full bg-primary text-base font-semibold text-primary-foreground ring-2 ring-background">
					{character.name[0]}
				</div>
			{/if}
			<!-- Story/text-mode badge in the avatar's bottom-right corner. -->
			<span class="pointer-events-none absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm">
				{#if isTexting}
					<Smartphone class="h-2.5 w-2.5" />
				{:else}
					<BookOpen class="h-2.5 w-2.5" />
				{/if}
			</span>
		</div>

		<h2 class="whitespace-nowrap text-[15px] font-semibold leading-tight md:text-base">{character.name}</h2>
	</div>

	<!-- Menu button. DOM-positioned BEFORE the search pill so that when the
	     row overflows, it's the search pill (last in DOM) that wraps to
	     line 2, not the menu. `order-3` keeps the menu visually anchored
	     to the right of the first row regardless of the search pill's
	     wrap state. -->
	<div class="pointer-events-auto order-3 flex shrink-0 items-center">
		<ChatHeaderMenu
			open={showHeaderMenu}
			{hasOverrides}
			{hasCompactionSummary}
			{compactingNow}
			onToggle={onToggleHeaderMenu}
			onClose={onCloseHeaderMenu}
			onCharacterInfo={onCharacterInfo}
			onSearchMessages={onSearchMessages}
			onLorebooks={onLorebooks}
			onCompactNow={onCompactNow}
			onViewCompaction={onViewCompaction}
			onChatSettings={onChatSettings}
		/>
	</div>

	<!-- Inline search pill, or a flex-1 spacer when closed. Either way it
	     sits visually (order-2) between the name pill and the menu while
	     being DOM-last so it's the one that wraps to line 2 when the row
	     runs out of room. -->
	{#if searchOpen}
		<div class="pointer-events-auto order-2 flex h-11 min-w-[14rem] max-w-md flex-1 items-center gap-2 rounded-full border border-border/40 bg-translucent px-4 shadow-sm backdrop-blur-md" style="--translucent-base: 1;">
			<Search class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
			<input
				bind:this={searchInputEl}
				bind:value={searchQuery}
				placeholder="Search in conversation…"
				class="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
				onkeydown={(e) => { if (e.key === 'Escape') onSearchClose(); }}
			/>
			{#if searchQuery.trim()}
				<span class="shrink-0 text-xs text-muted-foreground">
					{searchMatchCount}
					{searchMatchCount === 1 ? 'match' : 'matches'}
				</span>
			{/if}
			<button
				onclick={onSearchClose}
				class="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
				aria-label="Close search"
			>
				<X class="h-3.5 w-3.5" />
			</button>
		</div>
	{:else}
		<div class="order-2 flex-1"></div>
	{/if}
</header>
