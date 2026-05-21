/**
 * Client-side PIN lock state.
 *
 * The server is the source of truth for *what* the PIN/policy is — this
 * store just tracks whether the UI is currently locked and arms the right
 * trigger (focus / open / inactivity).
 *
 * `locked` only gates the overlay; in-flight requests (e.g. an active
 * streaming response) continue uninterrupted. This is intentional — losing a
 * 30-second generation because someone glanced away would be a bad trade for
 * a feature that's just a prying-eyes guard.
 */

type PinPolicy = 'disabled' | 'on-focus' | 'on-open' | 'timeout';

interface PinLockState {
	enabled: boolean;
	policy: PinPolicy;
	timeoutMinutes: number | null;
	locked: boolean;
	lastActivity: number;
	/** Pending lock check token — used so a debounced timer can be cancelled. */
	timerId: ReturnType<typeof setTimeout> | null;
}

const state = $state<PinLockState>({
	enabled: false,
	policy: 'disabled',
	timeoutMinutes: null,
	locked: false,
	lastActivity: Date.now(),
	timerId: null
});

function scheduleTimeoutCheck() {
	if (state.timerId) {
		clearTimeout(state.timerId);
		state.timerId = null;
	}
	if (!state.enabled || state.policy !== 'timeout' || !state.timeoutMinutes) return;
	const dueAt = state.lastActivity + state.timeoutMinutes * 60_000;
	const delay = Math.max(1_000, dueAt - Date.now());
	state.timerId = setTimeout(() => {
		// Re-check at fire time — activity in the meantime would push dueAt out.
		if (!state.enabled || state.policy !== 'timeout' || !state.timeoutMinutes) return;
		if (Date.now() - state.lastActivity >= state.timeoutMinutes * 60_000) {
			state.locked = true;
		} else {
			scheduleTimeoutCheck();
		}
	}, delay);
}

export const pinLock = {
	get enabled() { return state.enabled; },
	get policy() { return state.policy; },
	get timeoutMinutes() { return state.timeoutMinutes; },
	get locked() { return state.locked; },

	/**
	 * Hydrate from SSR payload. Must be invoked *synchronously* during the
	 * layout script body (not inside $effect / onMount) so the locked state
	 * is set before the first render — otherwise SSR would emit the bare app
	 * shell and a snooper with element-blocker tools could see through.
	 */
	init(opts: { enabled: boolean; policy: PinPolicy; timeoutMinutes: number | null }) {
		state.enabled = opts.enabled;
		state.policy = opts.policy;
		state.timeoutMinutes = opts.timeoutMinutes;
		if (!opts.enabled) {
			state.locked = false;
		} else if (opts.policy === 'on-focus' || opts.policy === 'on-open') {
			// Any cold start (SSR or hard reload) is treated as "regaining
			// focus from nothing", so both of these policies start locked.
			// 'timeout' starts unlocked; the inactivity timer takes it from there.
			state.locked = true;
		}
		state.lastActivity = Date.now();
		scheduleTimeoutCheck();
	},

	/** Update policy after a settings change (no need to relock the user). */
	updatePolicy(opts: { enabled: boolean; policy: PinPolicy; timeoutMinutes: number | null }) {
		state.enabled = opts.enabled;
		state.policy = opts.policy;
		state.timeoutMinutes = opts.timeoutMinutes;
		if (!opts.enabled) state.locked = false;
		scheduleTimeoutCheck();
	},

	/** Called from layout focus/visibility/manual triggers. */
	lock() {
		if (!state.enabled) return;
		state.locked = true;
	},

	unlock() {
		state.locked = false;
		state.lastActivity = Date.now();
		scheduleTimeoutCheck();
	},

	/** Pure activity ping — resets the inactivity timer. */
	recordActivity() {
		state.lastActivity = Date.now();
		// We don't reschedule the timer on every event (would thrash); the
		// existing timer just re-checks on fire and reschedules if not idle yet.
	},

	/** Triggered when the window regains focus / tab becomes visible. */
	onAppForeground() {
		if (!state.enabled || state.locked) return;
		if (state.policy === 'on-focus' || state.policy === 'on-open') {
			state.locked = true;
		}
	},

	/** Triggered on first load / SPA cold-start. */
	onAppOpen() {
		if (!state.enabled || state.locked) return;
		if (state.policy === 'on-open') {
			state.locked = true;
		}
	}
};
