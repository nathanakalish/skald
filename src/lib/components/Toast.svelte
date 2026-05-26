<script lang="ts">
	import { toasts, type ToastItem } from '$lib/stores/toast.svelte.js';
	import NotificationCard from './NotificationCard.svelte';

	function accentForSimple(type: 'success' | 'error' | 'info') {
		return type === 'success' ? 'success' as const
			: type === 'error' ? 'error' as const
			: 'info' as const;
	}
	function iconForSimple(type: 'success' | 'error' | 'info') {
		return type === 'success' ? 'check' as const
			: type === 'error' ? 'error' as const
			: 'info' as const;
	}
</script>

<!--
  Single overlay for every transient notification: "Reconnected to server",
  "Chat renamed", and the in-app new-message toasts. Stacking them in one
  fixed column at the top-right keeps them from fighting the same screen
  real estate.
-->
{#if toasts.all.length > 0}
	<div
		class="fixed right-4 z-[200] flex flex-col items-end gap-2 md:right-6 md:top-6"
		style="top: max(1rem, calc(var(--safe-area-top) + 0.5rem));"
		role="region"
		aria-label="Notifications"
	>
		{#each toasts.all as t (t.id)}
			<div
				onmouseenter={() => toasts.pause(t.id)}
				onmouseleave={() => toasts.resume(t.id)}
				role="presentation"
			>
				{#if t.kind === 'simple'}
					<NotificationCard
						accent={accentForSimple(t.type)}
						iconName={iconForSimple(t.type)}
						title={t.message}
						onclick={t.onclick ? () => { t.onclick!(); toasts.remove(t.id); } : null}
						ondismiss={() => toasts.remove(t.id)}
					/>
				{:else}
					<NotificationCard
						accent="primary"
						iconName="message"
						avatarUrl={t.characterAvatar}
						title={t.characterName}
						body={t.preview}
						onclick={t.onclick ? () => { t.onclick!(t.chatId); toasts.remove(t.id); } : null}
						ondismiss={() => toasts.remove(t.id)}
					/>
				{/if}
			</div>
		{/each}
	</div>
{/if}
