<script lang="ts">
	import { ChevronLeft, Smartphone, BookOpen } from 'lucide-svelte';
	import ChatHeaderMenu from '$lib/components/ChatHeaderMenu.svelte';

	// Pure presentational header. No store access — the orchestrator passes
	// in everything that needs to render, including handlers. This keeps the
	// component reusable and trivially testable, and means we can drop it
	// straight into either the old ChatView or the new orchestrator.
	let {
		character,
		isTexting,
		lastTokenStats = null,
		totalUnread = 0,
		showHeaderMenu,
		hasOverrides,
		hasCompactionSummary,
		compactingNow,
		ontogglemobile,
		onAvatarClick,
		onToggleHeaderMenu,
		onCloseHeaderMenu,
		onCharacterInfo,
		onSearchMessages,
		onLorebooks,
		onCompactNow,
		onViewCompaction,
		onChatSettings
	}: {
		character: { name: string; avatarPath: string | null };
		isTexting: boolean;
		lastTokenStats?: { promptTokens: number; availableForPrompt: number } | null;
		totalUnread?: number;
		showHeaderMenu: boolean;
		hasOverrides: boolean;
		hasCompactionSummary: boolean;
		compactingNow: boolean;
		ontogglemobile?: () => void;
		onAvatarClick: () => void;
		onToggleHeaderMenu: (e: MouseEvent) => void;
		onCloseHeaderMenu: () => void;
		onCharacterInfo: () => void;
		onSearchMessages: () => void;
		onLorebooks: () => void;
		onCompactNow: () => void;
		onViewCompaction: () => void;
		onChatSettings: () => void;
	} = $props();

	// Ring geometry constants — kept inline because they're tied to the SVG
	// viewBox + the r=22 circle below; pulling them out would just be noise.
	const RING_CIRCUMFERENCE = 2 * Math.PI * 22;

	let ringPct = $derived(
		lastTokenStats
			? Math.min(Math.round((lastTokenStats.promptTokens / lastTokenStats.availableForPrompt) * 100), 100)
			: 0
	);
	let ringOffset = $derived(RING_CIRCUMFERENCE - (ringPct / 100) * RING_CIRCUMFERENCE);
</script>

<!-- Fullscreen-mobile layout: the chat header floats over the messages
     with a translucent slab, and the bg-image bleeds through via the
     scrim + safe-area padding so messages don't read as a hard edge
     against the status bar. Safe-area insets evaluate to 0 on desktop,
     so the header looks identical there. -->
<header
	class="pointer-events-none absolute left-0 right-0 top-0 z-[3] flex min-h-16 items-center gap-2 md:gap-3"
	style="padding-top: max(0.5rem, var(--safe-area-top)); padding-bottom: 0.5rem; padding-left: max(0.75rem, var(--safe-area-left)); padding-right: max(0.75rem, var(--safe-area-right));"
>
	<!-- Back button only appears in the mobile layout (under md, where the
	     left tab bar is hidden) AND on hover-capable devices (mouse). Touch
	     mobile users have swipe-from-left for the drawer; desktop users
	     have the tab bar; only mouse-on-narrow needs this affordance. -->
	{#if ontogglemobile}
		<button
			onclick={ontogglemobile}
			class="pointer-events-auto relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border/40 bg-card/70 text-muted-foreground shadow-sm backdrop-blur-md transition-colors hover:bg-accent hover:text-foreground active:scale-90 md:hidden [@media(hover:none)]:hidden"
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
	     chats get a tinted pill automatically. -->
	<div class="pointer-events-auto mr-auto flex min-w-0 max-w-full items-center gap-2.5 rounded-full border border-border/40 bg-card/70 py-1 pl-1 pr-3 shadow-sm backdrop-blur-md md:gap-3 md:pr-4">
		<div class="pointer-events-auto relative h-12 w-12 shrink-0">
			{#if lastTokenStats}
				<svg
					class="pointer-events-none absolute inset-0 h-full w-full"
					viewBox="0 0 48 48"
					role="img"
					aria-label="Context: {lastTokenStats.promptTokens.toLocaleString()} / {lastTokenStats.availableForPrompt.toLocaleString()} tokens ({ringPct}%)"
				>
					<title>Context: {lastTokenStats.promptTokens.toLocaleString()} / {lastTokenStats.availableForPrompt.toLocaleString()} tokens ({ringPct}%)</title>
					<circle cx="24" cy="24" r="22" fill="none" stroke="currentColor" stroke-width="2" class="text-muted/40" />
					<circle
						cx="24"
						cy="24"
						r="22"
						fill="none"
						stroke-width="2"
						class="{ringPct > 90 ? 'text-destructive' : ringPct > 70 ? 'text-warning' : 'text-primary/70'} transition-all duration-500"
						stroke="currentColor"
						stroke-dasharray={RING_CIRCUMFERENCE}
						stroke-dashoffset={ringOffset}
						stroke-linecap="round"
						transform="rotate(-90 24 24)"
					/>
				</svg>
			{/if}
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

		<h2 class="min-w-0 flex-1 truncate text-[15px] font-semibold leading-tight md:text-base">{character.name}</h2>
	</div>

	<div class="pointer-events-auto flex shrink-0 items-center">
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
</header>
