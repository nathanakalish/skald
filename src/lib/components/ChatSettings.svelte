<script lang="ts">
	import { X, RotateCcw, ChevronDown, Loader2, Monitor, Server, Sliders, UserPen, Archive } from 'lucide-svelte';
	import Combobox, { type ComboboxItem } from '$lib/components/Combobox.svelte';
	import { modelsToItems } from '$lib/components/modelItems.js';
	import { toasts } from '$lib/stores/toast.svelte.js';
	import { createModalState, createModalGestures } from '$lib/modal.svelte.js';
	import { tooltip } from '$lib/tooltip.js';
	import { untrack } from 'svelte';

	interface Props {
		open: boolean;
		chatId: number;
		chat: {
			overrideProviderId: number | null;
			overrideModel: string | null;
			overrideTemperature: number | null;
			overrideMaxTokens: number | null;
			overrideCustomPrompt: string | null;
			overridePersonaId: number | null;
			overrideIncludeReasoning: boolean | null;
			overrideReasoningEffort: string | null;
			overrideRenderMode: string | null;
			useCharacterTheme: boolean;
			allowExternalResources: boolean | null;
			replyGuidance?: string | null;
			overrideCompactionEnabled?: boolean | null;
			overrideCompactionThreshold?: number | null;
			overrideCompactionMode?: string | null;
			overrideCompactionWindowPercent?: number | null;
			overrideCompactionFixedCount?: number | null;
			overrideCompactionProviderId?: number | null;
			overrideCompactionModel?: string | null;
			compactionSummary?: string | null;
			compactedUpToMessageId?: number | null;
			compactionLastRunAt?: string | null;
		};
		characterHasTheme?: boolean;
		providers: { id: number; name: string; type: string; defaultModel: string | null }[];
		personas: { id: number; name: string; displayName: string | null; isDefault: boolean | null }[];
		onclose: () => void;
		onrefresh?: () => Promise<void>;
	}

	let { open, chatId, chat, characterHasTheme = false, providers, personas, onclose, onrefresh }: Props = $props();

	let providerId = $state<number | null>(null);
	let model = $state<string>('');
	let temperature = $state<number | null>(null);
	let maxTokens = $state<number | null>(null);
	let customPrompt = $state<string>('');
	let replyGuidance = $state<string>('');
	let personaId = $state<number | null>(null);
	let includeReasoning = $state<boolean | null>(null);
	let reasoningEffort = $state<string | null>(null);
	let renderModeOverride = $state<string | null>(null);
	let useCharacterTheme = $state(true);
	let allowExternalResources = $state<boolean | null>(null);
	let compactionEnabledOverride = $state<boolean | null>(null);
	let compactionThresholdOverride = $state<number | null>(null);
	let compactionModeOverride = $state<string | null>(null);
	let compactionWindowPercentOverride = $state<number | null>(null);
	let compactionFixedCountOverride = $state<number | null>(null);
	let compactionProviderIdOverride = $state<number | null>(null);
	let compactionModelOverride = $state<string | null>(null);
	let compactionSummaryDraft = $state<string>('');
	let compactionModelList = $state<string[]>([]);
	let compactionModelLoading = $state(false);
	let compactingNow = $state(false);
	let saving = $state(false);

	// Model list
	let modelList = $state<string[]>([]);
	let modelLoading = $state(false);

	// Combobox-derived view models
	const providerItems = $derived(providers.map((p: any) => ({ value: String(p.id), label: p.name, hint: p.type })) as ComboboxItem[]);
	const activeProviderType = $derived(providers.find((p: any) => p.id === providerId)?.type ?? null);
	const personaItems = $derived(personas.map((p: any) => ({ value: String(p.id), label: p.name, hint: p.displayName ?? undefined })) as ComboboxItem[]);
	const compProviderType = $derived(providers.find((p: any) => p.id === compactionProviderIdOverride)?.type ?? null);

	// Tabs
	type TabId = 'display' | 'provider' | 'generation' | 'persona' | 'compaction';
	const tabs = [
		{ id: 'display' as const, label: 'Display', icon: Monitor },
		{ id: 'provider' as const, label: 'Provider', icon: Server },
		{ id: 'generation' as const, label: 'Generation', icon: Sliders },
		{ id: 'persona' as const, label: 'Persona', icon: UserPen },
		{ id: 'compaction' as const, label: 'Compaction', icon: Archive },
	];
	let activeTab = $state<TabId>('display');

	$effect(() => {
		if (open) {
			untrack(() => {
				providerId = chat.overrideProviderId ?? null;
				model = chat.overrideModel ?? '';
				temperature = chat.overrideTemperature ?? null;
				maxTokens = chat.overrideMaxTokens ?? null;
				customPrompt = chat.overrideCustomPrompt ?? '';
				replyGuidance = chat.replyGuidance ?? '';
				personaId = chat.overridePersonaId ?? null;
				includeReasoning = chat.overrideIncludeReasoning ?? null;
				reasoningEffort = chat.overrideReasoningEffort ?? null;
				renderModeOverride = chat.overrideRenderMode ?? null;
				useCharacterTheme = chat.useCharacterTheme ?? true;
				allowExternalResources = chat.allowExternalResources ?? null;
				compactionEnabledOverride = chat.overrideCompactionEnabled ?? null;
				compactionThresholdOverride = chat.overrideCompactionThreshold ?? null;
				compactionModeOverride = chat.overrideCompactionMode ?? null;
				compactionWindowPercentOverride = chat.overrideCompactionWindowPercent ?? null;
				compactionFixedCountOverride = chat.overrideCompactionFixedCount ?? null;
				compactionProviderIdOverride = chat.overrideCompactionProviderId ?? null;
				compactionModelOverride = chat.overrideCompactionModel ?? null;
				compactionSummaryDraft = chat.compactionSummary ?? '';
			});
		}
	});

	$effect(() => {
		const pid = providerId;
		if (pid) {
			fetchModels(pid);
		} else {
			modelList = [];
		}
	});

	async function fetchModels(pid: number) {
		modelLoading = true;
		try {
			const res = await fetch(`/api/providers/${pid}/models`);
			if (res.ok) {
				const data = await res.json();
				modelList = data.models ?? [];
			}
		} catch {
			// ignore
		} finally {
			modelLoading = false;
		}
	}

	$effect(() => {
		const pid = compactionProviderIdOverride;
		if (pid) fetchCompactionModels(pid);
		else compactionModelList = [];
	});

	async function fetchCompactionModels(pid: number) {
		compactionModelLoading = true;
		try {
			const res = await fetch(`/api/providers/${pid}/models`);
			if (res.ok) {
				const data = await res.json();
				compactionModelList = data.models ?? [];
			}
		} catch { /* ignore */ }
		compactionModelLoading = false;
	}

	async function runCompactionNow() {
		if (compactingNow) return;
		compactingNow = true;
		try {
			const res = await fetch(`/api/chats/${chatId}/compact`, { method: 'POST' });
			if (res.ok) {
				const data = await res.json();
				compactionSummaryDraft = data.summary ?? compactionSummaryDraft;
				toasts.success(`Compacted ${data.compactedCount} message${data.compactedCount === 1 ? '' : 's'}`);
				await onrefresh?.();
			} else {
				const data = await res.json().catch(() => ({}));
				toasts.error(data.reason ? `Compaction skipped: ${data.reason}` : 'Compaction failed');
			}
		} finally {
			compactingNow = false;
		}
	}

	function clearCompactionState() {
		compactionSummaryDraft = '';
	}

	async function save() {
		// Close immediately — the form is bound to local state so the UI
		// already reflects the new values. Persist in the background and
		// surface failures via a toast rather than blocking the user.
		const payload = {
			overrideProviderId: providerId || null,
			overrideModel: model || null,
			overrideTemperature: temperature,
			overrideMaxTokens: maxTokens,
			overrideCustomPrompt: customPrompt || null,
			replyGuidance: replyGuidance.trim() ? replyGuidance : null,
			overridePersonaId: personaId || null,
			overrideIncludeReasoning: includeReasoning,
			overrideReasoningEffort: reasoningEffort,
			overrideRenderMode: renderModeOverride,
			useCharacterTheme,
			allowExternalResources,
			overrideCompactionEnabled: compactionEnabledOverride,
			overrideCompactionThreshold: compactionThresholdOverride,
			overrideCompactionMode: compactionModeOverride,
			overrideCompactionWindowPercent: compactionWindowPercentOverride,
			overrideCompactionFixedCount: compactionFixedCountOverride,
			overrideCompactionProviderId: compactionProviderIdOverride,
			overrideCompactionModel: compactionModelOverride,
			compactionSummary: compactionSummaryDraft.trim() ? compactionSummaryDraft : null,
		};
		onclose();
		try {
			const res = await fetch(`/api/chats/${chatId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			});
			if (!res.ok) {
				toasts.error('Failed to save chat settings');
				return;
			}
			await onrefresh?.();
		} catch {
			toasts.error('Failed to save chat settings');
		}
	}

	function resetField(field: string) {
		if (field === 'provider') {
			providerId = null;
			model = '';
			modelList = [];
		}
		if (field === 'model') model = '';
		if (field === 'temperature') temperature = null;
		if (field === 'maxTokens') maxTokens = null;
		if (field === 'persona') personaId = null;
		if (field === 'includeReasoning') includeReasoning = null;
		if (field === 'reasoningEffort') reasoningEffort = null;
		if (field === 'renderMode') renderModeOverride = null;
		if (field === 'customPrompt') customPrompt = '';
		if (field === 'replyGuidance') replyGuidance = '';
	}

	const modal = createModalState(() => open);
	const gestures = createModalGestures({
		onclose: () => onclose(),
		modal,
		tabs: {
			ids: () => tabs.map(t => t.id),
			active: () => activeTab,
			set: (id) => { activeTab = id as TabId; },
		},
	});
</script>

{#if modal.visible}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center {modal.closing ? 'backdrop-exit' : 'backdrop-enter'}"
		role="dialog" aria-modal="true" aria-label="Chat Settings" tabindex="-1"
		onkeydown={(e) => e.key === 'Escape' && onclose()}
	>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div class="absolute inset-0" onclick={onclose}></div>
		<div
			class="relative z-10 flex max-h-[85vh] w-full max-w-3xl flex-col rounded-t-2xl bg-card shadow-xl sm:rounded-2xl {modal.closing ? 'modal-exit' : 'modal-enter'}"
			style={gestures.panelStyle}
			ontouchstart={gestures.handlers.onTouchStart}
			ontouchmove={gestures.handlers.onTouchMove}
			ontouchend={gestures.handlers.onTouchEnd}
		>
			<!-- Header -->
			<div class="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6 sm:py-4">
				<div>
					<h2 class="text-lg font-semibold">Chat Settings</h2>
					<p class="text-xs text-muted-foreground">Override defaults for this chat</p>
				</div>
				<button onclick={onclose} aria-label="Close" class="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent">
					<X class="h-4 w-4" />
				</button>
			</div>

			<!-- Mobile tab bar -->
			<div class="flex overflow-x-auto border-b border-border sm:hidden">
				{#each tabs as tab}
					<button
						onclick={() => { activeTab = tab.id; }}
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
				<nav class="hidden sm:flex flex-col gap-1 border-r border-border bg-background/50 p-3 w-44 shrink-0">
					{#each tabs as tab}
						<button
							onclick={() => { activeTab = tab.id; }}
							class="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors {activeTab === tab.id
								? 'bg-primary/10 text-primary'
								: 'text-muted-foreground hover:bg-accent hover:text-foreground'}"
						>
							<tab.icon class="h-4 w-4" />
							{tab.label}
						</button>
					{/each}
				</nav>

				<!-- Tab content -->
				<div class="flex-1 overflow-y-auto p-4 sm:p-6 {gestures.contentClass}" style={gestures.contentStyle}>
					{#key activeTab}
					<div class="slide-up">
					{#if activeTab === 'display'}
						<!-- Display Tab -->
						<div class="space-y-6">
							<div>
								<h3 class="text-base font-semibold">Display</h3>
								<p class="text-sm text-muted-foreground">Rendering and visual options</p>
							</div>

							<!-- Render Mode -->
							<div class="space-y-2">
								<div class="flex items-center justify-between">
									<span class="text-sm font-medium">Text renderer</span>
									{#if renderModeOverride}
										<button onclick={() => resetField('renderMode')} class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
											<RotateCcw class="h-3 w-3" /> Use global
										</button>
									{/if}
								</div>
								<div class="flex gap-2">
									{#each [{ value: null, label: 'Global default' }, { value: 'roleplay', label: 'Roleplay' }, { value: 'markdown', label: 'Markdown' }] as opt}
										<button
											onclick={() => { renderModeOverride = opt.value; }}
											class="flex-1 rounded-lg border px-3 py-1.5 text-sm {renderModeOverride === opt.value ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-accent'}"
										>
											{opt.label}
										</button>
									{/each}
								</div>
								<p class="text-xs text-muted-foreground">The AI will be told which formatting to use</p>
							</div>

							{#if characterHasTheme}
								<!-- Character Theme -->
								<button
									type="button"
									onclick={() => { useCharacterTheme = !useCharacterTheme; }}
									class="flex w-full items-center justify-between rounded-lg border border-border px-4 py-3 text-left transition-colors hover:bg-accent/50"
								>
									<div>
										<span class="block text-sm font-medium">Character theme</span>
										<span class="block text-xs text-muted-foreground">Apply this character's custom colors</span>
									</div>
									<div class="ml-3 h-5 w-9 shrink-0 rounded-full transition-colors {useCharacterTheme ? 'bg-primary' : 'bg-muted'}">
										<div class="h-5 w-5 rounded-full border-2 bg-white transition-transform {useCharacterTheme ? 'translate-x-4 border-primary' : 'translate-x-0 border-muted'}"></div>
									</div>
								</button>
							{/if}
						</div>

					{:else if activeTab === 'provider'}
						<!-- Provider Tab -->
						<div class="space-y-6">
							<div>
								<h3 class="text-base font-semibold">Provider & Model</h3>
								<p class="text-sm text-muted-foreground">Override which AI provider and model to use</p>
							</div>

							<!-- Provider -->
							<div class="space-y-1.5">
								<div class="flex items-center justify-between">
									<label for="cs-provider" class="text-sm font-medium">Provider</label>
									{#if providerId}
										<button onclick={() => resetField('provider')} class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
											<RotateCcw class="h-3 w-3" /> Use default
										</button>
									{/if}
								</div>
								<Combobox
									id="cs-provider"
									value={providerId == null ? '' : String(providerId)}
									onchange={(v) => { providerId = v ? parseInt(v) : null; }}
									items={providerItems}
									placeholder="Default"
									searchPlaceholder="Filter providers…"
								/>
							</div>

							<!-- Model -->
							<div class="space-y-1.5">
								<div class="flex items-center justify-between">
									<span class="text-sm font-medium">Model</span>
									{#if model}
										<button onclick={() => resetField('model')} class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
											<RotateCcw class="h-3 w-3" /> Use default
										</button>
									{/if}
								</div>
								<Combobox
									value={model}
									onchange={(v) => { model = v; }}
									items={modelsToItems(modelList, activeProviderType)}
									loading={modelLoading}
									disabled={!providerId}
									placeholder={providerId ? 'Default (from provider)' : 'Override provider first'}
									searchPlaceholder="Filter models…"
									emptyText="No matching models"
								/>
								{#if !providerId && model}
									<p class="text-xs text-muted-foreground">Applies to whatever provider is active globally</p>
								{/if}
							</div>
						</div>

					{:else if activeTab === 'generation'}
						<!-- Generation Tab -->
						<div class="space-y-6">
							<div>
								<h3 class="text-base font-semibold">Generation</h3>
								<p class="text-sm text-muted-foreground">Control how the AI generates responses</p>
							</div>

							<!-- Temperature -->
							<div class="space-y-2">
								<div class="flex items-center justify-between">
									<span class="text-sm font-medium">Temperature</span>
									<div class="flex items-center gap-2">
										{#if temperature !== null}
											<span class="text-sm tabular-nums text-muted-foreground">{temperature.toFixed(2)}</span>
											<button onclick={() => resetField('temperature')} class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
												<RotateCcw class="h-3 w-3" /> Default
											</button>
										{:else}
											<span class="text-xs text-muted-foreground">Using provider default</span>
										{/if}
									</div>
								</div>
								<input
									type="range"
									min="0"
									max="2"
									step="0.05"
									value={temperature ?? 0.8}
									oninput={(e) => { temperature = parseFloat(e.currentTarget.value); }}
									class="w-full accent-primary"
								/>
								<div class="flex justify-between text-xs text-muted-foreground">
									<span>Precise</span>
									<span>Creative</span>
								</div>
							</div>

							<!-- Max Tokens -->
							<div class="space-y-1.5">
								<div class="flex items-center justify-between">
									<span class="text-sm font-medium">Max Response Tokens</span>
									{#if maxTokens !== null}
										<button onclick={() => resetField('maxTokens')} class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
											<RotateCcw class="h-3 w-3" /> Default
										</button>
									{/if}
								</div>
								<input
									type="number"
									value={maxTokens ?? ''}
									oninput={(e) => {
										const v = parseInt(e.currentTarget.value);
										maxTokens = isNaN(v) ? null : v;
									}}
									min={64}
									max={65536}
									step={64}
									placeholder="Using provider default"
									class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm tabular-nums placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-ring"
								/>
							</div>

							<!-- Include Reasoning -->
							<button
								type="button"
								onclick={() => { includeReasoning = includeReasoning === null ? true : !includeReasoning; }}
								class="flex w-full items-center justify-between rounded-lg border border-border px-4 py-3 text-left transition-colors hover:bg-accent/50"
							>
								<div>
									<span class="block text-sm font-medium">Include reasoning in context</span>
									<span class="block text-xs text-muted-foreground">
										{#if includeReasoning === null}
											Using provider default
										{:else}
											Send reasoning from prior messages to the AI
										{/if}
									</span>
								</div>
								<div class="flex items-center gap-2">
									{#if includeReasoning !== null}
										<!-- svelte-ignore a11y_click_events_have_key_events -->
										<!-- svelte-ignore a11y_no_static_element_interactions -->
										<div onclick={(e) => { e.stopPropagation(); resetField('includeReasoning'); }} class="rounded p-1 text-muted-foreground/60 hover:text-foreground" use:tooltip={'Reset to default'}>
											<RotateCcw class="h-3.5 w-3.5" />
										</div>
									{/if}
									<div class="h-5 w-9 shrink-0 rounded-full transition-colors {includeReasoning ? 'bg-primary' : 'bg-muted'}">
										<div class="h-5 w-5 rounded-full border-2 bg-white transition-transform {includeReasoning ? 'translate-x-4 border-primary' : 'translate-x-0 border-muted'}"></div>
									</div>
								</div>
							</button>

							<!-- Reasoning Effort -->
							<div class="space-y-2">
								<div class="flex items-center justify-between">
									<span class="text-sm font-medium">Reasoning Effort</span>
									{#if reasoningEffort !== null}
										<button onclick={() => resetField('reasoningEffort')} class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
											<RotateCcw class="h-3 w-3" /> Default
										</button>
									{/if}
								</div>
								<div class="flex gap-2">
									{#each ['off', 'low', 'medium', 'high'] as level}
										<button
											onclick={() => { reasoningEffort = level; }}
											class="flex-1 rounded-lg border px-3 py-1.5 text-sm capitalize {(reasoningEffort ?? '') === level ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-accent'}"
										>
											{level}
										</button>
									{/each}
								</div>
								<p class="text-xs text-muted-foreground">
									{#if reasoningEffort === null}
										Using provider default
									{:else}
										Request the model to think before responding. Z.AI only supports on/off.
									{/if}
								</p>
							</div>
						</div>

					{:else if activeTab === 'persona'}
						<!-- Persona Tab -->
						<div class="space-y-6">
							<div>
								<h3 class="text-base font-semibold">Persona & Instructions</h3>
								<p class="text-sm text-muted-foreground">Identity and custom instructions for this chat</p>
							</div>

							<!-- Persona -->
							<div class="space-y-1.5">
								<div class="flex items-center justify-between">
									<label for="cs-persona" class="text-sm font-medium">Persona</label>
									{#if personaId !== null}
										<button onclick={() => resetField('persona')} class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
											<RotateCcw class="h-3 w-3" /> Use default
										</button>
									{/if}
								</div>
								<Combobox
									id="cs-persona"
									value={personaId == null ? '' : String(personaId)}
									onchange={(v) => { const n = v ? parseInt(v) : NaN; personaId = isNaN(n) ? null : n; }}
									items={personaItems}
									placeholder={`Default (${personas.find(p => p.isDefault)?.name ?? 'none'})`}
									searchPlaceholder="Filter personas…"
								/>
								<p class="text-xs text-muted-foreground">Who &#123;&#123;user&#125;&#125; is in this chat</p>
							</div>

							<!-- Custom Instructions -->
							<div class="space-y-1.5">
								<div class="flex items-center justify-between">
									<span class="text-sm font-medium">Custom Instructions</span>
									{#if customPrompt}
										<button onclick={() => resetField('customPrompt')} class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
											<RotateCcw class="h-3 w-3" /> Clear
										</button>
									{/if}
								</div>
								<textarea
									bind:value={customPrompt}
									rows={4}
									class="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm leading-relaxed placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-ring"
									placeholder="Override or extend the global custom instructions for this chat..."
								></textarea>
								<p class="text-xs text-muted-foreground">Replaces provider custom instructions when set. Supports &#123;&#123;char&#125;&#125; / &#123;&#123;user&#125;&#125; macros.</p>
							</div>

							<!-- Chat-wide reply guidance -->
							<div class="space-y-1.5">
								<div class="flex items-center justify-between">
									<span class="text-sm font-medium">Reply guidance</span>
									{#if replyGuidance}
										<button onclick={() => resetField('replyGuidance')} class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
											<RotateCcw class="h-3 w-3" /> Clear
										</button>
									{/if}
								</div>
								<textarea
									bind:value={replyGuidance}
									rows={3}
									class="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm leading-relaxed placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-ring"
									placeholder="e.g. keep replies short, avoid breaking the fourth wall…"
								></textarea>
								<p class="text-xs text-muted-foreground">Sent on every reply in this chat, in addition to any per-message guidance.</p>
							</div>

							<!-- External Resources -->
							<button
								type="button"
								onclick={() => { allowExternalResources = allowExternalResources === null ? true : !allowExternalResources; }}
								class="flex w-full items-center justify-between rounded-lg border border-border px-4 py-3 text-left transition-colors hover:bg-accent/50"
							>
								<div>
									<span class="block text-sm font-medium">External resources in creator notes</span>
									<span class="block text-xs text-muted-foreground">{allowExternalResources === null ? 'Using global setting' : 'Per-chat override'}</span>
								</div>
								<div class="flex items-center gap-2">
									{#if allowExternalResources !== null}
										<!-- svelte-ignore a11y_click_events_have_key_events -->
										<!-- svelte-ignore a11y_no_static_element_interactions -->
										<div onclick={(e) => { e.stopPropagation(); allowExternalResources = null; }} class="rounded p-1 text-muted-foreground/60 hover:text-foreground" use:tooltip={'Reset to global default'}>
											<RotateCcw class="h-3.5 w-3.5" />
										</div>
									{/if}
									<div class="h-5 w-9 shrink-0 rounded-full transition-colors {allowExternalResources === true ? 'bg-primary' : 'bg-muted'}">
										<div class="h-5 w-5 rounded-full border-2 bg-white transition-transform {allowExternalResources === true ? 'translate-x-4 border-primary' : 'translate-x-0 border-muted'}"></div>
									</div>
								</div>
							</button>
						</div>

					{:else if activeTab === 'compaction'}
						<!-- Compaction Tab -->
						<div class="space-y-6">
							<div>
								<h3 class="text-base font-semibold">Compaction</h3>
								<p class="text-sm text-muted-foreground">Override global compaction behavior for this chat. Leave fields blank to use the global default from Settings &rsaquo; Prompts.</p>
							</div>

							<!-- Enabled override -->
							<button
								type="button"
								onclick={() => { compactionEnabledOverride = compactionEnabledOverride === null ? true : !compactionEnabledOverride; }}
								class="flex w-full items-center justify-between rounded-lg border border-border px-4 py-3 text-left transition-colors hover:bg-accent/50"
							>
								<div>
									<span class="block text-sm font-medium">Auto-compact this chat</span>
									<span class="block text-xs text-muted-foreground">{compactionEnabledOverride === null ? 'Using global setting' : compactionEnabledOverride ? 'Forced on for this chat' : 'Forced off for this chat'}</span>
								</div>
								<div class="flex items-center gap-2">
									{#if compactionEnabledOverride !== null}
										<!-- svelte-ignore a11y_click_events_have_key_events -->
										<!-- svelte-ignore a11y_no_static_element_interactions -->
										<div onclick={(e) => { e.stopPropagation(); compactionEnabledOverride = null; }} class="rounded p-1 text-muted-foreground/60 hover:text-foreground" use:tooltip={'Reset to global default'}>
											<RotateCcw class="h-3.5 w-3.5" />
										</div>
									{/if}
									<div class="h-5 w-9 shrink-0 rounded-full transition-colors {compactionEnabledOverride === true ? 'bg-primary' : 'bg-muted'}">
										<div class="h-5 w-5 rounded-full border-2 bg-white transition-transform {compactionEnabledOverride === true ? 'translate-x-4 border-primary' : 'translate-x-0 border-muted'}"></div>
									</div>
								</div>
							</button>

							<!-- Threshold -->
							<div class="space-y-1.5">
								<div class="flex items-center justify-between">
									<span class="text-sm font-medium">Trigger threshold</span>
									{#if compactionThresholdOverride !== null}
										<button onclick={() => { compactionThresholdOverride = null; }} class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
											<RotateCcw class="h-3 w-3" /> Default
										</button>
									{:else}
										<span class="text-xs text-muted-foreground">Using global</span>
									{/if}
								</div>
								<div class="flex items-center gap-3">
									<input
										type="range" min="50" max="95" step="5"
										value={compactionThresholdOverride ?? 80}
										oninput={(e) => { compactionThresholdOverride = Number(e.currentTarget.value); }}
										class="flex-1 accent-primary"
									/>
									<span class="w-14 shrink-0 text-right text-sm tabular-nums text-muted-foreground">{compactionThresholdOverride ?? 80}%</span>
								</div>
							</div>

							<!-- Mode -->
							<div class="space-y-1.5">
								<div class="flex items-center justify-between">
									<span class="text-sm font-medium">What to compact</span>
									{#if compactionModeOverride !== null}
										<button onclick={() => { compactionModeOverride = null; }} class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
											<RotateCcw class="h-3 w-3" /> Default
										</button>
									{/if}
								</div>
								<div class="flex gap-2">
									{#each [{ value: null, label: 'Global' }, { value: 'window', label: 'Rolling window' }, { value: 'fixed', label: 'Fixed count' }] as opt}
										<button
											onclick={() => { compactionModeOverride = opt.value; }}
											class="flex-1 rounded-lg border px-3 py-1.5 text-sm {compactionModeOverride === opt.value ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-accent'}"
										>
											{opt.label}
										</button>
									{/each}
								</div>
							</div>

{#if compactionModeOverride === 'window' || compactionModeOverride === null}
							<div class="space-y-1.5">
								<div class="flex items-center justify-between">
									<span class="text-sm font-medium">Window size per run</span>
									{#if compactionWindowPercentOverride !== null}
										<button onclick={() => { compactionWindowPercentOverride = null; }} class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
											<RotateCcw class="h-3 w-3" /> Default
										</button>
									{:else}
										<span class="text-xs text-muted-foreground">Using global</span>
									{/if}
								</div>
								<div class="flex items-center gap-3">
									<input
										type="range" min="10" max="60" step="5"
										value={compactionWindowPercentOverride ?? 30}
										oninput={(e) => { compactionWindowPercentOverride = Number(e.currentTarget.value); }}
										class="flex-1 accent-primary"
									/>
									<span class="w-14 shrink-0 text-right text-sm tabular-nums text-muted-foreground">{compactionWindowPercentOverride ?? 30}%</span>
									</div>
								</div>
							{/if}

							{#if compactionModeOverride === 'fixed'}
								<div class="space-y-1.5">
									<div class="flex items-center justify-between">
										<span class="text-sm font-medium">Messages per run</span>
										{#if compactionFixedCountOverride !== null}
											<button onclick={() => { compactionFixedCountOverride = null; }} class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
												<RotateCcw class="h-3 w-3" /> Default
											</button>
										{/if}
									</div>
									<input
										type="number" min="2" max="500"
										value={compactionFixedCountOverride ?? ''}
										placeholder="Using global"
										oninput={(e) => {
											const v = parseInt(e.currentTarget.value);
											compactionFixedCountOverride = isNaN(v) ? null : Math.max(2, Math.min(500, v));
										}}
										class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
									/>
								</div>
							{/if}

							<!-- Provider override -->
							<div class="space-y-1.5">
								<div class="flex items-center justify-between">
									<label for="cs-comp-provider" class="text-sm font-medium">Summarizer provider</label>
									{#if compactionProviderIdOverride !== null}
										<button onclick={() => { compactionProviderIdOverride = null; compactionModelOverride = null; }} class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
											<RotateCcw class="h-3 w-3" /> Default
										</button>
									{/if}
								</div>
								<Combobox
									id="cs-comp-provider"
									value={compactionProviderIdOverride == null ? '' : String(compactionProviderIdOverride)}
									onchange={(v) => {
										const n = v ? parseInt(v) : NaN;
										compactionProviderIdOverride = isNaN(n) ? null : n;
										compactionModelOverride = null;
									}}
									items={providerItems}
									placeholder="Use global setting"
									searchPlaceholder="Filter providers…"
								/>
							</div>

							<!-- Model override -->
							<div class="space-y-1.5">
								<div class="flex items-center justify-between">
									<span class="text-sm font-medium">Summarizer model</span>
									{#if compactionModelOverride}
										<button onclick={() => { compactionModelOverride = null; }} class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
											<RotateCcw class="h-3 w-3" /> Default
										</button>
									{/if}
								</div>
								<Combobox
									value={compactionModelOverride ?? ''}
									onchange={(v) => { compactionModelOverride = v || null; }}
									items={modelsToItems(compactionModelList, compProviderType)}
									loading={compactionModelLoading}
									disabled={!compactionProviderIdOverride}
									placeholder={compactionProviderIdOverride ? 'Provider default' : 'Select provider first'}
									searchPlaceholder="Filter models…"
									emptyText="No matching models"
								/>
							</div>

							<!-- Stored summary editor -->
							<div class="space-y-1.5 border-t border-border pt-5">
								<div class="flex items-center justify-between">
									<span class="text-sm font-medium">Current summary</span>
									{#if compactionSummaryDraft.trim()}
										<button onclick={clearCompactionState} class="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive">
											<RotateCcw class="h-3 w-3" /> Clear
										</button>
									{/if}
								</div>
								<textarea
									bind:value={compactionSummaryDraft}
									rows={6}
									placeholder="No summary yet. Run compaction below or write one manually."
									class="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm leading-relaxed placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-ring"
								></textarea>
								<p class="text-xs text-muted-foreground">Saved with the rest of the chat settings. Clearing the summary also resets the high-water mark so the next run starts from the very first message.</p>
								{#if chat.compactionLastRunAt}
									<p class="text-xs text-muted-foreground">Last run: {new Date(chat.compactionLastRunAt + 'Z').toLocaleString()}</p>
								{/if}
							</div>

							<!-- Run now -->
							<button
								type="button"
								onclick={runCompactionNow}
								disabled={compactingNow}
								class="flex w-full items-center justify-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-2.5 text-sm font-medium text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
							>
								{#if compactingNow}
									<Loader2 class="h-4 w-4 animate-spin" /> Compacting...
								{:else}
									<Archive class="h-4 w-4" /> Run compaction now
								{/if}
							</button>
						</div>
					{/if}
					</div>
					{/key}
				</div>
			</div>

			<!-- Footer -->
			<div class="flex items-center justify-end gap-3 border-t border-border px-5 py-4">
				<button
					onclick={onclose}
					class="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
				>
					Cancel
				</button>
				<button
					onclick={save}
					disabled={saving}
					class="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
				>
					{saving ? 'Saving...' : 'Save'}
				</button>
			</div>
		</div>
	</div>
{/if}
