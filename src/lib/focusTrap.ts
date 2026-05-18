/**
 * Keep Tab / Shift+Tab inside `node` while the dialog is open so keyboard
 * users can't accidentally tab into the page underneath. Restores focus to
 * whatever was focused before the trap mounted on destroy.
 *
 * Extracted from Modal.svelte so heavyweight modals (Settings, CharacterEdit,
 * etc.) that ship their own portal/animation shell can opt in to the same
 * trap. See audit FRONT-M3.
 */
export function focusTrap(node: HTMLElement) {
	const selector =
		'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

	function getFocusables(): HTMLElement[] {
		return Array.from(node.querySelectorAll<HTMLElement>(selector)).filter(
			(el) => el.offsetParent !== null || el === document.activeElement
		);
	}

	function onKey(e: KeyboardEvent) {
		if (e.key !== 'Tab') return;
		const els = getFocusables();
		if (els.length === 0) {
			e.preventDefault();
			node.focus();
			return;
		}
		const first = els[0];
		const last = els[els.length - 1];
		const active = document.activeElement as HTMLElement | null;
		if (e.shiftKey && (active === first || !node.contains(active))) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && active === last) {
			e.preventDefault();
			first.focus();
		}
	}

	const prev = document.activeElement as HTMLElement | null;
	node.addEventListener('keydown', onKey);
	queueMicrotask(() => {
		const els = getFocusables();
		(els[0] ?? node).focus();
	});

	return {
		destroy() {
			node.removeEventListener('keydown', onKey);
			prev?.focus?.();
		}
	};
}
