import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { characters } from '$lib/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { toCharaCardJSON, embedCharaCardInPNG } from '$lib/services/character.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { requireUser } from '$lib/server/auth.js';
import { getAdminSettingBool } from '$lib/server/adminSettings.js';
import { getOriginalAvatarPath } from '$lib/services/imageOptimizer.js';
import { ApiError } from '$lib/server/apiError.js';

export const GET: RequestHandler = async (event) => {
	const user = requireUser(event);

	if (!getAdminSettingBool('allowCharacterExport') && user.role !== 'admin') {
		return ApiError.forbidden('Character export is disabled by the administrator');
	}

	const id = Number(event.params.id);
	const format = event.url.searchParams.get('format') || 'json';
	const character = db.select().from(characters).where(and(eq(characters.id, id), eq(characters.userId, user.id))).get();

	if (!character) throw error(404, 'Character not found');

	const cardJSON = toCharaCardJSON(character as Parameters<typeof toCharaCardJSON>[0]);

	if (format === 'json') {
		const payload = JSON.stringify(cardJSON);
		event.locals.logger?.info('characters: exported', { characterId: id, format: 'json', bytes: payload.length });
		return json(cardJSON);
	}

	if (format === 'png') {
		let pngBuffer: Buffer;

		// If the character has an avatar, use the original full-res file for export
		if (character.avatarPath) {
			const basename = character.avatarPath.split('/').pop() || '';
			const originalPath = getOriginalAvatarPath(basename);
			if (originalPath && existsSync(originalPath)) {
				pngBuffer = readFileSync(originalPath);
			} else {
				// Fall back to the optimized version in static/
				const avatarFile = join(process.cwd(), 'static', character.avatarPath);
				if (existsSync(avatarFile)) {
					pngBuffer = readFileSync(avatarFile);
				} else {
					pngBuffer = createMinimalPNG();
				}
			}
		} else {
			pngBuffer = createMinimalPNG();
		}

		const outputBuffer = embedCharaCardInPNG(pngBuffer, cardJSON);
		const safeName = character.name.replace(/[^a-zA-Z0-9_-]/g, '_');

		event.locals.logger?.info('characters: exported', { characterId: id, format: 'png', bytes: outputBuffer.length });

		return new Response(new Uint8Array(outputBuffer), {
			headers: {
				'Content-Type': 'image/png',
				'Content-Disposition': `attachment; filename="${safeName}.png"`
			}
		});
	}

	return ApiError.badRequest('Invalid format. Use json or png');
};

/**
 * Create a minimal 1x1 transparent PNG for characters without an avatar.
 */
function createMinimalPNG(): Buffer {
	// Minimal valid PNG: 1x1 RGBA transparent pixel
	const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

	// IHDR chunk
	const ihdrData = Buffer.alloc(13);
	ihdrData.writeUInt32BE(1, 0);  // width
	ihdrData.writeUInt32BE(1, 4);  // height
	ihdrData[8] = 8;              // bit depth
	ihdrData[9] = 6;              // color type RGBA
	const ihdr = makeChunk('IHDR', ihdrData);

	// IDAT chunk (zlib-compressed: filter byte 0 + 4 bytes RGBA)
	const idatRaw = Buffer.from([
		0x78, 0x01, 0x62, 0x60, 0x60, 0x60, 0x60, 0x00, 0x00, 0x00, 0x05, 0x00, 0x01
	]);
	const idat = makeChunk('IDAT', idatRaw);

	// IEND chunk
	const iend = makeChunk('IEND', Buffer.alloc(0));

	return Buffer.concat([sig, ihdr, idat, iend]);
}

function makeChunk(type: string, data: Buffer): Buffer {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length, 0);
	const typeBuf = Buffer.from(type, 'ascii');
	const crcInput = Buffer.concat([typeBuf, data]);
	const crc = crc32(crcInput);
	const crcBuf = Buffer.alloc(4);
	crcBuf.writeUInt32BE(crc >>> 0, 0);
	return Buffer.concat([len, typeBuf, data, crcBuf]);
}

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		table[n] = c;
	}
	return table;
})();

function crc32(buf: Buffer): number {
	let c = 0xffffffff;
	for (let i = 0; i < buf.length; i++) {
		c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
	}
	return (c ^ 0xffffffff) >>> 0;
}
