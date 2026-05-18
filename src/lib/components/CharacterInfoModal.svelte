<script lang="ts">
	import { tooltip } from '$lib/tooltip.js';
	import { X, Info, StickyNote } from 'lucide-svelte';
	import { untrack } from 'svelte';
	import { createModalState, createModalGestures } from '$lib/modal.svelte.js';
	import { focusTrap } from '$lib/focusTrap.js';
	import { page } from '$app/stores';
	import ImageModal from '$lib/components/ImageModal.svelte';
	import { sanitizeRichHtml } from '$lib/markdown.js';

	interface Props {
		open: boolean;
		character: any;
		allowExternalOverride?: boolean | null;
		onclose: () => void;
	}

	let { open, character, allowExternalOverride = null, onclose }: Props = $props();

	let enlargedImage: string | null = $state(null);
	let activeTab = $state<'info' | 'notes'>('info');

	// Reset tab when modal opens
	$effect(() => { if (open) untrack(() => { activeTab = 'info'; }); });

	let hasCreatorNotes = $derived(!!character?.creatorNotes?.trim());
	let notesAreHtml = $derived(hasCreatorNotes && /<[a-z][\s\S]*>/i.test(character.creatorNotes));

	let allowExternal = $derived(allowExternalOverride ?? $page.data.allowExternalCreatorNotes ?? false);

	let notesSrcdoc = $derived.by(() => {
		if (!notesAreHtml || !character?.creatorNotes) return '';
		const cleaned = sanitizeRichHtml(character.creatorNotes);
		const csp = allowExternal
			? ''
			: `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob: /api/">`;
		return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${csp}<style>body{margin:0;padding:16px;background:#1a1a2a;color:#e0e0e0;font-family:system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.6;overflow-x:hidden}img{max-width:100%;height:auto;border-radius:8px}a{color:#8ab4f8;text-decoration:none}a:hover{text-decoration:underline}</style></head><body>${cleaned}</body></html>`;
	});

	function parseTags(tagStr: string): string[] {
		if (!tagStr) return [];
		try {
			const parsed = JSON.parse(tagStr);
			if (Array.isArray(parsed)) return parsed;
		} catch { /* not JSON */ }
		return tagStr.split(',').map((t: string) => t.trim()).filter(Boolean);
	}

	const modal = createModalState(() => open && !!character);
	const gestures = createModalGestures({
		onclose: () => onclose(),
		modal,
		tabs: {
			ids: () => ['info', 'notes'],
			active: () => activeTab,
			set: (id) => { activeTab = id as 'info' | 'notes'; },
		},
	});
</script>

{#if modal.visible}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-[60] flex items-end justify-center overflow-y-auto p-0 sm:items-start sm:p-4 sm:pt-[5vh] bg-black/60 {modal.closing ? 'backdrop-exit' : 'backdrop-enter'}"
		role="dialog" aria-modal="true" aria-label="Character Info" tabindex="-1" use:focusTrap
		onkeydown={(e) => { if (e.key === 'Escape') onclose(); }}
	>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div class="absolute inset-0" onclick={onclose}></div>
		<div
			class="relative z-10 w-full max-w-2xl overflow-hidden rounded-t-2xl border border-border bg-card shadow-xl sm:rounded-xl {modal.closing ? 'modal-exit' : 'modal-enter'}"
			style={gestures.panelStyle}
			ontouchstart={gestures.handlers.onTouchStart}
			ontouchmove={gestures.handlers.onTouchMove}
			ontouchend={gestures.handlers.onTouchEnd}
		>
			<!-- Header -->
			<div class="flex items-start gap-4 border-b border-border p-5">
				{#if character.avatarPath}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
					<img
						src={character.avatarPath}
						alt={character.name}
						class="h-20 w-20 shrink-0 cursor-pointer rounded-xl object-cover transition-opacity hover:opacity-80"
						onclick={() => (enlargedImage = character.avatarPath?.replace('/avatars/', '/avatars/original/') ?? null)}
					/>
				{:else}
					<div class="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-2xl font-bold text-primary">
						{character.name[0]}
					</div>
				{/if}
				<div class="min-w-0 flex-1">
					<h2 class="text-lg font-semibold">{character.name}</h2>
					{#if character.creator}
						<p class="text-sm text-muted-foreground">by {character.creator}</p>
					{/if}
					{#if character.characterVersion}
						<p class="text-xs text-muted-foreground">v{character.characterVersion}</p>
					{/if}
				</div>
				<button
					onclick={onclose}
					aria-label="Close"
					class="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
				>
					<X class="h-4 w-4" />
				</button>
			</div>

			<!-- Tabs -->
			{#if hasCreatorNotes}
				<div class="flex border-b border-border">
					<button
						onclick={() => (activeTab = 'info')}
						use:tooltip={'Info'}
						class="flex flex-1 items-center justify-center gap-1.5 py-2.5 text-sm font-medium transition-colors {activeTab === 'info' ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground hover:text-foreground'}"
					><Info class="h-4 w-4" /><span class="hidden sm:inline">Info</span></button>
					<button
						onclick={() => (activeTab = 'notes')}
						use:tooltip={'Creator Notes'}
						class="flex flex-1 items-center justify-center gap-1.5 py-2.5 text-sm font-medium transition-colors {activeTab === 'notes' ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground hover:text-foreground'}"
					><StickyNote class="h-4 w-4" /><span class="hidden sm:inline">Creator Notes</span></button>
				</div>
			{/if}

			<!-- Content -->
			<div class="{gestures.contentClass}" style={gestures.contentStyle}>
			<!-- Info Tab -->
			{#if activeTab === 'info'}
				<div class="max-h-[65vh] space-y-4 overflow-y-auto p-5">
					<!-- Tags -->
					{#if character.tags && parseTags(character.tags).length}
						<div class="flex flex-wrap gap-1.5">
							{#each parseTags(character.tags) as tag}
								<span class="rounded-md bg-secondary px-2 py-0.5 text-xs text-muted-foreground">{tag}</span>
							{/each}
						</div>
					{/if}

					<!-- Description -->
					{#if character.description}
						<div>
							<h3 class="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Description</h3>
							<div class="whitespace-pre-wrap text-sm leading-relaxed">{character.description}</div>
						</div>
					{/if}

					<!-- Personality -->
					{#if character.personality}
						<div>
							<h3 class="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Personality</h3>
							<div class="whitespace-pre-wrap text-sm leading-relaxed">{character.personality}</div>
						</div>
					{/if}

					<!-- Scenario -->
					{#if character.scenario}
						<div>
							<h3 class="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Scenario</h3>
							<div class="whitespace-pre-wrap text-sm leading-relaxed">{character.scenario}</div>
						</div>
					{/if}

					<!-- Plain text creator notes (no HTML) shown inline -->
					{#if hasCreatorNotes && !notesAreHtml}
						<div>
							<h3 class="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Creator Notes</h3>
							<div class="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{character.creatorNotes}</div>
						</div>
					{/if}
				</div>

			<!-- Creator Notes Tab -->
			{:else if activeTab === 'notes'}
				{#if notesAreHtml}
					<iframe
						srcdoc={notesSrcdoc}
						sandbox=""
						class="h-[65vh] w-full border-0"
						title="Creator notes"
					></iframe>
				{:else}
					<div class="max-h-[65vh] overflow-y-auto p-5">
						<div class="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{character.creatorNotes}</div>
					</div>
				{/if}
			{/if}
			</div>
		</div>
	</div>
{/if}

<ImageModal src={enlargedImage} onclose={() => (enlargedImage = null)} />
