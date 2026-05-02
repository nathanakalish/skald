<script lang="ts">
	type OidcLike = { openPopup: () => void; devSignIn: () => void; error: string | null };

	let { oidcEnabled, devAuthEnabled, oidc }: {
		oidcEnabled: boolean;
		devAuthEnabled: boolean;
		oidc: OidcLike;
	} = $props();
</script>

<div class="flex min-h-dvh items-center justify-center bg-background p-4">
	<div class="w-full max-w-sm space-y-6">
		<div class="text-center">
			<h1 class="text-3xl font-bold text-primary">Skald</h1>
			<p class="mt-2 text-sm text-muted-foreground">Sign in to continue</p>
		</div>
		{#if oidcEnabled}
		<button type="button" onclick={oidc.openPopup} class="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium text-foreground shadow-lg transition-colors hover:bg-accent">
			<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
			Sign in with SSO
		</button>
		{:else}
		<div class="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground shadow-lg">
			OIDC is not configured on this server. Set <code class="text-foreground">OIDC_ISSUER_URL</code> and <code class="text-foreground">OIDC_CLIENT_ID</code> in the server environment to enable sign-in.
		</div>
		{/if}
		{#if devAuthEnabled}
		<button type="button" onclick={oidc.devSignIn} class="flex w-full items-center justify-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm font-medium text-amber-200 shadow-lg transition-colors hover:bg-amber-500/20">
			Dev sign-in (bypass)
		</button>
		{/if}
		{#if oidc.error}
		<div class="rounded-lg bg-destructive/10 px-3 py-2 text-center text-sm text-destructive">{oidc.error}</div>
		{/if}
	</div>
</div>
