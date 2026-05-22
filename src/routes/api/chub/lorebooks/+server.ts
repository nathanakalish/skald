import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { requireUser } from '$lib/server/auth.js';
import { getAdminSettingBool } from '$lib/server/adminSettings.js';
import { chubSearch, type ChubSort } from '$lib/server/chub.js';
import { logger } from '$lib/server/logger.js';
import { ApiError } from '$lib/server/apiError.js';

const ALLOWED_SORTS: readonly ChubSort[] = [
	'download_count', 'last_activity_at', 'created_at', 'rating', 'n_favorites',
];

export const GET: RequestHandler = async (event) => {
	const user = requireUser(event);
	if (!getAdminSettingBool('allowChubBrowse') && user.role !== 'admin') {
		return ApiError.forbidden('CHUB browsing is disabled by the administrator');
	}

	const q = event.url.searchParams;
	const sortRaw = q.get('sort') as ChubSort | null;
	const sort: ChubSort = sortRaw && ALLOWED_SORTS.includes(sortRaw) ? sortRaw : 'download_count';
	const page = Number(q.get('page')) || 1;
	const first = Math.min(48, Number(q.get('first')) || 24);
	const tagsRaw = (q.get('tags') ?? '').slice(0, 1000).trim();
	const excludeTagsRaw = (q.get('exclude_tags') ?? '').slice(0, 1000).trim();
	const minTokensRaw = Number(q.get('min_tokens'));
	const minTokens = Number.isFinite(minTokensRaw) && minTokensRaw >= 0 ? Math.min(100_000, Math.floor(minTokensRaw)) : undefined;

	try {
		const result = await chubSearch({
			namespace: 'lorebooks',
			search: q.get('search') ?? undefined,
			page,
			first,
			sort,
			asc: q.get('asc') === 'true',
			nsfw: q.get('nsfw') === 'true',
			include_forks: q.get('include_forks') === 'true',
			tags: tagsRaw || undefined,
			exclude_tags: excludeTagsRaw || undefined,
			min_tokens: minTokens,
		});
		return json(result, { headers: { 'Cache-Control': 'private, max-age=30' } });
	} catch (err) {
		logger.warn('chub lorebooks search error', { err: err instanceof Error ? err.message : String(err) });
		return json({ error: 'CHUB search failed', message: err instanceof Error ? err.message : 'Unknown' }, { status: 502 });
	}
};
