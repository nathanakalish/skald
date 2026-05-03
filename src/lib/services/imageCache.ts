import { mkdirSync, existsSync, readdirSync, unlinkSync, statSync } from 'fs';
import { writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { randomUUID } from 'crypto';
import { optimizeCachedImage } from '$lib/services/imageOptimizer.js';
import { getAdminSettingBool } from '$lib/server/adminSettings.js';
import { isPrivateHostname, assertPublicHost } from '$lib/server/ssrf.js';
import { safeFetch } from '$lib/server/safeFetch.js';
import { logger } from '$lib/server/logger.js';

const CACHE_DIR = join(process.cwd(), 'data', 'image-cache');
mkdirSync(CACHE_DIR, { recursive: true });

/** Per-image hard cap. Defends against decompression / oversize attacks. 16 MiB. */
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;

/** Hard cap on the cache directory. 1 GiB by default; override with IMAGE_CACHE_MAX_BYTES. */
const MAX_BYTES = (() => {
	const raw = Number(process.env.IMAGE_CACHE_MAX_BYTES);
	return Number.isFinite(raw) && raw > 0 ? raw : 1024 * 1024 * 1024;
})();

/** When eviction kicks in, knock the cache down to this fraction so we don't thrash. */
const EVICT_TO_FRACTION = 0.85;

// In-memory listing of cached files. Built lazily on first use.
let cacheIndex: Set<string> | null = null;
function getIndex(): Set<string> {
	if (cacheIndex === null) {
		try {
			cacheIndex = new Set<string>(readdirSync(CACHE_DIR));
		} catch (err) {
			logger.warn('image cache: failed to read directory; starting empty', { err });
			cacheIndex = new Set<string>();
		}
	}
	return cacheIndex;
}

/** Resolve a path and confirm it lives inside the expected directory (no `..` shenanigans). */
function isInsideDir(dir: string, filepath: string): boolean {
	const resolved = resolve(filepath);
	const resolvedDir = resolve(dir);
	return resolved.startsWith(resolvedDir + '/') || resolved === resolvedDir;
}

/** Walk the cache dir, sum byte size. Used to decide whether to evict. */
function totalBytes(): { bytes: number; entries: Array<{ name: string; size: number; mtime: number }> } {
	let bytes = 0;
	const entries: Array<{ name: string; size: number; mtime: number }> = [];
	for (const filename of getIndex()) {
		const filepath = join(CACHE_DIR, filename);
		if (!isInsideDir(CACHE_DIR, filepath)) continue;
		try {
			const st = statSync(filepath);
			if (st.isFile()) {
				bytes += st.size;
				entries.push({ name: filename, size: st.size, mtime: st.mtimeMs });
			}
		} catch { /* file vanished — skip */ }
	}
	return { bytes, entries };
}

/**
 * Evict least-recently-modified files until total size drops back under EVICT_TO_FRACTION * MAX_BYTES.
 * No-op if we're already under the cap. Synchronous — called opportunistically after a write.
 */
function evictIfNeeded() {
	const { bytes, entries } = totalBytes();
	if (bytes <= MAX_BYTES) return;

	const target = Math.floor(MAX_BYTES * EVICT_TO_FRACTION);
	entries.sort((a, b) => a.mtime - b.mtime); // oldest first

	let removed = 0;
	let freed = 0;
	let remaining = bytes;
	for (const entry of entries) {
		if (remaining <= target) break;
		const filepath = join(CACHE_DIR, entry.name);
		if (!isInsideDir(CACHE_DIR, filepath)) continue;
		try {
			unlinkSync(filepath);
			getIndex().delete(entry.name);
			remaining -= entry.size;
			freed += entry.size;
			removed++;
		} catch (err) {
			logger.warn('image cache: eviction failed for file', { file: entry.name, err });
		}
	}
	logger.info('image cache evicted', { removed, freedBytes: freed, remainingBytes: remaining, capBytes: MAX_BYTES });
}

// Each cacheImage call holds a buffer in memory + a Sharp worker thread.
// Without a cap, importing cards with many inline images fires dozens of concurrent
// fetch+optimize ops, saturates the libuv thread pool, and starves all other I/O.
const IMAGE_FETCH_CONCURRENCY = 4;
let _imageSlots = IMAGE_FETCH_CONCURRENCY;
const _imageWaiters: Array<() => void> = [];

function acquireImageSlot(): Promise<void> {
	if (_imageSlots > 0) { _imageSlots--; return Promise.resolve(); }
	return new Promise<void>((resolve) => _imageWaiters.push(resolve));
}

function releaseImageSlot(): void {
	const next = _imageWaiters.shift();
	if (next) { next(); } else { _imageSlots++; }
}

/**
 * Download a remote image and cache it locally. Returns the local serving path.
 * If the URL is already a local path (starts with /), it gets returned as-is.
 */
export async function cacheImage(url: string): Promise<string> {
	if (url.startsWith('/')) return url;

	// Admin opt-out — just hand back the original URL.
	if (getAdminSettingBool('disableImageCaching')) return url;

	// http/https only. data:, file:, etc are SSRF magnets.
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return url;
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		return url;
	}

	// No private/internal networks. SSRF protection.
	if (isPrivateHostname(parsed.hostname)) {
		return url;
	}

	// DNS-rebind defence: re-resolve and bail if any A/AAAA points somewhere private.
	try {
		await assertPublicHost(parsed.hostname);
	} catch {
		return url;
	}

	// Already cached? Prefer the optimized .webp variant if both exist.
	const hash = simpleHash(url);
	const prefix = hash + '_';
	const index = getIndex();
	let existing: string | undefined;
	for (const file of index) {
		if (!file.startsWith(prefix)) continue;
		if (file.endsWith('.webp')) { existing = file; break; }
		if (!existing) existing = file;
	}
	if (existing) {
		logger.trace('image cache hit', { url, file: existing });
		return `/api/images/cache/${existing}`;
	}

	await acquireImageSlot();
	try {
		logger.debug('image cache miss → fetch', { url });
		const response = await safeFetch(url, {
			headers: { 'User-Agent': 'Skald/1.0' },
			timeoutMs: 15000
		});

		if (!response.ok) return url; // download flopped, hand back the original

		const contentType = response.headers.get('content-type') || '';

		// M14: only cache things that actually look like images. Without this we'd
		// happily store an attacker's 200 MB binary blob as a "cached image".
		if (contentType && !/^image\//i.test(contentType.split(';')[0].trim())) {
			return url;
		}

		const declaredLen = Number(response.headers.get('content-length') ?? '0');
		if (declaredLen && declaredLen > MAX_IMAGE_BYTES) {
			logger.warn('image cache: oversize content-length, skipping', { url, declaredLen });
			return url;
		}

		// Stream the body and abort if it busts the cap. Beats letting
		// response.arrayBuffer() pull an arbitrary-size payload into memory.
		const body = response.body;
		if (!body) return url;
		const reader = body.getReader();
		const chunks: Uint8Array[] = [];
		let total = 0;
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > MAX_IMAGE_BYTES) {
				await reader.cancel().catch(() => { /* ignore */ });
				logger.warn('image cache: oversize stream, aborting', { url, total });
				return url;
			}
			chunks.push(value);
		}
		const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
		const ext = getExtension(contentType, url);
		const uuid = randomUUID();

		const originalFilename = `${hash}_${uuid}${ext}`;
		await writeFile(join(CACHE_DIR, originalFilename), buffer);
		index.add(originalFilename);

		// Try for an optimized WebP version too — we'll prefer it on serve if it succeeded.
		const optimized = await optimizeCachedImage(buffer, ext);
		let returnPath: string;
		if (optimized) {
			const optimizedFilename = `${hash}_${uuid}${optimized.ext}`;
			await writeFile(join(CACHE_DIR, optimizedFilename), optimized.buffer);
			index.add(optimizedFilename);
			returnPath = `/api/images/cache/${optimizedFilename}`;
		} else {
			returnPath = `/api/images/cache/${originalFilename}`;
		}

		// Eviction is opportunistic post-write — bounded work since most calls do nothing.
		try { evictIfNeeded(); } catch (err) { logger.warn('image cache: evict pass failed', { err }); }

		logger.info('image cached', {
			url,
			bytes: buffer.length,
			optimizedBytes: optimized?.buffer.length,
			webpUsed: !!optimized,
		});

		return returnPath;
	} catch (err) {
		logger.warn('image cache: fetch/store failed', { url, err });
		return url;
	} finally {
		releaseImageSlot();
	}
}

