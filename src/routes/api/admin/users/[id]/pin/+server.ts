import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { users } from '$lib/db/schema.js';
import { eq } from 'drizzle-orm';
import { requireAdmin } from '$lib/server/auth.js';
import { clearPinFailures } from '$lib/server/pin.js';

/** Admin override: clear another user's PIN entirely. */
export const DELETE: RequestHandler = async (event) => {
	const admin = requireAdmin(event);
	const userId = Number(event.params.id);
	if (!Number.isInteger(userId)) return json({ error: 'Invalid user id' }, { status: 400 });

	const target = db.select().from(users).where(eq(users.id, userId)).get();
	if (!target) return json({ error: 'User not found' }, { status: 404 });

	db.update(users)
		.set({ pinHash: null, pinPolicy: 'disabled', pinTimeoutMinutes: null })
		.where(eq(users.id, userId))
		.run();

	clearPinFailures(userId);
	event.locals.logger.warn('admin: cleared user pin', { actorId: admin.id, targetUserId: userId });
	return json({ ok: true });
};
