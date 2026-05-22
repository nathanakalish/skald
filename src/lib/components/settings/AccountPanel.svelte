<script lang="ts">
	import PinSettingsPanel from '$lib/components/settings/PinSettingsPanel.svelte';
	import SignedInDevices from '$lib/components/settings/SignedInDevices.svelte';

	interface Props {
		user: { id: number; username: string; role: string } | null;
	}
	let { user }: Props = $props();
</script>

<div class="space-y-6">
	<div>
		<h3 class="text-base font-semibold">Account</h3>
		<p class="text-sm text-muted-foreground">Manage your account settings</p>
	</div>

	<div class="rounded-xl border border-border p-4">
		<div class="flex items-center gap-3">
			<div class="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-base font-semibold text-primary">
				{user?.username?.[0]?.toUpperCase() ?? '?'}
			</div>
			<div>
				<p class="font-medium">{user?.username}</p>
				<div class="flex items-center gap-2 text-xs text-muted-foreground">
					<span class="capitalize">{user?.role}</span>
				</div>
			</div>
		</div>
	</div>

	<PinSettingsPanel />

	<SignedInDevices />
</div>