/**
 * Walk markdown content and swap remote ![alt](url) image URLs for cached local ones.
 */
export async function cacheInlineImages(content: string): Promise<string> {
	const imageRegex = /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g;
	const matches = [...content.matchAll(imageRegex)];
	if (matches.length === 0) return content;

	const cached = await Promise.all(matches.map((m) => cacheImage(m[2])));
	let result = content;
	for (let i = 0; i < matches.length; i++) {
		const [fullMatch, alt, url] = matches[i];
		const cachedUrl = cached[i];
		if (cachedUrl !== url) {
			result = result.split(fullMatch).join(`![${alt}](${cachedUrl})`);
		}
	}
	return result;
}

/**
 * Same as cacheInlineImages but for HTML — walks <img src="…"> and CSS url() patterns.
 */
export async function cacheHtmlImages(html: string): Promise<string> {
	const imgSrcRegex = /(<img\b[^>]*\bsrc\s*=\s*["'])(https?:\/\/[^"']+)(["'][^>]*>)/gi;
	const matches = [...html.matchAll(imgSrcRegex)];
	if (matches.length === 0) return html;

	const cached = await Promise.all(matches.map((m) => cacheImage(m[2])));
	let result = html;
	for (let i = 0; i < matches.length; i++) {
		const [fullMatch, prefix, url, suffix] = matches[i];
		const cachedUrl = cached[i];
		if (cachedUrl !== url) {
			result = result.split(fullMatch).join(`${prefix}${cachedUrl}${suffix}`);
		}
	}
	return result;
}

