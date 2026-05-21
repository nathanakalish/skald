/**
 * Per-user PIN lock helpers.
 *
 * Not meant as real auth — the PIN is a "guard against prying eyes" so a
 * casual passer-by can't snoop a chat window someone left open. Still:
 *
 * - Hash with scrypt + per-row salt so a leaked DB can't be trivially
 *   rainbow-tabled even though the keyspace is small (4–8 numeric digits).
 * - Constant-time comparison so we don't leak timing side channels.
 * - In-memory rate limiter (5 wrong attempts in 5 min → 1 min lockout) keeps
 *   a casual snooper from just brute-forcing all 10k 4-digit PINs in seconds.
 *   The limiter is per-user-id (not per-IP) since the only attacker model is
 *   "someone with physical access to the signed-in session".
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

const SCRYPT_KEYLEN = 32;
// N=16384, r=8, p=1 is the default for Node's scrypt — safe, ~30ms on a
// modern CPU. Plenty of friction for the 4–8 digit PIN keyspace.
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;

export function isValidPinFormat(pin: string): boolean {
	return /^\d{4,8}$/.test(pin);
}

export function hashPin(pin: string): string {
	const salt = randomBytes(16);
	const derived = scryptSync(pin, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS);
	return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

export function verifyPin(pin: string, stored: string | null | undefined): boolean {
	if (!stored) return false;
	const [saltHex, hashHex] = stored.split(':');
	if (!saltHex || !hashHex) return false;
	let salt: Buffer;
	let expected: Buffer;
	try {
		salt = Buffer.from(saltHex, 'hex');
		expected = Buffer.from(hashHex, 'hex');
	} catch {
		return false;
	}
	const derived = scryptSync(pin, salt, expected.length, SCRYPT_PARAMS);
	// timingSafeEqual throws on length mismatch; we already matched on
	// expected.length above so this is safe.
	return timingSafeEqual(derived, expected);
}

// ── Per-user rate limiter ──────────────────────────────────────────────
// Sliding window kept in memory. Reset on process restart, which is fine —
// this is a soft guard, not a security boundary.

interface AttemptWindow {
	attempts: number[]; // ms timestamps of recent failed attempts
	lockedUntil: number; // ms epoch; 0 = not locked
}

const WINDOW_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 60 * 1000;
const _windows = new Map<number, AttemptWindow>();

export interface RateLimitState {
	locked: boolean;
	/** ms remaining if locked, else 0 */
	retryAfterMs: number;
}

export function checkPinRateLimit(userId: number): RateLimitState {
	const w = _windows.get(userId);
	if (!w) return { locked: false, retryAfterMs: 0 };
	const now = Date.now();
	if (w.lockedUntil > now) return { locked: true, retryAfterMs: w.lockedUntil - now };
	return { locked: false, retryAfterMs: 0 };
}

/** Record a failed PIN attempt and return the post-update lock state. */
export function recordPinFailure(userId: number): RateLimitState {
	const now = Date.now();
	const w = _windows.get(userId) ?? { attempts: [], lockedUntil: 0 };
	w.attempts = w.attempts.filter(t => now - t < WINDOW_MS);
	w.attempts.push(now);
	if (w.attempts.length >= MAX_ATTEMPTS) {
		w.lockedUntil = now + LOCKOUT_MS;
		w.attempts = []; // reset window once lockout kicks in
	}
	_windows.set(userId, w);
	return checkPinRateLimit(userId);
}

/** Clear failure state for a user (call on successful verify or PIN change). */
export function clearPinFailures(userId: number): void {
	_windows.delete(userId);
}
