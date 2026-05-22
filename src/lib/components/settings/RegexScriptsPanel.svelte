<script lang="ts">
	// Self-contained regex scripts manager. Owns its list state and API
	// calls so it can drop into any tab without prop drilling.
	import { Check, X, Pencil, Trash2 } from 'lucide-svelte';
	import { toasts } from '$lib/stores/toast.svelte.js';
	import { tooltip } from '$lib/tooltip.js';
	import LimitedInput from '$lib/components/LimitedInput.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import IconButton from '$lib/components/ui/IconButton.svelte';
	import { checkFieldLimits } from '$lib/limitCheck.js';
	import { FIELD_LIMITS } from '$lib/fieldLimits.js';

	interface Props {
		// Parent tells us when it became visible so we can lazy-load the list.
		// (We can't just load on mount because the modal mounts the whole
		// thing eagerly even when this tab isn't selected.)
		active: boolean;
	}
	let { active }: Props = $props();

	let scripts = $state<any[]>([]);
	let loading = $state(false);
	let editing = $state<any | null>(null);
	let name = $state('');
	let find = $state('');
	let replace = $state('');
	let userInput = $state(false);
	let aiResponse = $state(true);
	let enabled = $state(true);

	async function load() {
		loading = true;
		try {
			const res = await fetch('/api/regex-scripts');
			if (res.ok) scripts = await res.json();
		} finally {
			loading = false;
		}
	}

	function reset() {
		editing = null;
		name = '';
		find = '';
		replace = '';
		userInput = false;
		aiResponse = true;
		enabled = true;
	}

	function startEdit(s: any) {
		editing = s;
		name = s.name;
		find = s.findRegex;
		replace = s.replaceString;
		userInput = s.affectUserInput;
		aiResponse = s.affectAiResponse;
		enabled = s.enabled;
	}

	async function save() {
		if (!name.trim() || !find.trim()) {
			toasts.error('Name and find pattern are required');
			return;
		}
		const ok = await checkFieldLimits([
			{ label: 'Name', value: name, limit: FIELD_LIMITS.name, trim: (v) => (name = v) },
			{ label: 'Find Regex', value: find, limit: FIELD_LIMITS.regexPattern, trim: (v) => (find = v) },
			{ label: 'Replace With', value: replace, limit: FIELD_LIMITS.regexReplacement, trim: (v) => (replace = v) },
		]);
		if (!ok) return;

		const body = {
			name: name.trim(),
			findRegex: find,
			replaceString: replace,
			affectUserInput: userInput,
			affectAiResponse: aiResponse,
			enabled
		};

		if (editing) {
			const res = await fetch(`/api/regex-scripts/${editing.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (res.ok) {
				toasts.success('Script updated');
				reset();
				await load();
			} else {
				const data = await res.json();
				toasts.error(data.error || 'Failed to update');
			}
		} else {
			const res = await fetch('/api/regex-scripts', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (res.ok) {
				toasts.success('Script created');
				reset();
				await load();
			} else {
				const data = await res.json();
				toasts.error(data.error || 'Failed to create');
			}
		}
	}

	async function remove(id: number) {
		const res = await fetch(`/api/regex-scripts/${id}`, { method: 'DELETE' });
		if (res.ok) {
			toasts.success('Script deleted');
			if (editing?.id === id) reset();
			await load();
		}
	}

	async function toggleEnabled(s: any) {
		await fetch(`/api/regex-scripts/${s.id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ enabled: !s.enabled })
		});
		await load();
	}

	$effect(() => {
		if (active) load();
	});
</script>

<div class="space-y-3">
	<div>
		<h3 class="text-base font-semibold">Regex Scripts</h3>
		<p class="text-sm text-muted-foreground">Find and replace patterns in messages.</p>
	</div>

	<!-- Script Form -->
	<div class="space-y-3 rounded-lg border border-border bg-card/50 p-4">
		<h4 class="text-sm font-medium">{editing ? 'Edit Script' : 'New Script'}</h4>
		<div class="grid gap-3 @xl:grid-cols-2">
			<div>
				<label for="regex-name" class="mb-1 block text-xs font-medium text-muted-foreground">Name</label>
				<LimitedInput id="regex-name" bind:value={name} limit={FIELD_LIMITS.name} placeholder="Script name" class="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring" />
			</div>
			<div class="flex items-end gap-2">
				<label class="flex items-center gap-2 text-sm">
					<input type="checkbox" bind:checked={enabled} class="accent-primary" />
					Enabled
				</label>
			</div>
		</div>
		<div>
			<label for="regex-find" class="mb-1 block text-xs font-medium text-muted-foreground">Find Regex <span class="text-muted-foreground/60">(e.g. /pattern/gi or plain text)</span></label>
			<LimitedInput id="regex-find" bind:value={find} limit={FIELD_LIMITS.regexPattern} placeholder="/pattern/flags or literal text" class="w-full rounded-md border border-input bg-background px-3 py-1.5 font-mono text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring" />
		</div>
		<div>
			<label for="regex-replace" class="mb-1 block text-xs font-medium text-muted-foreground">Replace With <span class="text-muted-foreground/60">($1, $2 for capture groups)</span></label>
			<LimitedInput id="regex-replace" bind:value={replace} limit={FIELD_LIMITS.regexReplacement} placeholder="Replacement text" class="w-full rounded-md border border-input bg-background px-3 py-1.5 font-mono text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring" />
		</div>
		<div class="flex flex-wrap gap-4">
			<label class="flex items-center gap-2 text-sm">
				<input type="checkbox" bind:checked={userInput} class="accent-primary" />
				User Input
			</label>
			<label class="flex items-center gap-2 text-sm">
				<input type="checkbox" bind:checked={aiResponse} class="accent-primary" />
				AI Response
			</label>
		</div>
		<div class="flex gap-2">
			<Button variant="primary" size="sm" onclick={save}>{editing ? 'Update' : 'Add Script'}</Button>
			{#if editing}
				<Button size="sm" onclick={reset}>Cancel</Button>
			{/if}
		</div>
	</div>

	<!-- Script List -->
	{#if loading}
		<p class="text-sm text-muted-foreground">Loading...</p>
	{:else if scripts.length === 0}
		<p class="text-sm text-muted-foreground">No regex scripts yet. Create one above.</p>
	{:else}
		<div class="space-y-2">
			{#each scripts as s (s.id)}
				<div class="flex items-center gap-3 rounded-lg border border-border p-3 {s.enabled ? '' : 'opacity-50'}">
					<button onclick={() => toggleEnabled(s)} class="shrink-0" use:tooltip={s.enabled ? 'Disable' : 'Enable'}>
						{#if s.enabled}
							<Check class="h-4 w-4 text-success" />
						{:else}
							<X class="h-4 w-4 text-muted-foreground" />
						{/if}
					</button>
					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-2">
							<span class="text-sm font-medium {s.enabled ? '' : 'line-through'}">{s.name}</span>
							<span class="text-xs text-muted-foreground">
								{[s.affectUserInput && 'Input', s.affectAiResponse && 'Output'].filter(Boolean).join(', ')}
							</span>
						</div>
						<p class="truncate font-mono text-xs text-muted-foreground">{s.findRegex} → {s.replaceString || '(empty)'}</p>
					</div>
					<IconButton icon={Pencil} ariaLabel="Edit" title="Edit" size="sm" onclick={() => startEdit(s)} />
					<IconButton icon={Trash2} ariaLabel="Delete" title="Delete" size="sm" variant="destructive" onclick={() => remove(s.id)} />
				</div>
			{/each}
		</div>
	{/if}
</div>
