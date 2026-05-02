import sharp from 'sharp';
import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const ORIGINALS_DIR = join(process.cwd(), 'data', 'avatars-original');
mkdirSync(ORIGINALS_DIR, { recursive: true });

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
