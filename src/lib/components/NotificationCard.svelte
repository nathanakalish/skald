<script lang="ts">
	import { X, Check, AlertCircle, Info, MessageSquare } from 'lucide-svelte';

	type Accent = 'primary' | 'success' | 'error' | 'info';
	type IconName = 'message' | 'check' | 'error' | 'info';

	interface Props {
		accent?: Accent;
		iconName?: IconName | null;
		avatarUrl?: string | null;
		title: string;
		body?: string;
		onclick?: (() => void) | null;
		ondismiss: () => void;
	}

	let {
		accent = 'info',
		iconName = null,
		avatarUrl = null,
		title,
		body = '',
		onclick = null,
		ondismiss
	}: Props = $props();

	// Accent bar + icon-fill colors. The card itself stays bg-card so the
	// chrome reads as one family and only the bar communicates type.
	const accentBg = $derived({
		primary: 'bg-primary',
		success: 'bg-success',
		error: 'bg-destructive',
		info: 'bg-primary',
	}[accent]);
	const accentFg = $derived({
		primary: 'text-primary',
		success: 'text-success',
		error: 'text-destructive',
		info: 'text-primary',
	}[accent]);

	const IconCmp = $derived(
		iconName === 'check' ? Check
		: iconName === 'error' ? AlertCircle
		: iconName === 'info' ? Info
		: iconName === 'message' ? MessageSquare
		: null
	);

	// Swipe-to-dismiss state. We only commit to a horizontal drag once the
	// pointer crosses an 8px threshold AND the horizontal motion dominates
	// vertical motion — otherwise we let the touch fall through to whatever
	// is below (page scroll, etc.). This mirrors the modal-drawer gesture
	// logic so we don't accidentally hijack scrolls.
	let dx = $state(0);
	let dragging = $state(false);
	let settling = $state(false);
	let startX = 0;
	let startY = 0;
	let intent: 'none' | 'horizontal' | 'vertical' = 'none';

	const SWIPE_DISMISS_THRESHOLD = 80;

	function onTouchStart(e: TouchEvent) {
		const t = e.touches[0];
		startX = t.clientX;
		startY = t.clientY;
		intent = 'none';
		dx = 0;
		dragging = false;
		settling = false;
	}

	function onTouchMove(e: TouchEvent) {
		const t = e.touches[0];
		const dxNow = t.clientX - startX;
		const dyNow = t.clientY - startY;

		if (intent === 'none') {
			if (Math.abs(dxNow) < 8 && Math.abs(dyNow) < 8) return;
			intent = Math.abs(dxNow) > Math.abs(dyNow) ? 'horizontal' : 'vertical';
		}

		if (intent === 'horizontal') {
			// Block the scroll/touch chain so we don't pull the page or click
			// whatever's underneath the toast.
			e.preventDefault();
			e.stopPropagation();
			dragging = true;
			// Right-only dismiss; rubber-band leftward pulls so they feel inert.
			dx = dxNow > 0 ? dxNow : dxNow * 0.2;
		}
	}

	function onTouchEnd() {
		if (intent !== 'horizontal') {
			intent = 'none';
			return;
		}
		settling = true;
		if (dx > SWIPE_DISMISS_THRESHOLD) {
			// Animate offscreen, then remove. 320px is wider than any toast we
			// render; combined with the opacity fade it disappears cleanly.
			dx = 360;
			setTimeout(() => ondismiss(), 200);
		} else {
			dx = 0;
			setTimeout(() => { settling = false; }, 200);
		}
		dragging = false;
		intent = 'none';
	}

	const swipeOpacity = $derived(Math.max(0, 1 - Math.max(0, dx) / 240));
	const cardStyle = $derived(
		dragging
			? `--translucent-base: 1; transform: translateX(${dx}px); transition: none; opacity: ${swipeOpacity}`
			: settling
			? `--translucent-base: 1; transform: translateX(${dx}px); transition: transform 200ms ease-out, opacity 200ms ease-out; opacity: ${swipeOpacity}`
			: '--translucent-base: 1;'
	);

	function handleCardClick() {
		if (onclick) onclick();
	}

	function handleDismissClick(e: MouseEvent) {
		e.stopPropagation();
		ondismiss();
	}
</script>

<div
	class="notif-enter pointer-events-auto relative flex w-max min-w-[16rem] max-w-sm items-stretch gap-0 overflow-hidden rounded-xl border border-border bg-translucent shadow-lg backdrop-blur-md"
	style={cardStyle}
	ontouchstart={onTouchStart}
	ontouchmove={onTouchMove}
	ontouchend={onTouchEnd}
	ontouchcancel={onTouchEnd}
	role="status"
	aria-live="polite"
>
	<!-- Accent bar -->
	<div class="w-1 shrink-0 {accentBg}"></div>

	{#if onclick}
		<button
			type="button"
			onclick={handleCardClick}
			class="flex flex-1 items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-accent/40"
		>
			{#if avatarUrl}
				<img src={avatarUrl} alt="" loading="lazy" decoding="async" class="h-9 w-9 shrink-0 rounded-full object-cover" />
			{:else if IconCmp}
				<div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted/40 {accentFg}">
					<IconCmp class="h-4 w-4" />
				</div>
			{/if}
			<div class="min-w-0 flex-1">
				<p class="break-words text-sm font-medium">{title}</p>
				{#if body}
					<p class="break-words text-xs text-muted-foreground">{body}</p>
				{/if}
			</div>
		</button>
	{:else}
		<div class="flex flex-1 items-center gap-3 px-3 py-3">
			{#if avatarUrl}
				<img src={avatarUrl} alt="" loading="lazy" decoding="async" class="h-9 w-9 shrink-0 rounded-full object-cover" />
			{:else if IconCmp}
				<div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted/40 {accentFg}">
					<IconCmp class="h-4 w-4" />
				</div>
			{/if}
			<div class="min-w-0 flex-1 text-left">
				<p class="break-words text-sm font-medium">{title}</p>
				{#if body}
					<p class="break-words text-xs text-muted-foreground">{body}</p>
				{/if}
			</div>
		</div>
	{/if}

	<button
		type="button"
		onclick={handleDismissClick}
		aria-label="Dismiss"
		class="shrink-0 self-stretch px-2 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
	>
		<X class="h-3.5 w-3.5" />
	</button>
</div>
