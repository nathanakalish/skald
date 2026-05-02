<script lang="ts">
	import { Pencil, Plus, Trash2, X, Star, User } from 'lucide-svelte';
	import { createModalState, createModalGestures } from '$lib/modal.svelte.js';
	import ConfirmModal from '$lib/components/ConfirmModal.svelte';
	import { personasStore } from '$lib/stores/personas.svelte.js';
	import { staggerOnMount } from '$lib/utils/staggerOnMount';

	interface Props {
		open: boolean;
		embedded?: boolean;
		selectedId?: number | null;
		oncreatenew?: () => void;
		onselect?: (id: number) => void;
		onclose: () => void;
	}

	let { open, embedded = false, selectedId = null, oncreatenew, onselect, onclose }: Props = $props();
	// Personas are read from the central store so add/edit/delete reflect
	// instantly without an invalidateAll() round-trip.
	const personas = $derived(personasStore.personas);
	let showCreateForm = $state(false);
	let editingId = $state<number | null>(null);
	let confirmDeleteId: number | null = $state(null);
	let confirmDeleteName = $state('');

	let name = $state('');
	let displayName = $state('');
	let description = $state('');
	let isDefault = $state(false);

	function resetForm() {
		name = '';
		displayName = '';
		description = '';
		isDefault = false;
	}

	async function createPersona() {
		if (!name.trim()) return;
		const forceDefault = personas.length === 0;

		const res = await fetch('/api/personas', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name, displayName, description, isDefault: forceDefault || isDefault })
		});

		if (res.ok) {
			showCreateForm = false;
			resetForm();
			const body = await res.json();
			if (Array.isArray(body?.personas)) personasStore.replaceAll(body.personas);
			else if (body?.id) personasStore.add(body);
		}
	}

	function startEdit(persona: any) {
		editingId = persona.id;
		name = persona.name;
		displayName = persona.displayName || '';
		description = persona.description || '';
		isDefault = !!persona.isDefault;
		showCreateForm = false;
	}

	async function saveEdit() {
		if (!editingId || !name.trim()) return;
		const res = await fetch(`/api/personas/${editingId}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name, displayName, description, isDefault })
		});
		if (res.ok) {
			const id = editingId;
			editingId = null;
			resetForm();
			const body = await res.json();
			if (Array.isArray(body?.personas)) personasStore.replaceAll(body.personas);
			else personasStore.update(id, { name, displayName, description, isDefault });
		}
	}

	async function deletePersona(id: number) {
		const res = await fetch(`/api/personas/${id}`, { method: 'DELETE' });
		if (res.ok) personasStore.remove(id);
	}

	function askDeletePersona(id: number, name: string) {
		confirmDeleteId = id;
		confirmDeleteName = name;
	}

	async function confirmDelete() {
		if (confirmDeleteId !== null) {
			await deletePersona(confirmDeleteId);
			confirmDeleteId = null;
			confirmDeleteName = '';
		}
	}

	async function setDefault(persona: any) {
		const res = await fetch(`/api/personas/${persona.id}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ ...persona, isDefault: true })
		});
		if (res.ok) {
			const body = await res.json();
			if (Array.isArray(body?.personas)) personasStore.replaceAll(body.personas);
			else personasStore.update(persona.id, { isDefault: true });
		}
	}

	const modal = createModalState(() => open && !embedded);
	const gestures = createModalGestures({ onclose: () => onclose(), modal });
</script>

