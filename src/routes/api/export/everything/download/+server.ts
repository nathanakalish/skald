import type { RequestHandler } from './$types.js';
import { requireUser } from '$lib/server/auth.js';
import { exportFilePath, exportFileExists } from '$lib/server/exportJobs.js';
import { error } from '@sveltejs/kit';
import { readFileSync } from 'fs';

export const GET: RequestHandler = async (event) => {
	const user = requireUser(event);

	if (!exportFileExists(user.id)) {
		throw error(404, 'No backup file found');
	}

	const filePath = exportFilePath(user.id);
	const buffer = readFileSync(filePath);
	const stamp = new Date().toISOString().slice(0, 10);

	event.locals.logger?.info('export: everything downloaded', { bytes: buffer.length });

	return new Response(buffer, {
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename="skald-backup-${stamp}.skald.zip"`
		}
	});
};
