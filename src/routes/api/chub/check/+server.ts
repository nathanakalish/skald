import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { requireUser } from '$lib/server/auth.js';
import { getAdminSettingBool } from '$lib/server/adminSettings.js';
import { db } from '$lib/db/index.js';
import { characters, lorebooks } from '$lib/db/schema.js';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { ApiError } from '$lib/server/apiError.js';

/**
 * POST /api/chub/check
 * Body: { type: 'character' | 'lorebook', cards: { fullPath: string; name: string }[] }
 *
 * For each requested card, says whether the user already has something like it.
 * Two signals:
 *
 *   - exact:  a row whose `chub_full_path` matches the CHUB fullPath exactly
 *             (only set on items previously imported via the browse modal).
 *   - byName: rows whose name matches the CHUB card name (case-insensitive),
 *             a fallback for legacy/manual imports.
 *
 * The browse modal uses this to badge owned cards and to offer the user
 * Cancel / Replace / Import-as-new on a duplicate import.
 */
type CheckMatch = { id: number; name: string; lastActivityAt?: string | null };
type CheckResult = { fullPath: string; exact: CheckMatch | null; byName: CheckMatch[] };

export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	if (!getAdminSettingBool('allowChubBrowse') && user.role !== 'admin') {
		return ApiError.forbidden('CHUB browsing is disabled by the administrator');
	}

	let body: { type?: string; cards?: { fullPath?: unknown; name?: unknown; creator?: unknown }[] };
	try {
		body = await event.request.json();
	} catch {
		return ApiError.badRequest('Invalid JSON body');
	}

	const type = body.type === 'lorebook' ? 'lorebook' : 'character';
	const rawCards = Array.isArray(body.cards) ? body.cards : [];
	if (rawCards.length === 0) return json({ results: [] satisfies CheckResult[] });
	if (rawCards.length > 100) {
		return ApiError.badRequest('Too many cards (max 100)');
	}

	const cards = rawCards
		.map((c) => ({
			fullPath: typeof c.fullPath === 'string' ? c.fullPath.trim() : '',
			name: typeof c.name === 'string' ? c.name.trim() : '',
			creator: typeof c.creator === 'string' ? c.creator.trim() : '',
		}))
		.filter((c) => c.fullPath.length > 0 && c.fullPath.length <= 200);

	const fullPaths = [...new Set(cards.map((c) => c.fullPath))];
	const creatorKeys = [
		...new Set(
			cards
				.map((c) => c.creator.toLowerCase())
				.filter((c) => c.length > 0)
		),
	];

	const table = type === 'character' ? characters : lorebooks;

	const exactRows = fullPaths.length > 0
		? db.select({ id: table.id, name: table.name, chubFullPath: table.chubFullPath, chubLastActivityAt: table.chubLastActivityAt })
			.from(table)
			.where(and(eq(table.userId, user.id), inArray(table.chubFullPath, fullPaths)))
			.all()
		: [];

	// byName matches need creator agreement (case-insensitive) AND a fuzzy name
	// match — either local name contains the CHUB name or vice versa, after
	// stripping non-alphanumerics. Catches "Bob" vs "Bob The Adventurer" and
	// "Bob (v2)" vs "Bob". Lorebooks don't carry a creator column, so byName
	// only fires for characters.
	const byNameRows = type === 'character' && creatorKeys.length > 0
		? db.select({ id: characters.id, name: characters.name, creator: characters.creator })
			.from(characters)
			.where(and(eq(characters.userId, user.id), inArray(sql`lower(${characters.creator})`, creatorKeys)))
			.all()
		: [];

	const exactByPath = new Map<string, CheckMatch>();
	for (const r of exactRows) {
		if (r.chubFullPath && !exactByPath.has(r.chubFullPath)) {
			exactByPath.set(r.chubFullPath, { id: r.id, name: r.name, lastActivityAt: r.chubLastActivityAt ?? null });
		}
	}

	// Group local rows by creator (lowercased) for quick lookup per card.
	const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
	const localByCreator = new Map<string, { id: number; name: string; nameNorm: string }[]>();
	for (const r of byNameRows) {
		const c = (r.creator ?? '').trim().toLowerCase();
		if (!c) continue;
		const arr = localByCreator.get(c) ?? [];
		arr.push({ id: r.id, name: r.name, nameNorm: normalize(r.name) });
		localByCreator.set(c, arr);
	}

	const results: CheckResult[] = cards.map((c) => {
		const creatorKey = c.creator.toLowerCase();
		const cardNorm = normalize(c.name);
		let matches: CheckMatch[] = [];
		if (creatorKey && cardNorm) {
			const candidates = localByCreator.get(creatorKey) ?? [];
			matches = candidates
				.filter((r) => {
					if (!r.nameNorm) return false;
					return (
						r.nameNorm === cardNorm ||
						r.nameNorm.includes(cardNorm) ||
						cardNorm.includes(r.nameNorm)
					);
				})
				.map((r) => ({ id: r.id, name: r.name }));
		}
		return {
			fullPath: c.fullPath,
			exact: exactByPath.get(c.fullPath) ?? null,
			byName: matches,
		};
	});

	const exactCount = results.reduce((n, r) => n + (r.exact ? 1 : 0), 0);
	const byNameCount = results.reduce((n, r) => n + r.byName.length, 0);
	event.locals.logger?.debug('chub: check', { type, cardCount: cards.length, exactCount, byNameCount });
	return json({ results });
};
