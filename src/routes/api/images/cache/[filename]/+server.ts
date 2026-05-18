import type { RequestHandler } from './$types.js';
import { readFile, access, unlink } from 'fs/promises';
import { join, resolve } from 'path';
import { logger } from '$lib/server/logger.js';

const CACHE_DIR = join(process.cwd(), 'data', 'image-cache');

// Magic-byte sniff so we don't serve corrupt/truncated payloads as images.
// Browsers handle a bad image gracefully (broken-image icon), but we'd rather
// 404 and evict so the next request through cacheImage() re-downloads.
function looksLikeImage(buf: Buffer, ext: string): boolean {
	if (buf.length < 12) return false;
	switch (ext) {
		case '.png':
			return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
		case '.jpg':
		case '.jpeg':
			return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
		case '.gif':
			return buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46;
		case '.webp':
			return buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
				&& buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;
		case '.svg':
			// Cheap text sniff — corrupt SVG is very rare, full XML parse would be overkill.
			return buf.subarray(0, 256).toString('utf8').toLowerCase().includes('<svg');
		default:
			return true;
	}
}

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

		if (!looksLikeImage(data, ext)) {
			// Corrupt/truncated cache entry — drop it so the next cacheImage() call
			// will refetch. Better to 404 once than serve garbage forever.
			logger.warn('image cache: corrupt entry, evicting', { file: targetFile, bytes: data.length });
			try { await unlink(filepath); } catch { /* may already be gone */ }
			return new Response('Not found', { status: 404 });
		}

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
