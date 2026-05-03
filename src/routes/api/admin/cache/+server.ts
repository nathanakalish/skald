import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { requireAdmin } from '$lib/server/auth.js';
import { getCacheStats, clearImageCache } from '$lib/services/imageCache.js';

/** GET image cache stats: file count + total bytes on disk. */
export const GET: RequestHandler = async (event) => {
	requireAdmin(event);
	return json(getCacheStats());
};

/** DELETE the image cache. Returns the number of files removed. */
export const DELETE: RequestHandler = async (event) => {
	const admin = requireAdmin(event);
	const removed = clearImageCache();
	event.locals.logger.info('admin: image cache cleared', { actorId: admin.id, removed });
	return json({ removed });
};
