<script lang="ts">
	// Prompts tab: slot ordering, character creator LLM, greeting reformatter
	// LLM, and conversation compaction. Reads/writes settingsStore + uses
	// providersStore for the provider picker — no props needed.
	import { GripVertical, RotateCcw } from 'lucide-svelte';
	import Combobox, { type ComboboxItem } from '$lib/components/Combobox.svelte';
	import { modelsToItems } from '$lib/components/modelItems.js';
	import LimitedTextarea from '$lib/components/LimitedTextarea.svelte';
	import ToggleSwitch from '$lib/components/settings/ToggleSwitch.svelte';
	import SettingRow from '$lib/components/settings/SettingRow.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte.js';
	import { providersStore } from '$lib/stores/providers.svelte.js';
	import { toasts } from '$lib/stores/toast.svelte.js';
	import { checkAutoSaveLimit } from '$lib/limitCheck.js';
	import { FIELD_LIMITS } from '$lib/fieldLimits.js';

	const s = $derived(settingsStore.settings);
	const providers = $derived(providersStore.providers);
	const providerItems = $derived(providers.map((p: any) => ({ value: String(p.id), label: p.name, hint: p.type })) as ComboboxItem[]);

	const creatorProviderType = $derived(providers.find((p: any) => String(p.id) === s.characterCreatorProviderId)?.type ?? null);
	const reformatterProviderType = $derived(providers.find((p: any) => String(p.id) === s.reformatterProviderId)?.type ?? null);
	const compactionProviderType = $derived(providers.find((p: any) => String(p.id) === s.compactionProviderId)?.type ?? null);

	async function save(key: string, value: string | boolean | number) {
		const ok = await settingsStore.save(key as any, value);
		if (ok) toasts.success('Setting saved');
	}

	// Models lists per-section. Refetch on provider change. We don't hold
	// these in the global store because they're transient picker data.
	let creatorModels: string[] = $state([]);
	let loadingCreatorModels = $state(false);
	let reformatterModels: string[] = $state([]);
	let loadingReformatterModels = $state(false);
	let compactionModels: string[] = $state([]);
	let loadingCompactionModels = $state(false);

	async function fetchModels(pid: string): Promise<string[]> {
		if (!pid) return [];
		try {
			const res = await fetch(`/api/providers/${pid}/models`);
			if (res.ok) {
				const data = await res.json();
				return data.models ?? [];
			}
		} catch { /* ignore */ }
		return [];
	}

	$effect(() => {
		const pid = s.characterCreatorProviderId;
		if (!pid) { creatorModels = []; return; }
		loadingCreatorModels = true;
		fetchModels(pid).then((m) => { creatorModels = m; loadingCreatorModels = false; });
	});

	$effect(() => {
		const pid = s.reformatterProviderId;
		if (!pid) { reformatterModels = []; return; }
		loadingReformatterModels = true;
		fetchModels(pid).then((m) => { reformatterModels = m; loadingReformatterModels = false; });
	});

	$effect(() => {
		const pid = s.compactionProviderId;
		if (!pid) { compactionModels = []; return; }
		loadingCompactionModels = true;
		fetchModels(pid).then((m) => { compactionModels = m; loadingCompactionModels = false; });
	});

	// Prompt slot ordering. Local mirror so drag updates feel instant while
	// the PATCH round-trips.
	const DEFAULT_SLOT_ORDER = ['system', 'persona', 'character', 'examples', 'history', 'postHistory'];
	let slotOrder = $state<string[]>([...DEFAULT_SLOT_ORDER]);
	let slotDragIdx = $state<number | null>(null);
	const SLOT_LABELS: Record<string, string> = {
		system: 'System Prompt',
		persona: 'Persona',
		character: 'Character Card',
		examples: 'Example Messages',
		history: 'Chat History',
		postHistory: 'Post-History Instructions'
	};

	$effect(() => {
		// Sync from store on first read and on external changes.
		try {
			const parsed = s.promptSlotOrder ? JSON.parse(s.promptSlotOrder) : DEFAULT_SLOT_ORDER;
			if (Array.isArray(parsed) && parsed.length === DEFAULT_SLOT_ORDER.length) {
				slotOrder = parsed;
			}
		} catch { /* fall back to default */ }
	});

	// Local mirrors for free-text prompts (LimitedTextarea uses bind:value).
	// They sync from the store and write back on `change`. Without a local
	// mirror, typing would be debounced through save() on every keystroke.
	// svelte-ignore state_referenced_locally
	let creatorPrompt = $state(s.characterCreatorPrompt);
	// svelte-ignore state_referenced_locally
	let reformatterPrompt = $state(s.reformatterPrompt);
	// svelte-ignore state_referenced_locally
	let compactionPrompt = $state(s.compactionPrompt);
	$effect(() => { creatorPrompt = s.characterCreatorPrompt; });
	$effect(() => { reformatterPrompt = s.reformatterPrompt; });
	$effect(() => { compactionPrompt = s.compactionPrompt; });
	// svelte-ignore state_referenced_locally
	let imagePrompt = $state(s.imagePromptTemplate);
	$effect(() => { imagePrompt = s.imagePromptTemplate; });
