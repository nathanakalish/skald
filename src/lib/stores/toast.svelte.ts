export interface Toast {
	id: number;
	message: string;
	type: 'success' | 'error' | 'info';
	duration: number;
}

let nextId = 0;
const _toasts = $state<Toast[]>([]);

function add(message: string, type: Toast['type'] = 'success', duration = 2500) {
	const id = ++nextId;
	_toasts.push({ id, message, type, duration });
	setTimeout(() => remove(id), duration);
	return id;
}

function remove(id: number) {
	const idx = _toasts.findIndex(t => t.id === id);
	if (idx >= 0) _toasts.splice(idx, 1);
}

export const toasts = {
	get all() { return _toasts; },
	success: (message: string, duration?: number) => add(message, 'success', duration),
	error: (message: string, duration?: number) => add(message, 'error', duration ?? 4000),
	info: (message: string, duration?: number) => add(message, 'info', duration),
	remove
};
