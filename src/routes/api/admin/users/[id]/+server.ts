import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { users } from '$lib/db/schema.js';
import { eq } from 'drizzle-orm';
import { requireAdmin } from '$lib/server/auth.js';

/** Update a user (admin only) */
export const PUT: RequestHandler = async (event) => {
	const admin = requireAdmin(event);
	const userId = Number(event.params.id);
	const { username, role } = await event.request.json();

	const user = db.select().from(users).where(eq(users.id, userId)).get();
	if (!user) return json({ error: 'User not found' }, { status: 404 });

	const updates: Record<string, unknown> = {};

	if (username && typeof username === 'string' && username.trim().length > 0) {
		// Check for duplicate
		const existing = db.select().from(users).where(eq(users.username, username.trim())).get();
		if (existing && existing.id !== userId) {
			event.locals.logger.warn('admin: rename rejected, duplicate username', { actorId: admin.id, targetUserId: userId, attemptedUsername: username.trim() });
			return json({ error: 'Username already taken' }, { status: 409 });
		}
		updates.username = username.trim();
	}

	if (role && ['admin', 'user'].includes(role)) {
		// Prevent removing the last admin
		if (role === 'user' && user.role === 'admin') {
			const adminCount = db
				.select({ id: users.id })
				.from(users)
				.where(eq(users.role, 'admin'))
				.all().length;
			if (adminCount <= 1) {
				event.locals.logger.warn('admin: role change rejected, would remove last admin', { actorId: admin.id, targetUserId: userId });
				return json({ error: 'Cannot remove the last admin' }, { status: 400 });
			}
		}
		updates.role = role;
	}

	if (Object.keys(updates).length > 0) {
		db.update(users).set(updates).where(eq(users.id, userId)).run();
		if (updates.role && updates.role !== user.role) {
			event.locals.logger.info('admin: user role changed', {
				actorId: admin.id, targetUserId: userId, fromRole: user.role, toRole: updates.role,
			});
		}
		if (updates.username && updates.username !== user.username) {
			event.locals.logger.info('admin: user renamed', {
				actorId: admin.id, targetUserId: userId,
			});
		}
	}

	return json({ ok: true });
};

/** Delete a user (admin only) */
export const DELETE: RequestHandler = async (event) => {
	const admin = requireAdmin(event);
	const userId = Number(event.params.id);

	if (userId === admin.id) {
		event.locals.logger.warn('admin: self-deletion rejected', { actorId: admin.id });
		return json({ error: 'Cannot delete yourself' }, { status: 400 });
	}

	const user = db.select().from(users).where(eq(users.id, userId)).get();
	if (!user) return json({ error: 'User not found' }, { status: 404 });

	// Prevent deleting the last admin
	if (user.role === 'admin') {
		const adminCount = db
			.select({ id: users.id })
			.from(users)
			.where(eq(users.role, 'admin'))
			.all().length;
		if (adminCount <= 1) {
			event.locals.logger.warn('admin: deletion rejected, would remove last admin', { actorId: admin.id, targetUserId: userId });
			return json({ error: 'Cannot delete the last admin' }, { status: 400 });
		}
	}

	// CASCADE will handle related data (characters, chats, messages, etc.)
	db.delete(users).where(eq(users.id, userId)).run();
	event.locals.logger.warn('admin: user deleted', {
		actorId: admin.id, targetUserId: userId, targetRole: user.role,
	});

	return json({ ok: true });
};
