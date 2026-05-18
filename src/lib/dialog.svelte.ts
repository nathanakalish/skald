/**
 * Global confirm / alert dialogs backed by ConfirmModal. Avoids the OS
 * confirm/alert/prompt popups (which look out of place, can't be styled,
 * and block the entire event loop on some platforms).
 *
 * Usage:
 *   if (await confirm({ title: 'Delete?', message: '...', variant: 'danger' })) { ... }
 *   await alert({ title: 'Failed', message: '...' });
 *
 * A single <DialogHost /> mounted in +layout.svelte renders whichever
 * dialog is currently active. Calls are serialised — opening a new dialog
 * resolves the previous one as cancelled.
 */

export interface ConfirmOptions {
	title?: string;
	message: string;
	confirmLabel?: string;
	cancelLabel?: string;
	secondaryLabel?: string;
	variant?: 'danger' | 'info';
}

interface AlertOptions {
	title?: string;
	message: string;
	okLabel?: string;
}

type ConfirmResult = 'confirm' | 'cancel' | 'secondary';

interface ActiveDialog {
	kind: 'confirm' | 'alert';
	title: string;
	message: string;
	confirmLabel: string;
	cancelLabel: string;
	secondaryLabel: string;
	variant: 'danger' | 'info';
	resolve: (result: ConfirmResult) => void;
}

let _active = $state<ActiveDialog | null>(null);

export const dialogStore = {
	get active() { return _active; },
};

function settle(result: ConfirmResult) {
	const a = _active;
	if (!a) return;
	_active = null;
	a.resolve(result);
}

/** Open a confirm dialog. Resolves to true if the user confirmed. */
export function confirm(opts: ConfirmOptions): Promise<boolean> {
	// Resolve any in-flight dialog as cancelled so callers don't deadlock
	// if two prompts fire in quick succession.
	if (_active) settle('cancel');
	return new Promise<boolean>((resolve) => {
		_active = {
			kind: 'confirm',
			title: opts.title ?? 'Confirm',
			message: opts.message,
			confirmLabel: opts.confirmLabel ?? 'Confirm',
			cancelLabel: opts.cancelLabel ?? 'Cancel',
			secondaryLabel: opts.secondaryLabel ?? '',
			variant: opts.variant ?? 'danger',
			resolve: (result) => resolve(result === 'confirm'),
		};
	});
}

/** Same as confirm() but lets the caller distinguish the secondary button. */
export function confirmWithSecondary(opts: ConfirmOptions): Promise<ConfirmResult> {
	if (_active) settle('cancel');
	return new Promise<ConfirmResult>((resolve) => {
		_active = {
			kind: 'confirm',
			title: opts.title ?? 'Confirm',
			message: opts.message,
			confirmLabel: opts.confirmLabel ?? 'Confirm',
			cancelLabel: opts.cancelLabel ?? 'Cancel',
			secondaryLabel: opts.secondaryLabel ?? '',
			variant: opts.variant ?? 'danger',
			resolve,
		};
	});
}

/** Open an info dialog with a single OK button. Resolves when dismissed. */
export function alert(opts: AlertOptions): Promise<void> {
	if (_active) settle('cancel');
	return new Promise<void>((resolve) => {
		_active = {
			kind: 'alert',
			title: opts.title ?? 'Notice',
			message: opts.message,
			confirmLabel: opts.okLabel ?? 'OK',
			cancelLabel: '',
			secondaryLabel: '',
			variant: 'info',
			resolve: () => resolve(),
		};
	});
}

// Internal handlers used by DialogHost. Not part of the public API.
export const _dialogInternals = {
	confirm: () => settle('confirm'),
	cancel: () => settle('cancel'),
	secondary: () => settle('secondary'),
};
