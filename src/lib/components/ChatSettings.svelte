<script lang="ts">
	import { X, RotateCcw, ChevronDown, Loader2, Monitor, Server, Sliders, UserPen, Archive, MoreHorizontal, RefreshCw } from 'lucide-svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Combobox, { type ComboboxItem } from '$lib/components/Combobox.svelte';
	import { modelsToItems } from '$lib/components/modelItems.js';
	import { toasts } from '$lib/stores/toast.svelte.js';
	import { createModalState, createModalGestures } from '$lib/modal.svelte.js';
	import { tooltip } from '$lib/tooltip.js';
	import { untrack } from 'svelte';
	import LimitedTextarea from '$lib/components/LimitedTextarea.svelte';
	import { checkFieldLimits } from '$lib/limitCheck.js';
	import { FIELD_LIMITS } from '$lib/fieldLimits.js';
	import SettingRow from '$lib/components/settings/SettingRow.svelte';
	import ToggleSwitch from '$lib/components/settings/ToggleSwitch.svelte';

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
			overrideImageProviderId?: number | null;
			overrideImageModel?: string | null;
			overrideImagePromptTemplate?: string | null;
			overrideImageIncludeAvatar?: boolean | null;
			overrideImageIncludeCharacterDesc?: boolean | null;
			overrideImageIncludePersonaDesc?: boolean | null;
			compactionSummary?: string | null;
			compactedUpToMessageId?: number | null;
			previousCompactedUpToMessageId?: number | null;
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
	let imageProviderIdOverride = $state<number | null>(null);
	let imageModelOverride = $state<string | null>(null);
	let imagePromptTemplateOverride = $state<string>('');
	let imageIncludeAvatarOverride = $state<boolean | null>(null);
	let imageIncludeCharacterDescOverride = $state<boolean | null>(null);
	let imageIncludePersonaDescOverride = $state<boolean | null>(null);
	let imageModelList = $state<string[]>([]);
	let imageModelLoading = $state(false);
	let compactingNow = $state(false);
	let reprocessingNow = $state(false);
	let showSummaryMenu = $state(false);
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
				imageProviderIdOverride = chat.overrideImageProviderId ?? null;
				imageModelOverride = chat.overrideImageModel ?? null;
				imagePromptTemplateOverride = chat.overrideImagePromptTemplate ?? '';
				imageIncludeAvatarOverride = chat.overrideImageIncludeAvatar ?? null;
				imageIncludeCharacterDescOverride = chat.overrideImageIncludeCharacterDesc ?? null;
				imageIncludePersonaDescOverride = chat.overrideImageIncludePersonaDesc ?? null;
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

	$effect(() => {
		const pid = imageProviderIdOverride;
		if (pid) fetchImageModels(pid);
		else imageModelList = [];
	});

	async function fetchImageModels(pid: number) {
		imageModelLoading = true;
		try {
			const res = await fetch(`/api/providers/${pid}/image-models`);
			if (res.ok) {
				const data = await res.json();
				imageModelList = data.models ?? [];
			}
		} catch { /* ignore */ }
		imageModelLoading = false;
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

	async function reprocessLastBatch() {
		if (reprocessingNow) return;
		reprocessingNow = true;
		showSummaryMenu = false;
		try {
			const res = await fetch(`/api/chats/${chatId}/compact`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ redo: true }),
			});
			if (res.ok) {
				const data = await res.json();
				compactionSummaryDraft = data.summary ?? compactionSummaryDraft;
				toasts.success('Re-processed last batch');
				await onrefresh?.();
			} else {
				const data = await res.json().catch(() => ({}));
				toasts.error(data.reason ? `Re-process failed: ${data.reason}` : 'Re-process failed');
			}
		} finally {
			reprocessingNow = false;
		}
	}

	async function save() {
		const ok = await checkFieldLimits([
			{ label: 'Custom Instructions', value: customPrompt, limit: FIELD_LIMITS.prompt, trim: (v) => (customPrompt = v) },
			{ label: 'Reply guidance', value: replyGuidance, limit: FIELD_LIMITS.replyGuidance, trim: (v) => (replyGuidance = v) },
			{ label: 'Compaction summary', value: compactionSummaryDraft, limit: FIELD_LIMITS.compactionSummary, trim: (v) => (compactionSummaryDraft = v) },
		]);
		if (!ok) return;
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
			overrideImageProviderId: imageProviderIdOverride,
			overrideImageModel: imageModelOverride || null,
			overrideImagePromptTemplate: imagePromptTemplateOverride.trim() ? imagePromptTemplateOverride : null,
			overrideImageIncludeAvatar: imageIncludeAvatarOverride,
			overrideImageIncludeCharacterDesc: imageIncludeCharacterDescOverride,
			overrideImageIncludePersonaDesc: imageIncludePersonaDescOverride,
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
		if (field === 'imageProvider') { imageProviderIdOverride = null; imageModelOverride = null; imageModelList = []; }
		if (field === 'imageModel') imageModelOverride = null;
		if (field === 'imagePromptTemplate') imagePromptTemplateOverride = '';
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

<!-- "Use default / Use global / Clear" link-button that sits next to a field
     label whenever it has a per-chat override. Centralised so the tiny styling
     and icon stays consistent across all ~16 reset spots. -->
{#snippet resetLink(onclick: () => void, label: string)}
	<button {onclick} type="button" class="flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
		<RotateCcw class="h-3 w-3" /> {label}
	</button>
{/snippet}

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
			class="relative z-10 flex max-h-[85vh] w-full max-w-3xl flex-col rounded-t-2xl bg-card pb-safe shadow-xl sm:rounded-2xl sm:pb-0 {modal.closing ? 'modal-exit' : 'modal-enter'}"
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
				<div class="@container flex-1 overflow-y-auto p-4 sm:p-6 {gestures.contentClass}" style={gestures.contentStyle}>
					{#key activeTab}
					<div class="slide-up">
					{#if activeTab === 'display'}
						<!-- Display Tab -->
						<div class="space-y-6">
							<div>
								<h3 class="text-base font-semibold">Display</h3>
								<p class="text-sm text-muted-foreground">Rendering and visual options</p>
							</div>

							<SettingRow label="Text renderer">
								{#snippet action()}
									{#if renderModeOverride}{@render resetLink(() => resetField('renderMode'), 'Use global')}{/if}
								{/snippet}
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
							</SettingRow>

							{#if characterHasTheme}
								<ToggleSwitch
									checked={useCharacterTheme}
									label="Character theme"
									description="Apply this character's custom colors"
									onchange={(next) => { useCharacterTheme = next; }}
								/>
							{/if}
						</div>

					{:else if activeTab === 'provider'}
						<!-- Provider Tab -->
						<div class="space-y-6">
							<div>
								<h3 class="text-base font-semibold">Provider & Model</h3>
								<p class="text-sm text-muted-foreground">Override which AI provider and model to use</p>
							</div>

							<div class="grid gap-4 @xl:grid-cols-2">
								<SettingRow label="Provider" htmlFor="cs-provider">
									{#snippet action()}
										{#if providerId}{@render resetLink(() => resetField('provider'), 'Use default')}{/if}
									{/snippet}
									<Combobox
										id="cs-provider"
										value={providerId == null ? '' : String(providerId)}
										onchange={(v) => { providerId = v ? parseInt(v) : null; }}
										items={providerItems}
										placeholder="Default"
										searchPlaceholder="Filter providers…"
									/>
								</SettingRow>

								<SettingRow label="Model">
									{#snippet action()}
										{#if model}{@render resetLink(() => resetField('model'), 'Use default')}{/if}
									{/snippet}
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
								</SettingRow>
							</div>

							<!-- Image generation overrides. Default fallback walks: image override
							     > chat's text provider override > user's first enabled provider.
							     Setting these here lets a story use one provider for text and
							     another for art without changing the global preset. -->
							<div class="border-t border-border pt-4 space-y-4">
								<div>
									<h3 class="text-base font-semibold">Image Generation</h3>
									<p class="text-sm text-muted-foreground">Override which provider generates images and how the prompt is built.</p>
								</div>
								<div class="grid gap-4 @xl:grid-cols-2">
									<SettingRow label="Image Provider">
										{#snippet action()}
											{#if imageProviderIdOverride}{@render resetLink(() => resetField('imageProvider'), 'Use default')}{/if}
										{/snippet}
										<Combobox
											value={imageProviderIdOverride == null ? '' : String(imageProviderIdOverride)}
											onchange={(v) => { imageProviderIdOverride = v ? parseInt(v) : null; }}
											items={providerItems}
											placeholder="Default"
											searchPlaceholder="Filter providers…"
										/>
									</SettingRow>

									<SettingRow label="Image Model">
										{#snippet action()}
											{#if imageModelOverride}{@render resetLink(() => resetField('imageModel'), 'Use default')}{/if}
										{/snippet}
										<Combobox
											value={imageModelOverride ?? ''}
											onchange={(v) => { imageModelOverride = v || null; }}
											items={modelsToItems(imageModelList, null)}
											loading={imageModelLoading}
											disabled={!imageProviderIdOverride}
											placeholder={imageProviderIdOverride ? 'Default (from provider)' : 'Override image provider first'}
											searchPlaceholder="Filter image models…"
											emptyText="No Image Generation Models Available"
										/>
									</SettingRow>
								</div>

								<SettingRow label="Prompt Template" description={`Used to build the image prompt from the source assistant message. Use {{message}} as the placeholder. Leave blank to use the global default.`}>
									{#snippet action()}
										{#if imagePromptTemplateOverride}{@render resetLink(() => resetField('imagePromptTemplate'), 'Use default')}{/if}
									{/snippet}
									<LimitedTextarea
										bind:value={imagePromptTemplateOverride}
										rows={3}
										limit={FIELD_LIMITS.prompt}
										class="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
										placeholder={`Generate an illustration that depicts: {{message}}`}
									/>
								</SettingRow>

								<ToggleSwitch
									checked={imageIncludeCharacterDescOverride === true}
									label="Include character description"
									description={imageIncludeCharacterDescOverride === null ? 'Using global setting' : 'Per-chat override'}
									onchange={(next) => { imageIncludeCharacterDescOverride = next; }}
									canReset={imageIncludeCharacterDescOverride !== null}
									onreset={() => { imageIncludeCharacterDescOverride = null; }}
									resetTooltip="Reset to global default"
								/>
								<ToggleSwitch
									checked={imageIncludeAvatarOverride === true}
									label="Include character avatar as reference image"
									description={imageIncludeAvatarOverride === null ? 'Using global setting' : 'Per-chat override'}
									onchange={(next) => { imageIncludeAvatarOverride = next; }}
									canReset={imageIncludeAvatarOverride !== null}
									onreset={() => { imageIncludeAvatarOverride = null; }}
									resetTooltip="Reset to global default"
								/>
								<ToggleSwitch
									checked={imageIncludePersonaDescOverride === true}
									label="Include persona description"
									description={imageIncludePersonaDescOverride === null ? 'Using global setting' : 'Per-chat override'}
									onchange={(next) => { imageIncludePersonaDescOverride = next; }}
									canReset={imageIncludePersonaDescOverride !== null}
									onreset={() => { imageIncludePersonaDescOverride = null; }}
									resetTooltip="Reset to global default"
								/>
							</div>
						</div>

					{:else if activeTab === 'generation'}
						<!-- Generation Tab -->
						<div class="space-y-6">
							<div>
								<h3 class="text-base font-semibold">Generation</h3>
								<p class="text-sm text-muted-foreground">Control how the AI generates responses</p>
							</div>

							<SettingRow label="Temperature">
								{#snippet action()}
									{#if temperature !== null}
										<span class="text-sm tabular-nums text-muted-foreground">{temperature.toFixed(2)}</span>
										{@render resetLink(() => resetField('temperature'), 'Default')}
									{:else}
										<span class="text-xs text-muted-foreground">Using provider default</span>
									{/if}
								{/snippet}
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
							</SettingRow>

							<SettingRow label="Max Response Tokens">
								{#snippet action()}
									{#if maxTokens !== null}{@render resetLink(() => resetField('maxTokens'), 'Default')}{/if}
								{/snippet}
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
							</SettingRow>

							<ToggleSwitch
								checked={includeReasoning === true}
								label="Include reasoning in context"
								description={includeReasoning === null ? 'Using provider default' : 'Send reasoning from prior messages to the AI'}
								onchange={(next) => { includeReasoning = next; }}
								canReset={includeReasoning !== null}
								onreset={() => resetField('includeReasoning')}
							/>

							<SettingRow label="Reasoning Effort">
								{#snippet action()}
									{#if reasoningEffort !== null}{@render resetLink(() => resetField('reasoningEffort'), 'Default')}{/if}
								{/snippet}
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
							</SettingRow>
						</div>

					{:else if activeTab === 'persona'}
						<!-- Persona Tab -->
						<div class="space-y-6">
							<div>
								<h3 class="text-base font-semibold">Persona & Instructions</h3>
								<p class="text-sm text-muted-foreground">Identity and custom instructions for this chat</p>
							</div>

							<SettingRow label="Persona" htmlFor="cs-persona">
								{#snippet action()}
									{#if personaId !== null}{@render resetLink(() => resetField('persona'), 'Use default')}{/if}
								{/snippet}
								<Combobox
									id="cs-persona"
									value={personaId == null ? '' : String(personaId)}
									onchange={(v) => { const n = v ? parseInt(v) : NaN; personaId = isNaN(n) ? null : n; }}
									items={personaItems}
									placeholder={`Default (${personas.find(p => p.isDefault)?.name ?? 'none'})`}
									searchPlaceholder="Filter personas…"
								/>
								<p class="text-xs text-muted-foreground">Who &#123;&#123;user&#125;&#125; is in this chat</p>
							</SettingRow>

							<SettingRow label="Custom Instructions">
								{#snippet action()}
									{#if customPrompt}{@render resetLink(() => resetField('customPrompt'), 'Clear')}{/if}
								{/snippet}
								<LimitedTextarea
									bind:value={customPrompt}
									rows={4}
									limit={FIELD_LIMITS.prompt}
									class="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm leading-relaxed placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-ring"
									placeholder="Override or extend the global custom instructions for this chat..."
								/>
								<p class="text-xs text-muted-foreground">Replaces provider custom instructions when set. Supports &#123;&#123;char&#125;&#125; / &#123;&#123;user&#125;&#125; macros.</p>
							</SettingRow>

							<SettingRow label="Reply guidance">
								{#snippet action()}
									{#if replyGuidance}{@render resetLink(() => resetField('replyGuidance'), 'Clear')}{/if}
								{/snippet}
								<LimitedTextarea
									bind:value={replyGuidance}
									rows={3}
									limit={FIELD_LIMITS.replyGuidance}
									class="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm leading-relaxed placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-ring"
									placeholder="e.g. keep replies short, avoid breaking the fourth wall…"
								/>
								<p class="text-xs text-muted-foreground">Sent on every reply in this chat, in addition to any per-message guidance.</p>
							</SettingRow>

							<ToggleSwitch
								checked={allowExternalResources === true}
								label="External resources in creator notes"
								description={allowExternalResources === null ? 'Using global setting' : 'Per-chat override'}
								onchange={(next) => { allowExternalResources = next; }}
								canReset={allowExternalResources !== null}
								onreset={() => { allowExternalResources = null; }}
								resetTooltip="Reset to global default"
							/>
						</div>

					{:else if activeTab === 'compaction'}
						<!-- Compaction Tab -->
						<div class="space-y-6">
							<div>
								<h3 class="text-base font-semibold">Compaction</h3>
								<p class="text-sm text-muted-foreground">Override global compaction behavior for this chat. Leave fields blank to use the global default from Settings &rsaquo; Prompts.</p>
							</div>

							<ToggleSwitch
								checked={compactionEnabledOverride === true}
								label="Auto-compact this chat"
								description={compactionEnabledOverride === null ? 'Using global setting' : compactionEnabledOverride ? 'Forced on for this chat' : 'Forced off for this chat'}
								onchange={(next) => { compactionEnabledOverride = next; }}
								canReset={compactionEnabledOverride !== null}
								onreset={() => { compactionEnabledOverride = null; }}
								resetTooltip="Reset to global default"
							/>

							<SettingRow label="Trigger threshold">
								{#snippet action()}
									{#if compactionThresholdOverride !== null}
										{@render resetLink(() => { compactionThresholdOverride = null; }, 'Default')}
									{:else}
										<span class="text-xs text-muted-foreground">Using global</span>
									{/if}
								{/snippet}
								<div class="flex items-center gap-3">
									<input
										type="range" min="50" max="95" step="5"
										value={compactionThresholdOverride ?? 80}
										oninput={(e) => { compactionThresholdOverride = Number(e.currentTarget.value); }}
										class="flex-1 accent-primary"
									/>
									<span class="w-14 shrink-0 text-right text-sm tabular-nums text-muted-foreground">{compactionThresholdOverride ?? 80}%</span>
								</div>
							</SettingRow>

							<SettingRow label="What to compact">
								{#snippet action()}
									{#if compactionModeOverride !== null}{@render resetLink(() => { compactionModeOverride = null; }, 'Default')}{/if}
								{/snippet}
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
							</SettingRow>

{#if compactionModeOverride === 'window' || compactionModeOverride === null}
							<SettingRow label="Window size per run">
								{#snippet action()}
									{#if compactionWindowPercentOverride !== null}
										{@render resetLink(() => { compactionWindowPercentOverride = null; }, 'Default')}
									{:else}
										<span class="text-xs text-muted-foreground">Using global</span>
									{/if}
								{/snippet}
								<div class="flex items-center gap-3">
									<input
										type="range" min="10" max="60" step="5"
										value={compactionWindowPercentOverride ?? 30}
										oninput={(e) => { compactionWindowPercentOverride = Number(e.currentTarget.value); }}
										class="flex-1 accent-primary"
									/>
									<span class="w-14 shrink-0 text-right text-sm tabular-nums text-muted-foreground">{compactionWindowPercentOverride ?? 30}%</span>
								</div>
							</SettingRow>
							{/if}

							{#if compactionModeOverride === 'fixed'}
								<SettingRow label="Messages per run">
									{#snippet action()}
										{#if compactionFixedCountOverride !== null}{@render resetLink(() => { compactionFixedCountOverride = null; }, 'Default')}{/if}
									{/snippet}
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
								</SettingRow>
							{/if}

							<div class="grid gap-4 @xl:grid-cols-2">
								<SettingRow label="Summarizer provider" htmlFor="cs-comp-provider">
									{#snippet action()}
										{#if compactionProviderIdOverride !== null}{@render resetLink(() => { compactionProviderIdOverride = null; compactionModelOverride = null; }, 'Default')}{/if}
									{/snippet}
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
								</SettingRow>

								<SettingRow label="Summarizer model">
									{#snippet action()}
										{#if compactionModelOverride}{@render resetLink(() => { compactionModelOverride = null; }, 'Default')}{/if}
									{/snippet}
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
								</SettingRow>
							</div>

							<!-- Stored summary editor -->
							<div class="border-t border-border pt-5">
								<SettingRow label="Current summary">
									{#snippet action()}
										<div class="flex items-center gap-1">
											{#if compactionSummaryDraft.trim()}
												<button onclick={clearCompactionState} class="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive">
													<RotateCcw class="h-3 w-3" /> Clear
												</button>
											{/if}
											<div class="relative">
												<button
													onclick={(e) => { e.stopPropagation(); showSummaryMenu = !showSummaryMenu; }}
													class="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
													aria-label="More options"
												>
													<MoreHorizontal class="h-3.5 w-3.5" />
												</button>
												{#if showSummaryMenu}
													<!-- svelte-ignore a11y_no_static_element_interactions -->
													<div
														class="absolute right-0 top-full z-10 mt-1 w-52 rounded-xl border border-border bg-popover py-1 shadow-xl"
														onmouseleave={() => { showSummaryMenu = false; }}
													>
														<button
															onclick={reprocessLastBatch}
															disabled={!chat.compactedUpToMessageId || reprocessingNow}
															class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
														>
															{#if reprocessingNow}
																<Loader2 class="h-4 w-4 animate-spin" /> Re-processing…
															{:else}
																<RefreshCw class="h-4 w-4" /> Re-process last batch
															{/if}
														</button>
													</div>
												{/if}
											</div>
										</div>
									{/snippet}
									<LimitedTextarea
										bind:value={compactionSummaryDraft}
										rows={6}
										limit={FIELD_LIMITS.compactionSummary}
										placeholder="No summary yet. Run compaction below or write one manually."
										class="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm leading-relaxed placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-ring"
									/>
									<p class="text-xs text-muted-foreground">Saved with the rest of the chat settings. Clearing the summary also resets the high-water mark so the next run starts from the very first message.</p>
									{#if chat.compactionLastRunAt}
										<p class="text-xs text-muted-foreground">Last run: {new Date(chat.compactionLastRunAt + 'Z').toLocaleString()}</p>
									{/if}
								</SettingRow>
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
				<Button variant="ghost" onclick={onclose}>Cancel</Button>
				<Button variant="primary" onclick={save} loading={saving} disabled={saving}>
					{saving ? 'Saving...' : 'Save'}
				</Button>
			</div>
		</div>
	</div>
{/if}
