import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { regexScripts } from '$lib/db/schema.js';
import { eq, and, asc } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth.js';

export const GET: RequestHandler = async (event) => {
	const user = requireUser(event);
	const scripts = db.select()
		.from(regexScripts)
		.where(eq(regexScripts.userId, user.id))
		.orderBy(asc(regexScripts.sortOrder))
		.all();
	return json(scripts);
};

export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const body = await event.request.json();

	const { name, findRegex, replaceString, affectUserInput, affectAiResponse, characterId, enabled } = body;

	if (!name || !findRegex) {
		return json({ error: 'Name and find regex are required' }, { status: 400 });
	}

	if (typeof findRegex !== 'string' || findRegex.length > 500) {
		return json({ error: 'Regex too long (max 500 chars)' }, { status: 400 });
	}
	// Cheap heuristic to block obviously catastrophic patterns:
	// nested groups with unbounded quantifiers, or character classes
	// followed by quantifiers — the classic ReDoS shapes.
	if (/(\([^)]*[+*][^)]*\)|\[[^\]]*\])[+*]/.test(findRegex)) {
		return json({ error: 'Regex pattern looks vulnerable to catastrophic backtracking' }, { status: 400 });
	}

	// Validate regex
	const regexMatch = findRegex.match(/^\/(.+)\/([gimsuy]*)$/s);
	if (regexMatch) {
		try {
			new RegExp(regexMatch[1], regexMatch[2]);
		} catch {
			return json({ error: 'Invalid regular expression' }, { status: 400 });
		}
	}

	const result = db.insert(regexScripts).values({
		userId: user.id,
		name,
		findRegex,
		replaceString: replaceString ?? '',
		affectUserInput: affectUserInput ?? false,
		affectAiResponse: affectAiResponse ?? false,
		characterId: characterId ?? null,
		enabled: enabled ?? true,
		sortOrder: body.sortOrder ?? 0
	}).returning().get();

	return json(result, { status: 201 });
};
