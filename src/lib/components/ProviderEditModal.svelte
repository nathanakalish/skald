<script lang="ts">
	import { X, Save, Trash2, TestTube, Loader2, Check, RefreshCw, ChevronDown, Sliders, Server } from 'lucide-svelte';
	import Combobox from '$lib/components/Combobox.svelte';
	import { modelsToItems } from '$lib/components/modelItems.js';
	import { untrack } from 'svelte';
	import { createModalState, createModalGestures } from '$lib/modal.svelte.js';
	import { providersStore } from '$lib/stores/providers.svelte.js';
	import { providerProfiles, defaultEndpoints, getProfile, type ProviderType } from '$lib/providers/profiles.js';

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
		saving = true;
		try {
			if (provider) {
				// Update existing
				const res = await fetch(`/api/providers/${provider.id}`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						id: provider.id,
						name, type, endpoint, apiKey, defaultModel,
						enabled: provider.enabled,
						maxConcurrent, temperature, topP, topK, maxTokens,
						contextSize, repetitionPenalty, frequencyPenalty, presencePenalty,
						customPrompt,
						lorebookDepth, streamingEnabled, includeReasoning, reasoningEffort,
						textingTypingSpeed, textingTypingMax, textingInitialDelay
					})
				});
				if (res.ok) {
					const body = await res.json().catch(() => null);
					if (body?.provider) providersStore.upsert(body.provider);
					else await providersStore.load(true);
				}
			} else {
				// Create new
				const res = await fetch('/api/providers', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						name, type,
						endpoint: endpoint || defaultEndpoints[type],
						apiKey, defaultModel
					})
				});
				if (res.ok) {
					const body = await res.json().catch(() => null);
					if (body?.id) providersStore.add(body);
					else await providersStore.load(true);
				}
			}
			onclose();
		} finally {
			saving = false;
		}
	}

	let showDeleteConfirm = $state(false);

	async function deleteProvider() {
		if (!provider) return;
		const res = await fetch(`/api/providers/${provider.id}`, { method: 'DELETE' });
		if (res.ok) {
			providersStore.remove(provider.id);
			onclose();
		}
	}

	async function testConnection() {
		if (!provider) return;
		testResult = 'testing';
		const res = await fetch(`/api/providers/${provider.id}/test`, { method: 'POST' });
		const result = await res.json();
		testResult = result.ok ? 'success' : 'fail';
		setTimeout(() => { testResult = null; }, 3000);
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
	const labelClass = 'mb-1 block text-xs font-medium text-muted-foreground';

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
		role="dialog" aria-modal="true" aria-label="Edit Provider" tabindex="-1"
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
							title="Delete provider"
						>
							<Trash2 class="h-4 w-4" />
						</button>
					{/if}
					<button
						onclick={onclose}
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
							title={tab.label}
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
			<div class="flex-1 overflow-y-auto p-5 {gestures.contentClass}" style={gestures.contentStyle}>
				{#if activeTab === 'connection' || isCreate}
					<div class="space-y-4">
						<!-- Name -->
						<div>
							<span class={labelClass}>Name</span>
							<input bind:value={name} class={inputClass} placeholder="My OpenAI Provider" />
						</div>

						<!-- Type -->
						<div>
							<span class={labelClass}>Type</span>
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
						</div>

						<!-- Endpoint & API Key -->
						<div class="grid gap-3 sm:grid-cols-2">
							<div>
								<span class={labelClass}>Endpoint</span>
								<input bind:value={endpoint} class={inputClass} />
							</div>
							<div>
								<span class={labelClass}>API Key</span>
								<input
									type="password"
									bind:value={apiKey}
									class={inputClass}
									placeholder={getProfile(type)?.keyPlaceholder ?? 'API key'}
								/>
							</div>
						</div>

						<!-- Model -->
						<div>
							<span class={labelClass}>Default Model</span>
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
									title="Fetch available models"
								>
									<RefreshCw class="h-3.5 w-3.5 {modelLoading ? 'animate-spin' : ''}" />
								</button>
							</div>
						</div>

						<!-- Max Concurrent -->
						<div>
							<span class={labelClass}>Max Concurrent Requests</span>
							<input type="number" min="1" max="20" bind:value={maxConcurrent} class="w-24 rounded-lg border border-input bg-background px-3 py-2 text-sm text-center tabular-nums focus:outline-none focus:ring-2 focus:ring-ring" />
						</div>

						<!-- Test button (edit mode only) -->
						{#if !isCreate}
							<button
								onclick={testConnection}
								disabled={testResult === 'testing'}
								class="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-accent"
							>
								{#if testResult === 'testing'}
									<Loader2 class="h-4 w-4 animate-spin" />
									Testing...
								{:else if testResult === 'success'}
									<Check class="h-4 w-4 text-green-500" />
									Connected
								{:else if testResult === 'fail'}
									<X class="h-4 w-4 text-destructive" />
									Failed
								{:else}
									<TestTube class="h-4 w-4" />
									Test Connection
								{/if}
							</button>
						{/if}
					</div>
				{:else if activeTab === 'generation'}
					<div class="space-y-5">
						<!-- Sampler Settings -->
						<div>
							<div class="mb-1.5 flex items-center justify-between">
								<span class="text-sm font-medium">Temperature</span>
								<span class="text-sm tabular-nums text-muted-foreground">{temperature.toFixed(2)}</span>
							</div>
							<input type="range" min="0" max="2" step="0.05" bind:value={temperature} class="w-full accent-primary" />
							<div class="mt-1 flex justify-between text-xs text-muted-foreground/60">
								<span>Precise</span>
								<span>Creative</span>
							</div>
						</div>
						<div>
							<div class="mb-1.5 flex items-center justify-between">
								<span class="text-sm font-medium">Top P</span>
								<span class="text-sm tabular-nums text-muted-foreground">{topP.toFixed(2)}</span>
							</div>
							<input type="range" min="0" max="1" step="0.05" bind:value={topP} class="w-full accent-primary" />
						</div>
						<div class="grid gap-4 sm:grid-cols-2">
							<div>
								<span class="mb-1 block text-sm font-medium">Top K</span>
								<input type="number" bind:value={topK} min={0} max={500} class={inputClass + ' tabular-nums'} />
								<p class="mt-1 text-xs text-muted-foreground/60">0 = disabled</p>
							</div>
							<div>
								<span class="mb-1 block text-sm font-medium">Max Response Tokens</span>
								<input type="number" bind:value={maxTokens} min={64} max={65536} step={64} class={inputClass + ' tabular-nums'} />
							</div>
						</div>
						<div>
							<div class="mb-1.5 flex items-center justify-between">
								<span class="text-sm font-medium">Repetition Penalty</span>
								<span class="text-sm tabular-nums text-muted-foreground">{repetitionPenalty.toFixed(2)}</span>
							</div>
							<input type="range" min="1" max="2" step="0.05" bind:value={repetitionPenalty} class="w-full accent-primary" />
						</div>
						<div class="grid gap-4 sm:grid-cols-2">
							<div>
								<div class="mb-1.5 flex items-center justify-between">
									<span class="text-sm font-medium">Frequency Penalty</span>
									<span class="text-sm tabular-nums text-muted-foreground">{frequencyPenalty.toFixed(2)}</span>
								</div>
								<input type="range" min="0" max="2" step="0.05" bind:value={frequencyPenalty} class="w-full accent-primary" />
							</div>
							<div>
								<div class="mb-1.5 flex items-center justify-between">
									<span class="text-sm font-medium">Presence Penalty</span>
									<span class="text-sm tabular-nums text-muted-foreground">{presencePenalty.toFixed(2)}</span>
								</div>
								<input type="range" min="0" max="2" step="0.05" bind:value={presencePenalty} class="w-full accent-primary" />
							</div>
						</div>

						<!-- Context Settings -->
						<div class="border-t border-border pt-4">
							<h4 class="mb-4 text-sm font-semibold text-muted-foreground">Context</h4>
							<div class="space-y-4">
								<div>
									<span class="mb-1 block text-sm font-medium">Context Size (tokens)</span>
									<input type="number" bind:value={contextSize} min={1024} max={2000000} step={1024} class={inputClass + ' tabular-nums'} />
									<p class="mt-1 text-xs text-muted-foreground/60">Total context window for the model. History is automatically trimmed by token count to fit.</p>
								</div>
							</div>
						</div>

						<!-- Prompt & Behavior -->
						<div class="border-t border-border pt-4">
							<h4 class="mb-4 text-sm font-semibold text-muted-foreground">Prompt & Behavior</h4>
							<div class="space-y-4">
								<div>
									<span class="mb-1 block text-sm font-medium">Custom Instructions</span>
									<p class="mb-2 text-xs text-muted-foreground/60">
										Additional instructions injected into the system prompt. Supports &#123;&#123;char&#125;&#125; and &#123;&#123;user&#125;&#125; macros.
									</p>
									<textarea
										bind:value={customPrompt}
										rows={4}
										class="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm leading-relaxed placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-ring"
										placeholder="e.g. Always respond in first person. Keep responses under 3 paragraphs..."
									></textarea>
								</div>
								<div class="flex items-center justify-between rounded-lg border border-border bg-background p-3">
									<div>
										<p class="text-sm font-medium">Stream responses</p>
										<p class="text-xs text-muted-foreground/60">Show tokens as they arrive</p>
									</div>
									<button
										aria-label="Toggle streaming"
										onclick={() => { streamingEnabled = !streamingEnabled; }}
										class="relative h-6 w-11 shrink-0 rounded-full transition-colors {streamingEnabled ? 'bg-primary' : 'bg-secondary'}"
									>
										<span class="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform {streamingEnabled ? 'translate-x-5' : 'translate-x-0'}"></span>
									</button>
								</div>
								<div class="flex items-center justify-between rounded-lg border border-border bg-background p-3">
									<div>
										<p class="text-sm font-medium">Include reasoning in context</p>
										<p class="text-xs text-muted-foreground/60">Send model reasoning back as conversation history</p>
									</div>
									<button
										aria-label="Toggle include reasoning"
										onclick={() => { includeReasoning = !includeReasoning; }}
										class="relative h-6 w-11 shrink-0 rounded-full transition-colors {includeReasoning ? 'bg-primary' : 'bg-secondary'}"
									>
										<span class="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform {includeReasoning ? 'translate-x-5' : 'translate-x-0'}"></span>
									</button>
								</div>
								<div>
									<span class="mb-1 block text-sm font-medium">Reasoning Effort</span>
									<p class="mb-2 text-xs text-muted-foreground/60">Request the model to think before responding</p>
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
									<p class="mt-1.5 text-[11px] text-muted-foreground/50">Z.AI only supports on/off — any non-off level enables thinking mode.</p>
								</div>
								<div>
									<span class="mb-1 block text-sm font-medium">Lorebook Injection Depth</span>
									<input type="number" bind:value={lorebookDepth} min={0} max={50} class={inputClass + ' tabular-nums'} />
									<p class="mt-1 text-xs text-muted-foreground/60">Messages from the end of history to inject world info (0 = top)</p>
								</div>
							</div>
						</div>

						<!-- Texting Mode Delays -->
						<div class="border-t border-border pt-4">
							<h4 class="mb-4 text-sm font-semibold text-muted-foreground">Texting Mode Delays</h4>
							<div class="space-y-4">
								<div>
									<div class="mb-1.5 flex items-center justify-between">
										<span class="text-sm font-medium">Initial Delay</span>
										<span class="text-sm tabular-nums text-muted-foreground">{(textingInitialDelay / 1000).toFixed(1)}s</span>
									</div>
									<input type="range" min="0" max="5000" step="100" bind:value={textingInitialDelay} class="w-full accent-primary" />
									<p class="mt-1 text-xs text-muted-foreground/60">Delay before the typing indicator appears</p>
								</div>
								<div>
									<div class="mb-1.5 flex items-center justify-between">
										<span class="text-sm font-medium">Typing Speed</span>
										<span class="text-sm tabular-nums text-muted-foreground">{textingTypingSpeed} ms/char</span>
									</div>
									<input type="range" min="0" max="100" step="5" bind:value={textingTypingSpeed} class="w-full accent-primary" />
									<p class="mt-1 text-xs text-muted-foreground/60">How long to simulate typing per character</p>
								</div>
								<div>
									<div class="mb-1.5 flex items-center justify-between">
										<span class="text-sm font-medium">Max Typing Delay</span>
										<span class="text-sm tabular-nums text-muted-foreground">{(textingTypingMax / 1000).toFixed(1)}s</span>
									</div>
									<input type="range" min="0" max="15000" step="500" bind:value={textingTypingMax} class="w-full accent-primary" />
									<p class="mt-1 text-xs text-muted-foreground/60">Maximum typing delay regardless of message length</p>
								</div>
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