/**
 * Delete cached images that any of these message contents reference.
 * Scans for /api/images/cache/ URLs and unlinks the matching files.
 */
export function deleteCachedImagesFromContent(contents: string[]): void {
	const cacheRegex = /\/api\/images\/cache\/([^)\s"]+)/g;
	const filenames = new Set<string>();
	for (const content of contents) {
		for (const match of content.matchAll(cacheRegex)) {
			filenames.add(match[1]);
		}
	}
	const index = getIndex();
	for (const filename of filenames) {
		// Reject anything that looks like path traversal.
		if (/[\/\\]|\.\./.test(filename)) continue;
		const filepath = join(CACHE_DIR, filename);
		if (!isInsideDir(CACHE_DIR, filepath)) continue;
		if (existsSync(filepath)) {
			try {
				unlinkSync(filepath);
				index.delete(filename);
			} catch (err) {
				logger.warn('image cache: delete failed', { file: filename, err });
			}
		}
	}
}

/**
 * Cache stats: file count, total bytes on disk, and the configured cap.
 */
export function getCacheStats(): { fileCount: number; totalBytes: number; capBytes: number } {
	let totalBytesValue = 0;
	let fileCount = 0;
	for (const filename of getIndex()) {
		const filepath = join(CACHE_DIR, filename);
		if (!isInsideDir(CACHE_DIR, filepath)) continue;
		try {
			const stat = statSync(filepath);
			if (stat.isFile()) {
				totalBytesValue += stat.size;
				fileCount++;
			}
		} catch { /* file may have vanished — skip */ }
	}
	return { fileCount, totalBytes: totalBytesValue, capBytes: MAX_BYTES };
}

/**
 * Delete every file in the image cache. Returns the number of files removed.
 */
export function clearImageCache(): number {
	let removed = 0;
	const index = getIndex();
	for (const filename of [...index]) {
		if (/[\/\\]|\.\./.test(filename)) continue;
		const filepath = join(CACHE_DIR, filename);
		if (!isInsideDir(CACHE_DIR, filepath)) continue;
		try {
			if (existsSync(filepath)) {
				unlinkSync(filepath);
				removed++;
			}
		} catch (err) { logger.warn('image cache: clear failed for file', { file: filename, err }); }
		index.delete(filename);
	}
	return removed;
}

function simpleHash(str: string): string {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		const ch = str.charCodeAt(i);
		hash = ((hash << 5) - hash + ch) | 0;
	}
	return Math.abs(hash).toString(36);
}

function getExtension(contentType: string, url: string): string {
	if (contentType.includes('png')) return '.png';
	if (contentType.includes('gif')) return '.gif';
	if (contentType.includes('webp')) return '.webp';
	if (contentType.includes('svg')) return '.svg';
	if (contentType.includes('jpeg') || contentType.includes('jpg')) return '.jpg';

	// Fallback: try to extract from URL
	const match = url.match(/\.(png|jpe?g|gif|webp|svg)(\?|$)/i);
	if (match) return `.${match[1].toLowerCase()}`;

	return '.jpg'; // Default
}
