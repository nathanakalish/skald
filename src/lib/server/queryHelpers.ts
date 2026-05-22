/**
 * Shared per-user uniqueness helpers used by CRUD routes that enforce
 * "name must be unique within the user's collection" (themes, personas,
 * providers, ...). Pre-existed in 5+ inlined copies before this module.
 */
import { db } from '$lib/db/index.js';
import { and, eq, ne } from 'drizzle-orm';
import type { SQLiteTableWithColumns } from 'drizzle-orm/sqlite-core';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NamedOwnedTable = SQLiteTableWithColumns<any> & { id: any; userId: any; name: any };

/**
 * Returns true iff some other row owned by `userId` already has `name`.
 * Pass `excludeId` to skip the row being updated.
 */
export function nameAlreadyExists(
	table: NamedOwnedTable,
	userId: number,
	name: string,
	excludeId?: number
): boolean {
	const cols = table as { id: unknown; userId: unknown; name: unknown };
	const where = excludeId !== undefined
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		? and(eq(cols.userId as any, userId), eq(cols.name as any, name), ne(cols.id as any, excludeId))
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		: and(eq(cols.userId as any, userId), eq(cols.name as any, name));
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const row = db.select({ id: cols.id as any }).from(table).where(where).get();
	return !!row;
}
