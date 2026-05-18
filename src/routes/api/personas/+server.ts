import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { personas } from '$lib/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth.js';
import { broadcast } from '$lib/server/realtime.js';

export const GET: RequestHandler = async (event) => {
	const user = requireUser(event);
	const list = db.select().from(personas).where(eq(personas.userId, user.id)).all();
	return json({ personas: list });
};

export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const body = await event.request.json();

	// CRUD-L1: refuse empty/whitespace-only names at write time.
	const name = typeof body?.name === 'string' ? body.name.trim() : '';
	if (!name) return json({ error: 'Name is required' }, { status: 400 });

	// CRUD-L2: per-user name uniqueness. Enforced at the app layer rather
	// than a schema-level UNIQUE because old accounts may already have dupes
	// and we don't want a migration to fail loudly. The pre-check runs in
	// the same tx as the insert below.

	// Validate avatarPath: must be a safe relative path under /avatars/
	const avatarPath = body.avatarPath && typeof body.avatarPath === 'string'
		&& /^\/avatars\/[\w.-]+$/.test(body.avatarPath)
		? body.avatarPath : null;

	// Demote-then-promote in one tx so we can't end up with zero defaults if
	// the insert fails after the demote.
	let conflict = false;
	const result = db.transaction(() => {
		const existing = db
			.select({ id: personas.id })
			.from(personas)
			.where(and(eq(personas.userId, user.id), eq(personas.name, name)))
			.get();
		if (existing) {
			conflict = true;
			return null;
		}
		if (body.isDefault) {
			db.update(personas).set({ isDefault: false }).where(eq(personas.userId, user.id)).run();
		}
		return db
			.insert(personas)
			.values({
				userId: user.id,
				name,
				displayName: body.displayName || '',
				description: body.description || '',
				avatarPath,
				isDefault: body.isDefault ?? false
			})
			.returning()
			.get();
	});

	if (conflict) return json({ error: 'A persona with that name already exists' }, { status: 409 });

	// Return all personas — setting isDefault may have demoted others
	const list = db.select().from(personas).where(eq(personas.userId, user.id)).all();
	broadcast(user.id, { type: 'persona:replaced', personas: list as any });
	return json({ ...(result ?? {}), personas: list });
};
