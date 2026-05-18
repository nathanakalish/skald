import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { regexScripts } from '$lib/db/schema.js';
import { eq } from 'drizzle-orm';
import { requireOwned } from '$lib/server/ownership.js';

export const PATCH: RequestHandler = async (event) => {
	const { row: existing } = requireOwned(event, regexScripts, event.params.id);
	const id = existing.id;

	const body = await event.request.json();
	const updates: Record<string, any> = {};

	if (body.name !== undefined) updates.name = body.name;
	if (body.findRegex !== undefined) {
		if (typeof body.findRegex !== 'string' || body.findRegex.length > 500) {
			return json({ error: 'Regex too long (max 500 chars)' }, { status: 400 });
		}
		if (/(\([^)]*[+*][^)]*\)|\[[^\]]*\])[+*]/.test(body.findRegex)) {
			return json({ error: 'Regex pattern looks vulnerable to catastrophic backtracking' }, { status: 400 });
		}
		// Validate regex
		const regexMatch = body.findRegex.match(/^\/(.+)\/([gimsuy]*)$/s);
		if (regexMatch) {
			try {
				new RegExp(regexMatch[1], regexMatch[2]);
			} catch {
				return json({ error: 'Invalid regular expression' }, { status: 400 });
			}
		}
		updates.findRegex = body.findRegex;
	}
	if (body.replaceString !== undefined) updates.replaceString = body.replaceString;
	if (body.affectUserInput !== undefined) updates.affectUserInput = body.affectUserInput;
	if (body.affectAiResponse !== undefined) updates.affectAiResponse = body.affectAiResponse;
	if (body.characterId !== undefined) updates.characterId = body.characterId;
	if (body.enabled !== undefined) updates.enabled = body.enabled;
	if (body.sortOrder !== undefined) updates.sortOrder = body.sortOrder;

	if (Object.keys(updates).length === 0) {
		return json(existing);
	}

	db.update(regexScripts).set(updates).where(eq(regexScripts.id, id)).run();
	const updated = db.select().from(regexScripts).where(eq(regexScripts.id, id)).get();
	event.locals.logger?.debug('regexScript: updated', { scriptId: id, keys: Object.keys(updates) });
	return json(updated);
};

export const DELETE: RequestHandler = async (event) => {
	const { row: existing } = requireOwned(event, regexScripts, event.params.id);
	db.delete(regexScripts).where(eq(regexScripts.id, existing.id)).run();
	event.locals.logger?.info('regexScript: deleted', { scriptId: existing.id });
	return json({ ok: true });
};
