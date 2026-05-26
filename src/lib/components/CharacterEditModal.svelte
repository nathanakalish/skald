<script lang="ts">
	import { tooltip } from '$lib/tooltip.js';
	import { X, Save, Plus, Trash2, RotateCcw, Wand2, User, MessageSquare, ScrollText, Tag, Palette, Download, Smartphone, Pencil, ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-svelte';
	import { marked } from 'marked';
	import { sanitizeRichHtml, renderMarkdown } from '$lib/markdown.js';
	import { untrack } from 'svelte';
	import { createModalState, createModalGestures } from '$lib/modal.svelte.js';
	import { focusTrap } from '$lib/focusTrap.js';
	import { page } from '$app/stores';
	import { charactersStore } from '$lib/stores/characters.svelte.js';
	import { api } from '$lib/api.js';
	import GreetingReviewModal from '$lib/components/GreetingReviewModal.svelte';
	import ConfirmModal from '$lib/components/ConfirmModal.svelte';
	import ImageModal from '$lib/components/ImageModal.svelte';
	import { parseCharacterTheme } from '$lib/theme/characterTheme.js';
	import { toasts } from '$lib/stores/toast.svelte.js';
	import { confirm as confirmDialog } from '$lib/dialog.svelte.js';
	import { checkFieldLimits } from '$lib/limitCheck.js';
	import { FIELD_LIMITS } from '$lib/fieldLimits.js';
	import LimitedInput from '$lib/components/LimitedInput.svelte';
	import LimitedTextarea from '$lib/components/LimitedTextarea.svelte';
	import SettingRow from '$lib/components/settings/SettingRow.svelte';

	interface Props {
		open: boolean;
		embedded?: boolean;
		initialEditing?: boolean;
		character: any;
		userName?: string;
		hasLorebook?: boolean;
		onclose: () => void;
		ondelete?: (keepLorebook?: boolean) => void;
		onstartchat?: (characterId: number, mode: 'story' | 'texting') => void;
		onaiedit?: (characterId: number) => void;
	}

	let { open, embedded = false, initialEditing = false, character, userName = 'User', hasLorebook = false, onclose, ondelete, onstartchat, onaiedit }: Props = $props();

	let activeTab = $state<'basic' | 'messages' | 'prompts' | 'meta' | 'theme'>('basic');
	let saving = $state(false);
	let enlargedAvatar = $state<string | null>(null);
	let editing = $state(false);
	let avatarFileInput: HTMLInputElement | undefined = $state();
	let uploadingAvatar = $state(false);
	$effect(() => { editing = initialEditing; });
	let showDeleteConfirm = $state(false);
	let menuOpen = $state(false);

	// Post-save propagation prompt: when the saved character is in use by
	// existing chats, ask the user whether they want those chats refreshed
	// (title rename + sidebar bump). Greetings are deliberately preserved.
	let showPropagateConfirm = $state(false);
	let propagateChatCount = $state(0);
	let propagatePreviousName = $state<string | null>(null);
	let propagatingChats = $state(false);

	$effect(() => {
		if (!menuOpen) return;
		const onClick = (e: MouseEvent) => {
			if (!(e.target as HTMLElement).closest('[data-char-header-menu]')) menuOpen = false;
		};
		const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') menuOpen = false; };
		setTimeout(() => document.addEventListener('click', onClick), 0);
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('click', onClick);
			document.removeEventListener('keydown', onKey);
		};
	});

	function cancelEdit() {
		// Reset state to current character snapshot
		if (character) {
			name = character.name ?? '';
			description = character.description ?? '';
			personality = character.personality ?? '';
			firstMessage = character.firstMessage ?? '';
			scenario = character.scenario ?? '';
			systemPrompt = character.systemPrompt ?? '';
			creatorNotes = character.creatorNotes ?? '';
			const rawTags = character.tags ?? '';
			if (rawTags.startsWith('[')) {
				try { tags = (JSON.parse(rawTags) as string[]).join(', '); } catch { tags = rawTags; }
			} else {
				tags = rawTags;
			}
			mesExample = character.mesExample ?? '';
			postHistoryInstructions = character.postHistoryInstructions ?? '';
			creator = character.creator ?? '';
			characterVersion = character.characterVersion ?? '';
			try {
				alternateGreetings = JSON.parse(character.alternateGreetings || '[]');
			} catch {
				alternateGreetings = [];
			}
			const parsedTheme = parseCharacterTheme(character.theme);
			themeColorsDark = { ...parsedTheme.dark };
			themeColorsLight = { ...parsedTheme.light };
		}
		editing = false;
	}

	// Form state — reset when character changes
	let name = $state('');
	let description = $state('');
	let personality = $state('');
	let firstMessage = $state('');
	let scenario = $state('');
	let systemPrompt = $state('');
	let creatorNotes = $state('');
	let tags = $state('');
	let mesExample = $state('');
	let postHistoryInstructions = $state('');
	let creator = $state('');
	let characterVersion = $state('');
	let alternateGreetings: string[] = $state([]);
	let viewGreetingIndex = $state(0);

	// Theme color overrides (sparse — only set colors are saved)
	const themeColorKeys = [
		{ key: 'background', label: 'Background' },
		{ key: 'foreground', label: 'Text' },
		{ key: 'card', label: 'Card' },
		{ key: 'card-foreground', label: 'Card text' },
		{ key: 'primary', label: 'Primary' },
		{ key: 'primary-foreground', label: 'Primary text' },
		{ key: 'secondary', label: 'Secondary' },
		{ key: 'muted', label: 'Muted' },
		{ key: 'muted-foreground', label: 'Muted text' },
		{ key: 'accent', label: 'Accent' },
		{ key: 'border', label: 'Border' },
		{ key: 'speech', label: 'Dialogue' },
	];
	let themeColorsDark: Record<string, string> = $state({});
	let themeColorsLight: Record<string, string> = $state({});
	let editingThemeMode = $state<'dark' | 'light'>('dark');
	const themeColors = $derived(editingThemeMode === 'dark' ? themeColorsDark : themeColorsLight);
	function setThemeColor(key: string, value: string) {
		if (editingThemeMode === 'dark') themeColorsDark = { ...themeColorsDark, [key]: value };
		else themeColorsLight = { ...themeColorsLight, [key]: value };
	}

	// Creator notes rendering
	let notesAreHtml = $derived(!!creatorNotes.trim() && /<[a-z][\s\S]*>/i.test(creatorNotes));

	let allowExternal = $derived($page.data.allowExternalCreatorNotes ?? false);

	let notesSrcdoc = $derived.by(() => {
		if (!notesAreHtml || !creatorNotes) return '';
		const cleaned = sanitizeRichHtml(creatorNotes);
		const csp = allowExternal
			? ''
			: `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob: /api/">`;
		return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${csp}<style>body{margin:0;padding:16px;background:transparent;color:#e0e0e0;font-family:system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.6;overflow-x:hidden}img{max-width:100%;height:auto;border-radius:8px}a{color:#8ab4f8;text-decoration:none}a:hover{text-decoration:underline}</style></head><body>${cleaned}</body></html>`;
	});

	let notesRenderedMarkdown = $derived.by(() => {
		if (!creatorNotes.trim() || notesAreHtml) return '';
		return renderMarkdown(creatorNotes);
	});

	// Variable replacement for formatted view
	function replaceVars(text: string): string {
		return text.replace(/\{\{char\}\}/gi, name).replace(/\{\{user\}\}/gi, userName);
	}

	function renderField(text: string): string {
		if (!text.trim()) return '';
		return renderMarkdown(replaceVars(text));
	}

	let parsedTags = $derived.by(() => {
		const raw = tags.trim();
		if (!raw) return [];
		if (raw.startsWith('[')) {
			try { return (JSON.parse(raw) as string[]).map(t => t.trim()).filter(Boolean); } catch {}
		}
		return raw.split(',').map(t => t.trim()).filter(Boolean);
	});

	// Track which character is loaded to reset form when switching
	let loadedId: number | null = $state(null);

	$effect(() => {
		if (character && character.id !== loadedId) {
			untrack(() => {
				loadedId = character.id;
				editing = initialEditing;
				name = character.name ?? '';
				description = character.description ?? '';
				personality = character.personality ?? '';
				firstMessage = character.firstMessage ?? '';
				scenario = character.scenario ?? '';
				systemPrompt = character.systemPrompt ?? '';
				creatorNotes = character.creatorNotes ?? '';
				const rawTags = character.tags ?? '';
				if (rawTags.startsWith('[')) {
					try { tags = (JSON.parse(rawTags) as string[]).join(', '); } catch { tags = rawTags; }
				} else {
					tags = rawTags;
				}
				mesExample = character.mesExample ?? '';
				postHistoryInstructions = character.postHistoryInstructions ?? '';
				creator = character.creator ?? '';
				characterVersion = character.characterVersion ?? '';
				activeTab = 'basic';
				try {
					alternateGreetings = JSON.parse(character.alternateGreetings || '[]');
				} catch {
					alternateGreetings = [];
				}
				const parsedTheme = parseCharacterTheme(character.theme);
				themeColorsDark = { ...parsedTheme.dark };
				themeColorsLight = { ...parsedTheme.light };
				editingThemeMode = 'dark';
			});
		}
	});

	async function save() {
		if (!character || !name.trim()) return;
		const ok = await checkFieldLimits([
			{ label: 'Name', value: name, limit: FIELD_LIMITS.name, trim: (v) => (name = v) },
			{ label: 'Creator', value: creator, limit: FIELD_LIMITS.name, trim: (v) => (creator = v) },
			{ label: 'Version', value: characterVersion, limit: FIELD_LIMITS.name, trim: (v) => (characterVersion = v) },
			{ label: 'Description', value: description, limit: FIELD_LIMITS.description, trim: (v) => (description = v) },
			{ label: 'Personality', value: personality, limit: FIELD_LIMITS.personality, trim: (v) => (personality = v) },
			{ label: 'Scenario', value: scenario, limit: FIELD_LIMITS.scenario, trim: (v) => (scenario = v) },
			{ label: 'Tags', value: tags, limit: FIELD_LIMITS.tags, trim: (v) => (tags = v) },
			{ label: 'First Message', value: firstMessage, limit: FIELD_LIMITS.firstMessage, trim: (v) => (firstMessage = v) },
			{ label: 'Example Messages', value: mesExample, limit: FIELD_LIMITS.mesExample, trim: (v) => (mesExample = v) },
			{ label: 'System Prompt', value: systemPrompt, limit: FIELD_LIMITS.systemPrompt, trim: (v) => (systemPrompt = v) },
			{ label: 'Post-History Instructions', value: postHistoryInstructions, limit: FIELD_LIMITS.postHistoryInstructions, trim: (v) => (postHistoryInstructions = v) },
			{ label: 'Creator Notes', value: creatorNotes, limit: FIELD_LIMITS.creatorNotes, trim: (v) => (creatorNotes = v) },
			...alternateGreetings.map((g, i) => ({
				label: `Alternate Greeting #${i + 1}`,
				value: g,
				limit: FIELD_LIMITS.greeting,
				trim: (v: string) => { alternateGreetings[i] = v; alternateGreetings = [...alternateGreetings]; },
			})),
		]);
		if (!ok) return;
		saving = true;
		try {
			const body = await api<any>(`/api/characters/${character.id}`, {
				method: 'PUT',
				json: {
					name,
					description,
					personality,
					firstMessage,
					scenario,
					systemPrompt,
					creatorNotes,
					tags,
					mesExample,
					postHistoryInstructions,
					alternateGreetings: JSON.stringify(alternateGreetings),
					creator,
					characterVersion,
					theme: JSON.stringify({
						dark: Object.fromEntries(Object.entries(themeColorsDark).filter(([, v]) => v)),
						light: Object.fromEntries(Object.entries(themeColorsLight).filter(([, v]) => v))
					})
				},
				errorLabel: 'Failed to save character'
			});
			if (body) {
				if (body.light) {
					charactersStore.upsert(body.light);
				} else if (body.id) {
					charactersStore.update(body.id, body);
				}
				// Mutate the locally-bound character object so cached image paths
				// (firstMessage/alternateGreetings/creatorNotes) flow back into the
				// open editor without a refetch.
				if (character) {
					Object.assign(character, body);
					delete (character as any).light;
				}
				// Offer to propagate the change to existing chats. Most fields
				// (description, system prompt, …) are read live so they update
				// automatically; this is mostly a chat-title refresh + a
				// confirmation that nothing is silently mutated. Greetings
				// already in chat history are preserved either way.
				const count = Number(body.chatCount ?? 0);
				if (count > 0) {
					propagateChatCount = count;
					propagatePreviousName = body.previousName ?? null;
					showPropagateConfirm = true;
				}
			}
			if (embedded) {
				editing = false;
			} else if (!showPropagateConfirm) {
				onclose();
			}
		} finally {
			saving = false;
		}
	}

	async function onAvatarFilePicked(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file || !character) return;
		uploadingAvatar = true;
		try {
			const fd = new FormData();
			fd.append('file', file);
			const res = await fetch(`/api/characters/${character.id}/avatar`, { method: 'POST', body: fd });
			if (!res.ok) {
				let msg = 'Failed to upload avatar';
				try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
				toasts.error(msg);
				return;
			}
			const body = await res.json();
			if (body?.character) {
				Object.assign(character, body.character);
				// Sync the local theme editor to whatever the server now has so a
				// subsequent save doesn't reintroduce stale colors.
				const parsedTheme = parseCharacterTheme(character.theme);
				themeColorsDark = { ...parsedTheme.dark };
				themeColorsLight = { ...parsedTheme.light };
				charactersStore.upsert({
					id: character.id,
					name: character.name,
					avatarPath: character.avatarPath,
					description: character.description,
					tags: character.tags,
					creator: character.creator,
					characterVersion: character.characterVersion,
					theme: character.theme,
					backgroundPath: character.backgroundPath,
					createdAt: character.createdAt,
					updatedAt: character.updatedAt
				} as any);
			}
		} catch (err) {
			toasts.error(err instanceof Error ? err.message : 'Network error');
		} finally {
			uploadingAvatar = false;
		}
	}

	async function removeAvatar() {
		if (!character?.avatarPath) return;
		const ok = await confirmDialog({
			title: 'Remove avatar?',
			message: 'This character will fall back to a generated avatar.',
			confirmLabel: 'Remove',
		});
		if (!ok) return;
		uploadingAvatar = true;
		try {
			const res = await fetch(`/api/characters/${character.id}/avatar`, { method: 'DELETE' });
			if (!res.ok) {
				let msg = 'Failed to remove avatar';
				try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
				toasts.error(msg);
				return;
			}
			const body = await res.json();
			if (body?.character) {
				Object.assign(character, body.character);
				charactersStore.upsert({
					id: character.id,
					name: character.name,
					avatarPath: character.avatarPath,
					description: character.description,
					tags: character.tags,
					creator: character.creator,
					characterVersion: character.characterVersion,
					theme: character.theme,
					backgroundPath: character.backgroundPath,
					createdAt: character.createdAt,
					updatedAt: character.updatedAt
				} as any);
			}
		} catch (err) {
			toasts.error(err instanceof Error ? err.message : 'Network error');
		} finally {
			uploadingAvatar = false;
		}
	}

	async function exportCharacter(format: 'png' | 'json') {
		if (!character) return;
		const res = await fetch(`/api/characters/${character.id}/export?format=${format}`);
		if (!res.ok) return;
		const blob = await res.blob();
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${character.name}.${format}`;
		a.click();
		URL.revokeObjectURL(url);
	}


	function addGreeting() {
		alternateGreetings = [...alternateGreetings, ''];
	}

	function removeGreeting(index: number) {
		alternateGreetings = alternateGreetings.filter((_, i) => i !== index);
	}

	// Greeting reformatter
	let reformatting = $state(false);
	let reformatResults: { index: number; original: string; reformatted: string }[] = $state([]);
	let showReview = $state(false);

	async function reformatGreetings() {
		if (!character) return;
		reformatting = true;
		try {
			const res = await fetch(`/api/characters/${character.id}/reformat-greetings`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({})
			});
			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				toasts.error(data.error || 'Failed to reformat greetings');
				return;
			}
			const data = await res.json();
			reformatResults = data.results;
			showReview = true;
		} catch (err) {
			toasts.error('Failed to reformat greetings');
		} finally {
			reformatting = false;
		}
	}

	function acceptReformat(results: typeof reformatResults) {
		for (const r of results) {
			if (r.index === -1) {
				firstMessage = r.reformatted;
			} else {
				alternateGreetings[r.index] = r.reformatted;
			}
		}
		alternateGreetings = [...alternateGreetings]; // trigger reactivity
		showReview = false;
	}

	const tabs = [
		{ id: 'basic' as const, label: 'Basic', icon: User },
		{ id: 'messages' as const, label: 'Messages', icon: MessageSquare },
		{ id: 'prompts' as const, label: 'Prompts', icon: ScrollText },
		{ id: 'meta' as const, label: 'Meta', icon: Tag },
		{ id: 'theme' as const, label: 'Theme', icon: Palette },
	];

	const inputClass = 'field-input';
	const textareaClass = 'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring resize-y';
	const labelClass = 'mb-1.5 block text-sm font-medium text-foreground';
	const hintClass = 'mt-1 text-xs text-muted-foreground';

	const modal = createModalState(() => open && !!character && !embedded);
	const gestures = createModalGestures({
		onclose: () => onclose(),
		modal,
		tabs: {
			ids: () => tabs.map(t => t.id),
			active: () => activeTab,
			set: (id) => { activeTab = id as typeof activeTab; },
		},
	});

	// Embedded-mode horizontal tab swipe (no pull-to-dismiss)
	let embSwipeX = $state(0);
	let embSwiping = $state(false);
	let embSettling = $state(false);
	let embEnterFrom = $state<'left' | 'right' | null>(null);
	let embStartX = 0;
	let embStartY = 0;
	let embIntent: 'none' | 'swipe' | 'scroll' = 'none';

	function embTouchStart(e: TouchEvent) {
		const t = e.touches[0];
		// Don't interfere with the drawer open gesture from the left edge
		if (t.clientX < 35) return;
		embStartX = t.clientX;
		embStartY = t.clientY;
		embIntent = 'none';
		embSwipeX = 0;
		embSwiping = false;
		embSettling = false;
		embEnterFrom = null;
	}

	function embTouchMove(e: TouchEvent) {
		if (embIntent === 'scroll') return;
		const t = e.touches[0];
		const dx = t.clientX - embStartX;
		const dy = t.clientY - embStartY;
		if (embIntent === 'none') {
			if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
			if (Math.abs(dx) > Math.abs(dy)) {
				embIntent = 'swipe';
			} else {
				embIntent = 'scroll';
				return;
			}
		}
		if (embIntent === 'swipe') {
			e.preventDefault();
			embSwiping = true;
			const tabIds = tabs.map(t => t.id);
			const idx = tabIds.indexOf(activeTab);
			// Rubber band at edges
			if ((dx < 0 && idx === tabIds.length - 1) || (dx > 0 && idx === 0)) {
				embSwipeX = dx * 0.3;
			} else {
				embSwipeX = dx;
			}
		}
	}

	function embTouchEnd() {
		if (embIntent !== 'swipe') { embIntent = 'none'; return; }
		const tabIds = tabs.map(t => t.id);
		const idx = tabIds.indexOf(activeTab);
		if (embSwipeX < -50 && idx < tabIds.length - 1) {
			activeTab = tabIds[idx + 1] as typeof activeTab;
			embEnterFrom = 'right';
			embSwipeX = 0;
			embSwiping = false;
			setTimeout(() => { embEnterFrom = null; }, 250);
		} else if (embSwipeX > 50 && idx > 0) {
			activeTab = tabIds[idx - 1] as typeof activeTab;
			embEnterFrom = 'left';
			embSwipeX = 0;
			embSwiping = false;
			setTimeout(() => { embEnterFrom = null; }, 250);
		} else {
			embSettling = true;
			embSwipeX = 0;
			embSwiping = false;
			setTimeout(() => { embSettling = false; }, 200);
		}
		embIntent = 'none';
	}
</script>

{#snippet viewField(label: string, content: string, mono?: boolean)}
	{#if content.trim()}
		<SettingRow {label}>
			<div class="message-content text-sm leading-relaxed {mono ? 'font-mono' : ''}">
				{@html renderField(content)}
			</div>
		</SettingRow>
	{/if}
{/snippet}

{#snippet tabContent()}
	{#if activeTab === 'basic'}
		{#if editing}
		<div class="space-y-5">
			<!-- Avatar + Name row -->
			<div class="flex gap-5">
				<div class="shrink-0 space-y-2">
					<span class={labelClass}>Avatar</span>
					{#if character?.avatarPath}
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
						<img
							src={character.avatarPath}
							alt={name}
							class="h-28 w-28 rounded-xl object-cover border border-border cursor-pointer transition-opacity hover:opacity-80"
							onclick={() => (enlargedAvatar = character.avatarPath?.replace('/avatars/', '/avatars/original/') ?? null)}
						/>
					{:else}
						<div class="flex h-28 w-28 items-center justify-center rounded-xl border border-dashed border-border bg-muted text-3xl font-bold text-muted-foreground">
							{name?.[0] ?? '?'}
						</div>
					{/if}
					<input
						bind:this={avatarFileInput}
						type="file"
						accept="image/png,image/jpeg,image/webp,image/gif"
						class="hidden"
						onchange={onAvatarFilePicked}
					/>
					<div class="flex items-center gap-2 text-xs">
						<button
							type="button"
							onclick={() => avatarFileInput?.click()}
							disabled={uploadingAvatar}
							class="rounded-lg border border-border px-2 py-1 transition-colors hover:bg-accent disabled:opacity-50"
						>
							{uploadingAvatar ? 'Uploading…' : (character?.avatarPath ? 'Replace' : 'Upload')}
						</button>
						{#if character?.avatarPath}
							<button
								type="button"
								onclick={removeAvatar}
								disabled={uploadingAvatar}
								class="rounded-lg px-2 py-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
							>
								Remove
							</button>
						{/if}
					</div>
				</div>
				<div class="flex-1 space-y-4">
					<SettingRow label="Name *" htmlFor="edit-name">
						<LimitedInput id="edit-name" bind:value={name} limit={FIELD_LIMITS.name} class={inputClass} placeholder="Character name" />
					</SettingRow>
					<div class="grid grid-cols-2 gap-3">
						<SettingRow label="Creator" htmlFor="edit-creator">
							<LimitedInput id="edit-creator" bind:value={creator} limit={FIELD_LIMITS.name} class={inputClass} placeholder="Author name" />
						</SettingRow>
						<SettingRow label="Version" htmlFor="edit-version">
							<LimitedInput id="edit-version" bind:value={characterVersion} limit={FIELD_LIMITS.name} class={inputClass} placeholder="1.0" />
						</SettingRow>
					</div>
				</div>
			</div>

			<SettingRow label="Description" htmlFor="edit-desc">
				<LimitedTextarea id="edit-desc" bind:value={description} rows={6} limit={FIELD_LIMITS.description} class={textareaClass} placeholder="Character description, background, appearance..." />
				<p class={hintClass}>Supports plain text or markdown-style formatting (e.g. ### headings).</p>
			</SettingRow>

			<SettingRow label="Personality" htmlFor="edit-personality">
				<LimitedTextarea id="edit-personality" bind:value={personality} rows={3} limit={FIELD_LIMITS.personality} class={textareaClass} placeholder="Personality traits, behavior patterns..." />
			</SettingRow>

			<SettingRow label="Tags" htmlFor="edit-tags">
				<LimitedInput id="edit-tags" bind:value={tags} limit={FIELD_LIMITS.tags} class={inputClass} placeholder="fantasy, sci-fi, romance (comma-separated)" />
			</SettingRow>
		</div>
		{:else}
		<div class="grid gap-6 md:grid-cols-[minmax(0,260px)_1fr]">
			<!-- Left column: avatar + identity. Sticky on desktop so long descriptions don't lose context. -->
			<div class="space-y-4 md:sticky md:top-0 md:self-start">
				{#if character?.avatarPath}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
					<img
						src={character.avatarPath}
						alt={name}
						class="block w-full h-auto max-w-[260px] mx-auto md:mx-0 rounded-2xl border border-border cursor-pointer transition-opacity hover:opacity-80 bg-muted"
						onclick={() => (enlargedAvatar = character.avatarPath?.replace('/avatars/', '/avatars/original/') ?? null)}
					/>
				{:else}
					<div class="mx-auto md:mx-0 flex aspect-[2/3] w-full max-w-[260px] items-center justify-center rounded-2xl border border-dashed border-border bg-muted text-5xl font-bold text-muted-foreground">
						{name?.[0] ?? '?'}
					</div>
				{/if}
				<div class="space-y-2">
					<h2 class="text-xl font-semibold leading-tight break-words">{name}</h2>
					{#if creator || characterVersion}
						<p class="text-sm text-muted-foreground">
							{#if creator}by {creator}{/if}
							{#if creator && characterVersion} · {/if}
							{#if characterVersion}v{characterVersion}{/if}
						</p>
					{/if}
					{#if parsedTags.length > 0}
						<div class="flex flex-wrap gap-1.5">
							{#each parsedTags as tag}
								<span class="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">{tag}</span>
							{/each}
						</div>
					{/if}
				</div>
			</div>

			<!-- Right column: content -->
			<div class="min-w-0 space-y-5">
				{#if description.trim() || personality.trim()}
					{@render viewField('Description', description)}
					{@render viewField('Personality', personality)}
				{:else}
					<p class="py-8 text-center text-sm text-muted-foreground">No description or personality defined.</p>
				{/if}
			</div>
		</div>
		{/if}

	{:else if activeTab === 'messages'}
		{#if editing}
		<div class="space-y-5">
			<SettingRow label="First Message" htmlFor="edit-first">
				{#snippet action()}
					<button
						onclick={reformatGreetings}
						disabled={reformatting || (!firstMessage.trim() && alternateGreetings.every(g => !g.trim()))}
						class="flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-40 disabled:pointer-events-none"
					>
						{#if reformatting}
							<span class="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent"></span>
							Reformatting...
						{:else}
							<Wand2 class="h-3.5 w-3.5" />
							Reformat with AI
						{/if}
					</button>
				{/snippet}
				<LimitedTextarea id="edit-first" bind:value={firstMessage} rows={8} limit={FIELD_LIMITS.firstMessage} class={textareaClass} placeholder="The opening message when a new chat starts..." />
				<p class={hintClass}>Use &#123;&#123;char&#125;&#125; for the character's name and &#123;&#123;user&#125;&#125; for the user's name.</p>
			</SettingRow>

			<SettingRow label="Alternate Greetings ({alternateGreetings.length})">
				{#snippet action()}
					<button
						onclick={addGreeting}
						class="flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
					>
						<Plus class="h-3 w-3" />
						Add
					</button>
				{/snippet}
				{#if alternateGreetings.length === 0}
					<p class="rounded-lg border border-dashed border-border px-4 py-3 text-center text-sm text-muted-foreground">
						No alternate greetings. Click "Add" to create one.
					</p>
				{/if}
				{#each alternateGreetings as _, i}
					<div class="mb-3 flex gap-2">
						<LimitedTextarea
							bind:value={alternateGreetings[i]}
							rows={3}
							limit={FIELD_LIMITS.greeting}
							class="{textareaClass} flex-1"
							placeholder="Alternate greeting #{i + 1}"
						/>
						<button
							onclick={() => removeGreeting(i)}
							class="shrink-0 self-start rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/20 hover:text-destructive"
						>
							<Trash2 class="h-4 w-4" />
						</button>
					</div>
				{/each}
			</SettingRow>

			<SettingRow label="Example Messages" htmlFor="edit-example">
				<LimitedTextarea
					id="edit-example"
					bind:value={mesExample}
					rows={8}
					limit={FIELD_LIMITS.mesExample}
					class={textareaClass}
					placeholder={"<START>\n{{char}}: Example dialogue here...\n{{user}}: Example response...\n{{char}}: Another example..."}
				/>
				<p class={hintClass}>Example dialogue to teach the AI the character's voice. Use &lt;START&gt; to separate examples.</p>
			</SettingRow>
		</div>
		{:else}
		{@const allGreetings = [firstMessage, ...alternateGreetings].filter(g => g.trim())}
		<div class="space-y-5">
			{#if allGreetings.length > 0}
				<div>
					<div class="mb-3 flex items-center justify-center gap-2">
						{#if allGreetings.length > 1}
							<button
								onclick={() => { viewGreetingIndex = (viewGreetingIndex - 1 + allGreetings.length) % allGreetings.length; }}
								class="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
								aria-label="Previous greeting"
							>
								<ChevronLeft class="h-4 w-4" />
							</button>
						{/if}
						<span class={labelClass}>Greeting {viewGreetingIndex + 1} of {allGreetings.length}</span>
						{#if allGreetings.length > 1}
							<button
								onclick={() => { viewGreetingIndex = (viewGreetingIndex + 1) % allGreetings.length; }}
								class="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
								aria-label="Next greeting"
							>
								<ChevronRight class="h-4 w-4" />
							</button>
						{/if}
					</div>
					<div class="message-content text-sm leading-relaxed">
						{@html renderField(allGreetings[viewGreetingIndex] ?? '')}
					</div>
				</div>
			{/if}
			{#if mesExample.trim()}
				<SettingRow label="Example Messages">
					<div class="message-content text-sm leading-relaxed font-mono">
						{@html renderField(mesExample)}
					</div>
				</SettingRow>
			{/if}
			{#if !firstMessage.trim() && alternateGreetings.every(g => !g.trim()) && !mesExample.trim()}
				<p class="py-8 text-center text-sm text-muted-foreground">No messages defined.</p>
			{/if}
		</div>
		{/if}

	{:else if activeTab === 'prompts'}
		{#if editing}
		<div class="space-y-5">
			<SettingRow label="Scenario" htmlFor="edit-scenario">
				<LimitedTextarea id="edit-scenario" bind:value={scenario} rows={4} limit={FIELD_LIMITS.scenario} class={textareaClass} placeholder="The setting, situation, or context for the roleplay..." />
				<p class={hintClass}>Describes the circumstances and environment for the conversation.</p>
			</SettingRow>

			<SettingRow label="System Prompt" htmlFor="edit-system">
				<LimitedTextarea id="edit-system" bind:value={systemPrompt} rows={6} limit={FIELD_LIMITS.systemPrompt} class={textareaClass} placeholder="Custom system prompt for this character..." />
				<p class={hintClass}>Overrides or supplements the global system prompt when chatting with this character.</p>
			</SettingRow>

			<SettingRow label="Post-History Instructions" htmlFor="edit-post">
				<LimitedTextarea id="edit-post" bind:value={postHistoryInstructions} rows={3} limit={FIELD_LIMITS.postHistoryInstructions} class={textareaClass} placeholder="Instructions injected after the chat history..." />
				<p class={hintClass}>Added after all messages, right before the AI responds. Good for reminders and formatting rules.</p>
			</SettingRow>
		</div>
		{:else}
		<div class="space-y-5">
			{@render viewField('Scenario', scenario)}
			{@render viewField('System Prompt', systemPrompt, true)}
			{@render viewField('Post-History Instructions', postHistoryInstructions, true)}
			{#if !scenario.trim() && !systemPrompt.trim() && !postHistoryInstructions.trim()}
				<p class="py-8 text-center text-sm text-muted-foreground">No prompts defined.</p>
			{/if}
		</div>
		{/if}

	{:else if activeTab === 'meta'}
		<div class="flex h-full flex-col">
			{#if editing || !creatorNotes.trim()}
				<label for="edit-notes" class="{labelClass} mb-2">Creator Notes</label>
				<LimitedTextarea id="edit-notes" bind:value={creatorNotes} limit={FIELD_LIMITS.creatorNotes} class="{textareaClass} flex-1" style="min-height: 200px;" placeholder="Notes about the character, usage tips, recommended settings..." />
				<p class="{hintClass} mt-1">Internal notes visible only to you. Not sent to the AI.</p>
			{:else}
				<span class="{labelClass} mb-2">Creator Notes</span>
				{#if notesAreHtml}
					<iframe
						srcdoc={notesSrcdoc}
						sandbox=""
						class="flex-1 w-full rounded-xl border border-border"
						style="min-height: 300px;"
						title="Creator notes"
					></iframe>
				{:else}
					<div class="flex-1 overflow-y-auto rounded-xl border border-border p-5">
						<div class="message-content text-sm leading-relaxed">
							{@html notesRenderedMarkdown}
						</div>
					</div>
				{/if}
			{/if}
		</div>

	{:else if activeTab === 'theme'}
		<div class="space-y-5">
			<p class="text-sm text-muted-foreground">
				Set custom colors for this character. When enabled, these override the app theme in the chat area. The dark variant is used in dark mode (and dark system mode); the light variant is used in light mode. Leave blank to fall back to the app theme.
			</p>
			<div class="flex gap-1 rounded-xl border border-border p-1">
				<button
					onclick={() => (editingThemeMode = 'dark')}
					class="flex-1 rounded-lg px-3 py-1.5 text-sm transition-colors {editingThemeMode === 'dark' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}"
				>Dark variant</button>
				<button
					onclick={() => (editingThemeMode = 'light')}
					class="flex-1 rounded-lg px-3 py-1.5 text-sm transition-colors {editingThemeMode === 'light' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}"
				>Light variant</button>
			</div>
			<div class="grid grid-cols-2 gap-4 @xl:grid-cols-3">
				{#each themeColorKeys as { key, label }}
					<div>
						<div class="mb-1.5 flex items-center justify-between">
							<span class="text-sm font-medium">{label}</span>
							{#if themeColors[key]}
								<button
									onclick={() => setThemeColor(key, '')}
									class="text-muted-foreground hover:text-foreground"
									use:tooltip={'Clear'}
								>
									<RotateCcw class="h-3 w-3" />
								</button>
							{/if}
						</div>
						<div class="flex items-center gap-2">
							<input
								type="color"
								value={themeColors[key] || '#000000'}
								oninput={(e) => setThemeColor(key, e.currentTarget.value)}
								class="h-9 w-9 shrink-0 cursor-pointer rounded-lg border border-input bg-background p-0.5"
							/>
							<input
								type="text"
								value={themeColors[key] || ''}
								oninput={(e) => setThemeColor(key, e.currentTarget.value)}
								maxlength={64}
								class="{inputClass} font-mono text-xs"
								placeholder="Not set"
							/>
						</div>
					</div>
				{/each}
			</div>
			{#if Object.values(themeColors).some(v => v)}
				<div class="rounded-xl border border-border p-4">
					<p class="mb-3 text-xs font-medium text-muted-foreground">Preview</p>
					<div
						class="flex flex-col gap-2 rounded-lg p-4"
						style={Object.entries(themeColors).filter(([, v]) => v).map(([k, v]) => `--${k}: ${v}`).join('; ')}
					>
						<div class="rounded-lg bg-[var(--background,var(--card))] p-3" style="background-color: var(--background)">
							<div class="rounded-lg p-3" style="background-color: var(--card); color: var(--card-foreground)">
								<p class="text-sm" style="color: var(--card-foreground)">Card content</p>
								<p class="text-xs" style="color: var(--muted-foreground)">Muted text</p>
							</div>
						</div>
						<div class="flex gap-2">
							<div class="rounded-lg px-3 py-1.5 text-xs" style="background-color: var(--primary); color: var(--primary-foreground)">Primary</div>
							<div class="rounded-lg px-3 py-1.5 text-xs" style="background-color: var(--secondary); color: var(--foreground)">Secondary</div>
							<div class="rounded-lg px-3 py-1.5 text-xs" style="background-color: var(--accent); color: var(--foreground)">Accent</div>
						</div>
						<p class="text-sm" style="color: var(--speech)">"Dialogue color"</p>
					</div>
				</div>
			{/if}
		</div>
	{/if}
{/snippet}

{#if embedded && open && character}
	<div class="flex h-full flex-col md:rounded-2xl md:bg-background">
		<!-- Header -->
		<div
			class="flex items-center justify-between border-b border-border pb-3"
			style="padding-top: max(0.75rem, var(--safe-area-top)); padding-left: max(1rem, var(--safe-area-left)); padding-right: max(1rem, var(--safe-area-right));"
		>
			<div class="flex items-center gap-3 min-w-0">
				{#if character.avatarPath}
					<img src={character.avatarPath} alt={character.name} loading="lazy" decoding="async" class="h-10 w-10 rounded-full object-cover" />
				{:else}
					<div class="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-lg font-bold text-primary">
						{character.name?.[0] ?? '?'}
					</div>
				{/if}
				<div class="min-w-0">
					<h2 class="truncate text-lg font-semibold">{character.name}</h2>
					{#if character.creator}
						<p class="truncate text-xs text-muted-foreground">by {character.creator}</p>
					{/if}
				</div>
			</div>
			<div class="flex items-center gap-1">
				{#if editing}
					<button
						onclick={cancelEdit}
						class="flex h-8 items-center gap-1.5 rounded-lg border border-border px-2 sm:px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent"
					>
						<X class="h-3.5 w-3.5" />
						<span class="hidden sm:inline">Cancel</span>
					</button>
					<button
						onclick={save}
						disabled={saving || !name.trim()}
						class="flex h-8 items-center gap-1.5 rounded-lg bg-primary px-2 sm:px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
					>
						<Save class="h-3.5 w-3.5" />
						<span class="hidden sm:inline">{saving ? 'Saving...' : 'Save'}</span>
					</button>
				{:else}
					<button
						onclick={() => onstartchat?.(character.id, 'story')}
						class="flex h-8 items-center gap-1 rounded-lg bg-primary/10 px-2 sm:gap-1.5 sm:px-3 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
						use:tooltip={'Start story chat'}
					>
						<Plus class="h-3 w-3 sm:hidden" />
						<MessageSquare class="h-3.5 w-3.5" />
						<span class="hidden sm:inline">Story</span>
					</button>
					<button
						onclick={() => onstartchat?.(character.id, 'texting')}
						class="flex h-8 items-center gap-1 rounded-lg bg-emerald-500/10 px-2 sm:gap-1.5 sm:px-3 text-xs font-medium text-emerald-500 transition-colors hover:bg-emerald-500/20"
						use:tooltip={'Start text chat'}
					>
						<Plus class="h-3 w-3 sm:hidden" />
						<Smartphone class="h-3.5 w-3.5" />
						<span class="hidden sm:inline">Text</span>
					</button>
					<div class="relative" data-char-header-menu>
						<button
							onclick={() => (menuOpen = !menuOpen)}
							class="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
							aria-label="More actions"
							use:tooltip={'More actions'}
						>
							<MoreHorizontal class="h-4 w-4" />
						</button>
						{#if menuOpen}
							<div class="popup-menu absolute right-0 top-full mt-1 z-50 w-48 rounded-xl border border-border bg-popover py-1 shadow-2xl">
								<button
									onclick={() => { menuOpen = false; exportCharacter('png'); }}
									class="flex w-full items-center gap-3 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
								>
									<Download class="h-4 w-4 text-muted-foreground" /> Export as PNG
								</button>
								<button
									onclick={() => { menuOpen = false; exportCharacter('json'); }}
									class="flex w-full items-center gap-3 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
								>
									<Download class="h-4 w-4 text-muted-foreground" /> Export as JSON
								</button>
								<div class="my-1 h-px bg-border"></div>
								<button
									onclick={() => { menuOpen = false; editing = true; }}
									class="flex w-full items-center gap-3 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
								>
									<Pencil class="h-4 w-4 text-muted-foreground" /> Edit
								</button>
								{#if onaiedit && character?.id != null}
									<button
										onclick={() => { menuOpen = false; onaiedit?.(character.id); }}
										class="flex w-full items-center gap-3 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
									>
										<Wand2 class="h-4 w-4 text-muted-foreground" /> Edit with AI
									</button>
								{/if}
								<button
									onclick={() => { menuOpen = false; showDeleteConfirm = true; }}
									class="flex w-full items-center gap-3 px-3 py-2 text-sm text-destructive transition-colors hover:bg-destructive/10"
								>
									<Trash2 class="h-4 w-4" /> Delete
								</button>
							</div>
						{/if}
					</div>
				{/if}
			</div>
		</div>

		<!-- Tabs -->
		<div class="flex gap-1 border-b border-border px-3 sm:px-6">
			{#each tabs as tab}
				<button
					onclick={() => (activeTab = tab.id)}
					use:tooltip={tab.label}
					class="relative flex flex-1 sm:flex-none items-center justify-center gap-1.5 px-3 py-2.5 text-sm font-medium transition-colors
						{activeTab === tab.id
							? 'text-foreground'
							: 'text-muted-foreground hover:text-foreground'}"
				>
					<tab.icon class="h-4 w-4" />
					<span class="hidden sm:inline">{tab.label}</span>
					{#if activeTab === tab.id}
						<div class="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full"></div>
					{/if}
				</button>
			{/each}
		</div>

		<!-- Body -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="@container flex-1 overflow-y-auto p-6 {embEnterFrom === 'left' ? 'tab-enter-from-left' : embEnterFrom === 'right' ? 'tab-enter-from-right' : ''}"
			style={embSwiping ? `transform: translateX(${embSwipeX}px); transition: none` : embSettling ? 'transform: translateX(0); transition: transform 200ms ease-out' : ''}
			ontouchstart={embTouchStart}
			ontouchmove={embTouchMove}
			ontouchend={embTouchEnd}
			ontouchcancel={embTouchEnd}
		>
			{@render tabContent()}
		</div>
	</div>
{:else if modal.visible}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-[60] flex items-end justify-center p-0 sm:items-center sm:p-4 bg-black/60 {modal.closing ? 'backdrop-exit' : 'backdrop-enter'}"
		role="dialog" aria-modal="true" aria-label="Edit Character" tabindex="-1" use:focusTrap
		onkeydown={(e) => e.key === 'Escape' && onclose()}
	>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div class="absolute inset-0" onclick={onclose}></div>

		<div
			class="relative z-10 flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl border border-border bg-card pb-safe shadow-xl sm:rounded-xl sm:pb-0 {modal.closing ? 'modal-exit' : 'modal-enter'}"
			style={gestures.panelStyle}
			ontouchstart={gestures.handlers.onTouchStart}
			ontouchmove={gestures.handlers.onTouchMove}
			ontouchend={gestures.handlers.onTouchEnd}
		>
			<!-- Header -->
			<div class="flex items-center justify-between border-b border-border px-6 py-4">
				<div class="flex items-center gap-3">
					{#if character.avatarPath}
						<img src={character.avatarPath} alt={character.name} class="h-10 w-10 rounded-full object-cover" />
					{:else}
						<div class="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-lg font-bold text-primary">
							{character.name?.[0] ?? '?'}
						</div>
					{/if}
					<div>
						<h2 class="text-lg font-semibold">{character.name}</h2>
						{#if character.creator}
							<p class="text-xs text-muted-foreground">by {character.creator}</p>
						{/if}
					</div>
				</div>
				<div class="flex items-center gap-2">
					{#if editing}
						<button
							onclick={cancelEdit}
							class="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
						>
							<X class="h-4 w-4" /> Cancel
						</button>
						<button
							onclick={save}
							disabled={saving || !name.trim()}
							class="flex items-center gap-2 rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
						>
							<Save class="h-4 w-4" />
							{saving ? 'Saving...' : 'Save'}
						</button>
					{:else}
						<div class="relative" data-char-header-menu>
							<button
								onclick={() => (menuOpen = !menuOpen)}
								class="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
								aria-label="More actions"
								use:tooltip={'More actions'}
							>
								<MoreHorizontal class="h-4 w-4" />
							</button>
							{#if menuOpen}
								<div class="popup-menu absolute right-0 top-full mt-1 z-50 w-48 rounded-xl border border-border bg-popover py-1 shadow-2xl">
									<button
										onclick={() => { menuOpen = false; exportCharacter('png'); }}
										class="flex w-full items-center gap-3 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
									>
										<Download class="h-4 w-4 text-muted-foreground" /> Export as PNG
									</button>
									<button
										onclick={() => { menuOpen = false; exportCharacter('json'); }}
										class="flex w-full items-center gap-3 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
									>
										<Download class="h-4 w-4 text-muted-foreground" /> Export as JSON
									</button>
									<div class="my-1 h-px bg-border"></div>
									<button
										onclick={() => { menuOpen = false; editing = true; }}
										class="flex w-full items-center gap-3 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
									>
										<Pencil class="h-4 w-4 text-muted-foreground" /> Edit
									</button>
									{#if onaiedit && character?.id != null}
										<button
											onclick={() => { menuOpen = false; onaiedit?.(character.id); }}
											class="flex w-full items-center gap-3 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
										>
											<Wand2 class="h-4 w-4 text-muted-foreground" /> Edit with AI
										</button>
									{/if}
									<button
										onclick={() => { menuOpen = false; showDeleteConfirm = true; }}
										class="flex w-full items-center gap-3 px-3 py-2 text-sm text-destructive transition-colors hover:bg-destructive/10"
									>
										<Trash2 class="h-4 w-4" /> Delete
									</button>
								</div>
							{/if}
						</div>
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
			<div class="flex gap-1 border-b border-border px-3 sm:px-6">
				{#each tabs as tab}
					<button
						onclick={() => (activeTab = tab.id)}
						use:tooltip={tab.label}
						class="relative flex flex-1 sm:flex-none items-center justify-center gap-1.5 px-3 py-2.5 text-sm font-medium transition-colors
							{activeTab === tab.id
								? 'text-foreground'
								: 'text-muted-foreground hover:text-foreground'}"
					>
						<tab.icon class="h-4 w-4" />
						<span class="hidden sm:inline">{tab.label}</span>
						{#if activeTab === tab.id}
							<div class="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full"></div>
						{/if}
					</button>
				{/each}
			</div>

			<!-- Body -->
			<div class="@container flex-1 overflow-y-auto p-6 {gestures.contentClass}" style={gestures.contentStyle}>
				{@render tabContent()}
			</div>
		</div>
	</div>
{/if}

<GreetingReviewModal
	open={showReview}
	results={reformatResults}
	onaccept={acceptReformat}
	onclose={() => (showReview = false)}
/>

<ImageModal
	src={enlargedAvatar}
	alt={name}
	onclose={() => (enlargedAvatar = null)}
/>

<ConfirmModal
	open={showDeleteConfirm}
	title="Delete Character"
	message={hasLorebook
		? `Delete "${character?.name ?? ''}"? All related chats and data will be permanently removed.\n\nThis character has an associated lorebook. "Delete All" will also remove the lorebook. "Keep Lorebook" will keep it as a standalone lorebook.`
		: `Delete "${character?.name ?? ''}"? All related chats and data will be permanently removed.`}
	confirmLabel={hasLorebook ? 'Delete All' : 'Delete'}
	secondaryLabel={hasLorebook ? 'Keep Lorebook' : ''}
	onsecondary={() => { showDeleteConfirm = false; ondelete?.(true); }}
	onconfirm={() => { showDeleteConfirm = false; ondelete?.(); }}
	oncancel={() => { showDeleteConfirm = false; }}
/>

<ConfirmModal
	open={showPropagateConfirm}
	variant="info"
	title="Update existing chats?"
	message={`This character is used in ${propagateChatCount} chat${propagateChatCount === 1 ? '' : 's'}. Apply your changes there too? Existing greetings will be left as-is so in-progress stories aren't disrupted.`}
	confirmLabel={propagatingChats ? 'Updating…' : 'Update chats'}
	cancelLabel="Skip"
	onconfirm={async () => {
		if (propagatingChats) return;
		propagatingChats = true;
		try {
			await api(`/api/characters/${character.id}/sync-chats`, {
				method: 'POST',
				json: { oldName: propagatePreviousName },
				errorLabel: 'Failed to update existing chats'
			});
		} finally {
			propagatingChats = false;
			showPropagateConfirm = false;
			if (!embedded) onclose();
		}
	}}
	oncancel={() => {
		showPropagateConfirm = false;
		if (!embedded) onclose();
	}}
/>
