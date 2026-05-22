<script lang="ts">
	import { tooltip } from '$lib/tooltip.js';
	import { X, Check, CheckCheck, ChevronLeft, ChevronRight, RefreshCw, FileText, Sparkles, Square } from 'lucide-svelte';
	import { untrack } from 'svelte';
	import { createModalState, createModalGestures } from '$lib/modal.svelte.js';
	import { focusTrap } from '$lib/focusTrap.js';
	import { renderRoleplay } from '$lib/utils/rp-format.js';
	import { toasts } from '$lib/stores/toast.svelte.js';
	import Button from '$lib/components/ui/Button.svelte';

	interface GreetingResult {
		index: number;
		original: string;
		reformatted: string;
	}

	interface Props {
		open: boolean;
		results: GreetingResult[];
		onaccept: (results: GreetingResult[]) => void;
		onclose: () => void;
	}

	let { open, results = $bindable(), onaccept, onclose }: Props = $props();

	let activeIndex = $state(0);
	let mobileTab = $state<'original' | 'reformatted'>('reformatted');
	let accepted: boolean[] = $state([]);
	let regenerating = $state(false);
	// Abort controller for the in-flight reformat. Lets the user bail out
	// of a slow LLM call without waiting for it to finish; the original
	// reformatted text stays untouched on cancel.
	let regenerateController: AbortController | null = null;

	// Synced scrolling refs
	let leftPane: HTMLDivElement | undefined = $state();
	let rightPane: HTMLDivElement | undefined = $state();
	let syncing = false;

	function syncScroll(source: HTMLDivElement, target: HTMLDivElement | undefined) {
		if (syncing || !target) return;
		syncing = true;
		const ratio = source.scrollTop / (source.scrollHeight - source.clientHeight || 1);
		target.scrollTop = ratio * (target.scrollHeight - target.clientHeight || 1);
		requestAnimationFrame(() => { syncing = false; });
	}

	function renderContent(content: string): string {
		return renderRoleplay(content);
	}

	async function regenerateCurrent() {
		const cur = results[activeIndex];
		if (!cur || regenerating) return;
		regenerating = true;
		const controller = new AbortController();
		regenerateController = controller;
		try {
			const res = await fetch('/api/reformat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ text: cur.original }),
				signal: controller.signal
			});
			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				toasts.error(data.error || 'Failed to regenerate');
				return;
			}
			const data = await res.json();
			results[activeIndex] = { ...cur, reformatted: data.reformatted };
		} catch (err) {
			// User-cancelled: silently keep the previous reformatted text.
			if ((err as any)?.name === 'AbortError') return;
			toasts.error('Failed to regenerate');
		} finally {
			if (regenerateController === controller) regenerateController = null;
			regenerating = false;
		}
	}

	function stopRegenerate() {
		regenerateController?.abort();
	}

	function acceptCurrent() {
		accepted[activeIndex] = true;
		// Auto-advance to next unaccepted, if any
		const nextUnaccepted = accepted.findIndex((a, i) => i > activeIndex && !a);
		if (nextUnaccepted !== -1) {
			activeIndex = nextUnaccepted;
		} else {
			// Check if all accepted
			const allDone = results.length > 0 && results.every((_, i) => accepted[i]);
			if (allDone) {
				onaccept(results);
			}
		}
	}

	$effect(() => {
		if (open) {
			untrack(() => {
				activeIndex = 0;
				mobileTab = 'reformatted';
				accepted = results.map(() => false);
			});
		}
	});

	const current = $derived(results[activeIndex]);
	const label = $derived(current?.index === -1 ? 'First Message' : `Alt Greeting #${(current?.index ?? 0) + 1}`);
	const acceptedCount = $derived(accepted.filter(Boolean).length);
	const allAccepted = $derived(results.length > 0 && acceptedCount === results.length);

	const modal = createModalState(() => open && results.length > 0);
	const gestures = createModalGestures({
		onclose: () => onclose(),
		modal,
		tabs: {
			ids: () => ['original', 'reformatted'],
			active: () => mobileTab,
			set: (id) => { mobileTab = id as 'original' | 'reformatted'; },
		},
	});
</script>

