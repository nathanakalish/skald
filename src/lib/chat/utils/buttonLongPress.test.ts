import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createButtonLongPress } from './buttonLongPress';

vi.mock('$lib/utils/haptics', () => ({ haptic: vi.fn() }));

function pdown(x = 100, y = 100, button = 0): PointerEvent {
	return { clientX: x, clientY: y, button } as unknown as PointerEvent;
}
function pmove(x = 100, y = 100): PointerEvent {
	return { clientX: x, clientY: y } as unknown as PointerEvent;
}
function ctx(x = 100, y = 100): MouseEvent {
	return { clientX: x, clientY: y, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as MouseEvent;
}

describe('createButtonLongPress', () => {
	beforeEach(() => vi.useFakeTimers());

	it('fires open() after the hold delay', () => {
		const open = vi.fn();
		const h = createButtonLongPress(open, { holdMs: 500 });
		h.onpointerdown(pdown(50, 60));
		vi.advanceTimersByTime(499);
		expect(open).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(open).toHaveBeenCalledWith(50, 60);
	});

	it('cancels long-press on excessive move', () => {
		const open = vi.fn();
		const h = createButtonLongPress(open, { holdMs: 500, moveTolerance: 8 });
		h.onpointerdown(pdown(50, 60));
		h.onpointermove(pmove(70, 60)); // 20px > 8
		vi.advanceTimersByTime(500);
		expect(open).not.toHaveBeenCalled();
	});

	it('ignores small jitter within tolerance', () => {
		const open = vi.fn();
		const h = createButtonLongPress(open, { holdMs: 500, moveTolerance: 8 });
		h.onpointerdown(pdown(50, 60));
		h.onpointermove(pmove(55, 65)); // 5px < 8
		vi.advanceTimersByTime(500);
		expect(open).toHaveBeenCalled();
	});

	it('pointerup before hold cancels the timer', () => {
		const open = vi.fn();
		const h = createButtonLongPress(open, { holdMs: 500 });
		h.onpointerdown(pdown());
		h.onpointerup();
		vi.advanceTimersByTime(500);
		expect(open).not.toHaveBeenCalled();
	});

	it('suppressClick is one-shot after long-press', () => {
		const open = vi.fn();
		const h = createButtonLongPress(open, { holdMs: 500 });
		h.onpointerdown(pdown());
		vi.advanceTimersByTime(500);
		expect(h.suppressClick()).toBe(true);
		expect(h.suppressClick()).toBe(false);
	});

	it('right-click fires immediately and does NOT arm suppressClick', () => {
		const open = vi.fn();
		const h = createButtonLongPress(open, { holdMs: 500 });
		h.oncontextmenu(ctx(10, 20));
		expect(open).toHaveBeenCalledWith(10, 20);
		expect(h.suppressClick()).toBe(false);
	});

	it('ignores non-primary mouse buttons', () => {
		const open = vi.fn();
		const h = createButtonLongPress(open, { holdMs: 500 });
		h.onpointerdown(pdown(100, 100, 2));
		vi.advanceTimersByTime(500);
		expect(open).not.toHaveBeenCalled();
	});

	it('pointercancel clears pending flag', () => {
		const open = vi.fn();
		const h = createButtonLongPress(open, { holdMs: 500 });
		h.onpointerdown(pdown());
		vi.advanceTimersByTime(500);
		h.onpointercancel();
		expect(h.suppressClick()).toBe(false);
	});
});