</script>

<div class="space-y-6">
	<div>
		<h3 class="text-base font-semibold">Prompts</h3>
		<p class="text-sm text-muted-foreground">Control how prompts are assembled and pre-processed before sending to the model</p>
	</div>

	<!-- Prompt Slot Ordering -->
	<SettingRow label="Prompt Order" description="Drag to reorder how prompt sections are assembled. Changes apply to all chats.">
		<div class="space-y-1" role="list">
			{#each slotOrder as slotName, i (slotName)}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					role="listitem"
					draggable="true"
					ondragstart={(e: DragEvent) => { slotDragIdx = i; e.dataTransfer!.effectAllowed = 'move'; }}
					ondragover={(e: DragEvent) => { e.preventDefault(); }}
					ondrop={async (e: DragEvent) => {
						e.preventDefault();
						if (slotDragIdx === null || slotDragIdx === i) return;
						const newOrder = [...slotOrder];
						const [moved] = newOrder.splice(slotDragIdx, 1);
						newOrder.splice(i, 0, moved);
						slotOrder = newOrder;
						slotDragIdx = null;
						await save('promptSlotOrder', JSON.stringify(newOrder));
					}}
					ondragend={() => { slotDragIdx = null; }}
					class="flex cursor-grab items-center gap-2 rounded-md border border-border bg-card/50 px-3 py-2 text-sm transition-colors hover:bg-accent/30 active:cursor-grabbing {slotDragIdx === i ? 'opacity-40' : ''}"
				>
					<GripVertical class="h-4 w-4 shrink-0 text-muted-foreground" />
					<span>{SLOT_LABELS[slotName] ?? slotName}</span>
				</div>
			{/each}
		</div>
		{#if JSON.stringify(slotOrder) !== JSON.stringify(DEFAULT_SLOT_ORDER)}
			<button
				onclick={async () => { slotOrder = [...DEFAULT_SLOT_ORDER]; await save('promptSlotOrder', JSON.stringify(DEFAULT_SLOT_ORDER)); }}
				class="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
			>
				<RotateCcw class="h-3 w-3" /> Reset to default
			</button>
		{/if}
	</SettingRow>

	<!-- Character Creator -->
	<div class="border-t border-border pt-6">
		<div class="mb-4">
			<h3 class="text-base font-semibold">Character Creator</h3>
			<p class="text-sm text-muted-foreground">LLM used to generate and refine characters via the AI creator (the sparkles button in the new-character form).</p>
		</div>
		<div class="space-y-4">
			<div class="grid gap-4 @xl:grid-cols-2">
				<SettingRow label="Provider" htmlFor="creator-provider">
					<Combobox
						id="creator-provider"
						value={s.characterCreatorProviderId}
						onchange={async (v) => {
							await save('characterCreatorProviderId', v);
							await save('characterCreatorModel', '');
						}}
						items={providerItems}
						placeholder="Default (active provider)"
						searchPlaceholder="Filter providers…"
					/>
				</SettingRow>
				<SettingRow label="Model" htmlFor="creator-model">
					<Combobox
						id="creator-model"
						value={s.characterCreatorModel}
						onchange={async (v) => { await save('characterCreatorModel', v); }}
						items={modelsToItems(creatorModels, creatorProviderType)}
						loading={loadingCreatorModels}
						placeholder={`Default (${s.characterCreatorProviderId ? 'provider default' : 'active provider model'})`}
						searchPlaceholder="Filter models…"
						emptyText="No matching models"
					/>
				</SettingRow>
			</div>
			<SettingRow label="System Prompt" htmlFor="creator-prompt">
				<LimitedTextarea
					id="creator-prompt"
					class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring resize-y"
					rows={6}
					limit={FIELD_LIMITS.systemPrompt}
					bind:value={creatorPrompt}
					placeholder="Leave blank for default prompt. The default instructs the LLM to return JSON with minimal field changes."
					onchange={async () => {
						if (!checkAutoSaveLimit('Character Creator system prompt', creatorPrompt, FIELD_LIMITS.systemPrompt)) return;
						await save('characterCreatorPrompt', creatorPrompt);
					}}
				/>
			</SettingRow>
		</div>
	</div>

	<!-- Greeting Reformatter -->
	<div class="border-t border-border pt-6">
		<div class="mb-4">
			<h3 class="text-base font-semibold">Greeting Reformatter</h3>
			<p class="text-sm text-muted-foreground">LLM used to reformat character greetings on demand. Available per-character in the edit modal.</p>
		</div>
		<div class="space-y-4">
			<div class="grid gap-4 @xl:grid-cols-2">
				<SettingRow label="Provider" htmlFor="reformatter-provider">
					<Combobox
						id="reformatter-provider"
						value={s.reformatterProviderId}
						onchange={async (v) => {
							await save('reformatterProviderId', v);
							await save('reformatterModel', '');
						}}
						items={providerItems}
						placeholder="Default (active provider)"
						searchPlaceholder="Filter providers…"
					/>
				</SettingRow>
				<SettingRow label="Model" htmlFor="reformatter-model">
					<Combobox
						id="reformatter-model"
						value={s.reformatterModel}
						onchange={async (v) => { await save('reformatterModel', v); }}
						items={modelsToItems(reformatterModels, reformatterProviderType)}
						loading={loadingReformatterModels}
						placeholder={`Default (${s.reformatterProviderId ? 'provider default' : 'active provider model'})`}
						searchPlaceholder="Filter models…"
						emptyText="No matching models"
					/>
				</SettingRow>
			</div>
			<SettingRow label="System Prompt" htmlFor="reformatter-prompt">
				<LimitedTextarea
					id="reformatter-prompt"
					class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring resize-y"
					rows={6}
					limit={FIELD_LIMITS.systemPrompt}
					bind:value={reformatterPrompt}
					placeholder='Leave blank for default prompt. The default instructs the LLM to reformat narration as plain text, speech in "quotes", and thoughts in *asterisks*.'
					onchange={async () => {
						if (!checkAutoSaveLimit('Greeting Reformatter system prompt', reformatterPrompt, FIELD_LIMITS.systemPrompt)) return;
						await save('reformatterPrompt', reformatterPrompt);
					}}
				/>
			</SettingRow>
		</div>
	</div>

	<!-- Conversation Compaction -->
	<div class="border-t border-border pt-6">
		<div class="mb-4">
			<h3 class="text-base font-semibold">Conversation Compaction</h3>
			<p class="text-sm text-muted-foreground">When a chat starts crowding the context window, summarize the oldest messages into a rolling summary placed right after the system prompt. Subsequent compactions feed the previous summary back in, so context stays continuous.</p>
		</div>
		<div class="space-y-4">
			<ToggleSwitch
				label="Auto-compact long chats"
				description="Automatically run a compaction pass when prompt usage crosses the threshold below. The manual button in the chat menu always works regardless of this setting."
				checked={s.compactionEnabled}
				onchange={async () => { await save('compactionEnabled', !s.compactionEnabled); }}
			/>

			<div class="grid gap-4 @xl:grid-cols-2">
				<SettingRow label="Trigger threshold" htmlFor="compaction-threshold">
					{#snippet action()}<span class="text-sm tabular-nums text-muted-foreground">{s.compactionThreshold}% of context</span>{/snippet}
					<input
						id="compaction-threshold"
						type="range" min="50" max="95" step="5"
						value={s.compactionThreshold}
						onchange={async (e) => { await save('compactionThreshold', Number(e.currentTarget.value)); }}
						class="w-full"
					/>
				</SettingRow>

				<SettingRow label="What to compact" htmlFor="compaction-mode">
					<Combobox
						id="compaction-mode"
						value={s.compactionMode}
						onchange={async (v) => { await save('compactionMode', v); }}
						items={[
							{ value: 'window', label: 'Rolling window of oldest (recommended)' },
							{ value: 'fixed', label: 'Fixed number of oldest' }
						]}
					/>
				</SettingRow>
			</div>

			{#if s.compactionMode === 'window'}
				<SettingRow label="Window size per run" description="Each run folds the oldest messages up to this share of the context window into the highlights." htmlFor="compaction-window">
					{#snippet action()}<span class="text-sm tabular-nums text-muted-foreground">{s.compactionWindowPercent}% of context</span>{/snippet}
					<input
						id="compaction-window"
						type="range" min="10" max="60" step="5"
						value={s.compactionWindowPercent}
						onchange={async (e) => { await save('compactionWindowPercent', Number(e.currentTarget.value)); }}
						class="w-full"
					/>
				</SettingRow>
			{:else}
				<SettingRow label="Messages to compact per run" htmlFor="compaction-fixed">
					<input
						id="compaction-fixed"
						type="number" min="2" max="500"
						value={s.compactionFixedCount}
						onchange={async (e) => {
							const v = Math.max(2, Math.min(500, Number(e.currentTarget.value) || 20));
							await save('compactionFixedCount', v);
						}}
						class="field-input"
					/>
				</SettingRow>
			{/if}

			<div class="grid gap-4 @xl:grid-cols-2">
				<SettingRow label="Provider" htmlFor="compaction-provider">
					<Combobox
						id="compaction-provider"
						value={s.compactionProviderId}
						onchange={async (v) => {
							await save('compactionProviderId', v);
							await save('compactionModel', '');
						}}
						items={providerItems}
						placeholder="Default (chat's active provider)"
						searchPlaceholder="Filter providers…"
					/>
				</SettingRow>
				<SettingRow label="Model" htmlFor="compaction-model">
					<Combobox
						id="compaction-model"
						value={s.compactionModel}
						onchange={async (v) => { await save('compactionModel', v); }}
						items={modelsToItems(compactionModels, compactionProviderType)}
						loading={loadingCompactionModels}
						placeholder={`Default (${s.compactionProviderId ? 'provider default' : 'active provider model'})`}
						searchPlaceholder="Filter models…"
						emptyText="No matching models"
					/>
				</SettingRow>
			</div>

			<SettingRow label="System Prompt" htmlFor="compaction-prompt">
				<LimitedTextarea
					id="compaction-prompt"
					class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring resize-y"
					rows={8}
					limit={FIELD_LIMITS.systemPrompt}
					bind:value={compactionPrompt}
					placeholder="Leave blank for default prompt. The default tells the LLM to summarize setting, important objects, relationships, plot, and emotional state in terse third-person prose."
					onchange={async () => {
						if (!checkAutoSaveLimit('Compaction system prompt', compactionPrompt, FIELD_LIMITS.systemPrompt)) return;
						await save('compactionPrompt', compactionPrompt);
					}}
				/>
			</SettingRow>
		</div>
	</div>

	<!-- Image Generation prompt -->
	<div class="border-t border-border pt-6">
		<div class="mb-4">
			<h3 class="text-base font-semibold">Image Generation</h3>
			<p class="text-sm text-muted-foreground">Prompt template sent to the image model when generating an illustration for an assistant message. Use <code class="rounded bg-muted px-1 py-0.5 text-xs">{'{{message}}'}</code> as the placeholder for the message text. Per-chat overrides are available in chat settings.</p>
		</div>
		<SettingRow label="Prompt Template" htmlFor="image-prompt">
			<LimitedTextarea
				id="image-prompt"
				class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring resize-y"
				rows={6}
				limit={FIELD_LIMITS.prompt}
				bind:value={imagePrompt}
				placeholder="Leave blank to fall back to the built-in default."
				onchange={async () => {
					if (!checkAutoSaveLimit('Image generation prompt', imagePrompt, FIELD_LIMITS.prompt)) return;
					await save('imagePromptTemplate', imagePrompt);
				}}
			/>
		</SettingRow>

		<div class="mt-4 space-y-3">
			<ToggleSwitch
				label="Include character description"
				description="Prepend the character's description to every image prompt so the model knows who's in the scene."
				checked={s.imageIncludeCharacterDesc}
				onchange={async () => { await save('imageIncludeCharacterDesc', !s.imageIncludeCharacterDesc); }}
			/>
			<ToggleSwitch
				label="Include character avatar as reference image"
				description="Send the character's avatar to the provider as a visual reference. Requires a model that accepts image input (e.g. gpt-image-1, gemini-2.5-flash-image). Ignored for ComfyUI."
				checked={s.imageIncludeAvatar}
				onchange={async () => { await save('imageIncludeAvatar', !s.imageIncludeAvatar); }}
			/>
			<ToggleSwitch
				label="Include persona description"
				description="Prepend the active persona's description to every image prompt so the model knows who the user is. Uses the chat's persona override if set, otherwise the default persona."
				checked={s.imageIncludePersonaDesc}
				onchange={async () => { await save('imageIncludePersonaDesc', !s.imageIncludePersonaDesc); }}
			/>
		</div>
	</div>
</div>
