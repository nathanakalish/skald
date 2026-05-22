<script lang="ts">
	import { X, Pin, Smartphone, BookOpen, BellOff } from 'lucide-svelte';
	import LimitedInput from '$lib/components/LimitedInput.svelte';
	import { FIELD_LIMITS } from '$lib/fieldLimits.js';
	import { tooltip } from '$lib/tooltip.js';
	import { staggerOnMount } from '$lib/utils/staggerOnMount';

	interface Props {
		chat: any;
		index: number;
		isActive: boolean;
		isPinned: boolean;
		streaming: boolean;
		muted: boolean;
		unreadCount: number;
		// For background animation gating
		staggerEnabled: boolean;
		// State shared with parent for inline rename
		renamingChatId: number | null;
		renameValue: string;
		// chatMenu reactive object (createChatMenu) — passed through wholesale
		chatMenu: any;
		// Callbacks
		onOpen: (id: number) => void;
		onContextMenu: (id: number, e: MouseEvent) => void;
		onAbort: (id: number) => void;
		onEnlargeAvatar: (url: string) => void;
		onRenameSubmit: (id: number) => void;
		onRenameCancel: () => void;
		onStartRename: (id: number, title: string) => void;
		onMoreClick: (id: number, e: MouseEvent) => void;
		// Display helpers
		formatTime: (s: string) => string;
		formatPreview: (chat: any) => string;
	}

	let {
		chat,
		index,
		isActive,
		isPinned,
		streaming,
		muted,
		unreadCount,
		staggerEnabled,
		renamingChatId,
		renameValue = $bindable(),
		chatMenu,
		onOpen,
		onContextMenu,
		onAbort,
		onEnlargeAvatar,
		onRenameSubmit,
		onRenameCancel,
		onStartRename,
		onMoreClick,
		formatTime,
		formatPreview,
	}: Props = $props();
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
	onclick={() => { if (!chatMenu.longPressFired) onOpen(chat.id); }}
	oncontextmenu={(e: MouseEvent) => onContextMenu(chat.id, e)}
	use:staggerOnMount={{ enabled: staggerEnabled, index }}
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
				onclick={(e) => { e.preventDefault(); e.stopPropagation(); onEnlargeAvatar(chat.characterAvatar.replace('/avatars/', '/avatars/original/')); }}
			/>
		{:else}
			<div class="flex h-12 w-12 items-center justify-center rounded-full bg-primary/20 text-base font-semibold text-primary">
				{chat.characterName[0]}
			</div>
		{/if}
		{#if streaming}
			<button
				type="button"
				onclick={(e) => { e.preventDefault(); e.stopPropagation(); onAbort(chat.id); }}
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
					<LimitedInput
						type="text"
						bind:value={renameValue}
						autofocus
						limit={FIELD_LIMITS.name}
						class="w-full rounded border border-border bg-background px-1 py-0.5 text-sm font-semibold outline-none focus:ring-1 focus:ring-primary"
						onclick={(e) => e.stopPropagation()}
						onkeydown={(e) => { if (e.key === 'Enter') onRenameSubmit(chat.id); if (e.key === 'Escape') onRenameCancel(); }}
						onblur={() => onRenameSubmit(chat.id)}
					/>
				{:else}
					<span class="truncate text-[15px] font-semibold leading-tight" ondblclick={(e) => { e.stopPropagation(); onStartRename(chat.id, chat.title); }}>{chat.title !== `Chat with ${chat.characterName}` ? chat.title : chat.characterName}</span>
				{/if}
			</div>
			<span class="shrink-0 text-[11px] text-muted-foreground">{formatTime(chat.updatedAt ?? '')}</span>
		</div>
		<div class="mt-0.5 flex items-center justify-between gap-2">
			<p class="truncate text-[13px] {unreadCount && !isActive ? 'font-semibold text-foreground' : 'text-muted-foreground'}">{@html formatPreview(chat) || '\u00A0'}</p>
			<div class="flex shrink-0 items-center gap-1">
				{#if muted}
					<BellOff class="h-3 w-3 text-muted-foreground" />
				{/if}
				{#if unreadCount && !isActive}
					{#key unreadCount}
						<span class="badge-pop flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">{unreadCount}</span>
					{/key}
				{/if}
			</div>
		</div>
	</div>

	<!-- Hover ⋯ menu (desktop only; mobile uses long-press / drag for pin) -->
	<button
		onclick={(e) => onMoreClick(chat.id, e)}
		class="hidden md:flex absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 items-center justify-center rounded-full bg-card/90 text-muted-foreground shadow-md opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100 {chatMenu.openChatId === chat.id ? '!opacity-100' : ''}"
		use:tooltip={'More'}
		aria-label="More actions"
	>
		<svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>
	</button>
</div>
