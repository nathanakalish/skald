import { describe, it, expect } from 'vitest';
import { positionForMenu } from './menuPositioning';

const VP = { innerWidth: 400, innerHeight: 800, visualViewport: null };

describe('positionForMenu', () => {
	it('opens above the touch point when there is room', () => {
		const pos = positionForMenu(200, 600, 220, 300, VP);
		expect(pos.flipUp).toBe(true);
		// y is the bottom edge in flipUp mode; should sit just above the touch
		expect(pos.y).toBe(600 - 8);
	});

	it('flips below when the touch is too high to fit above', () => {
		const pos = positionForMenu(200, 100, 220, 300, VP);
		expect(pos.flipUp).toBe(false);
		// y is the top edge; clamped to PAD or just below the touch
		expect(pos.y).toBeGreaterThanOrEqual(8);
		expect(pos.y + 300).toBeLessThanOrEqual(800);
	});

	it('clamps x so the menu never clips the left edge', () => {
		const pos = positionForMenu(0, 400, 220, 300, VP);
		expect(pos.x).toBe(8);
	});

	it('clamps x so the menu never clips the right edge', () => {
		const pos = positionForMenu(400, 400, 220, 300, VP);
		expect(pos.x).toBe(400 - 220 - 8);
	});

	it('keeps menu fully on screen vertically when flipped up', () => {
		// Touch near the bottom — bottom edge clamped to viewport
		const pos = positionForMenu(200, 790, 220, 300, VP);
		expect(pos.flipUp).toBe(true);
		expect(pos.y).toBeLessThanOrEqual(800 - 8);
		expect(pos.y - 300).toBeGreaterThanOrEqual(0);
	});

	it('subtracts visualViewport offset so coords match on-screen pixels', () => {
		const pos = positionForMenu(200, 600, 220, 300, {
			innerWidth: 400,
			innerHeight: 800,
			// keyboard up: visual viewport is shorter and offset down by 200
			visualViewport: { width: 400, height: 600, offsetLeft: 0, offsetTop: 200 }
		});
		// localY = 600 - 200 = 400. 400 - 300 - 8 = 92 >= 8 → fits above
		expect(pos.flipUp).toBe(true);
		expect(pos.viewportH).toBe(600);
	});
});
