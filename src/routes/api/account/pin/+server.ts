import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { users } from '$lib/db/schema.js';
import { eq } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth.js';
import { hashPin, verifyPin, isValidPinFormat, clearPinFailures } from '$lib/server/pin.js';

type PinPolicy = 'disabled' | 'on-focus' | 'on-open' | 'timeout';
const POLICIES: PinPolicy[] = ['disabled', 'on-focus', 'on-open', 'timeout'];

function normalizePolicy(value: unknown): PinPolicy | null {
	return typeof value === 'string' && (POLICIES as string[]).includes(value) ? (value as PinPolicy) : null;
}

function normalizeTimeout(value: unknown, policy: PinPolicy): number | null {
	if (policy !== 'timeout') return null;
	const n = Number(value);
	if (!Number.isInteger(n) || n < 1 || n > 1440) return null;
	return n;
}

/** Set or change the caller's PIN. */
export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const body = await event.request.json().catch(() => ({}));
	const { currentPin, newPin, policy, timeoutMinutes } = body ?? {};

	if (typeof newPin !== 'string' || !isValidPinFormat(newPin)) {
		return json({ error: 'PIN must be 4–8 digits' }, { status: 400 });
	}

	const row = db.select().from(users).where(eq(users.id, user.id)).get();
	if (!row) return json({ error: 'User not found' }, { status: 404 });

	// Require the current PIN to rotate an existing one. This blocks an
	// attacker who got hold of an unlocked session from silently changing
	// the PIN and locking the real user out.
	if (row.pinHash) {
		if (typeof currentPin !== 'string' || !verifyPin(currentPin, row.pinHash)) {
			return json({ error: 'Current PIN is incorrect' }, { status: 403 });
		}
	}

	const resolvedPolicy: PinPolicy = normalizePolicy(policy) ?? (row.pinPolicy as PinPolicy) ?? 'on-focus';
	const effectivePolicy: PinPolicy = resolvedPolicy === 'disabled' ? 'on-focus' : resolvedPolicy;
	const resolvedTimeout = normalizeTimeout(timeoutMinutes, effectivePolicy);

	db.update(users)
		.set({
			pinHash: hashPin(newPin),
			pinPolicy: effectivePolicy,
			pinTimeoutMinutes: resolvedTimeout
		})
		.where(eq(users.id, user.id))
		.run();

	clearPinFailures(user.id);
	event.locals.logger.info('account: pin set', { userId: user.id, policy: effectivePolicy });
	return json({ ok: true, policy: effectivePolicy, timeoutMinutes: resolvedTimeout });
};

/** Remove the caller's PIN. */
export const DELETE: RequestHandler = async (event) => {
	const user = requireUser(event);
	const body = await event.request.json().catch(() => ({}));
	const { currentPin } = body ?? {};

	const row = db.select().from(users).where(eq(users.id, user.id)).get();
	if (!row) return json({ error: 'User not found' }, { status: 404 });
	if (!row.pinHash) return json({ ok: true }); // nothing to remove

	if (typeof currentPin !== 'string' || !verifyPin(currentPin, row.pinHash)) {
		return json({ error: 'Current PIN is incorrect' }, { status: 403 });
	}

	db.update(users)
		.set({ pinHash: null, pinPolicy: 'disabled', pinTimeoutMinutes: null })
		.where(eq(users.id, user.id))
		.run();

	clearPinFailures(user.id);
	event.locals.logger.info('account: pin removed', { userId: user.id });
	return json({ ok: true });
};

/** Update policy/timeout without changing the PIN itself. */
export const PATCH: RequestHandler = async (event) => {
	const user = requireUser(event);
	const body = await event.request.json().catch(() => ({}));
	const policy = normalizePolicy(body?.policy);
	if (!policy) return json({ error: 'Invalid policy' }, { status: 400 });

	const row = db.select().from(users).where(eq(users.id, user.id)).get();
	if (!row) return json({ error: 'User not found' }, { status: 404 });

	// Only allow 'disabled' if no PIN is set, or when explicitly removing —
	// otherwise "disabled" sneaks past the prying-eyes guard while the hash
	// still exists. UX-wise we just route the user through DELETE for that.
	if (policy === 'disabled' && row.pinHash) {
		return json({ error: 'Remove the PIN to disable the lock' }, { status: 400 });
	}
	if (policy !== 'disabled' && !row.pinHash) {
		return json({ error: 'Set a PIN before choosing a policy' }, { status: 400 });
	}

	const timeoutMinutes = normalizeTimeout(body?.timeoutMinutes, policy);
	if (policy === 'timeout' && timeoutMinutes === null) {
		return json({ error: 'timeoutMinutes must be an integer 1–1440' }, { status: 400 });
	}

	db.update(users)
		.set({ pinPolicy: policy, pinTimeoutMinutes: timeoutMinutes })
		.where(eq(users.id, user.id))
		.run();

	event.locals.logger.info('account: pin policy updated', { userId: user.id, policy });
	return json({ ok: true, policy, timeoutMinutes });
};
