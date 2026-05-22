import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { users } from '$lib/db/schema.js';
import { eq } from 'drizzle-orm';
import { requireAdmin } from '$lib/server/auth.js';
import { clearPinFailures } from '$lib/server/pin.js';
import { ApiError } from '$lib/server/apiError.js';

/** Admin override: clear another user's PIN entirely. */
export const DELETE: RequestHandler = async (event) => {
	const admin = requireAdmin(event);
	const userId = Number(event.params.id);
	if (!Number.isInteger(userId)) return ApiError.badRequest('Invalid user id');

	const target = db.select().from(users).where(eq(users.id, userId)).get();
	if (!target) return ApiError.notFound('User not found');

	db.update(users)
		.set({ pinHash: null, pinPolicy: 'disabled', pinTimeoutMinutes: null })
		.where(eq(users.id, userId))
		.run();

	clearPinFailures(userId);
	event.locals.logger.warn('admin: cleared user pin', { actorId: admin.id, targetUserId: userId });
	return json({ ok: true });
};
