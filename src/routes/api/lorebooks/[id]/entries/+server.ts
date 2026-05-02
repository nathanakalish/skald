import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { lorebookEntries, lorebooks } from '$lib/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth.js';

export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const lorebookId = Number(event.params.id);
	const body = await event.request.json();

	// Verify lorebook ownership
	const lorebook = db.select().from(lorebooks).where(and(eq(lorebooks.id, lorebookId), eq(lorebooks.userId, user.id))).get();
	if (!lorebook) return json({ error: 'Not found' }, { status: 404 });

	const entry = db
		.insert(lorebookEntries)
		.values({
			lorebookId,
			keywords: body.keywords,
			content: body.content,
			insertionOrder: body.insertionOrder ?? 100,
			enabled: body.enabled ?? true,
			caseSensitive: body.caseSensitive ?? false,
			constant: body.constant ?? false
		})
		.returning()
		.get();

	return json(entry);
};
