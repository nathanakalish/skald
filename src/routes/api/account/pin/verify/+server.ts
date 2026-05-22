import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { users } from '$lib/db/schema.js';
import { eq } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth.js';
import { verifyPin, checkPinRateLimit, recordPinFailure, clearPinFailures } from '$lib/server/pin.js';
import { ApiError } from '$lib/server/apiError.js';

/** Verify a PIN attempt for the caller (used to unlock the UI overlay). */
export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const limit = checkPinRateLimit(user.id);
	if (limit.locked) {
		return json({ error: 'Too many attempts', retryAfterMs: limit.retryAfterMs }, { status: 429 });
	}

	const body = await event.request.json().catch(() => ({}));
	const { pin } = body ?? {};
	if (typeof pin !== 'string') return ApiError.badRequest('PIN required');

	const row = db
		.select({ pinHash: users.pinHash })
		.from(users)
		.where(eq(users.id, user.id))
		.get();

	if (!row?.pinHash) {
		// No PIN configured — treat as success so a desynced client doesn't
		// get stuck behind a lock it can never satisfy.
		return json({ ok: true });
	}

	if (!verifyPin(pin, row.pinHash)) {
		const next = recordPinFailure(user.id);
		event.locals.logger.warn('account: pin verify failed', { userId: user.id, locked: next.locked });
		if (next.locked) {
			return json({ error: 'Too many attempts', retryAfterMs: next.retryAfterMs }, { status: 429 });
		}
		return ApiError.forbidden('Incorrect PIN');
	}

	clearPinFailures(user.id);
	return json({ ok: true });
};
