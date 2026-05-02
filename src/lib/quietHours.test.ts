import { describe, it, expect } from 'vitest';
import { isWithinQuietHours } from './quietHours.js';

function at(h: number, m: number = 0): Date {
	const d = new Date(2024, 0, 1, h, m, 0);
	return d;
}

describe('isWithinQuietHours', () => {
	it('returns false for invalid times', () => {
		expect(isWithinQuietHours('', '07:00', at(3))).toBe(false);
		expect(isWithinQuietHours('22:00', 'oops', at(3))).toBe(false);
		expect(isWithinQuietHours('25:00', '07:00', at(3))).toBe(false);
	});

	it('returns false when start equals end', () => {
		expect(isWithinQuietHours('08:00', '08:00', at(8))).toBe(false);
	});

	it('handles non-wrapping window (09:00 → 17:00)', () => {
		expect(isWithinQuietHours('09:00', '17:00', at(8, 59))).toBe(false);
		expect(isWithinQuietHours('09:00', '17:00', at(9, 0))).toBe(true);
		expect(isWithinQuietHours('09:00', '17:00', at(12))).toBe(true);
		expect(isWithinQuietHours('09:00', '17:00', at(16, 59))).toBe(true);
		expect(isWithinQuietHours('09:00', '17:00', at(17, 0))).toBe(false);
	});

	it('handles midnight-wrapping window (22:00 → 07:00)', () => {
		expect(isWithinQuietHours('22:00', '07:00', at(21, 59))).toBe(false);
		expect(isWithinQuietHours('22:00', '07:00', at(22, 0))).toBe(true);
		expect(isWithinQuietHours('22:00', '07:00', at(23, 30))).toBe(true);
		expect(isWithinQuietHours('22:00', '07:00', at(0, 0))).toBe(true);
		expect(isWithinQuietHours('22:00', '07:00', at(6, 59))).toBe(true);
		expect(isWithinQuietHours('22:00', '07:00', at(7, 0))).toBe(false);
	});
});
