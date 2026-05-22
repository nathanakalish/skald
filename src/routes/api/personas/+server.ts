import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { personas } from '$lib/db/schema.js';
import { eq } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth.js';
import { broadcast } from '$lib/server/realtime.js';
import { validateLengths } from '$lib/server/fieldLimits.js';
import { ApiError } from '$lib/server/apiError.js';

const PERSONA_FIELD_LIMITS = {
	name: 'name',
	displayName: 'name',
	description: 'description',
} as const;

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
	if (!name) return ApiError.badRequest('Name is required');

	const tooLong = validateLengths(body, PERSONA_FIELD_LIMITS);
	if (tooLong) return tooLong;

	// Personas intentionally allow duplicate in-chat names — the Label field
	// is what disambiguates them in the UI, while the in-chat name is just
	// the literal {{user}} substitution and can collide freely.

	// Validate avatarPath: must be a safe relative path under /avatars/
	const avatarPath = body.avatarPath && typeof body.avatarPath === 'string'
		&& /^\/avatars\/[\w.-]+$/.test(body.avatarPath)
		? body.avatarPath : null;

	// Demote-then-promote in one tx so we can't end up with zero defaults if
	// the insert fails after the demote.
	const result = db.transaction(() => {
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

	// Return all personas — setting isDefault may have demoted others
	const list = db.select().from(personas).where(eq(personas.userId, user.id)).all();
	broadcast(user.id, { type: 'persona:replaced', personas: list as any });
	event.locals.logger.info('personas: created', { personaId: result?.id, isDefault: !!body.isDefault });
	return json({ ...(result ?? {}), personas: list });
};
