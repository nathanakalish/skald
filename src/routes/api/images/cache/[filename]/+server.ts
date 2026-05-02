import type { RequestHandler } from './$types.js';
import { readFile, access } from 'fs/promises';
import { join, resolve } from 'path';

const CACHE_DIR = join(process.cwd(), 'data', 'image-cache');

const MIME_TYPES: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.svg': 'image/svg+xml'
};

async function fileExists(path: string): Promise<boolean> {
	try { await access(path); return true; } catch { return false; }
}

export const GET: RequestHandler = async ({ params, url }) => {
	const filename = params.filename;

	// Sanitize: only allow alphanumeric, hyphens, underscores, dots
	if (!filename || !/^[\w\-.]+$/.test(filename)) {
		return new Response('Not found', { status: 404 });
	}

	// If ?original=1 is requested, try to find the original (non-WebP) version
	let targetFile = filename;
	if (url.searchParams.get('original') === '1' && filename.endsWith('.webp')) {
		const base = filename.replace(/\.webp$/, '');
		const originals = ['.png', '.jpg', '.jpeg', '.gif'];
		for (const ext of originals) {
			const candidate = base + ext;
			if (await fileExists(join(CACHE_DIR, candidate))) {
				targetFile = candidate;
				break;
			}
		}
	}

	const filepath = join(CACHE_DIR, targetFile);

	// Defense-in-depth: ensure resolved path is inside the cache directory
	const resolvedPath = resolve(filepath);
	const resolvedDir = resolve(CACHE_DIR);
	if (!resolvedPath.startsWith(resolvedDir + '/')) {
		return new Response('Not found', { status: 404 });
	}

	try {
		const data = await readFile(filepath);
		const ext = targetFile.substring(targetFile.lastIndexOf('.'));
		const contentType = MIME_TYPES[ext] || 'application/octet-stream';

		const headers: Record<string, string> = {
			'Content-Type': contentType,
			'Cache-Control': 'public, max-age=31536000, immutable'
		};

		// SVG can contain embedded scripts — block execution via CSP
		if (ext === '.svg') {
			headers['Content-Security-Policy'] = "script-src 'none'";
			headers['Content-Disposition'] = 'inline';
		}

		return new Response(data, { headers });
	} catch {
		return new Response('Not found', { status: 404 });
	}
};
