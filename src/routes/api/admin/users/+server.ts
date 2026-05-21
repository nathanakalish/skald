import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { users } from '$lib/db/schema.js';
import { requireAdmin } from '$lib/server/auth.js';

/** List all users (admin only) */
export const GET: RequestHandler = async (event) => {
	requireAdmin(event);

	const userList = db
		.select({
			id: users.id,
			username: users.username,
			role: users.role,
			createdAt: users.createdAt,
			pinHash: users.pinHash
		})
		.from(users)
		.all();

	// Don't ship the hash to the client; just whether a PIN is set.
	return json(userList.map(({ pinHash, ...rest }) => ({ ...rest, hasPin: !!pinHash })));
};