{#if modal.visible}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div class="fixed inset-0 z-[60] flex items-end justify-center p-0 sm:items-center sm:p-4 bg-black/60 {modal.closing ? 'backdrop-exit' : 'backdrop-enter'}" role="dialog" aria-modal="true" aria-label="Review Greetings" tabindex="-1" use:focusTrap onclick={onclose}>
		<div
			class="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-2xl sm:rounded-2xl {modal.closing ? 'modal-exit' : 'modal-enter'}"
			onclick={(e) => e.stopPropagation()}
			style={gestures.panelStyle}
			ontouchstart={gestures.handlers.onTouchStart}
			ontouchmove={gestures.handlers.onTouchMove}
			ontouchend={gestures.handlers.onTouchEnd}
		>
			<!-- Header -->
			<div class="flex items-center justify-between border-b border-border px-5 py-3">
				<div class="flex items-center gap-3">
					<h2 class="text-lg font-semibold">Review Reformatted Greetings</h2>
					{#if results.length > 1}
						<div class="flex items-center gap-1.5 text-sm text-muted-foreground">
							<button
								onclick={() => { if (activeIndex > 0) activeIndex--; }}
								disabled={activeIndex === 0}
								class="rounded p-0.5 hover:bg-accent disabled:opacity-30"
							><ChevronLeft class="h-4 w-4" /></button>
							{#each results as _, i}
								<button
									onclick={() => (activeIndex = i)}
									class="flex h-5 w-5 items-center justify-center rounded-full text-xs transition-colors {i === activeIndex ? 'bg-primary text-primary-foreground' : accepted[i] ? 'bg-success/20 text-success' : 'bg-muted text-muted-foreground hover:bg-accent'}"
								>{accepted[i] ? '✓' : i + 1}</button>
							{/each}
							<button
								onclick={() => { if (activeIndex < results.length - 1) activeIndex++; }}
								disabled={activeIndex === results.length - 1}
								class="rounded p-0.5 hover:bg-accent disabled:opacity-30"
							><ChevronRight class="h-4 w-4" /></button>
						</div>
					{/if}
				</div>
				<button onclick={onclose} class="rounded-lg p-1.5 text-muted-foreground hover:bg-accent" aria-label="Close"><X class="h-5 w-5" /></button>
			</div>

			<!-- Greeting label -->
			<div class="flex items-center gap-2 border-b border-border px-5 py-2 text-sm font-medium text-muted-foreground">
				<span>{label}</span>
				{#if accepted[activeIndex]}
					<span class="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success">
						<Check class="h-3 w-3" /> Accepted
					</span>
				{/if}
			</div>

			<!-- Mobile tabs -->
			<div class="flex border-b border-border md:hidden">
				<button
					onclick={() => (mobileTab = 'original')}
					use:tooltip={'Original'}
					class="flex flex-1 items-center justify-center gap-1.5 py-2 text-sm font-medium transition-colors {mobileTab === 'original' ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground'}"
				><FileText class="h-4 w-4" /><span class="hidden sm:inline">Original</span></button>
				<button
					onclick={() => (mobileTab = 'reformatted')}
					use:tooltip={'Reformatted'}
					class="flex flex-1 items-center justify-center gap-1.5 py-2 text-sm font-medium transition-colors {mobileTab === 'reformatted' ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground'}"
				><Sparkles class="h-4 w-4" /><span class="hidden sm:inline">Reformatted</span></button>
			</div>

			<!-- Content area -->
			<div class="flex min-h-0 flex-1 overflow-hidden {gestures.contentClass}" style={gestures.contentStyle}>
				<!-- Desktop: side by side -->
				<!-- Mobile: tabbed -->

				<!-- Left / Original -->
				<div class="hidden w-1/2 flex-col border-r border-border md:flex">
					<div class="border-b border-border px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Original</div>
					<div
						bind:this={leftPane}
						onscroll={() => { if (leftPane) syncScroll(leftPane, rightPane); }}
						class="flex-1 overflow-y-auto p-4"
					>
						<div class="whitespace-pre-wrap text-sm leading-relaxed">
							{@html renderContent(current?.original ?? '')}
						</div>
					</div>
				</div>

				<!-- Right / Reformatted -->
				<div class="hidden w-1/2 flex-col md:flex">
					<div class="border-b border-border px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Reformatted</div>
					<div
						bind:this={rightPane}
						onscroll={() => { if (rightPane) syncScroll(rightPane, leftPane); }}
						class="flex-1 overflow-y-auto p-4"
					>
						<div class="whitespace-pre-wrap text-sm leading-relaxed">
							{@html renderContent(current?.reformatted ?? '')}
						</div>
					</div>
				</div>

				<!-- Mobile: single pane -->
				<div class="flex flex-1 flex-col md:hidden">
					<div class="flex-1 overflow-y-auto p-4">
						<div class="whitespace-pre-wrap text-sm leading-relaxed">
							{@html renderContent(mobileTab === 'original' ? (current?.original ?? '') : (current?.reformatted ?? ''))}
						</div>
					</div>
				</div>
			</div>

			<!-- Footer -->
			<div class="flex items-center justify-between border-t border-border px-5 py-3">
				<div class="flex items-center gap-2">
					{#if regenerating}
						<Button variant="destructive" size="md" icon={Square} onclick={stopRegenerate}>Stop</Button>
					{:else}
						<Button size="md" icon={RefreshCw} onclick={regenerateCurrent}>Regenerate</Button>
					{/if}
				</div>
				<div class="flex items-center gap-2">
					<Button onclick={onclose}>Cancel</Button>
					{#if !accepted[activeIndex]}
						<Button variant="primary" icon={Check} onclick={acceptCurrent}>Accept</Button>
					{/if}
					{#if results.length > 1 && !allAccepted}
						<Button variant="text" icon={CheckCheck} onclick={() => onaccept(results)}>Accept All</Button>
					{/if}
				</div>
			</div>
		</div>
	</div>
{/if}
