<script lang="ts">
	import { Plus, Pencil, Trash2, Copy, GripVertical } from 'lucide-svelte';
	import { providersStore } from '$lib/stores/providers.svelte.js';
	import { haptic } from '$lib/utils/haptics.js';
	import ProviderEditModal from '$lib/components/ProviderEditModal.svelte';

	interface Props {
		providers: any[];
	}

	let { providers }: Props = $props();

	// Provider modal state
	let editingProvider = $state<any | null>(null);
	let showProviderModal = $state(false);

	function openEditProvider(provider: any) {
		editingProvider = provider;
		showProviderModal = true;
	}

	function openNewProvider() {
		editingProvider = null;
		showProviderModal = true;
	}

	function closeProviderModal() {
		showProviderModal = false;
		editingProvider = null;
	}

	async function setDefaultProvider(id: number) {
		for (const p of providers) {
			const res = await fetch(`/api/providers/${p.id}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ...p, enabled: p.id === id })
			});
			if (res.ok) {
				const body = await res.json().catch(() => null);
				if (body?.provider) providersStore.upsert(body.provider);
			}
		}
	}

	async function cloneProvider(provider: any) {
		const res = await fetch('/api/providers', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				...provider,
				id: undefined,
				name: `${provider.name} (Copy)`,
				enabled: false
			})
		});
		if (res.ok) {
			const body = await res.json().catch(() => null);
			if (body?.id) providersStore.add(body);
			else await providersStore.load(true);
		}
	}

	// Delete confirmation state
	let confirmDeleteId: number | null = $state(null);
	let confirmDeleteName = $state('');

	function requestDeleteProvider(id: number, name: string, e?: MouseEvent) {
		if (e) e.stopPropagation();
		confirmDeleteId = id;
		confirmDeleteName = name;
	}

	async function confirmDeleteProvider() {
		if (confirmDeleteId === null) return;
		const res = await fetch(`/api/providers/${confirmDeleteId}`, { method: 'DELETE' });
		if (res.ok) providersStore.remove(confirmDeleteId);
		confirmDeleteId = null;
		confirmDeleteName = '';
	}

	function cancelDeleteProvider() {
		confirmDeleteId = null;
		confirmDeleteName = '';
	}

	// Drag-to-reorder state
	let dragProviderId: number | null = $state(null);
	let dragOverProviderId: number | null = $state(null);
	let dropPosition: 'above' | 'below' = $state('below');
	let touchDragProviderId: number | null = $state(null);
	let touchLongPressTimer: ReturnType<typeof setTimeout> | null = null;
	let touchStartY = 0;
	let didTouchDrag = false;

	function getDropPosition(clientY: number, targetEl: HTMLElement): 'above' | 'below' {
		const rect = targetEl.getBoundingClientRect();
		return clientY < rect.top + rect.height / 2 ? 'above' : 'below';
	}

	function handleProviderDragStart(id: number, e: DragEvent) {
		dragProviderId = id;
		if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
	}

	function handleProviderDragOver(id: number, e: DragEvent) {
		e.preventDefault();
		dragOverProviderId = id;
		dropPosition = getDropPosition(e.clientY, e.currentTarget as HTMLElement);
	}

	async function handleProviderDrop(targetId: number, e: DragEvent) {
		e.preventDefault();
		if (dragProviderId && dragProviderId !== targetId) {
			await performProviderReorder(dragProviderId, targetId, dropPosition);
		}
		dragProviderId = null;
		dragOverProviderId = null;
	}

	function handleProviderDragEnd() {
		dragProviderId = null;
		dragOverProviderId = null;
	}

	function handleProviderTouchStart(id: number, e: TouchEvent) {
		touchStartY = e.touches[0].clientY;
		didTouchDrag = false;
		touchLongPressTimer = setTimeout(() => {
			touchDragProviderId = id;
			dragProviderId = id;
			didTouchDrag = true;
			haptic('heavy');
		}, 400);
	}

	function handleProviderTouchMove(e: TouchEvent) {
		if (!touchDragProviderId && touchLongPressTimer) {
			if (Math.abs(e.touches[0].clientY - touchStartY) > 10) {
				clearTimeout(touchLongPressTimer);
				touchLongPressTimer = null;
			}
			return;
		}
		if (!touchDragProviderId) return;
		e.preventDefault();

		const touch = e.touches[0];
		const elements = document.elementsFromPoint(touch.clientX, touch.clientY);
		for (const el of elements) {
			const provEl = (el as HTMLElement).closest('[data-provider-id]') as HTMLElement | null;
			if (provEl) {
				const overId = Number(provEl.dataset.providerId);
				if (overId !== touchDragProviderId) {
					dragOverProviderId = overId;
					dropPosition = getDropPosition(touch.clientY, provEl);
				}
				break;
			}
		}
	}

	function handleProviderTouchEnd() {
		if (touchLongPressTimer) {
			clearTimeout(touchLongPressTimer);
			touchLongPressTimer = null;
		}
		if (touchDragProviderId && dragOverProviderId) {
			performProviderReorder(touchDragProviderId, dragOverProviderId, dropPosition);
		}
		touchDragProviderId = null;
		dragProviderId = null;
		dragOverProviderId = null;
	}

	async function performProviderReorder(fromId: number, toId: number, pos: 'above' | 'below') {
		if (fromId === toId) return;
		const list = providers ?? [];
		const dragIdx = list.findIndex((p: any) => p.id === fromId);
		let targetIdx = list.findIndex((p: any) => p.id === toId);
		if (dragIdx === -1 || targetIdx === -1) return;

		const reordered = [...list];
		const [moved] = reordered.splice(dragIdx, 1);
		if (dragIdx < targetIdx) targetIdx--;
		const insertIdx = pos === 'below' ? targetIdx + 1 : targetIdx;
		reordered.splice(insertIdx, 0, moved);

		const order = reordered.map((p: any) => p.id);
		await fetch('/api/providers/reorder', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ order })
		});
		await providersStore.load(true);
	}
</script>

<div class="space-y-4">
	<div class="flex items-center justify-between">
		<div>
			<h3 class="text-base font-semibold">LLM Providers</h3>
			<p class="text-sm text-muted-foreground">Configure your AI model providers</p>
		</div>
		<button
			onclick={openNewProvider}
			class="flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
		>
			<Plus class="h-4 w-4" />
			Add Provider
		</button>
	</div>

	{#if (providers ?? []).length === 0}
		<div class="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground">
			<p>No providers configured yet.</p>
			<p class="mt-1 text-sm">Add a provider to start chatting.</p>
		</div>
	{/if}

	<div class="space-y-2">
		{#each providers ?? [] as provider (provider.id)}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<div
				data-provider-id={provider.id}
				ondragover={(e) => handleProviderDragOver(provider.id, e)}
				ondrop={(e) => handleProviderDrop(provider.id, e)}
				class="group flex items-center gap-3 rounded-xl border p-3.5 transition-all
					{provider.enabled ? 'border-primary/30 bg-primary/5' : 'border-border bg-background hover:border-primary/20 hover:bg-accent/50'}
					{dragProviderId === provider.id ? 'opacity-40' : ''}
					{dragOverProviderId === provider.id && dropPosition === 'above' ? 'border-t-4 border-t-primary' : ''}
					{dragOverProviderId === provider.id && dropPosition === 'below' ? 'border-b-4 border-b-primary' : ''}"
			>
				<!-- Drag handle -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					draggable="true"
					ondragstart={(e) => handleProviderDragStart(provider.id, e)}
					ondragend={handleProviderDragEnd}
					ontouchstart={(e) => handleProviderTouchStart(provider.id, e)}
					ontouchmove={handleProviderTouchMove}
					ontouchend={handleProviderTouchEnd}
					class="-ml-1.5 flex shrink-0 cursor-grab items-center px-1.5 py-2 text-muted-foreground/40 transition-colors hover:text-muted-foreground active:cursor-grabbing"
				>
					<GripVertical class="h-5 w-5" />
				</div>

				<!-- Default radio -->
				<button
					onclick={(e) => { e.stopPropagation(); setDefaultProvider(provider.id); }}
					class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 {provider.enabled ? 'border-primary' : 'border-muted-foreground/40'}"
					title={provider.enabled ? 'Default provider' : 'Set as default'}
				>
					{#if provider.enabled}
						<span class="h-2 w-2 rounded-full bg-primary"></span>
					{/if}
				</button>

				<!-- Info (clickable to edit) -->
				<div class="min-w-0 flex-1 cursor-pointer" onclick={() => openEditProvider(provider)}>
					<div class="flex items-center gap-2">
						<span class="font-medium">{provider.name}</span>
						<span class="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">{provider.type}</span>
						{#if provider.enabled}
							<span class="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">Default</span>
						{/if}
					</div>
					<p class="mt-0.5 truncate text-xs text-muted-foreground">
						{provider.defaultModel || 'No model selected'}
					</p>
				</div>

				<!-- Action buttons -->
				<div class="flex shrink-0 gap-1">
					<button
						onclick={(e) => { e.stopPropagation(); cloneProvider(provider); }}
						class="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
						title="Clone provider"
					>
						<Copy class="h-3.5 w-3.5" />
					</button>
					<button
						onclick={(e) => { e.stopPropagation(); openEditProvider(provider); }}
						class="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
						title="Edit provider"
					>
						<Pencil class="h-3.5 w-3.5" />
					</button>
					<button
						onclick={(e) => requestDeleteProvider(provider.id, provider.name, e)}
						class="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
						title="Delete provider"
					>
						<Trash2 class="h-3.5 w-3.5" />
					</button>
				</div>
			</div>
		{/each}
	</div>
</div>

<ProviderEditModal
	open={showProviderModal}
	provider={editingProvider}
	onclose={closeProviderModal}
/>

<!-- Delete confirmation dialog -->
{#if confirmDeleteId !== null}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
		onkeydown={(e) => e.key === 'Escape' && cancelDeleteProvider()}
	>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div class="absolute inset-0" onclick={cancelDeleteProvider}></div>
		<div class="relative z-10 w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-xl">
			<h3 class="text-base font-semibold">Delete Provider</h3>
			<p class="mt-2 text-sm text-muted-foreground">Are you sure you want to delete <strong>{confirmDeleteName}</strong>? This cannot be undone.</p>
			<div class="mt-4 flex justify-end gap-2">
				<button
					onclick={cancelDeleteProvider}
					class="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent"
				>Cancel</button>
				<button
					onclick={confirmDeleteProvider}
					class="rounded-lg bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
				>Delete</button>
			</div>
		</div>
	</div>
{/if}
