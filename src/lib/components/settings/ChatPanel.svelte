<script lang="ts">
	// Chat behavior + regex scripts. Reads/writes settingsStore directly —
	// no prop drilling needed since every field here lives in the user
	// settings bag.
	import ToggleSwitch from '$lib/components/settings/ToggleSwitch.svelte';
	import SettingRow from '$lib/components/settings/SettingRow.svelte';
	import RegexScriptsPanel from '$lib/components/settings/RegexScriptsPanel.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte.js';
	import { toasts } from '$lib/stores/toast.svelte.js';

	interface Props {
		// Lets the regex sub-panel lazy-load when this tab is shown.
		active: boolean;
	}
	let { active }: Props = $props();

	const s = $derived(settingsStore.settings);

	async function save(key: string, value: string | boolean | number) {
		const ok = await settingsStore.save(key as any, value);
		if (ok) toasts.success('Setting saved');
	}

	async function toggle(key: keyof typeof s) {
		await save(String(key), !s[key]);
	}

	const TIMESTAMPS = [
		{ value: 'relative', label: 'Relative' },
		{ value: 'absolute', label: 'Absolute' },
		{ value: 'off', label: 'Off' }
	];
	const AUTOSCROLL = [
		{ value: 'tight', label: 'Tight' },
		{ value: 'normal', label: 'Normal' },
		{ value: 'relaxed', label: 'Relaxed' }
	];
	const PAGE_SIZES = [
		{ value: '25', label: '25' },
		{ value: '50', label: '50' },
		{ value: '100', label: '100' },
		{ value: '200', label: '200' },
		{ value: '0', label: 'All' }
	];
</script>

<div class="space-y-6">
	<div>
		<h3 class="text-base font-semibold">Chat</h3>
		<p class="text-sm text-muted-foreground">Customize chat behavior and display</p>
	</div>

	<!-- Boolean toggles side-by-side on wider screens — they're all short
	     descriptions so two columns stays readable. -->
	<div class="grid gap-4 sm:grid-cols-2">
		<ToggleSwitch
			label="Send with Enter (Desktop)"
			description="Press Enter to send on desktop. When off, use Shift+Enter or the send button."
			checked={s.sendWithEnterDesktop}
			onchange={() => toggle('sendWithEnterDesktop')}
		/>
		<ToggleSwitch
			label="Send with Enter (Mobile)"
			description="Press Enter to send on mobile. When off, use the send button."
			checked={s.sendWithEnterMobile}
			onchange={() => toggle('sendWithEnterMobile')}
		/>
		<ToggleSwitch
			label="Confirm deletions"
			description="Show a confirmation dialog before deleting chats and messages."
			checked={s.confirmDeletions}
			onchange={() => toggle('confirmDeletions')}
		/>
		<ToggleSwitch
			label="Auto-show reasoning"
			description="Automatically open the reasoning panel when model reasoning is available."
			checked={s.showReasoning}
			onchange={() => toggle('showReasoning')}
		/>
		<ToggleSwitch
			label="Auto-load earlier messages"
			description="When scrolling near the top, automatically fetch the next batch instead of waiting for a click."
			checked={s.autoLoadEarlierMessages}
			onchange={() => toggle('autoLoadEarlierMessages')}
		/>
	</div>

	<!-- Button-group settings: two-up on wider screens. -->
	<div class="grid gap-6 sm:grid-cols-2">
		<SettingRow
			label="Message timestamps"
			description={s.messageTimestamps === 'relative' ? '"Today", "Yesterday", etc.' : s.messageTimestamps === 'absolute' ? 'Shows exact date and time.' : 'Hides date separators.'}
		>
			<div class="flex gap-2">
				{#each TIMESTAMPS as opt}
					<button
						onclick={() => save('messageTimestamps', opt.value)}
						class="flex-1 rounded-lg border px-3 py-1.5 text-sm {s.messageTimestamps === opt.value ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-accent'}"
					>{opt.label}</button>
				{/each}
			</div>
		</SettingRow>

		<SettingRow
			label="Auto-scroll sensitivity"
			description="How close to the bottom you need to be for new messages to auto-scroll into view."
		>
			<div class="flex gap-2">
				{#each AUTOSCROLL as opt}
					<button
						onclick={() => save('autoScrollThreshold', opt.value)}
						class="flex-1 rounded-lg border px-3 py-1.5 text-sm {s.autoScrollThreshold === opt.value ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-accent'}"
					>{opt.label}</button>
				{/each}
			</div>
		</SettingRow>
	</div>

	<SettingRow
		label="Messages per page"
		description="How many messages to load initially. Older messages can be loaded on demand by scrolling up."
	>
		<div class="flex gap-2">
			{#each PAGE_SIZES as opt}
				<button
					onclick={() => save('chatPageSize', opt.value)}
					class="flex-1 rounded-lg border px-3 py-1.5 text-sm {String(s.chatPageSize) === opt.value ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-accent'}"
				>{opt.label}</button>
			{/each}
		</div>
	</SettingRow>

	<div class="border-t border-border pt-6">
		<RegexScriptsPanel {active} />
	</div>
</div>
