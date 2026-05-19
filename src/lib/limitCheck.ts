/**
 * Save-time gates for fields with soft character limits. Two flavours:
 *
 *   • `checkFieldLimits()` — call from explicit save / apply handlers (modals
 *     with a Save button). Pops a blocking dialog listing the offending fields
 *     with "Go back" (safe default) or "Trim & continue" (truncates and
 *     proceeds). Returns true if the caller should proceed with the save,
 *     false if it should abort.
 *
 *   • `checkAutoSaveLimit()` — call from inline / on-blur autosave paths
 *     (settings, regex scripts, etc.) where opening a modal would be too
 *     heavy. Shows an error toast and returns false if the value is too long.
 *
 * Both honour the global `limitsState.enabled` flag — when the admin turns
 * the feature off these become no-ops and report success unconditionally so
 * downstream save logic continues to run.
 *
 * "Go back" is the primary / Enter-default action, and Escape / backdrop-
 * click also resolve to "go back" — both interpretations land on the safe
 * outcome so an accidental dismissal never silently truncates data.
 */

import { confirmWithSecondary } from './dialog.svelte.js';
import { toasts } from './stores/toast.svelte.js';
import { limitsState } from './limits.svelte.js';

export interface CheckField {
	/** Human-readable label for the field, used in the dialog body. */
	label: string;
	/** Current value (post-edit). */
	value: string;
	/** Soft cap. */
	limit: number;
	/**
	 * Called once per offending field when the user picks "Trim & continue".
	 * The caller is responsible for actually writing the trimmed value back
	 * into the form state.
	 */
	trim: (next: string) => void;
}

/**
 * Returns true if every field is within its limit (or the user accepted the
 * trim), false if the user chose to go back and edit. Idempotent — when all
 * fields are already within limits this resolves synchronously, and when the
 * admin has globally disabled limits it short-circuits to true.
 */
export async function checkFieldLimits(fields: CheckField[]): Promise<boolean> {
	if (!limitsState.enabled) return true;
	const over = fields.filter((f) => (f.value ?? '').length > f.limit);
	if (over.length === 0) return true;

	const lines = over
		.map((f) => `• ${f.label}: ${f.value.length} / ${f.limit} (${f.value.length - f.limit} over)`)
		.join('\n');
	const result = await confirmWithSecondary({
		title: over.length === 1 ? 'Field is too long' : 'Some fields are too long',
		message: `${lines}\n\nGo back to edit, or trim the excess characters and continue saving.`,
		// Primary / Enter-default = safe option. The user must explicitly click
		// the secondary button to lose data.
		confirmLabel: 'Go back',
		cancelLabel: '',
		secondaryLabel: 'Trim & continue',
		variant: 'info',
	});

	if (result === 'secondary') {
		for (const f of over) f.trim(f.value.slice(0, f.limit));
		return true;
	}
	return false;
}

/**
 * Inline autosave check. Returns false (and pops a toast) when the value
 * exceeds its limit; callers should bail without writing. Returns true
 * unconditionally when the global flag is off.
 */
export function checkAutoSaveLimit(label: string, value: string, limit: number): boolean {
	if (!limitsState.enabled) return true;
	const len = (value ?? '').length;
	if (len <= limit) return true;
	toasts.error(`Couldn't save: "${label}" is ${len} / ${limit} characters. Trim the excess and try again.`);
	return false;
}
