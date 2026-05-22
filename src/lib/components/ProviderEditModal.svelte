<script lang="ts">
	import { tooltip } from '$lib/tooltip.js';
	import { X, Save, Trash2, TestTube, Loader2, Check, RefreshCw, ChevronDown, Sliders, Server } from 'lucide-svelte';
	import Combobox from '$lib/components/Combobox.svelte';
	import { modelsToItems } from '$lib/components/modelItems.js';
	import { untrack } from 'svelte';
	import { createModalState, createModalGestures } from '$lib/modal.svelte.js';
	import { focusTrap } from '$lib/focusTrap.js';
	import { providersStore } from '$lib/stores/providers.svelte.js';
	import { toasts } from '$lib/stores/toast.svelte.js';
	import { providerProfiles, defaultEndpoints, getProfile, type ProviderType } from '$lib/providers/profiles.js';
	import LimitedInput from '$lib/components/LimitedInput.svelte';
	import LimitedTextarea from '$lib/components/LimitedTextarea.svelte';
	import SettingRow from '$lib/components/settings/SettingRow.svelte';
	import ToggleSwitch from '$lib/components/settings/ToggleSwitch.svelte';
	import { checkFieldLimits } from '$lib/limitCheck.js';
	import { FIELD_LIMITS } from '$lib/fieldLimits.js';

	interface Provider {
		id: number;
		name: string;
		type: string;
		endpoint: string;
		hasKey?: boolean;
		defaultModel: string;
		enabled: boolean;
		maxConcurrent: number;
		temperature: number;
		topP: number;
		topK: number;
		maxTokens: number;
		contextSize: number;
		repetitionPenalty: number;
		frequencyPenalty: number;
		presencePenalty: number;
		customPrompt: string;
		lorebookDepth: number;
		streamingEnabled: boolean;
		includeReasoning: boolean;
		reasoningEffort: 'off' | 'low' | 'medium' | 'high';
		textingTypingSpeed: number;
		textingTypingMax: number;
		textingInitialDelay: number;
	}

	interface Props {
		open: boolean;
		provider: any | null; // null = create mode
		onclose: () => void;
	}

	let { open, provider, onclose }: Props = $props();


	const tabs = [
		{ id: 'connection' as const, label: 'Connection', icon: Server },
		{ id: 'generation' as const, label: 'Generation', icon: Sliders }
	];

	type TabId = (typeof tabs)[number]['id'];

	let activeTab = $state<TabId>('connection');
	let saving = $state(false);

	// Form state
	let name = $state('');
	let type = $state<ProviderType>('openai');
	let endpoint = $state('');
	let apiKey = $state('');
	let defaultModel = $state('');
	let maxConcurrent = $state(1);
	let temperature = $state(0.8);
	let topP = $state(1.0);
	let topK = $state(0);
	let maxTokens = $state(1024);
	let contextSize = $state(32768);
	let repetitionPenalty = $state(1.0);
	let frequencyPenalty = $state(0.0);
	let presencePenalty = $state(0.0);
	let customPrompt = $state('');
	let lorebookDepth = $state(4);
	let streamingEnabled = $state(true);
	let includeReasoning = $state(false);
	let reasoningEffort = $state<'off' | 'low' | 'medium' | 'high'>('off');
	let textingTypingSpeed = $state(35);
	let textingTypingMax = $state(4000);
	let textingInitialDelay = $state(1500);

	// Test & model state
	let testResult = $state<'testing' | 'success' | 'fail' | null>(null);
	let testDetails = $state<{ latencyMs?: number; modelCount?: number; error?: string } | null>(null);
	let modelList = $state<string[]>([]);
	let modelLoading = $state(false);

	// Track loaded provider to reset form (-1 = uninitialized)
	let loadedId: number | null = $state(-1 as any);

	$effect(() => {
		if (!open) {
			untrack(() => { loadedId = -1 as any; });
			return;
		}

		const pid = provider?.id ?? null;
		if (pid !== null && pid === loadedId) return;

		untrack(() => {
			loadedId = pid;
			activeTab = 'connection';
			testResult = null;
			testDetails = null;
			modelList = [];

			if (provider) {
				// Edit mode — populate from provider
				name = provider.name ?? '';
				type = provider.type ?? 'openai';
				endpoint = provider.endpoint ?? defaultEndpoints[provider.type ?? 'openai'];
				apiKey = '';
				defaultModel = provider.defaultModel ?? '';
				maxConcurrent = provider.maxConcurrent ?? 1;
				temperature = provider.temperature ?? 0.8;
				topP = provider.topP ?? 1.0;
				topK = provider.topK ?? 0;
				maxTokens = provider.maxTokens ?? 1024;
				contextSize = provider.contextSize ?? 32768;
				repetitionPenalty = provider.repetitionPenalty ?? 1.0;
				frequencyPenalty = provider.frequencyPenalty ?? 0.0;
				presencePenalty = provider.presencePenalty ?? 0.0;
				customPrompt = provider.customPrompt ?? '';
				lorebookDepth = provider.lorebookDepth ?? 4;
				streamingEnabled = provider.streamingEnabled ?? true;
				includeReasoning = provider.includeReasoning ?? false;
				reasoningEffort = provider.reasoningEffort ?? 'off';
				textingTypingSpeed = provider.textingTypingSpeed ?? 35;
				textingTypingMax = provider.textingTypingMax ?? 4000;
				textingInitialDelay = provider.textingInitialDelay ?? 1500;
				// Fetch the API key on demand (not included in layout data)
				fetch(`/api/providers/${provider.id}`).then(r => r.json()).then(data => {
					if (data?.apiKey != null) apiKey = data.apiKey;
				}).catch(() => {});
				// Auto-load available models
				fetchModels();
			} else {
				// Create mode — defaults
				name = '';
				type = 'openai';
				endpoint = defaultEndpoints.openai;
				apiKey = '';
				defaultModel = '';
				maxConcurrent = 1;
				temperature = 0.8;
				topP = 1.0;
				topK = 0;
				maxTokens = 1024;
				contextSize = 32768;
				repetitionPenalty = 1.0;
				frequencyPenalty = 0.0;
				presencePenalty = 0.0;
				customPrompt = '';
				lorebookDepth = 4;
				streamingEnabled = true;
				includeReasoning = false;
				reasoningEffort = 'off';
				textingTypingSpeed = 35;
				textingTypingMax = 4000;
				textingInitialDelay = 1500;
			}
		});
	});

	function setType(t: typeof type) {
		type = t;
		if (!endpoint || Object.values(defaultEndpoints).includes(endpoint)) {
			endpoint = defaultEndpoints[t];
		}
	}

	async function save() {
		if (!name.trim()) return;
		const ok = await checkFieldLimits([
			{ label: 'Name', value: name, limit: FIELD_LIMITS.name, trim: (v) => (name = v) },
			{ label: 'Endpoint', value: endpoint, limit: FIELD_LIMITS.url, trim: (v) => (endpoint = v) },
			{ label: 'Custom Instructions', value: customPrompt, limit: FIELD_LIMITS.prompt, trim: (v) => (customPrompt = v) },
		]);
		if (!ok) return;
		saving = true;
		const editing = provider;
		const prev = editing ? { ...editing } : null;
		// Optimistic store update so list views (and the chat picker) refresh
		// the moment the user clicks Save. Real server response will overwrite.
		if (editing) {
			providersStore.update(editing.id, {
				name, type, endpoint, defaultModel, enabled: editing.enabled,
			} as any);
		}
		onclose();
		try {
			if (editing) {
				const res = await fetch(`/api/providers/${editing.id}`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						id: editing.id,
						name, type, endpoint, apiKey, defaultModel,
						enabled: editing.enabled,
						maxConcurrent, temperature, topP, topK, maxTokens,
						contextSize, repetitionPenalty, frequencyPenalty, presencePenalty,
						customPrompt,
						lorebookDepth, streamingEnabled, includeReasoning, reasoningEffort,
						textingTypingSpeed, textingTypingMax, textingInitialDelay
					}),
				});
				if (!res.ok) throw new Error(String(res.status));
				const body = await res.json().catch(() => null);
				if (body?.provider) providersStore.upsert(body.provider);
				else await providersStore.load(true);
			} else {
				const res = await fetch('/api/providers', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						name, type,
						endpoint: endpoint || defaultEndpoints[type],
						apiKey, defaultModel
					})
				});
				if (!res.ok) throw new Error(String(res.status));
				const body = await res.json().catch(() => null);
				if (body?.id) providersStore.add(body);
				else await providersStore.load(true);
			}
		} catch {
			if (editing && prev) providersStore.update(editing.id, prev as any);
			toasts.error('Failed to save provider');
		} finally {
			saving = false;
		}
	}

	let showDeleteConfirm = $state(false);

	async function deleteProvider() {
		if (!provider) return;
		const snapshot = { ...provider };
		providersStore.remove(snapshot.id);
		onclose();
		try {
			const res = await fetch(`/api/providers/${snapshot.id}`, { method: 'DELETE' });
			if (!res.ok) throw new Error(String(res.status));
		} catch {
			providersStore.add(snapshot);
			toasts.error('Failed to delete provider');
		}
	}

	async function testConnection() {
		if (!provider) return;
		testResult = 'testing';
		testDetails = null;
		const res = await fetch(`/api/providers/${provider.id}/test`, { method: 'POST' });
		const result = await res.json();
		testResult = result.ok ? 'success' : 'fail';
		testDetails = {
			latencyMs: typeof result.latencyMs === 'number' ? result.latencyMs : undefined,
			modelCount: typeof result.modelCount === 'number' ? result.modelCount : undefined,
			error: typeof result.error === 'string' ? result.error : undefined,
		};
		setTimeout(() => { testResult = null; testDetails = null; }, 5000);
	}

	async function fetchModels() {
		modelLoading = true;
		try {
			const res = await fetch('/api/providers/models', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					type,
					endpoint: endpoint || defaultEndpoints[type],
					apiKey
				})
			});
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

	const inputClass = 'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

	let isCreate = $derived(!provider);

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
		class="fixed inset-0 z-[60] flex items-end justify-center p-0 sm:items-center sm:p-4 bg-black/60 {modal.closing ? 'backdrop-exit' : 'backdrop-enter'}"
		role="dialog" aria-modal="true" aria-label="Edit Provider" tabindex="-1" use:focusTrap
		onkeydown={(e) => e.key === 'Escape' && onclose()}
	>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div class="absolute inset-0" onclick={onclose}></div>

		<div
			class="relative z-10 flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-xl sm:rounded-xl {modal.closing ? 'modal-exit' : 'modal-enter'}"
			style={gestures.panelStyle}
			ontouchstart={gestures.handlers.onTouchStart}
			ontouchmove={gestures.handlers.onTouchMove}
			ontouchend={gestures.handlers.onTouchEnd}
		>
			<!-- Header -->
			<div class="flex items-center justify-between border-b border-border px-5 py-3.5">
				<h2 class="text-lg font-semibold">{isCreate ? 'New Provider' : `Edit ${name || 'Provider'}`}</h2>
				<div class="flex items-center gap-2">
					{#if !isCreate}
						<button
							onclick={() => (showDeleteConfirm = true)}
							class="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/20 hover:text-destructive"
							use:tooltip={'Delete provider'}
						>
							<Trash2 class="h-4 w-4" />
						</button>
					{/if}
					<button
						onclick={onclose}
						aria-label="Close"
						class="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent"
					>
						<X class="h-4 w-4" />
					</button>
				</div>
			</div>

			<!-- Tabs -->
			{#if !isCreate}
				<div class="flex border-b border-border px-5">
					{#each tabs as tab}
						<button
							onclick={() => { activeTab = tab.id; }}
							use:tooltip={tab.label}
							class="flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors {activeTab === tab.id
								? 'border-primary text-primary'
								: 'border-transparent text-muted-foreground hover:text-foreground'}"
						>
							<tab.icon class="h-4 w-4" />
							<span class="hidden sm:inline">{tab.label}</span>
						</button>
					{/each}
				</div>
			{/if}

			<!-- Body -->
			<div class="@container flex-1 overflow-y-auto p-5 {gestures.contentClass}" style={gestures.contentStyle}>
				{#if activeTab === 'connection' || isCreate}
					<div class="space-y-4">
						<!-- Name -->
						<SettingRow size="sm" label="Name">
							<LimitedInput bind:value={name} limit={FIELD_LIMITS.name} class={inputClass} placeholder="My OpenAI Provider" />
						</SettingRow>

						<!-- Type -->
						<SettingRow size="sm" label="Type">
							<div class="flex flex-wrap gap-2">
								{#each providerProfiles as profile}
									<button
										onclick={() => setType(profile.id)}
										class="rounded-lg border px-3 py-1.5 text-sm transition-colors {type === profile.id
											? 'border-primary bg-primary/10 text-primary'
											: 'border-border hover:bg-accent'}"
									>
										{profile.label}
									</button>
								{/each}
							</div>
							{#if getProfile(type)?.description}
								<p class="mt-1 text-xs text-muted-foreground">{getProfile(type)?.description}</p>
							{/if}
						</SettingRow>

						<!-- Endpoint & API Key -->
						<div class="grid gap-3 @2xl:grid-cols-2">
							<SettingRow size="sm" label="Endpoint">
								<LimitedInput bind:value={endpoint} limit={FIELD_LIMITS.url} class={inputClass} />
							</SettingRow>
							<SettingRow size="sm" label="API Key">
								<input
									type="password"
									bind:value={apiKey}
									class={inputClass}
									placeholder={getProfile(type)?.keyPlaceholder ?? 'API key'}
								/>
							</SettingRow>
						</div>

						<!-- Model -->
						<SettingRow size="sm" label="Default Model">
							<div class="flex gap-2">
								<div class="flex-1">
									<Combobox
										bind:value={defaultModel}
										items={modelsToItems(modelList, type)}
										loading={modelLoading}
										placeholder={modelList.length ? 'Select a model…' : (defaultModel ? defaultModel : 'Click refresh to load models')}
										searchPlaceholder="Filter models…"
										emptyText="No matching models"
									/>
								</div>
								<button
									onclick={fetchModels}
									disabled={modelLoading}
									class="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-2 text-xs transition-colors hover:bg-accent disabled:opacity-50"
									use:tooltip={'Fetch available models'}
								>
									<RefreshCw class="h-3.5 w-3.5 {modelLoading ? 'animate-spin' : ''}" />
								</button>
							</div>
						</SettingRow>

						<!-- Max Concurrent + Test Connection: pair compact controls -->
						<div class="grid gap-3 @xl:grid-cols-2 @xl:items-end">
							<SettingRow size="sm" label="Max Concurrent Requests">
								<input type="number" min="1" max="20" bind:value={maxConcurrent} class="w-24 rounded-lg border border-input bg-background px-3 py-2 text-sm text-center tabular-nums focus:outline-none focus:ring-2 focus:ring-ring" />
							</SettingRow>

							<!-- Test button (edit mode only) -->
							{#if !isCreate}
								<div class="flex flex-col gap-1">
									<button
										onclick={testConnection}
										disabled={testResult === 'testing'}
										class="flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-accent"
									>
										{#if testResult === 'testing'}
											<Loader2 class="h-4 w-4 animate-spin" />
											Testing...
										{:else if testResult === 'success'}
											<Check class="h-4 w-4 text-success" />
											Connected
										{:else if testResult === 'fail'}
											<X class="h-4 w-4 text-destructive" />
											Failed
										{:else}
											<TestTube class="h-4 w-4" />
											Test Connection
										{/if}
									</button>
									{#if testDetails && (testDetails.latencyMs != null || testDetails.modelCount != null || testDetails.error)}
										<div class="px-1 text-xs text-muted-foreground">
											{#if testDetails.latencyMs != null}
												<span>{testDetails.latencyMs}ms</span>
											{/if}
											{#if testDetails.modelCount != null}
												<span class="ml-2">{testDetails.modelCount} model{testDetails.modelCount === 1 ? '' : 's'}</span>
											{/if}
											{#if testDetails.error}
												<div class="mt-0.5 text-destructive">{testDetails.error}</div>
											{/if}
										</div>
									{/if}
								</div>
							{/if}
						</div>
					</div>
				{:else if activeTab === 'generation'}
					<div class="space-y-5">
						<SettingRow label="Temperature">
							{#snippet action()}<span class="text-sm tabular-nums text-muted-foreground">{temperature.toFixed(2)}</span>{/snippet}
							<input type="range" min="0" max="2" step="0.05" bind:value={temperature} class="w-full accent-primary" />
							<div class="flex justify-between text-xs text-muted-foreground/60">
								<span>Precise</span>
								<span>Creative</span>
							</div>
						</SettingRow>
						<div class="grid gap-4 @xl:grid-cols-2">
							<SettingRow label="Top P">
								{#snippet action()}<span class="text-sm tabular-nums text-muted-foreground">{topP.toFixed(2)}</span>{/snippet}
								<input type="range" min="0" max="1" step="0.05" bind:value={topP} class="w-full accent-primary" />
							</SettingRow>
							<SettingRow label="Repetition Penalty">
								{#snippet action()}<span class="text-sm tabular-nums text-muted-foreground">{repetitionPenalty.toFixed(2)}</span>{/snippet}
								<input type="range" min="1" max="2" step="0.05" bind:value={repetitionPenalty} class="w-full accent-primary" />
							</SettingRow>
						</div>
						<div class="grid gap-4 @xl:grid-cols-2">
							<SettingRow label="Top K">
								<input type="number" bind:value={topK} min={0} max={500} class={inputClass + ' tabular-nums'} />
								<p class="text-xs text-muted-foreground/60">0 = disabled</p>
							</SettingRow>
							<SettingRow label="Max Response Tokens">
								<input type="number" bind:value={maxTokens} min={64} max={65536} step={64} class={inputClass + ' tabular-nums'} />
							</SettingRow>
						</div>
						<div class="grid gap-4 @xl:grid-cols-2">
							<SettingRow label="Frequency Penalty">
								{#snippet action()}<span class="text-sm tabular-nums text-muted-foreground">{frequencyPenalty.toFixed(2)}</span>{/snippet}
								<input type="range" min="0" max="2" step="0.05" bind:value={frequencyPenalty} class="w-full accent-primary" />
							</SettingRow>
							<SettingRow label="Presence Penalty">
								{#snippet action()}<span class="text-sm tabular-nums text-muted-foreground">{presencePenalty.toFixed(2)}</span>{/snippet}
								<input type="range" min="0" max="2" step="0.05" bind:value={presencePenalty} class="w-full accent-primary" />
							</SettingRow>
						</div>

						<div class="border-t border-border pt-4">
							<h4 class="mb-4 text-sm font-semibold text-muted-foreground">Context</h4>
							<SettingRow label="Context Size (tokens)">
								<input type="number" bind:value={contextSize} min={1024} max={2000000} step={1024} class={inputClass + ' tabular-nums'} />
								<p class="text-xs text-muted-foreground/60">Total context window for the model. History is automatically trimmed by token count to fit.</p>
							</SettingRow>
						</div>

						<div class="border-t border-border pt-4">
							<h4 class="mb-4 text-sm font-semibold text-muted-foreground">Prompt & Behavior</h4>
							<div class="space-y-4">
								<SettingRow label="Custom Instructions" description="Additional instructions injected into the system prompt. Supports &#123;&#123;char&#125;&#125; and &#123;&#123;user&#125;&#125; macros.">
									<LimitedTextarea
										bind:value={customPrompt}
										rows={4}
										limit={FIELD_LIMITS.prompt}
										class="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm leading-relaxed placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-ring"
										placeholder="e.g. Always respond in first person. Keep responses under 3 paragraphs..."
									/>
								</SettingRow>
								<div class="grid gap-4 @xl:grid-cols-2">
									<ToggleSwitch
										label="Stream responses"
										description="Show tokens as they arrive"
										checked={streamingEnabled}
										onchange={(next) => { streamingEnabled = next; }}
									/>
									<ToggleSwitch
										label="Include reasoning in context"
										description="Send model reasoning back as conversation history"
										checked={includeReasoning}
										onchange={(next) => { includeReasoning = next; }}
									/>
								</div>
								<SettingRow label="Reasoning Effort" description="Request the model to think before responding">
									<div class="flex gap-2">
										{#each ['off', 'low', 'medium', 'high'] as level}
											<button
												onclick={() => { reasoningEffort = level as Provider['reasoningEffort']; }}
												class="flex-1 rounded-lg border px-3 py-2 text-sm font-medium capitalize transition-colors {reasoningEffort === level ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background text-muted-foreground hover:bg-muted'}"
											>
												{level}
											</button>
										{/each}
									</div>
									<p class="text-[11px] text-muted-foreground/50">Z.AI only supports on/off — any non-off level enables thinking mode.</p>
								</SettingRow>
								<SettingRow label="Lorebook Injection Depth">
									<input type="number" bind:value={lorebookDepth} min={0} max={50} class={inputClass + ' tabular-nums'} />
									<p class="text-xs text-muted-foreground/60">Messages from the end of history to inject world info (0 = top)</p>
								</SettingRow>
							</div>
						</div>

						<div class="border-t border-border pt-4">
							<h4 class="mb-4 text-sm font-semibold text-muted-foreground">Texting Mode Delays</h4>
							<div class="grid gap-4 @2xl:grid-cols-3">
								<SettingRow label="Initial Delay">
									{#snippet action()}<span class="text-sm tabular-nums text-muted-foreground">{(textingInitialDelay / 1000).toFixed(1)}s</span>{/snippet}
									<input type="range" min="0" max="5000" step="100" bind:value={textingInitialDelay} class="w-full accent-primary" />
									<p class="text-xs text-muted-foreground/60">Before typing indicator appears</p>
								</SettingRow>
								<SettingRow label="Typing Speed">
									{#snippet action()}<span class="text-sm tabular-nums text-muted-foreground">{textingTypingSpeed} ms/char</span>{/snippet}
									<input type="range" min="0" max="100" step="5" bind:value={textingTypingSpeed} class="w-full accent-primary" />
									<p class="text-xs text-muted-foreground/60">Simulated time per character</p>
								</SettingRow>
								<SettingRow label="Max Typing Delay">
									{#snippet action()}<span class="text-sm tabular-nums text-muted-foreground">{(textingTypingMax / 1000).toFixed(1)}s</span>{/snippet}
									<input type="range" min="0" max="15000" step="500" bind:value={textingTypingMax} class="w-full accent-primary" />
									<p class="text-xs text-muted-foreground/60">Cap regardless of length</p>
								</SettingRow>
							</div>
						</div>
					</div>
				{/if}
			</div>

			<!-- Footer -->
			<div class="flex items-center justify-end gap-3 border-t border-border px-5 py-3.5">
				<button
					onclick={onclose}
					class="rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-accent"
				>
					Cancel
				</button>
				<button
					onclick={save}
					disabled={!name.trim() || saving}
					class="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
				>
					{#if saving}
						<Loader2 class="h-3.5 w-3.5 animate-spin" />
					{:else}
						<Save class="h-3.5 w-3.5" />
					{/if}
					{isCreate ? 'Add Provider' : 'Save'}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Delete confirmation dialog -->
{#if showDeleteConfirm}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4"
		onkeydown={(e) => e.key === 'Escape' && (showDeleteConfirm = false)}
	>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div class="absolute inset-0" onclick={() => (showDeleteConfirm = false)}></div>
		<div class="relative z-10 w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-xl">
			<h3 class="text-base font-semibold">Delete Provider</h3>
			<p class="mt-2 text-sm text-muted-foreground">Are you sure you want to delete <strong>{name || 'this provider'}</strong>? This cannot be undone.</p>
			<div class="mt-4 flex justify-end gap-2">
				<button
					onclick={() => (showDeleteConfirm = false)}
					class="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent"
				>Cancel</button>
				<button
					onclick={deleteProvider}
					class="rounded-lg bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
				>Delete</button>
			</div>
		</div>
	</div>
{/if}
