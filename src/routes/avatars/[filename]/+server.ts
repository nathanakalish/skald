import type { RequestHandler } from './$types.js';
import { readFile } from 'fs/promises';
import { join } from 'path';

const AVATAR_DIR = join(process.cwd(), 'static', 'avatars');

const MIME_TYPES: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp'
};

export const GET: RequestHandler = async ({ params }) => {
	const filename = params.filename;

	// Sanitize: only allow alphanumeric, hyphens, underscores, dots
	if (!filename || !/^[\w\-.]+$/.test(filename)) {
		return new Response('Not found', { status: 404 });
	}

	const filepath = join(AVATAR_DIR, filename);

	try {
		const data = await readFile(filepath);
		const ext = filename.substring(filename.lastIndexOf('.'));
		const contentType = MIME_TYPES[ext] || 'application/octet-stream';

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
