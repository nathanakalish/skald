/**
 * Tiny ownership helpers — verify that a row belongs to the requesting user
 * before persisting it as a foreign key. Centralises the IDOR check that was
 * previously copy-pasted (or just missing) all over the place.
 */
import { error, type RequestEvent } from '@sveltejs/kit';
import { db } from '$lib/db/index.js';
import { providers, personas, messages, chats, characters, lorebooks, themes, regexScripts } from '$lib/db/schema.js';
import { and, eq } from 'drizzle-orm';
import type { SQLiteTableWithColumns } from 'drizzle-orm/sqlite-core';
import { requireUser } from './auth.js';

export function ownsProvider(userId: number, id: number): boolean {
	if (!Number.isFinite(id)) return false;
	const row = db.select({ id: providers.id }).from(providers)
		.where(and(eq(providers.id, id), eq(providers.userId, userId))).get();
	return !!row;
}

export function ownsPersona(userId: number, id: number): boolean {
	if (!Number.isFinite(id)) return false;
	const row = db.select({ id: personas.id }).from(personas)
		.where(and(eq(personas.id, id), eq(personas.userId, userId))).get();
	return !!row;
}

/** Tables that have an `id` PK and a `userId` FK and are subject to per-user ownership checks. */
type OwnedTable =
	| typeof providers
	| typeof personas
	| typeof chats
	| typeof characters
	| typeof lorebooks
	| typeof themes
	| typeof regexScripts;

/**
 * Combined `requireUser` + ownership check. Throws 401 if not authenticated,
 * 400 if `id` is non-numeric, and 404 if the row doesn't exist OR isn't owned
 * by the authenticated user.
 *
 * Usage:
 *   const { user, row } = requireOwned(event, chats, event.params.id);
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function requireOwned<T extends SQLiteTableWithColumns<any>>(
	event: RequestEvent,
	table: T,
	idParam: string | number | undefined
): { user: ReturnType<typeof requireUser>; row: T['$inferSelect'] } {
	const user = requireUser(event);
	const id = typeof idParam === 'number' ? idParam : Number(idParam);
	if (!Number.isFinite(id)) throw error(400, 'Invalid id');

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const cols = (table as any) as { id: any; userId: any };
	const row = db.select().from(table)
		.where(and(eq(cols.id, id), eq(cols.userId, user.id)))
		.get() as T['$inferSelect'] | undefined;
	if (!row) throw error(404, 'Not found');
	return { user, row };
}
