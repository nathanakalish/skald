import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth.js';
import { exportFileExists, isExportRunning } from '$lib/server/exportJobs.js';

export const GET: RequestHandler = async (event) => {
	const user = requireUser(event);
	return json({
		ready: exportFileExists(user.id),
		running: isExportRunning(user.id)
	});
};
