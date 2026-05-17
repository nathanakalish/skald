<script lang="ts">
	import { tooltip } from '$lib/tooltip.js';
	import { Sparkles, Send, X, Loader2, Save, Undo2, StopCircle, MessageSquarePlus, Check } from 'lucide-svelte';
	import { onMount, tick, untrack } from 'svelte';
	import { toasts } from '$lib/stores/toast.svelte.js';
	import { charactersStore } from '$lib/stores/characters.svelte.js';

	interface Props {
		open: boolean;
		seed?: { name?: string; description?: string };
		// When provided, the creator runs in EDIT MODE: it pre-loads from the
		// existing character and persists every AI change immediately. The
		// "Create" button becomes "Done" and just closes the view.
		editingCharacter?: any | null;
		onclose: () => void;
		oncreated: (id: number) => void;
	}

	let { open, seed, editingCharacter = null, onclose, oncreated }: Props = $props();

	type FieldKey = 'name' | 'description' | 'personality' | 'scenario' | 'firstMessage' | 'systemPrompt' | 'tags';
	const FIELD_KEYS: FieldKey[] = ['name', 'description', 'personality', 'scenario', 'firstMessage', 'systemPrompt', 'tags'];

	const isEditing = $derived(!!editingCharacter);
	const draftKey = $derived(isEditing ? `skald-ai-edit-draft-${editingCharacter?.id ?? '0'}` : 'skald-ai-create-draft');

	// Field state
	let fields = $state<Record<FieldKey, string>>({
		name: '',
		description: '',
		personality: '',
		scenario: '',
		firstMessage: '',
		systemPrompt: '',
		tags: ''
	});
	let pendingFields = $state<Set<FieldKey>>(new Set());

	// Chat state
	type Turn =
		| { id: number; role: 'user'; content: string }
		| { id: number; role: 'assistant'; content: string; changes?: Partial<Record<FieldKey, string>>; prevValues?: Partial<Record<FieldKey, string>>; undone?: boolean }
		| { id: number; role: 'system'; content: string; error?: boolean };
	let turns = $state<Turn[]>([]);
	let nextTurnId = 0;
	let input = $state('');
	let isSending = $state(false);
	let abortCtrl: AbortController | null = null;
	let creating = $state(false);
	// Tracks the last successful auto-save in edit mode.
	let editAutoSaving = $state(false);
	let editAutoSaveOk = $state<null | 'ok' | 'err'>(null);

	// Mobile chat panel toggle
	let mobileChatOpen = $state(true);

	// Confirm-on-cancel — only meaningful for create mode (edit auto-saves).
	let hasInteracted = $derived(turns.length > 0 || Object.values(fields).some(v => v.trim().length > 0));
	let showCancelConfirm = $state(false);

	let chatScrollEl: HTMLDivElement | null = $state(null);

	let didKickoff = false;
	let didRestore = $state(false);

	function tagsToString(raw: string | undefined | null): string {
		const s = raw ?? '';
		if (s.startsWith('[')) {
			try { return (JSON.parse(s) as string[]).join(', '); } catch { return s; }
		}
		return s;
	}

	function loadFromCharacter(c: any) {
		fields.name = c?.name ?? '';
		fields.description = c?.description ?? '';
		fields.personality = c?.personality ?? '';
		fields.scenario = c?.scenario ?? '';
		fields.firstMessage = c?.firstMessage ?? '';
		fields.systemPrompt = c?.systemPrompt ?? '';
		fields.tags = tagsToString(c?.tags);
	}

	function persistDraft() {
		if (typeof window === 'undefined') return;
		try {
			const payload = {
				v: 1,
				fields,
				turns,
				nextTurnId,
				editingId: editingCharacter?.id ?? null,
				ts: Date.now()
			};
			localStorage.setItem(draftKey, JSON.stringify(payload));
		} catch { /* quota — ignore */ }
	}

	function clearDraft() {
		if (typeof window === 'undefined') return;
		try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
	}

	function tryRestoreDraft(): boolean {
		if (typeof window === 'undefined') return false;
		try {
			const raw = localStorage.getItem(draftKey);
			if (!raw) return false;
			const parsed = JSON.parse(raw);
			if (!parsed || parsed.v !== 1) return false;
			// Discard stale drafts older than 7 days.
			if (typeof parsed.ts === 'number' && Date.now() - parsed.ts > 7 * 24 * 60 * 60 * 1000) {
				clearDraft();
				return false;
			}
			if (parsed.fields) {
				for (const k of FIELD_KEYS) {
					if (typeof parsed.fields[k] === 'string') fields[k] = parsed.fields[k];
				}
			}
			if (Array.isArray(parsed.turns)) {
				turns = parsed.turns;
				nextTurnId = typeof parsed.nextTurnId === 'number' ? parsed.nextTurnId : turns.length;
			}
			return true;
		} catch {
			return false;
		}
	}

	onMount(() => {
		untrack(() => {
			if (isEditing && editingCharacter) {
				// Edit mode: preload from the live character first, then attempt
				// to overlay any in-progress draft (e.g. user closed mid-edit).
				loadFromCharacter(editingCharacter);
			}
			didRestore = tryRestoreDraft();

			if (!didKickoff && !didRestore && !isEditing && (seed?.name?.trim() || seed?.description?.trim())) {
				if (seed?.name) fields.name = seed.name;
				if (seed?.description) fields.description = seed.description;
				didKickoff = true;
				const parts: string[] = [];
				if (seed?.name?.trim()) parts.push(`name "${seed.name.trim()}"`);
				if (seed?.description?.trim()) parts.push(`description "${seed.description.trim()}"`);
				const seedDesc = parts.join(' and ');
				void sendMessage(`Generate a complete character based on the starting ${seedDesc}. Fill in all fields (name, description, personality, scenario, firstMessage, systemPrompt, tags) with thoughtful, coherent values.`, { auto: true });
			}
		});
	});

	// Persist a draft on every observable change so closing the panel/window
	// loses no more than the current keystroke.
	$effect(() => {
		// Touch reactive deps so the effect re-runs.
		void fields.name; void fields.description; void fields.personality;
		void fields.scenario; void fields.firstMessage; void fields.systemPrompt; void fields.tags;
		void turns;
		// Skip the initial run before mount finishes the load.
		if (!open) return;
		persistDraft();
	});

	async function scrollChatToBottom() {
		await tick();
		if (chatScrollEl) chatScrollEl.scrollTop = chatScrollEl.scrollHeight;
	}

	async function persistEditChanges(changedKeys: FieldKey[]) {
		if (!isEditing || !editingCharacter || changedKeys.length === 0) return;
		editAutoSaving = true;
		editAutoSaveOk = null;
		try {
			const payload: any = {
				name: fields.name,
				description: fields.description,
				personality: fields.personality,
				firstMessage: fields.firstMessage,
				scenario: fields.scenario,
				systemPrompt: fields.systemPrompt,
				tags: fields.tags,
				// Pass through fields the editor doesn't expose so they aren't wiped.
				creatorNotes: editingCharacter.creatorNotes ?? '',
				mesExample: editingCharacter.mesExample ?? '',
				postHistoryInstructions: editingCharacter.postHistoryInstructions ?? '',
				alternateGreetings: editingCharacter.alternateGreetings ?? '[]',
				creator: editingCharacter.creator ?? '',
				characterVersion: editingCharacter.characterVersion ?? '',
				extensions: editingCharacter.extensions ?? '{}',
				theme: editingCharacter.theme ?? '{}'
			};
			const res = await fetch(`/api/characters/${editingCharacter.id}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});
			if (!res.ok) {
				editAutoSaveOk = 'err';
				toasts.error('Auto-save failed');
				return;
			}
			const body = await res.json();
			if (body?.light) charactersStore.upsert(body.light);
			else if (body?.id) charactersStore.update(body.id, body);
			// Mirror new values back onto the bound character so subsequent saves stay in sync.
			if (editingCharacter) Object.assign(editingCharacter, body);
			editAutoSaveOk = 'ok';
		} catch (err) {
			editAutoSaveOk = 'err';
			toasts.error(err instanceof Error ? err.message : 'Auto-save failed');
		} finally {
			editAutoSaving = false;
			setTimeout(() => { if (editAutoSaveOk === 'ok') editAutoSaveOk = null; }, 1500);
		}
	}

	async function sendMessage(text: string, opts: { auto?: boolean } = {}) {
		const trimmed = text.trim();
		if (!trimmed || isSending) return;

		const history = turns
			.filter(t => (t.role === 'user' || (t.role === 'assistant' && !t.undone)))
			.slice(-10)
			.map(t => {
				if (t.role === 'assistant') {
					return {
						role: 'assistant' as const,
						content: JSON.stringify({ message: t.content, changes: t.changes ?? {} })
					};
				}
				return { role: 'user' as const, content: t.content };
			});

		const userTurn: Turn = { id: nextTurnId++, role: 'user', content: trimmed };
		turns = [...turns, userTurn];
		if (!opts.auto) input = '';
		isSending = true;
		void scrollChatToBottom();

		abortCtrl = new AbortController();
		try {
			const res = await fetch('/api/characters/ai-create', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					currentFields: { ...fields },
					history,
					userMessage: trimmed
				}),
				signal: abortCtrl.signal
			});

			if (!res.ok) {
				let errMsg = 'Request failed';
				try { errMsg = (await res.json()).error || errMsg; } catch { /* ignore */ }
				turns = [...turns, { id: nextTurnId++, role: 'system', content: errMsg, error: true }];
				return;
			}

			const data = await res.json();
			const message: string = data.message || 'Done.';
			const changes = (data.changes ?? {}) as Partial<Record<FieldKey, string>>;
			const changedKeys = (Object.keys(changes) as FieldKey[]).filter(k => FIELD_KEYS.includes(k));

			const prevValues: Partial<Record<FieldKey, string>> = {};
			for (const k of changedKeys) prevValues[k] = fields[k];

			if (changedKeys.length > 0) {
				const next = new Set(pendingFields);
				for (const k of changedKeys) next.add(k);
				pendingFields = next;
				for (const k of changedKeys) fields[k] = changes[k] ?? '';
				setTimeout(() => {
					const cur = new Set(pendingFields);
					for (const k of changedKeys) cur.delete(k);
					pendingFields = cur;
				}, 500);
			}

			turns = [...turns, {
				id: nextTurnId++,
				role: 'assistant',
				content: message,
				changes: changedKeys.length > 0 ? Object.fromEntries(changedKeys.map(k => [k, changes[k] ?? ''])) as Partial<Record<FieldKey, string>> : undefined,
				prevValues: changedKeys.length > 0 ? prevValues : undefined
			}];

			// Edit mode: persist immediately so external edits never get lost.
			if (isEditing && changedKeys.length > 0) {
				await persistEditChanges(changedKeys);
			}
		} catch (err: any) {
			if (err?.name === 'AbortError') {
				turns = [...turns, { id: nextTurnId++, role: 'system', content: 'Stopped.' }];
			} else {
				const msg = err instanceof Error ? err.message : 'Network error';
				turns = [...turns, { id: nextTurnId++, role: 'system', content: msg, error: true }];
			}
		} finally {
			isSending = false;
			abortCtrl = null;
			void scrollChatToBottom();
		}
	}

	function stop() {
		abortCtrl?.abort();
	}

	async function undoTurn(turnId: number) {
		const idx = turns.findIndex(t => t.id === turnId);
		if (idx === -1) return;
		const t = turns[idx];
		if (t.role !== 'assistant' || !t.prevValues || t.undone) return;

		const reverted = new Set(pendingFields);
		const keys = Object.keys(t.prevValues) as FieldKey[];
		for (const k of keys) {
			fields[k] = t.prevValues[k] ?? '';
			reverted.add(k);
		}
		pendingFields = reverted;
		setTimeout(() => {
			const cur = new Set(pendingFields);
			for (const k of keys) cur.delete(k);
			pendingFields = cur;
		}, 400);

		turns = turns.map(x => x.id === turnId && x.role === 'assistant' ? { ...x, undone: true } : x);

		if (isEditing && keys.length > 0) {
			await persistEditChanges(keys);
		}
	}

	async function createCharacter() {
		if (isEditing) {
			// In edit mode the changes have already been auto-saved. Just close.
			clearDraft();
			onclose();
			return;
		}
		if (!fields.name.trim() || creating) return;
		creating = true;
		try {
			const res = await fetch('/api/characters', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: fields.name,
					description: fields.description,
					personality: fields.personality,
					firstMessage: fields.firstMessage,
					scenario: fields.scenario,
					systemPrompt: fields.systemPrompt,
					tags: fields.tags
				})
			});
			if (!res.ok) {
				let msg = 'Failed to create character';
				try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
				toasts.error(msg);
				return;
			}
			const created = await res.json();
			if (created?.light) charactersStore.add(created.light);
			else if (created?.id) charactersStore.add(created);
			const id = created?.id ?? created?.light?.id;
			if (id) {
				clearDraft();
				oncreated(id);
			}
		} catch (err) {
			toasts.error(err instanceof Error ? err.message : 'Network error');
		} finally {
			creating = false;
		}
	}

	function tryClose() {
		if (isSending) {
			abortCtrl?.abort();
		}
		// Edit mode: changes are persisted as they happen, so just close.
		// Create mode: keep the draft for next time. No "discard" prompt — the
		// draft is the safety net.
		if (!isEditing && hasInteracted && turns.length > 0) {
			showCancelConfirm = true;
		} else {
			onclose();
		}
	}

	function discardAndClose() {
		clearDraft();
		showCancelConfirm = false;
		onclose();
	}

	function keepDraftAndClose() {
		showCancelConfirm = false;
		onclose();
	}

	function onInputKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			void sendMessage(input);
		}
	}

	const fieldLabels: Record<FieldKey, string> = {
		name: 'Name',
		description: 'Description',
		personality: 'Personality',
		scenario: 'Scenario',
		firstMessage: 'First Message',
		systemPrompt: 'System Prompt',
		tags: 'Tags'
	};

	const inputClass = 'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';
	const textareaClass = 'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y';
	const labelClass = 'mb-1.5 block text-sm font-medium text-foreground';
</script>

{#if open}
<div class="flex h-full flex-col md:rounded-2xl md:bg-background">
	<!-- Header -->
	<div class="flex items-center justify-between border-b border-border px-4 py-3">
		<div class="flex items-center gap-3 min-w-0">
			<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
				<Sparkles class="h-5 w-5" />
			</div>
			<div class="min-w-0">
				<h2 class="truncate text-lg font-semibold">{isEditing ? 'AI Edit Character' : 'AI Character Creator'}</h2>
				<p class="truncate text-xs text-muted-foreground">
					{#if isEditing}
						{#if editAutoSaving}Saving…{:else if editAutoSaveOk === 'ok'}Saved.{:else if editAutoSaveOk === 'err'}Save failed.{:else}Changes auto-save as the AI applies them.{/if}
					{:else}
						{didRestore ? 'Restored your in-progress draft.' : 'Describe what you want and the AI will fill in the fields.'}
					{/if}
				</p>
			</div>
		</div>
		<div class="flex items-center gap-1">
			<button
				onclick={() => { mobileChatOpen = !mobileChatOpen; }}
				class="md:hidden flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
				use:tooltip={mobileChatOpen ? 'Hide chat' : 'Show chat'}
				aria-label="Toggle chat"
			>
				<MessageSquarePlus class="h-4 w-4" />
			</button>
			<button
				onclick={createCharacter}
				disabled={!fields.name.trim() || creating}
				class="flex h-8 items-center gap-1.5 rounded-lg bg-primary px-2 sm:px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
			>
				{#if isEditing}
					<Check class="h-3.5 w-3.5" />
					<span class="hidden sm:inline">Done</span>
				{:else}
					<Save class="h-3.5 w-3.5" />
					<span class="hidden sm:inline">{creating ? 'Creating…' : 'Create'}</span>
				{/if}
			</button>
			<button
				onclick={tryClose}
				class="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
				aria-label="Close"
			>
				<X class="h-4 w-4" />
			</button>
		</div>
	</div>

	<!-- Body: side-by-side desktop, stacked mobile -->
	<div class="relative flex flex-1 min-h-0 flex-col md:flex-row">
		<!-- Fields pane -->
		<div class="flex-1 min-h-0 overflow-y-auto p-4 md:p-6 md:border-r md:border-border {mobileChatOpen ? 'pb-[60vh] md:pb-6' : 'pb-4 md:pb-6'}">
			<div class="space-y-5 max-w-2xl mx-auto">
				<!-- Name -->
				<div>
					<label for="ai-name" class={labelClass}>Name <span class="text-destructive">*</span></label>
					<div class="creator-field-wrap" data-pending={pendingFields.has('name') ? '' : undefined}>
						<input id="ai-name" bind:value={fields.name} disabled={pendingFields.has('name') || isSending} class={inputClass} placeholder="Character name" />
						{#if pendingFields.has('name')}
							<div class="creator-field-overlay"><Loader2 class="spinner-centered h-6 w-6 animate-spin text-foreground" strokeWidth={2.5} /></div>
						{/if}
					</div>
				</div>

				<!-- Description -->
				<div>
					<label for="ai-desc" class={labelClass}>Description</label>
					<div class="creator-field-wrap" data-pending={pendingFields.has('description') ? '' : undefined}>
						<textarea id="ai-desc" bind:value={fields.description} disabled={pendingFields.has('description') || isSending} rows={6} class={textareaClass} placeholder="Character description, background, appearance…"></textarea>
						{#if pendingFields.has('description')}
							<div class="creator-field-overlay"><Loader2 class="spinner-centered h-6 w-6 animate-spin text-foreground" strokeWidth={2.5} /></div>
						{/if}
					</div>
				</div>

				<!-- Personality -->
				<div>
					<label for="ai-personality" class={labelClass}>Personality</label>
					<div class="creator-field-wrap" data-pending={pendingFields.has('personality') ? '' : undefined}>
						<textarea id="ai-personality" bind:value={fields.personality} disabled={pendingFields.has('personality') || isSending} rows={3} class={textareaClass} placeholder="Personality traits, behavior patterns…"></textarea>
						{#if pendingFields.has('personality')}
							<div class="creator-field-overlay"><Loader2 class="spinner-centered h-6 w-6 animate-spin text-foreground" strokeWidth={2.5} /></div>
						{/if}
					</div>
				</div>

				<!-- Scenario -->
				<div>
					<label for="ai-scenario" class={labelClass}>Scenario</label>
					<div class="creator-field-wrap" data-pending={pendingFields.has('scenario') ? '' : undefined}>
						<textarea id="ai-scenario" bind:value={fields.scenario} disabled={pendingFields.has('scenario') || isSending} rows={3} class={textareaClass} placeholder="The setting, situation, or context…"></textarea>
						{#if pendingFields.has('scenario')}
							<div class="creator-field-overlay"><Loader2 class="spinner-centered h-6 w-6 animate-spin text-foreground" strokeWidth={2.5} /></div>
						{/if}
					</div>
				</div>

				<!-- First Message -->
				<div>
					<label for="ai-first" class={labelClass}>First Message</label>
					<div class="creator-field-wrap" data-pending={pendingFields.has('firstMessage') ? '' : undefined}>
						<textarea id="ai-first" bind:value={fields.firstMessage} disabled={pendingFields.has('firstMessage') || isSending} rows={6} class={textareaClass} placeholder="The opening message when a new chat starts…"></textarea>
						{#if pendingFields.has('firstMessage')}
							<div class="creator-field-overlay"><Loader2 class="spinner-centered h-6 w-6 animate-spin text-foreground" strokeWidth={2.5} /></div>
						{/if}
					</div>
				</div>

				<!-- System Prompt -->
				<div>
					<label for="ai-system" class={labelClass}>System Prompt</label>
					<div class="creator-field-wrap" data-pending={pendingFields.has('systemPrompt') ? '' : undefined}>
						<textarea id="ai-system" bind:value={fields.systemPrompt} disabled={pendingFields.has('systemPrompt') || isSending} rows={4} class={textareaClass} placeholder="Optional system prompt for chats with this character…"></textarea>
						{#if pendingFields.has('systemPrompt')}
							<div class="creator-field-overlay"><Loader2 class="spinner-centered h-6 w-6 animate-spin text-foreground" strokeWidth={2.5} /></div>
						{/if}
					</div>
				</div>

				<!-- Tags -->
				<div>
					<label for="ai-tags" class={labelClass}>Tags</label>
					<div class="creator-field-wrap" data-pending={pendingFields.has('tags') ? '' : undefined}>
						<input id="ai-tags" bind:value={fields.tags} disabled={pendingFields.has('tags') || isSending} class={inputClass} placeholder="fantasy, sci-fi, romance (comma-separated)" />
						{#if pendingFields.has('tags')}
							<div class="creator-field-overlay"><Loader2 class="spinner-centered h-6 w-6 animate-spin text-foreground" strokeWidth={2.5} /></div>
						{/if}
					</div>
				</div>
			</div>
		</div>

		<!-- Chat pane: side-by-side on desktop, sliding bottom sheet on mobile -->
		<div
			class="flex flex-col bg-background md:w-[380px] md:shrink-0 md:relative
				absolute inset-x-0 bottom-0 z-10 max-h-[55vh] border-t border-border md:max-h-none md:border-t-0
				transition-transform duration-200 md:transition-none
				{mobileChatOpen ? 'translate-y-0' : 'translate-y-full md:translate-y-0'}"
		>
			<div class="flex items-center justify-between border-b border-border px-4 py-2">
				<div class="flex items-center gap-2 text-sm font-medium">
					<Sparkles class="h-4 w-4 text-primary" />
					<span>Assistant</span>
				</div>
			</div>

			<div bind:this={chatScrollEl} class="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3">
				{#if turns.length === 0}
					<div class="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
						<Sparkles class="mb-2 h-7 w-7 opacity-30" />
						<p class="text-sm">{isEditing ? 'Tell me what you want to change.' : 'Tell me about the character you want to create.'}</p>
						<p class="mt-1 text-xs">{isEditing ? 'Try: "Make them more sarcastic"' : 'Try: "A cynical detective in 1920s Chicago"'}</p>
					</div>
				{/if}
				{#each turns as turn (turn.id)}
					{#if turn.role === 'user'}
						<div class="flex justify-end">
							<div class="rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground max-w-[85%] whitespace-pre-wrap break-words">{turn.content}</div>
						</div>
					{:else if turn.role === 'assistant'}
						<div class="flex flex-col items-start gap-1.5">
							<div class="rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-sm text-foreground max-w-[85%] whitespace-pre-wrap break-words {turn.undone ? 'opacity-50' : ''}">{turn.content}</div>
							{#if turn.changes && Object.keys(turn.changes).length > 0}
								<div class="flex flex-wrap items-center gap-1.5 pl-1">
									{#each Object.keys(turn.changes) as k}
										<span class="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">{fieldLabels[k as FieldKey] ?? k}</span>
									{/each}
									{#if !turn.undone}
										<button
											onclick={() => undoTurn(turn.id)}
											class="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
											use:tooltip={'Undo this change'}
										>
											<Undo2 class="h-3 w-3" />
											Undo
										</button>
									{:else}
										<span class="text-[10px] text-muted-foreground">Undone</span>
									{/if}
								</div>
							{/if}
						</div>
					{:else}
						<div class="flex justify-center">
							<div class="rounded-lg px-3 py-1.5 text-xs {turn.error ? 'bg-destructive/15 text-destructive' : 'bg-muted text-muted-foreground'}">{turn.content}</div>
						</div>
					{/if}
				{/each}
				{#if isSending}
					<div class="flex justify-start">
						<div class="flex items-center gap-1.5 rounded-2xl rounded-bl-sm bg-muted px-3 py-2.5">
							<span class="typing-dot h-2 w-2 rounded-full bg-muted-foreground/60" style="animation-delay: 0ms"></span>
							<span class="typing-dot h-2 w-2 rounded-full bg-muted-foreground/60" style="animation-delay: 160ms"></span>
							<span class="typing-dot h-2 w-2 rounded-full bg-muted-foreground/60" style="animation-delay: 320ms"></span>
						</div>
					</div>
				{/if}
			</div>

			<div class="border-t border-border p-2">
				<div class="flex items-end gap-2">
					<textarea
						bind:value={input}
						onkeydown={onInputKeydown}
						rows={1}
						disabled={isSending}
						placeholder={isSending ? 'AI is working…' : 'Ask the AI to change something…'}
						class="flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
						style="max-height: 120px;"
					></textarea>
					{#if isSending}
						<button
							onclick={stop}
							class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-destructive/15 text-destructive hover:bg-destructive/25 transition-colors"
							aria-label="Stop"
							use:tooltip={'Stop'}
						>
							<StopCircle class="h-4 w-4" />
						</button>
					{:else}
						<button
							onclick={() => sendMessage(input)}
							disabled={!input.trim()}
							class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
							aria-label="Send"
							use:tooltip={'Send'}
						>
							<Send class="h-4 w-4" />
						</button>
					{/if}
				</div>
			</div>
		</div>
	</div>
</div>

{#if showCancelConfirm}
	<div class="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4">
		<div class="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-xl">
			<h3 class="text-base font-semibold">Discard draft?</h3>
			<p class="mt-2 text-sm text-muted-foreground">Your in-progress character is auto-saved. You can keep it for later, or discard it now.</p>
			<div class="mt-4 flex justify-end gap-2">
				<button onclick={keepDraftAndClose} class="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent">Keep draft</button>
				<button onclick={discardAndClose} class="rounded-lg bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90">Discard</button>
			</div>
		</div>
	</div>
{/if}

{/if}

<style>
	.creator-field-wrap {
		position: relative;
	}
	.creator-field-wrap[data-pending] > :global(input),
	.creator-field-wrap[data-pending] > :global(textarea) {
		filter: blur(3px);
		opacity: 0.55;
		transition: filter 0.2s ease, opacity 0.2s ease;
	}
	.creator-field-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		pointer-events: none;
		border-radius: 0.5rem;
		background: rgba(0, 0, 0, 0.05);
		backdrop-filter: blur(1px);
	}

	.typing-dot {
		animation: typing-bounce 1.4s ease-in-out infinite;
	}
	@keyframes typing-bounce {
		0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
		30% { transform: translateY(-4px); opacity: 1; }
	}
</style>
