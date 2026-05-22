import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { regexScripts } from '$lib/db/schema.js';
import { eq } from 'drizzle-orm';
import { requireOwned } from '$lib/server/ownership.js';
import { validateLengths } from '$lib/server/fieldLimits.js';
import { ApiError } from '$lib/server/apiError.js';

export const PATCH: RequestHandler = async (event) => {
	const { row: existing } = requireOwned(event, regexScripts, event.params.id);
	const id = existing.id;

	const body = await event.request.json();

	const lengthError = validateLengths(body, {
		name: 'name',
		findRegex: 'regexPattern',
		replaceString: 'regexReplacement',
	});
	if (lengthError) return lengthError;

	const updates: Record<string, any> = {};

	if (body.name !== undefined) updates.name = body.name;
	if (body.findRegex !== undefined) {
		if (typeof body.findRegex !== 'string' || body.findRegex.length > 500) {
			return ApiError.badRequest('Regex too long (max 500 chars)');
		}
		if (/(\([^)]*[+*][^)]*\)|\[[^\]]*\])[+*]/.test(body.findRegex)) {
			return ApiError.badRequest('Regex pattern looks vulnerable to catastrophic backtracking');
		}
		// Validate regex
		const regexMatch = body.findRegex.match(/^\/(.+)\/([gimsuy]*)$/s);
		if (regexMatch) {
			try {
				new RegExp(regexMatch[1], regexMatch[2]);
			} catch {
				return ApiError.badRequest('Invalid regular expression');
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
