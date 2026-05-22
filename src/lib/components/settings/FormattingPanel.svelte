<script lang="ts">
	// Render mode + roleplay typography (speech / thought / narration / link).
	// Reads/writes settingsStore directly, mirroring ChatPanel — no prop drilling.
	import SettingRow from '$lib/components/settings/SettingRow.svelte';
	import ToggleSwitch from '$lib/components/settings/ToggleSwitch.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte.js';
	import { toasts } from '$lib/stores/toast.svelte.js';
	import { tooltip } from '$lib/tooltip.js';

	const s = $derived(settingsStore.settings);

	async function save(key: string, value: string | boolean | number) {
		const ok = await settingsStore.save(key as any, value);
		if (ok) toasts.success('Setting saved');
	}

	// Each roleplay typography row drives the same bold/italic/opacity trio but
	// against a different settings key. Keep the metadata in one place so the
	// {#each} body stays small.
	const rows = $derived([
		{ key: 'speech', label: 'Speech', sample: '"Hello there"', op: s.speechOpacity, bold: s.speechBold, italic: s.speechItalic, boldKey: 'speechBold', italicKey: 'speechItalic', opKey: 'speechOpacity' },
		{ key: 'thought', label: 'Thoughts', sample: '*A quiet thought*', op: s.thoughtOpacity, bold: s.thoughtBold, italic: s.thoughtItalic, boldKey: 'thoughtBold', italicKey: 'thoughtItalic', opKey: 'thoughtOpacity' },
		{ key: 'narration', label: 'Narration', sample: 'She walked across the room.', op: s.narrationOpacity, bold: s.narrationBold, italic: s.narrationItalic, boldKey: 'narrationBold', italicKey: 'narrationItalic', opKey: 'narrationOpacity' },
		{ key: 'link', label: 'Links', sample: '[a link](https://example.com)', op: s.linkOpacity, bold: s.linkBold, italic: s.linkItalic, boldKey: 'linkBold', italicKey: 'linkItalic', opKey: 'linkOpacity' }
	]);
</script>

<div class="space-y-6">
	<div>
		<h3 class="text-base font-semibold">Formatting</h3>
		<p class="text-sm text-muted-foreground">How model output is rendered and transformed</p>
	</div>

	<SettingRow label="Text rendering">
		<div class="flex gap-2">
			{#each [{ value: 'roleplay', label: 'Roleplay' }, { value: 'markdown', label: 'Markdown' }] as opt}
				<button
					onclick={() => save('renderMode', opt.value)}
					class="flex-1 rounded-lg border px-3 py-1.5 text-sm {s.renderMode === opt.value ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-accent'}"
				>{opt.label}</button>
			{/each}
		</div>
		<p class="text-xs text-muted-foreground">Roleplay: *thoughts*, "speech", and plain narration. Markdown: full formatting with bold, italic, headings, lists, code blocks, etc. The AI will be told which formatting to use.</p>
	</SettingRow>

	<!-- Roleplay typography card. Kept as one bordered block because the
		 preview swatches read better as a tight cluster than as freestanding rows. -->
	<div class="space-y-3 rounded-xl border border-border bg-background/40 p-4">
		<div>
			<span class="block text-sm font-medium">Roleplay formatting</span>
			<p class="text-xs text-muted-foreground">Tune how "speech", *thoughts*, [links], and plain narration appear inside chat bubbles.</p>
		</div>

		{#each rows as row (row.key)}
			<div class="space-y-2 rounded-lg border border-border/60 bg-card px-3 py-3">
				<div class="flex items-center justify-between gap-3">
					<div class="min-w-0 flex-1">
						<span class="block text-sm font-medium">{row.label}</span>
						<span
							class="mt-0.5 block truncate text-xs text-muted-foreground"
							style="opacity: {row.op / 100}; font-weight: {row.bold ? 700 : 400}; font-style: {row.italic ? 'italic' : 'normal'};"
						>{row.sample}</span>
					</div>
					<div class="flex shrink-0 items-center gap-1.5">
						<button
							type="button"
							onclick={() => save(row.boldKey, !row.bold)}
							class="flex h-8 w-8 items-center justify-center rounded-md border text-sm font-bold transition-colors {row.bold ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent'}"
							use:tooltip={'Bold'}
							aria-label="Bold"
							aria-pressed={row.bold}
						>B</button>
						<button
							type="button"
							onclick={() => save(row.italicKey, !row.italic)}
							class="flex h-8 w-8 items-center justify-center rounded-md border text-sm italic transition-colors {row.italic ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent'}"
							use:tooltip={'Italic'}
							aria-label="Italic"
							aria-pressed={row.italic}
						>I</button>
					</div>
				</div>
				<div class="flex items-center gap-3">
					<span class="text-[11px] text-muted-foreground">Opacity</span>
					<input
						type="range"
						min="10"
						max="100"
						step="5"
						value={row.op}
						onchange={(e) => save(row.opKey, Number((e.target as HTMLInputElement).value))}
						class="flex-1 accent-primary"
					/>
					<span class="w-10 text-right text-[11px] tabular-nums text-muted-foreground">{row.op}%</span>
				</div>
			</div>
		{/each}

		<ToggleSwitch
			label="Nested emphasis in speech"
			checked={s.nestedEmphasisInSpeech}
			onchange={(next) => save('nestedEmphasisInSpeech', next)}
		/>
		<!-- The toggle's description prop is plain text, so render the rich-markup
			 hint outside the switch to keep the <em>/<code> styling. -->
		<p class="px-1 text-xs text-muted-foreground">Apply <em>thought</em> styling to <code class="rounded bg-muted px-1">*asterisks*</code> that appear inside <code class="rounded bg-muted px-1">"quotes"</code>.</p>
	</div>
</div>
