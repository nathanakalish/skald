/**
 * Reactive client-side mirror of the `characterLimitsEnabled` admin flag.
 *
 * The flag is loaded server-side in `+layout.server.ts` and pushed into this
 * store from `+layout.svelte`. Every consumer (LimitedInput, LimitedTextarea,
 * checkFieldLimits, checkAutoSaveLimit) reads `limitsState.enabled` so the
 * toggle has a single source of truth on the client. When the admin flips
 * it off, all overflow highlighting, the blocking modal, and the autosave
 * toast disappear together.
 *
 * Defaults to `true` so first paint matches the server's default while we
 * wait for `$page.data` to flow through.
 */
let _enabled = $state(true);

export const limitsState = {
	get enabled() {
		return _enabled;
	},
	set(value: boolean) {
		_enabled = value;
	},
};
