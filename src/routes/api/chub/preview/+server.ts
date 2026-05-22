import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { requireUser } from '$lib/server/auth.js';
import { getAdminSettingBool } from '$lib/server/adminSettings.js';
import { chubFetchPreview } from '$lib/server/chub.js';
import { ApiError } from '$lib/server/apiError.js';

/**
 * GET /api/chub/preview?type=character|lorebook&fullPath=creator/slug
 *
 * Returns the parsed CHUB project metadata (description, personality, first
 * message, lorebook entries, etc.) so the browse modal can show a "what am I
 * about to import?" pane before the user commits. No download happens server
 * side beyond a single JSON fetch from `/api/{namespace}/{creator}/{slug}?full=true`.
 */
export const GET: RequestHandler = async (event) => {
	const user = requireUser(event);
	if (!getAdminSettingBool('allowChubBrowse') && user.role !== 'admin') {
		return ApiError.forbidden('CHUB browsing is disabled by the administrator');
	}

	const typeParam = event.url.searchParams.get('type');
	const type = typeParam === 'lorebook' ? 'lorebook' : 'character';
	const fullPath = (event.url.searchParams.get('fullPath') ?? '').trim();
	if (!fullPath || !fullPath.includes('/') || fullPath.length > 200) {
		return ApiError.badRequest('Invalid fullPath');
	}

	try {
		const preview = await chubFetchPreview({ type, fullPath });
		event.locals.logger?.debug('chub: preview', { type, fullPath });
		return json(preview);
	} catch (err) {
		event.locals.logger?.warn('chub: preview failed', { type, fullPath, err: err instanceof Error ? err.message : String(err) });
		return json(
			{ error: 'Preview failed', message: err instanceof Error ? err.message : 'Unknown' },
			{ status: 502 },
		);
	}
};
