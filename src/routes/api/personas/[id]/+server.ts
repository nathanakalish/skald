import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { personas } from '$lib/db/schema.js';
import { eq, and, ne } from 'drizzle-orm';
import { requireOwned } from '$lib/server/ownership.js';
import { broadcast } from '$lib/server/realtime.js';

export const PUT: RequestHandler = async (event) => {
	const { user, row: existing } = requireOwned(event, personas, event.params.id);
	const id = existing.id;
	const body = await event.request.json();

	// CRUD-L1: refuse empty/whitespace-only names at write time.
	const name = typeof body?.name === 'string' ? body.name.trim() : '';
	if (!name) return json({ error: 'Name is required' }, { status: 400 });

	// CRUD-L2: per-user name uniqueness (excluding self).
	const dupe = db
		.select({ id: personas.id })
		.from(personas)
		.where(and(eq(personas.userId, user.id), eq(personas.name, name), ne(personas.id, id)))
		.get();
	if (dupe) return json({ error: 'A persona with that name already exists' }, { status: 409 });

	// Validate avatarPath: must be a safe relative path under /avatars/
	const avatarPath = body.avatarPath && typeof body.avatarPath === 'string'
		&& /^\/avatars\/[\w.-]+$/.test(body.avatarPath)
		? body.avatarPath : null;

	// Demote-then-update in one tx so the "exactly one default" invariant
	// can't be broken by a crash between the two writes.
	db.transaction(() => {
		if (body.isDefault) {
			db.update(personas).set({ isDefault: false }).where(eq(personas.userId, user.id)).run();
		}
		db.update(personas)
			.set({
				name,
				displayName: body.displayName || '',
				description: body.description || '',
				avatarPath,
				isDefault: body.isDefault ?? false
			})
			.where(and(eq(personas.id, id), eq(personas.userId, user.id)))
			.run();
	});

	// Return all personas — setting isDefault may have changed others' isDefault
	const list = db.select().from(personas).where(eq(personas.userId, user.id)).all();
	broadcast(user.id, { type: 'persona:replaced', personas: list as any });
	return json({ ok: true, personas: list });
};

export const DELETE: RequestHandler = async (event) => {
	const { user, row: existing } = requireOwned(event, personas, event.params.id);
	db.delete(personas).where(eq(personas.id, existing.id)).run();
	broadcast(user.id, { type: 'persona:deleted', id: existing.id });
	return json({ ok: true });
};
