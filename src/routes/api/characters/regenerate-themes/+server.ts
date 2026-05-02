import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { characters } from '$lib/db/schema.js';
import { eq } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth.js';
import { extractThemeFromAvatar } from '$lib/services/themeExtractor.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getAvatarOriginalsDir } from '$lib/services/imageOptimizer.js';

export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const allChars = db.select().from(characters).where(eq(characters.userId, user.id)).all();

	let updated = 0;
	let skipped = 0;

	for (const char of allChars) {
		if (!char.avatarPath) {
			skipped++;
			continue;
		}

		// Try originals dir first, then static avatars
		const filename = char.avatarPath.split('/').pop() ?? '';
		const baseName = filename.replace(/\.\w+$/, '');
		const originalsDir = getAvatarOriginalsDir();
		const originalPath = join(originalsDir, `${baseName}.png`);
		const staticPath = join(process.cwd(), 'static', 'avatars', filename);

		let buffer: Buffer | null = null;
		if (existsSync(originalPath)) {
			buffer = readFileSync(originalPath);
		} else if (existsSync(staticPath)) {
			buffer = readFileSync(staticPath);
		}

		if (!buffer) {
			skipped++;
			continue;
		}

		const theme = await extractThemeFromAvatar(buffer);
		if (theme) {
			db.update(characters)
				.set({ theme: JSON.stringify(theme) })
				.where(eq(characters.id, char.id))
				.run();
			updated++;
		} else {
			skipped++;
		}
	}

	return json({ ok: true, updated, skipped });
};
