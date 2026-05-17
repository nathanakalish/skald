<script lang="ts">
	import { tooltip } from '$lib/tooltip.js';
	import { Pencil, Save, Star, Trash2, User as UserIcon, Upload, X, MoreHorizontal } from 'lucide-svelte';
	import { personasStore, type Persona } from '$lib/stores/personas.svelte.js';
	import { toasts } from '$lib/stores/toast.svelte.js';
	import ConfirmModal from '$lib/components/ConfirmModal.svelte';

	interface Props {
		// `null` means create-new mode.
		persona: Persona | null;
		onsaved?: (id: number) => void;
		ondeleted?: () => void;
	}

	let { persona, onsaved, ondeleted }: Props = $props();

	const isCreate = $derived(persona === null);

	let editing = $state(false);
	let name = $state('');
	let displayName = $state('');
	let description = $state('');
	let isDefault = $state(false);
	let avatarPath = $state<string | null>(null);
	let saving = $state(false);
	let uploading = $state(false);
	let error = $state<string | null>(null);
	let confirmDelete = $state(false);
	let fileInput: HTMLInputElement | null = $state(null);
	let menuOpen = $state(false);

	// Reset form when the selected persona changes; create-mode opens
	// straight into editing, view-mode starts as a read-only viewer.
	$effect(() => {
		if (persona) {
			name = persona.name;
			displayName = persona.displayName || '';
			description = persona.description || '';
			isDefault = !!persona.isDefault;
			avatarPath = persona.avatarPath || null;
			editing = false;
		} else {
			name = '';
			displayName = '';
			description = '';
			isDefault = personasStore.personas.length === 0;
			avatarPath = null;
			editing = true;
		}
		error = null;
	});

	$effect(() => {
		if (!menuOpen) return;
		const onClick = (e: MouseEvent) => {
			if (!(e.target as HTMLElement).closest('[data-persona-menu]')) menuOpen = false;
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
		if (isCreate) {
			ondeleted?.();
			return;
		}
		// Restore from persona snapshot.
		if (persona) {
			name = persona.name;
			displayName = persona.displayName || '';
			description = persona.description || '';
			isDefault = !!persona.isDefault;
			avatarPath = persona.avatarPath || null;
		}
		editing = false;
		error = null;
	}

	async function save() {
		if (!name.trim() || saving) return;
		saving = true;
		error = null;
		// Snapshot the existing entry so we can revert on failure.
		const editingPersona = persona;
		const prevSnapshot = editingPersona ? { ...editingPersona } : null;
		const nextLocal: any = {
			id: editingPersona?.id ?? -Date.now(),
			name: name.trim(),
			displayName: displayName.trim(),
			description,
			isDefault,
			avatarPath: avatarPath ?? editingPersona?.avatarPath ?? null,
		};
		if (editingPersona) {
			personasStore.update(editingPersona.id, nextLocal);
		} else {
			personasStore.add(nextLocal);
		}
		editing = false;

		try {
			const body = JSON.stringify({
				name: name.trim(),
				displayName: displayName.trim(),
				description,
				isDefault,
				...(avatarPath !== undefined ? { avatarPath } : {}),
			});
			const res = editingPersona
				? await fetch(`/api/personas/${editingPersona.id}`, {
						method: 'PUT',
						headers: { 'Content-Type': 'application/json' },
						body,
					})
				: await fetch('/api/personas', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body,
					});
			if (!res.ok) {
				const j = await res.json().catch(() => ({}));
				error = j?.error || `Save failed (${res.status})`;
				if (editingPersona && prevSnapshot) personasStore.update(editingPersona.id, prevSnapshot);
				else personasStore.remove(nextLocal.id);
				editing = true;
				return;
			}
			const data = await res.json();
			if (Array.isArray(data?.personas)) personasStore.replaceAll(data.personas);
			else if (data?.id) {
				if (editingPersona) personasStore.update(data.id, data);
				else {
					personasStore.remove(nextLocal.id);
					personasStore.add(data);
				}
			}
			const newId = editingPersona?.id ?? data?.id;
			if (newId) onsaved?.(newId);
		} catch {
			if (editingPersona && prevSnapshot) personasStore.update(editingPersona.id, prevSnapshot);
			else personasStore.remove(nextLocal.id);
			error = 'Network error';
			editing = true;
		} finally {
			saving = false;
		}
	}

	async function uploadAvatar(file: File) {
		if (!persona) {
			error = 'Save the persona first, then upload an avatar.';
			return;
		}
		uploading = true;
		error = null;
		try {
			const fd = new FormData();
			fd.append('file', file);
			const res = await fetch(`/api/personas/${persona.id}/avatar`, {
				method: 'POST',
				body: fd,
			});
			if (!res.ok) {
				const j = await res.json().catch(() => ({}));
				error = j?.error || `Upload failed (${res.status})`;
				return;
			}
			const data = await res.json();
			if (Array.isArray(data?.personas)) personasStore.replaceAll(data.personas);
			if (data?.avatarPath) avatarPath = data.avatarPath;
		} finally {
			uploading = false;
		}
	}

	async function removeAvatar() {
		if (!persona) {
			avatarPath = null;
			return;
		}
		uploading = true;
		try {
			const res = await fetch(`/api/personas/${persona.id}/avatar`, { method: 'DELETE' });
			if (res.ok) {
				const data = await res.json();
				if (Array.isArray(data?.personas)) personasStore.replaceAll(data.personas);
				avatarPath = null;
			}
		} finally {
			uploading = false;
		}
	}

	async function setDefault() {
		if (!persona) {
			isDefault = true;
			return;
		}
		const res = await fetch(`/api/personas/${persona.id}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ isDefault: true }),
		});
		if (res.ok) {
			const data = await res.json();
			if (Array.isArray(data?.personas)) personasStore.replaceAll(data.personas);
			else if (data?.id) personasStore.update(data.id, data);
			isDefault = true;
		}
	}

	async function doDelete() {
		if (!persona) return;
		const snapshot = { ...persona };
		personasStore.remove(persona.id);
		confirmDelete = false;
		ondeleted?.();
		try {
			const res = await fetch(`/api/personas/${snapshot.id}`, { method: 'DELETE' });
			if (!res.ok) throw new Error(String(res.status));
			const data = await res.json().catch(() => ({}));
			if (Array.isArray(data?.personas)) personasStore.replaceAll(data.personas);
		} catch {
			personasStore.add(snapshot);
			toasts.error('Failed to delete persona');
		}
	}

	function onPickFile(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (file) uploadAvatar(file);
		input.value = '';
	}
</script>

<div class="flex h-full flex-col">
	<!-- Header -->
	<div class="flex items-center justify-between gap-2 border-b border-border px-6 py-4">
		<div class="min-w-0 flex-1">
			<h2 class="truncate text-lg font-semibold">
				{isCreate ? 'New Persona' : persona?.displayName || persona?.name || 'Persona'}
			</h2>
			{#if !isCreate && persona?.isDefault}
				<p class="text-xs text-primary">Default persona</p>
			{/if}
		</div>
		<div class="flex items-center gap-2">
			{#if editing}
				<button
					type="button"
					onclick={cancelEdit}
					class="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm transition-colors hover:bg-accent"
				>
					<X class="h-4 w-4" /> Cancel
				</button>
				<button
					type="button"
					onclick={save}
					disabled={!name.trim() || saving}
					class="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
				>
					<Save class="h-4 w-4" />
					{saving ? 'Saving…' : isCreate ? 'Create' : 'Save'}
				</button>
			{:else if !isCreate}
				<div class="relative" data-persona-menu>
					<button
						type="button"
						onclick={() => (menuOpen = !menuOpen)}
						class="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
						aria-label="More actions"
						use:tooltip={'More actions'}
					>
						<MoreHorizontal class="h-4 w-4" />
					</button>
					{#if menuOpen}
						<div class="popup-menu absolute right-0 top-full mt-1 z-50 w-48 rounded-xl border border-border bg-popover py-1 shadow-2xl">
							{#if persona && !persona.isDefault}
								<button
									onclick={() => { menuOpen = false; setDefault(); }}
									class="flex w-full items-center gap-3 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
								>
									<Star class="h-4 w-4 text-muted-foreground" /> Set as default
								</button>
								<div class="my-1 h-px bg-border"></div>
							{/if}
							<button
								onclick={() => { menuOpen = false; editing = true; }}
								class="flex w-full items-center gap-3 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
							>
								<Pencil class="h-4 w-4 text-muted-foreground" /> Edit
							</button>
							<button
								onclick={() => { menuOpen = false; confirmDelete = true; }}
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

	<!-- Body -->
	<div class="flex-1 overflow-y-auto px-6 py-5">
		<div class="mx-auto max-w-2xl space-y-6">
			<!-- Avatar -->
			<div class="flex items-center gap-4">
				<div class="relative">
					{#if avatarPath}
						<img src={avatarPath} alt="Persona avatar" loading="lazy" decoding="async" class="h-20 w-20 rounded-full object-cover ring-2 ring-border" />
					{:else}
						<div class="flex h-20 w-20 items-center justify-center rounded-full bg-secondary text-secondary-foreground ring-2 ring-border">
							<UserIcon class="h-8 w-8" />
						</div>
					{/if}
					{#if uploading}
						<div class="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 text-xs text-white">…</div>
					{/if}
				</div>
				{#if editing}
					<div class="flex flex-col gap-2">
						<input
							bind:this={fileInput}
							type="file"
							accept="image/png,image/jpeg,image/webp,image/gif"
							class="hidden"
							onchange={onPickFile}
						/>
						<button
							type="button"
							onclick={() => fileInput?.click()}
							disabled={uploading || isCreate}
							class="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-sm transition-colors hover:bg-accent disabled:opacity-50"
							use:tooltip={isCreate ? 'Save persona first to upload an avatar' : 'Upload avatar'}
						>
							<Upload class="h-4 w-4" />
							{avatarPath ? 'Replace avatar' : 'Upload avatar'}
						</button>
						{#if avatarPath && !isCreate}
							<button
								type="button"
								onclick={removeAvatar}
								disabled={uploading}
								class="text-left text-xs text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
							>
								Remove avatar
							</button>
						{/if}
						{#if isCreate}
							<p class="max-w-xs text-xs text-muted-foreground">Save first, then upload an image.</p>
						{/if}
					</div>
				{/if}
			</div>

			{#if editing}
				<!-- Editable fields -->
				<div class="grid gap-4 sm:grid-cols-2">
					<div>
						<label for="pe-display" class="mb-1 block text-xs font-medium text-muted-foreground">Label</label>
						<input
							id="pe-display"
							bind:value={displayName}
							class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
							placeholder="e.g. My Fantasy Persona"
						/>
					</div>
					<div>
						<label for="pe-name" class="mb-1 block text-xs font-medium text-muted-foreground">In-Chat Name *</label>
						<input
							id="pe-name"
							bind:value={name}
							class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
							placeholder={"Name used for {{user}}"}
						/>
					</div>
				</div>
				<div>
					<label for="pe-desc" class="mb-1 block text-xs font-medium text-muted-foreground">Description</label>
					<textarea
						id="pe-desc"
						bind:value={description}
						rows={8}
						class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
						placeholder="Describe your persona — this is injected into context for the AI."
					></textarea>
				</div>

				<label class="flex items-center gap-2 text-sm">
					<input type="checkbox" bind:checked={isDefault} class="rounded" disabled={!isCreate && persona?.isDefault} />
					Set as default persona
				</label>
			{:else}
				<!-- Read-only viewer -->
				<div class="grid gap-4 sm:grid-cols-2">
					<div>
						<p class="mb-1 text-xs font-medium text-muted-foreground">Label</p>
						<p class="text-sm">{displayName || (name ? '—' : '')}</p>
					</div>
					<div>
						<p class="mb-1 text-xs font-medium text-muted-foreground">In-Chat Name</p>
						<p class="text-sm font-medium">{name}</p>
					</div>
				</div>
				<div>
					<p class="mb-1 text-xs font-medium text-muted-foreground">Description</p>
					{#if description?.trim()}
						<p class="whitespace-pre-wrap text-sm text-foreground">{description}</p>
					{:else}
						<p class="text-sm italic text-muted-foreground">No description.</p>
					{/if}
				</div>
			{/if}

			{#if error}
				<div class="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
					{error}
				</div>
			{/if}
		</div>
	</div>
</div>

<ConfirmModal
	open={confirmDelete}
	title="Delete Persona"
	message={`Delete "${persona?.displayName || persona?.name}"? This cannot be undone.`}
	confirmLabel="Delete"
	oncancel={() => (confirmDelete = false)}
	onconfirm={doDelete}
/>
