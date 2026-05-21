<script lang="ts">
	import { tooltip } from '$lib/tooltip.js';
	import { onMount } from 'svelte';
	import { Pencil, Trash2, Plus, Shield, KeyRound } from 'lucide-svelte';
	import LimitedInput from '$lib/components/LimitedInput.svelte';
	import { checkFieldLimits } from '$lib/limitCheck.js';
	import { FIELD_LIMITS } from '$lib/fieldLimits.js';

	interface Props {
		currentUserId?: number;
	}

	let { currentUserId }: Props = $props();

	let userList = $state<any[]>([]);
	let userListLoading = $state(false);
	let showCreateUser = $state(false);
	let newUsername = $state('');
	let newRole = $state<'user' | 'admin'>('user');
	let createUserError = $state('');
	let editingUserId = $state<number | null>(null);
	let editUsername = $state('');
	let editRole = $state<'user' | 'admin'>('user');
	let editUserError = $state('');
	let confirmDeleteUserId = $state<number | null>(null);
	let confirmDeleteUsername = $state('');
	let adminCount = $derived(userList.filter((u: any) => u.role === 'admin').length);
	let editIsLastAdmin = $derived(
		editingUserId !== null && adminCount <= 1 && userList.find((u: any) => u.id === editingUserId)?.role === 'admin'
	);

	async function loadUsers() {
		userListLoading = true;
		try {
			const res = await fetch('/api/admin/users');
			if (res.ok) userList = await res.json();
		} finally {
			userListLoading = false;
		}
	}

	onMount(() => {
		loadUsers();
	});

	async function createUser() {
		createUserError = '';
		const ok = await checkFieldLimits([
			{ label: 'Username', value: newUsername, limit: FIELD_LIMITS.username, trim: (v) => (newUsername = v) },
		]);
		if (!ok) return;
		const res = await fetch('/api/admin/users', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username: newUsername.trim(), role: newRole })
		});
		if (!res.ok) {
			const data = await res.json();
			createUserError = data.error || 'Failed to create user';
			return;
		}
		newUsername = '';
		newRole = 'user';
		showCreateUser = false;
		await loadUsers();
	}

	function startEditUser(u: any) {
		editingUserId = u.id;
		editUsername = u.username;
		editRole = u.role;
		editUserError = '';
	}

	function cancelEditUser() {
		editingUserId = null;
		editUserError = '';
	}

	async function saveEditUser() {
		if (editingUserId === null) return;
		editUserError = '';
		const ok = await checkFieldLimits([
			{ label: 'Username', value: editUsername, limit: FIELD_LIMITS.username, trim: (v) => (editUsername = v) },
		]);
		if (!ok) return;
		const body: Record<string, string> = { username: editUsername.trim(), role: editRole };
		const res = await fetch(`/api/admin/users/${editingUserId}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
		if (!res.ok) {
			const data = await res.json();
			editUserError = data.error || 'Failed to update user';
			return;
		}
		editingUserId = null;
		await loadUsers();
	}

	function requestDeleteUser(id: number, username: string) {
		confirmDeleteUserId = id;
		confirmDeleteUsername = username;
	}

	async function confirmDeleteUser() {
		if (confirmDeleteUserId === null) return;
		await fetch(`/api/admin/users/${confirmDeleteUserId}`, { method: 'DELETE' });
		confirmDeleteUserId = null;
		confirmDeleteUsername = '';
		await loadUsers();
	}

	function cancelDeleteUser() {
		confirmDeleteUserId = null;
		confirmDeleteUsername = '';
	}

	let confirmClearPinUserId = $state<number | null>(null);
	let confirmClearPinUsername = $state('');

	function requestClearPin(id: number, username: string) {
		confirmClearPinUserId = id;
		confirmClearPinUsername = username;
	}

	async function confirmClearPin() {
		if (confirmClearPinUserId === null) return;
		await fetch(`/api/admin/users/${confirmClearPinUserId}/pin`, { method: 'DELETE' });
		confirmClearPinUserId = null;
		confirmClearPinUsername = '';
		await loadUsers();
	}

	function cancelClearPin() {
		confirmClearPinUserId = null;
		confirmClearPinUsername = '';
	}
</script>

<div class="space-y-4">
	<div class="flex items-center justify-between">
		<div>
			<h3 class="text-base font-semibold">User Management</h3>
			<p class="text-sm text-muted-foreground">Create and manage user accounts</p>
		</div>
		<button
			onclick={() => { showCreateUser = !showCreateUser; createUserError = ''; }}
			class="flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
		>
			<Plus class="h-4 w-4" />
			Add User
		</button>
	</div>

	{#if showCreateUser}
		<div class="rounded-xl border-2 border-dashed border-primary/30 bg-background p-4">
			<div class="space-y-3">
				<div>
					<span class="mb-1 block text-xs font-medium text-muted-foreground">Username</span>
					<LimitedInput
						bind:value={newUsername}
						limit={FIELD_LIMITS.username}
						class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
						placeholder="username"
						autocomplete="off"
					/>
				</div>
				<div>
					<span class="mb-1 block text-xs font-medium text-muted-foreground">Role</span>
					<div class="flex gap-2">
						<button
							onclick={() => (newRole = 'user')}
							class="flex-1 rounded-lg border px-3 py-1.5 text-sm {newRole === 'user' ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-accent'}"
						>User</button>
						<button
							onclick={() => (newRole = 'admin')}
							class="flex-1 rounded-lg border px-3 py-1.5 text-sm {newRole === 'admin' ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-accent'}"
						>Admin</button>
					</div>
				</div>
				{#if createUserError}
					<p class="text-sm text-destructive">{createUserError}</p>
				{/if}
				<div class="flex justify-end gap-2">
					<button
						onclick={() => { showCreateUser = false; createUserError = ''; }}
						class="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent"
					>Cancel</button>
					<button
						onclick={createUser}
						disabled={!newUsername.trim()}
						class="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
					>Create User</button>
				</div>
			</div>
		</div>
	{/if}

	{#if userListLoading}
		<div class="flex justify-center py-8">
			<div class="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
		</div>
	{:else}
		<div class="space-y-2">
			{#each userList as u (u.id)}
				{#if editingUserId === u.id}
					<!-- Edit form -->
					<div class="rounded-xl border-2 border-primary/30 bg-primary/5 p-4">
						<div class="space-y-3">
							<div>
								<span class="mb-1 block text-xs font-medium text-muted-foreground">Username</span>
								<LimitedInput
									bind:value={editUsername}
									limit={FIELD_LIMITS.username}
									class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
									autocomplete="off"
								/>
							</div>
							<div>
								<span class="mb-1 block text-xs font-medium text-muted-foreground">Role</span>
								<div class="flex gap-2">
									<button
										onclick={() => { if (!editIsLastAdmin) editRole = 'user'; }}
										disabled={editIsLastAdmin}
										class="flex-1 rounded-lg border px-3 py-1.5 text-sm {editRole === 'user' ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-accent'} {editIsLastAdmin ? 'opacity-40 cursor-not-allowed' : ''}"
										use:tooltip={editIsLastAdmin ? 'Cannot remove the last admin' : ''}
									>User</button>
									<button
										onclick={() => (editRole = 'admin')}
										class="flex-1 rounded-lg border px-3 py-1.5 text-sm {editRole === 'admin' ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-accent'}"
									>Admin</button>
								</div>
								{#if editIsLastAdmin}
									<p class="mt-1 text-xs text-amber-500">At least one admin account is required</p>
								{/if}
							</div>
							{#if editUserError}
								<p class="text-sm text-destructive">{editUserError}</p>
							{/if}
							<div class="flex justify-end gap-2">
								<button
									onclick={cancelEditUser}
									class="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent"
								>Cancel</button>
								<button
									onclick={saveEditUser}
									disabled={!editUsername.trim()}
									class="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
								>Save Changes</button>
							</div>
						</div>
					</div>
				{:else}
					<!-- Display row -->
					<div class="group flex items-center gap-3 rounded-xl border border-border p-3.5 transition-all hover:border-primary/20 hover:bg-accent/50">
						<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
							{u.username[0].toUpperCase()}
						</div>
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2 flex-wrap">
								<span class="font-medium">{u.username}</span>
								{#if u.role === 'admin'}
									<span class="flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
										<Shield class="h-3 w-3" />
										Admin
									</span>
								{:else}
									<span class="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">User</span>
								{/if}
								{#if u.id === currentUserId}
									<span class="text-xs text-muted-foreground">(you)</span>
								{/if}
							</div>
							<p class="text-xs text-muted-foreground">Created {new Date(u.createdAt).toLocaleDateString()}</p>
						</div>
						<div class="flex shrink-0 gap-1">
							<button
								onclick={() => startEditUser(u)}
								class="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
								use:tooltip={'Edit user'}
							>
								<Pencil class="h-4 w-4" />
							</button>
							{#if u.hasPin}
								<button
									onclick={() => requestClearPin(u.id, u.username)}
									class="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
									use:tooltip={'Clear PIN'}
								>
									<KeyRound class="h-4 w-4" />
								</button>
							{/if}
							{#if u.id !== currentUserId}
								<button
									onclick={() => requestDeleteUser(u.id, u.username)}
									class="rounded-lg p-2 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
									use:tooltip={'Delete user'}
								>
									<Trash2 class="h-4 w-4" />
								</button>
							{/if}
						</div>
					</div>
				{/if}
			{/each}
		</div>
	{/if}
</div>

<!-- User delete confirmation -->
{#if confirmDeleteUserId !== null}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
		onkeydown={(e) => e.key === 'Escape' && cancelDeleteUser()}
	>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div class="absolute inset-0" onclick={cancelDeleteUser}></div>
		<div class="relative z-10 w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-xl">
			<h3 class="text-base font-semibold">Delete User</h3>
			<p class="mt-2 text-sm text-muted-foreground">Are you sure you want to delete <strong>{confirmDeleteUsername}</strong>? All their data (characters, chats, etc.) will be permanently deleted.</p>
			<div class="mt-4 flex justify-end gap-2">
				<button
					onclick={cancelDeleteUser}
					class="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent"
				>Cancel</button>
				<button
					onclick={confirmDeleteUser}
					class="rounded-lg bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
				>Delete</button>
			</div>
		</div>
	</div>
{/if}

<!-- Clear PIN confirmation -->
{#if confirmClearPinUserId !== null}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
		onkeydown={(e) => e.key === 'Escape' && cancelClearPin()}
	>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div class="absolute inset-0" onclick={cancelClearPin}></div>
		<div class="relative z-10 w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-xl">
			<h3 class="text-base font-semibold">Clear PIN</h3>
			<p class="mt-2 text-sm text-muted-foreground">Remove the PIN lock for <strong>{confirmClearPinUsername}</strong>? They'll have to set a new one if they want the lock back.</p>
			<div class="mt-4 flex justify-end gap-2">
				<button
					onclick={cancelClearPin}
					class="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent"
				>Cancel</button>
				<button
					onclick={confirmClearPin}
					class="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
				>Clear PIN</button>
			</div>
		</div>
	</div>
{/if}
