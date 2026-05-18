import sharp from 'sharp';
import { mkdirSync, existsSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { db } from '$lib/db/index.js';
import { characters, personas } from '$lib/db/schema.js';
import { eq } from 'drizzle-orm';
import { logger } from '$lib/server/logger.js';

const ORIGINALS_DIR = join(process.cwd(), 'data', 'avatars-original');
const OPTIMIZED_DIR = join(process.cwd(), 'static', 'avatars');
mkdirSync(ORIGINALS_DIR, { recursive: true });
mkdirSync(OPTIMIZED_DIR, { recursive: true });

// CRUD-M2 dedup: pick the original-file extension from the upload MIME so
// callers don't all have to maintain their own lookup table.
const EXT_BY_MIME: Record<string, string> = {
	'image/png': '.png',
	'image/jpeg': '.jpg',
	'image/webp': '.webp',
	'image/gif': '.gif',
};

function extFromMime(mime: string | undefined): string {
	if (!mime) return '.bin';
	return EXT_BY_MIME[mime.toLowerCase()] ?? '.bin';
}

/**
 * Returns true if the buffer is a tiny placeholder image (1×1 px or smaller).
 * Used during import to skip saving a fake avatar and let the UI show the
 * initial-letter fallback instead.
 */
export async function isPlaceholderAvatar(buffer: Buffer): Promise<boolean> {
	try {
		const { width, height } = await sharp(buffer).metadata();
		return (width ?? 2) <= 1 && (height ?? 2) <= 1;
	} catch {
		return false;
	}
}

/**
 * Optimize an avatar image: resize to fit within maxSize while preserving aspect ratio,
 * convert to WebP. Returns the WebP buffer.
 */
export async function optimizeAvatar(buffer: Buffer, maxSize = 512): Promise<Buffer> {
	return sharp(buffer)
		.resize(maxSize, maxSize, { fit: 'inside', withoutEnlargement: true })
		.webp({ quality: 85 })
		.toBuffer();
}

/**
 * Optimize a general image (cached creator notes, message images).
 * Larger max size since these are content images, not thumbnails.
 * Skips SVGs and GIFs (animated).
 */
export async function optimizeCachedImage(buffer: Buffer, ext: string, maxSize = 1920): Promise<{ buffer: Buffer; ext: string } | null> {
	// Skip SVG (sharp would rasterize and lose vector data) and GIF (sharp's
	// WebP encoder serializes only the first frame, which silently turns
	// animated reactions/avatars into a single still image). Better to serve
	// the original than break the animation.
	const skipFormats = ['.svg', '.gif'];
	if (skipFormats.includes(ext.toLowerCase())) return null;

	const optimized = await sharp(buffer)
		.resize(maxSize, maxSize, { fit: 'inside', withoutEnlargement: true })
		.webp({ quality: 85 })
		.toBuffer();

	return { buffer: optimized, ext: '.webp' };
}

/** Get the path to the originals directory for avatars. */
export function getAvatarOriginalsDir(): string {
	return ORIGINALS_DIR;
}

/** Check if an original avatar exists for a given filename. */
export function getOriginalAvatarPath(optimizedFilename: string): string | null {
	// Optimized: static/avatars/uuid.webp → Original: data/avatars-original/uuid.png (or any ext)
	const base = optimizedFilename.replace(/\.[^.]+$/, '');
	const origDir = ORIGINALS_DIR;
	if (!existsSync(origDir)) return null;

	for (const ext of ['.png', '.jpg', '.jpeg', '.webp', '.gif']) {
		const candidate = join(origDir, base + ext);
		if (existsSync(candidate)) return candidate;
	}
	return null;
}

/**
 * CRUD-M2: content-addressed avatar storage. Hashes the original buffer and
 * writes the original + optimized webp under that hash. If a webp with the
 * same hash already exists, both writes are skipped — multiple characters or
 * personas can then share the same disk file. Returns the `/avatars/...`
 * path callers should store in the DB.
 *
 * The hash is over the original bytes, not the optimized webp: two slightly
 * different originals can deterministically optimize to identical webp, and
 * we don't want to silently merge them. Original bytes are the source of
 * truth.
 */
export async function storeAvatarFromBuffer(buffer: Buffer, mime: string | undefined): Promise<string> {
	// 24 hex chars ≈ 96 bits of sha256 — collision-free in practice for the
	// volumes this app sees, and keeps the filenames short.
	const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 24);
	const optimizedName = `${hash}.webp`;
	const optimizedPath = join(OPTIMIZED_DIR, optimizedName);

	if (!existsSync(optimizedPath)) {
		const originalName = `${hash}${extFromMime(mime)}`;
		const originalPath = join(ORIGINALS_DIR, originalName);
		if (!existsSync(originalPath)) {
			try {
				writeFileSync(originalPath, buffer);
			} catch (err) {
				// Original is best-effort — full-resolution view degrades but the
				// optimized webp still serves.
				logger.warn('storeAvatarFromBuffer: original save failed', { err: err instanceof Error ? err.message : String(err) });
			}
		}
		const optimized = await optimizeAvatar(buffer);
		writeFileSync(optimizedPath, optimized);
	}

	return `/avatars/${optimizedName}`;
}

/**
 * CRUD-M2: refcount-aware unlink. Counts how many characters + personas
 * still reference the same `avatar_path`; only unlinks the on-disk files
 * when nobody else points at them. Callers should run this AFTER they've
 * already removed/updated the row that referenced the path.
 *
 * Quietly no-ops on null / non-/avatars paths / IO errors — avatar cleanup
 * is a disk-space optimisation, never a correctness requirement.
 */
export function tryDeleteUnreferencedAvatar(avatarPath: string | null | undefined): void {
	if (!avatarPath || !avatarPath.startsWith('/avatars/')) return;
	try {
		const charRefs = db.select({ id: characters.id }).from(characters).where(eq(characters.avatarPath, avatarPath)).all();
		if (charRefs.length > 0) return;
		const personaRefs = db.select({ id: personas.id }).from(personas).where(eq(personas.avatarPath, avatarPath)).all();
		if (personaRefs.length > 0) return;

		const optimizedFile = join(process.cwd(), 'static', avatarPath.replace(/^\//, ''));
		if (existsSync(optimizedFile)) unlinkSync(optimizedFile);
		const basename = avatarPath.split('/').pop() || '';
		const original = getOriginalAvatarPath(basename);
		if (original && existsSync(original)) unlinkSync(original);
	} catch (err) {
		logger.warn('tryDeleteUnreferencedAvatar: cleanup failed', { avatarPath, err: err instanceof Error ? err.message : String(err) });
	}
}