{#if embedded && open}
	<!-- Embedded mode: sidebar list. Editing happens in the main pane. -->
	<div class="flex h-14 items-center justify-between px-5">
		<h1 class="text-2xl font-extrabold tracking-tight text-primary md:text-foreground">Personas</h1>
		<button
			onclick={() => oncreatenew?.()}
			class="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md shadow-primary/30 transition-transform hover:bg-primary/90 hover:scale-105 active:scale-95"
			title="New persona"
			aria-label="New persona"
		>
			<Plus class="h-4 w-4" />
		</button>
	</div>
	<nav class="flex-1 overflow-y-auto px-2 py-2">
		{#if personas.length === 0}
			<div class="flex flex-col items-center justify-center py-12 text-muted-foreground">
				<User class="mb-3 h-8 w-8 opacity-30" />
				<p class="text-sm">No personas yet</p>
				<p class="mt-1 text-xs">Tap + to create one</p>
			</div>
		{:else}
			<div class="flex flex-col gap-1.5">
				{#each personas as persona, i}
					<button
						onclick={() => onselect?.(persona.id)}
						use:staggerOnMount={{ index: i }}
						class="group flex items-center gap-3 rounded-xl px-4 py-3 text-left text-sm transition-colors
							{selectedId === persona.id
								? 'bg-primary/10 ring-1 ring-primary/30'
								: 'bg-accent/30 hover:bg-accent/60'}"
					>
						{#if persona.avatarPath}
							<img src={persona.avatarPath} alt="" class="h-9 w-9 shrink-0 rounded-full object-cover" />
						{:else}
							<div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full {persona.isDefault ? 'bg-primary/20 text-primary' : 'bg-secondary text-secondary-foreground'}">
								{#if persona.isDefault}
									<Star class="h-4 w-4" />
								{:else}
									<User class="h-4 w-4" />
								{/if}
							</div>
						{/if}
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								<span class="truncate font-medium">{persona.displayName || persona.name}</span>
								{#if persona.isDefault}
									<span class="shrink-0 rounded bg-primary/10 px-1 py-0.5 text-[10px] font-medium text-primary">Default</span>
								{/if}
							</div>
							<p class="truncate text-xs text-muted-foreground">{persona.name}</p>
						</div>
					</button>
				{/each}
			</div>
		{/if}
	</nav>
{:else if modal.visible}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4 bg-black/60 {modal.closing ? 'backdrop-exit' : 'backdrop-enter'}"
		role="dialog" aria-modal="true" aria-label="Personas" tabindex="-1"
		onkeydown={(e) => e.key === 'Escape' && onclose()}
	>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div class="absolute inset-0" onclick={onclose}></div>
		<div
			class="relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col rounded-t-2xl border border-border bg-card shadow-xl sm:rounded-xl {modal.closing ? 'modal-exit' : 'modal-enter'}"
			ontouchstart={gestures.handlers.onTouchStart}
			ontouchmove={gestures.handlers.onTouchMove}
			ontouchend={gestures.handlers.onTouchEnd}
			style={gestures.panelStyle}
		>
			<!-- Header -->
			<div class="flex items-center justify-between border-b border-border px-6 py-4">
				<h2 class="text-lg font-semibold">Personas</h2>
				<div class="flex items-center gap-2">
					<button
						onclick={() => (showCreateForm = !showCreateForm)}
						class="flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
					>
						<Plus class="h-4 w-4" />
						Create
					</button>
					<button
						onclick={onclose}
						class="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent"
					>
						<X class="h-4 w-4" />
					</button>
				</div>
			</div>

			<!-- Body -->
			<div class="flex-1 overflow-y-auto p-6">
				{#if showCreateForm}
					<div class="mb-6 rounded-xl border border-primary/20 bg-card p-4">
						<h3 class="mb-4 text-sm font-semibold">New Persona</h3>
						<div class="space-y-3">
							<div class="grid gap-3 sm:grid-cols-2">
								<div>
									<label for="persona-display" class="mb-1 block text-xs font-medium text-muted-foreground">Label</label>
									<input
										id="persona-display"
										bind:value={displayName}
										class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
										placeholder="e.g. My Fantasy Persona"
									/>
								</div>
								<div>
									<label for="persona-name" class="mb-1 block text-xs font-medium text-muted-foreground">In-Chat Name *</label>
									<input
										id="persona-name"
										bind:value={name}
										class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
										placeholder={"Name used for {{user}}"}
									/>
								</div>
							</div>
							<div>
								<label for="persona-desc" class="mb-1 block text-xs font-medium text-muted-foreground">Description</label>
								<textarea
									id="persona-desc"
									bind:value={description}
									rows={3}
									class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
									placeholder="Describe your persona (injected into context for the AI)"
								></textarea>
							</div>
							<label class="flex items-center gap-2 text-sm {personas.length === 0 ? 'opacity-50' : ''}">
								<input type="checkbox" checked={personas.length === 0 || isDefault} oninput={(e) => { if (personas.length > 0) isDefault = e.currentTarget.checked; }} class="rounded" disabled={personas.length === 0} />
								Set as default persona
							</label>
							<div class="flex justify-end gap-3 pt-1">
								<button
									onclick={() => {
										showCreateForm = false;
										resetForm();
									}}
									class="rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-accent"
								>
									Cancel
								</button>
								<button
									onclick={createPersona}
									disabled={!name.trim()}
									class="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
								>
									Create
								</button>
							</div>
						</div>
					</div>
				{/if}

				{#if personas.length === 0 && !showCreateForm}
					<div class="flex flex-col items-center justify-center py-12 text-muted-foreground">
						<User class="mb-4 h-12 w-12 opacity-30" />
						<p class="text-lg">No personas yet</p>
						<p class="mt-1 text-sm">Create a persona to set your name and description</p>
					</div>
				{:else}
					<div class="space-y-3">
						{#each personas as persona}
							<div
								class="flex items-start gap-3 rounded-xl border p-4 transition-colors {persona.isDefault
									? 'border-primary/40 bg-primary/5'
									: 'border-border bg-background'}"
							>
								<div
									class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full {persona.isDefault
										? 'bg-primary/20 text-primary'
										: 'bg-secondary text-secondary-foreground'}"
								>
									{#if persona.isDefault}
										<Star class="h-4 w-4" />
									{:else}
										<User class="h-4 w-4" />
									{/if}
								</div>
								{#if editingId === persona.id}
									<div class="min-w-0 flex-1 space-y-3">
										<div class="grid gap-3 sm:grid-cols-2">
											<div>
												<label for="edit-display" class="mb-1 block text-xs font-medium text-muted-foreground">Label</label>
												<input id="edit-display" bind:value={displayName} class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" placeholder="e.g. My Fantasy Persona" />
											</div>
											<div>
												<label for="edit-name" class="mb-1 block text-xs font-medium text-muted-foreground">In-Chat Name *</label>
												<input id="edit-name" bind:value={name} class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" placeholder={"Name used for {{user}}"} />
											</div>
										</div>
										<div>
											<label for="edit-desc" class="mb-1 block text-xs font-medium text-muted-foreground">Description</label>
											<textarea id="edit-desc" bind:value={description} rows={3} class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" placeholder="Describe your persona"></textarea>
										</div>
										<label class="flex items-center gap-2 text-sm">
											<input type="checkbox" bind:checked={isDefault} class="rounded" />
											Set as default persona
										</label>
										<div class="flex justify-end gap-3">
											<button onclick={() => { editingId = null; resetForm(); }} class="rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-accent">Cancel</button>
											<button onclick={saveEdit} disabled={!name.trim()} class="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50">Save</button>
										</div>
									</div>
								{:else}
									<div class="min-w-0 flex-1">
										<div class="flex items-center gap-2">
											<h3 class="font-semibold">{persona.displayName || persona.name}</h3>
											{#if persona.isDefault}
												<span class="rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">Default</span>
											{/if}
										</div>
										<p class="text-xs text-muted-foreground">In-chat: <span class="font-medium">{persona.name}</span></p>
										{#if persona.description}
											<p class="mt-1 line-clamp-5 whitespace-pre-wrap text-sm text-muted-foreground">{persona.description.replace(/\n\s*\n/g, '\n').trim()}</p>
										{/if}
									</div>
									<div class="flex shrink-0 items-center gap-1">
										{#if !persona.isDefault}
											<button
												onclick={() => setDefault(persona)}
												class="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
												title="Set as default"
											>
												<Star class="h-4 w-4" />
											</button>
										{/if}
										<button
											onclick={() => startEdit(persona)}
											class="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
											title="Edit persona"
										>
											<Pencil class="h-4 w-4" />
										</button>
										<button
											onclick={() => askDeletePersona(persona.id, persona.displayName || persona.name)}
											class="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/20 hover:text-destructive"
										>
											<Trash2 class="h-4 w-4" />
										</button>
									</div>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

<ConfirmModal
	open={confirmDeleteId !== null}
	title="Delete Persona"
	message={`Delete "${confirmDeleteName}"? This cannot be undone.`}
	onconfirm={confirmDelete}
	oncancel={() => { confirmDeleteId = null; confirmDeleteName = ''; }}
/>
