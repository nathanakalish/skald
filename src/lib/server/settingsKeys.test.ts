import { describe, it, expect } from 'vitest';
import { ALLOWED_SETTING_KEYS } from './settingsKeys.js';

describe('ALLOWED_SETTING_KEYS', () => {
	it('contains no duplicates', () => {
		const set = new Set(ALLOWED_SETTING_KEYS);
		expect(set.size).toBe(ALLOWED_SETTING_KEYS.length);
	});

	it('contains only string keys', () => {
		for (const k of ALLOWED_SETTING_KEYS) {
			expect(typeof k).toBe('string');
			expect(k.length).toBeGreaterThan(0);
		}
	});

	it('does not include known dangerous internal keys', () => {
		// These are admin / internal flags that must never be writable from
		// the user-facing PATCH /api/settings endpoint.
		expect(ALLOWED_SETTING_KEYS).not.toContain('role');
		expect(ALLOWED_SETTING_KEYS).not.toContain('userId');
		expect(ALLOWED_SETTING_KEYS).not.toContain('id');
		expect(ALLOWED_SETTING_KEYS).not.toContain('passwordHash');
		expect(ALLOWED_SETTING_KEYS).not.toContain('apiKey');
	});

	it('includes the headline user-facing settings', () => {
		expect(ALLOWED_SETTING_KEYS).toContain('fontSize');
		expect(ALLOWED_SETTING_KEYS).toContain('renderMode');
		expect(ALLOWED_SETTING_KEYS).toContain('quietHoursEnabled');
		expect(ALLOWED_SETTING_KEYS).toContain('compactionEnabled');
	});
});
