import type { RequestHandler } from './$types.js';
import { readFile } from 'fs/promises';
import { basename } from 'path';
import { getOriginalAvatarPath } from '$lib/services/imageOptimizer.js';

const MIME_TYPES: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.gif': 'image/gif'
};

export const GET: RequestHandler = async ({ params }) => {
	const filename = params.filename;

	// Sanitize: only allow alphanumeric, hyphens, underscores, dots
	if (!filename || !/^[\w\-.]+$/.test(filename)) {
		return new Response('Not found', { status: 404 });
	}

	const originalPath = getOriginalAvatarPath(basename(filename));

	if (!originalPath) {
		return new Response('Not found', { status: 404 });
	}

	try {
		const ext = originalPath.substring(originalPath.lastIndexOf('.'));
		const contentType = MIME_TYPES[ext] || 'application/octet-stream';

		const data = await readFile(originalPath);
		return new Response(data, {
			headers: {
				'Content-Type': contentType,
				'Cache-Control': 'public, max-age=31536000, immutable'
			}
		});
	} catch {
		return new Response('Not found', { status: 404 });
	}
};
