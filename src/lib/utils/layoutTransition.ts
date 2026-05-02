// Shared "is the layout currently transitioning between breakpoints?"
// flag used by entrance-animation gates so they can skip the initial
// reveal when components remount as part of a breakpoint cross.
//
// Implemented as a tiny module-level box rather than a Svelte store so
// it can be read from both Svelte action callbacks and component
// $derived expressions.

let _transitioning = false;
const subs = new Set<() => void>();

export const layoutTransitionState = {
	get value() {
		return _transitioning;
	},
	set(v: boolean) {
		if (_transitioning === v) return;
		_transitioning = v;
		for (const s of subs) s();
	},
	subscribe(fn: () => void) {
		subs.add(fn);
		return () => subs.delete(fn);
	}
};
