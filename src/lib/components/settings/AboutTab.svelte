<script lang="ts">
	import { RefreshCw } from 'lucide-svelte';
	import { api } from '$lib/api.js';

	type VersionInfo = {
		current: string;
		latest: string | null;
		updateAvailable: boolean;
		repoUrl: string | null;
	};

	let versionInfo: VersionInfo | null = $state(null);
	let checkingVersion = $state(false);

	async function checkForUpdates() {
		checkingVersion = true;
		const data = await api<VersionInfo>('/api/version', { silent: true });
		if (data) versionInfo = data;
		checkingVersion = false;
	}
</script>

<!-- About Tab -->
<div class="space-y-6">
	<div>
		<h3 class="text-base font-semibold">About Skald</h3>
		<p class="text-sm text-muted-foreground">Version information and updates</p>
	</div>

	<!-- Version -->
	<div class="rounded-xl border border-border p-5">
		<div class="flex items-center gap-3">
			<div class="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
				<span class="text-2xl font-bold text-primary">S</span>
			</div>
			<div>
				<h4 class="text-lg font-semibold">Skald</h4>
				<p class="text-sm text-muted-foreground">v{__APP_VERSION__}</p>
			</div>
		</div>
	</div>

	<!-- Check for Updates -->
	<div class="space-y-3">
		<button
			onclick={checkForUpdates}
			disabled={checkingVersion}
			class="flex items-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50"
		>
			<RefreshCw class="h-4 w-4 {checkingVersion ? 'animate-spin' : ''}" />
			{checkingVersion ? 'Checking...' : 'Check for Updates'}
		</button>

		{#if versionInfo}
			{#if versionInfo.updateAvailable}
				<div class="rounded-lg border border-primary/30 bg-primary/5 p-4">
					<p class="text-sm font-medium text-primary">Update available: v{versionInfo.latest}</p>
					<p class="mt-1 text-xs text-muted-foreground">
						You're running v{versionInfo.current}. Pull the latest image and recreate your container to update:
					</p>
					<code class="mt-2 block rounded bg-muted px-3 py-2 text-xs text-foreground">docker compose pull && docker compose up -d</code>
					{#if versionInfo.repoUrl}
						<a
							href={versionInfo.repoUrl}
							target="_blank"
							rel="noopener noreferrer"
							class="mt-2 inline-block text-xs font-medium text-primary hover:underline"
						>View on GitHub →</a>
					{/if}
				</div>
			{:else if versionInfo.latest}
				<div class="rounded-lg border border-border bg-muted/30 p-4">
					<p class="text-sm font-medium text-foreground">You're up to date!</p>
					<p class="mt-1 text-xs text-muted-foreground">v{versionInfo.current} is the latest version.</p>
				</div>
			{:else}
				<div class="rounded-lg border border-warning/30 bg-warning/5 p-4">
					<p class="text-sm font-medium text-foreground">Unable to check for updates</p>
					<p class="mt-1 text-xs text-muted-foreground">Could not reach GitHub. If this is a private repo, set the GITHUB_TOKEN environment variable.</p>
				</div>
			{/if}
		{/if}
	</div>

	<!-- Info -->
	<div class="space-y-2 text-xs text-muted-foreground">
		<p>Skald is a self-hosted AI character chat application.</p>
		<p>Deployed via Docker — updates are applied by pulling the latest image.</p>
		<a
			href="https://github.com/nathanakalish/skald"
			target="_blank"
			rel="noopener noreferrer"
			class="inline-block text-primary hover:underline"
		>GitHub Repository →</a>
	</div>
</div>
