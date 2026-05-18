import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { characters } from '$lib/db/schema.js';
import { desc, eq } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth.js';
import { cacheCharacterTextImages } from '$lib/services/characterImageCache.js';
import { broadcast } from '$lib/server/realtime.js';
import { characterLight } from '$lib/server/projections.js';
import { enforceCreate } from '$lib/server/userLimits.js';

export const GET: RequestHandler = async (event) => {
	const user = requireUser(event);
	const rows = db
		.select(characterLight)
		.from(characters)
		.where(eq(characters.userId, user.id))
		.orderBy(desc(characters.updatedAt))
		.all();
	return json({ characters: rows });
};

export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const body = await event.request.json();

	// CRUD-L1: refuse empty/whitespace-only names at write time. The client
	// already validates, but the API was happy to create '' or '   ' rows
	// which then display as a blank entry in every list.
	const name = typeof body?.name === 'string' ? body.name.trim() : '';
	if (!name) return json({ error: 'Name is required' }, { status: 400 });

	const limitResponse = enforceCreate('characters', user.id, JSON.stringify(body ?? {}).length);
	if (limitResponse) return limitResponse;

	const cached = await cacheCharacterTextImages({
		firstMessage: body.firstMessage,
		alternateGreetings: body.alternateGreetings || '[]',
		creatorNotes: body.creatorNotes
	});

	const result = db
		.insert(characters)
		.values({
			userId: user.id,
			name,
			description: body.description || '',
			personality: body.personality || '',
			firstMessage: cached.firstMessage || '',
			scenario: body.scenario || '',
			systemPrompt: body.systemPrompt || '',
			creatorNotes: cached.creatorNotes || '',
			tags: body.tags || '',
			mesExample: body.mesExample || '',
			postHistoryInstructions: body.postHistoryInstructions || '',
			alternateGreetings: cached.alternateGreetings,
			creator: body.creator || '',
			characterVersion: body.characterVersion || '',
			extensions: body.extensions || '{}'
		})
		.returning()
		.get();

	// Return both the full row (for editor flows that immediately open) and a
	// `light` projection so the client store can insert without a refetch.
	const light = db.select(characterLight).from(characters).where(eq(characters.id, result.id)).get();
	if (light) broadcast(user.id, { type: 'character:created', character: light as any });
	event.locals.logger.info('characters: created', { characterId: result.id });
	return json({ ...result, light });
};
