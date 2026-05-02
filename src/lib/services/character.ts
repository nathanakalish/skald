/**
 * Character card parsing and export.
 * Supports V2 (chara_card_v2) and V3 (chara_card_v3) PNG character cards.
 *
 * PNG cards stash the JSON data (base64-encoded) in a tEXt chunk with keyword "chara".
 */

export interface CharaBookEntry {
	keys: string[];
	content: string;
	enabled: boolean;
	insertionOrder: number;
	caseSensitive: boolean;
	constant: boolean;
}

export interface CharaBook {
	name: string;
	entries: CharaBookEntry[];
}

export interface CharaCardData {
	name: string;
	description: string;
	personality: string;
	scenario: string;
	firstMessage: string;
	mesExample: string;
	systemPrompt: string;
	postHistoryInstructions: string;
	alternateGreetings: string[];
	tags: string[];
	creator: string;
	creatorNotes: string;
	characterVersion: string;
	extensions: Record<string, unknown>;
	characterBook: CharaBook | null;
}

/**
 * Pull the "chara" tEXt chunk out of a PNG buffer and parse the character card JSON.
 */
export function parseCharaCardFromPNG(buffer: Buffer): CharaCardData {
	// PNG magic bytes — if these don't match, it's not a PNG.
	const pngSig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
	if (buffer.subarray(0, 8).compare(pngSig) !== 0) {
		throw new Error('Not a valid PNG file');
	}

	let offset = 8;
	while (offset < buffer.length) {
		if (offset + 8 > buffer.length) break;

		const length = buffer.readUInt32BE(offset);
		const chunkType = buffer.subarray(offset + 4, offset + 8).toString('ascii');
		const dataStart = offset + 8;
		const dataEnd = dataStart + length;

		if (dataEnd > buffer.length) break;

		if (chunkType === 'tEXt') {
			const data = buffer.subarray(dataStart, dataEnd);
			const nullIdx = data.indexOf(0);
			if (nullIdx !== -1) {
				const keyword = data.subarray(0, nullIdx).toString('latin1');
				if (keyword === 'chara') {
					const text = data.subarray(nullIdx + 1).toString('latin1');
					const decoded = Buffer.from(text, 'base64').toString('utf-8');
					return parseCharaJSON(JSON.parse(decoded));
				}
			}
		}

		// Skip past: length(4) + type(4) + data(length) + crc(4)
		offset = dataEnd + 4;
	}

	throw new Error('No character card data found in PNG');
}

/**
 * Parse a character card JSON object (V2 or V3 format) into our normalized shape.
 */
export function parseCharaJSON(raw: Record<string, unknown>): CharaCardData {
	// V3 and V2 both shove the detailed fields into a `data` sub-object.
	const data = (raw.data as Record<string, unknown>) ?? raw;

	return {
		name: str(data.name ?? raw.name),
		description: str(data.description ?? raw.description),
		personality: str(data.personality ?? raw.personality),
		scenario: str(data.scenario ?? raw.scenario),
		firstMessage: str(data.first_mes ?? raw.first_mes),
		mesExample: str(data.mes_example ?? raw.mes_example),
		systemPrompt: str(data.system_prompt ?? raw.system_prompt),
		postHistoryInstructions: str(data.post_history_instructions ?? raw.post_history_instructions),
		alternateGreetings: arrStr(data.alternate_greetings ?? raw.alternate_greetings),
		tags: arrStr(data.tags ?? raw.tags),
		creator: str(data.creator ?? raw.creator),
		creatorNotes: str(data.creator_notes ?? raw.creator_notes ?? raw.creatorcomment),
		characterVersion: str(data.character_version ?? raw.character_version),
		extensions: (typeof data.extensions === 'object' && data.extensions !== null
			? data.extensions
			: {}) as Record<string, unknown>,
		characterBook: parseCharacterBook(data.character_book)
	};
}

/**
 * Embed character card JSON into a PNG as a tEXt chunk with keyword "chara".
 * Data is base64-encoded and inserted before the first IDAT chunk.
 */
export function embedCharaCardInPNG(pngBuffer: Buffer, cardJSON: Record<string, unknown>): Buffer {
	const base64Data = Buffer.from(JSON.stringify(cardJSON)).toString('base64');
	const keyword = Buffer.from('chara', 'latin1');
	const nullSep = Buffer.from([0]);
	const textData = Buffer.from(base64Data, 'latin1');
	const chunkData = Buffer.concat([keyword, nullSep, textData]);

	// Build tEXt chunk: length(4) + "tEXt"(4) + data + crc(4)
	const chunkLength = Buffer.alloc(4);
	chunkLength.writeUInt32BE(chunkData.length, 0);
	const chunkType = Buffer.from('tEXt', 'ascii');
	const crcInput = Buffer.concat([chunkType, chunkData]);
	const crc = crc32(crcInput);
	const crcBuf = Buffer.alloc(4);
	crcBuf.writeUInt32BE(crc >>> 0, 0);

	const charaChunk = Buffer.concat([chunkLength, chunkType, chunkData, crcBuf]);

	// Insert before the first IDAT chunk. First, strip any existing 'chara'
	// tEXt chunks so we don't end up with duplicates.
	const cleanPng = stripCharaChunks(pngBuffer);

	let offset = 8; // skip PNG signature
	while (offset < cleanPng.length) {
		const len = cleanPng.readUInt32BE(offset);
		const type = cleanPng.subarray(offset + 4, offset + 8).toString('ascii');
		if (type === 'IDAT') {
			const before = cleanPng.subarray(0, offset);
			const after = cleanPng.subarray(offset);
			return Buffer.concat([before, charaChunk, after]);
		}
		offset += 12 + len; // length(4) + type(4) + data + crc(4)
	}

	// No IDAT? Weird, but stick it before IEND as a fallback.
	const iendOffset = cleanPng.length - 12;
	const before = cleanPng.subarray(0, iendOffset);
	const after = cleanPng.subarray(iendOffset);
	return Buffer.concat([before, charaChunk, after]);
}

function stripCharaChunks(png: Buffer): Buffer {
	const parts: Buffer[] = [png.subarray(0, 8)]; // PNG signature
	let offset = 8;

	while (offset < png.length) {
		const len = png.readUInt32BE(offset);
		const type = png.subarray(offset + 4, offset + 8).toString('ascii');
		const chunkEnd = offset + 12 + len;

		let isChara = false;
		if (type === 'tEXt') {
			const data = png.subarray(offset + 8, offset + 8 + len);
			const nullIdx = data.indexOf(0);
			if (nullIdx !== -1 && data.subarray(0, nullIdx).toString('latin1') === 'chara') {
				isChara = true;
			}
		}

		if (!isChara) {
			parts.push(png.subarray(offset, chunkEnd));
		}
		offset = chunkEnd;
	}

	return Buffer.concat(parts);
}

/**
 * Convert our DB character row to V2 card JSON for export.
 */
export function toCharaCardJSON(character: {
	name: string;
	description: string;
	personality: string;
	scenario: string;
	firstMessage: string;
	mesExample: string;
	systemPrompt: string;
	postHistoryInstructions: string;
	alternateGreetings: string;
	tags: string;
	creator: string;
	creatorNotes: string;
	characterVersion: string;
	extensions: string;
}): Record<string, unknown> {
	let altGreetings: string[] = [];
	try {
		altGreetings = JSON.parse(character.alternateGreetings || '[]');
	} catch { /* empty */ }

	let tagsList: string[] = [];
	try {
		tagsList = JSON.parse(character.tags || '[]');
		if (!Array.isArray(tagsList)) {
			tagsList = character.tags
				? character.tags.split(',').map((t: string) => t.trim()).filter(Boolean)
				: [];
		}
	} catch {
		tagsList = character.tags
			? character.tags.split(',').map((t: string) => t.trim()).filter(Boolean)
			: [];
	}

	let extensions: Record<string, unknown> = {};
	try {
		extensions = JSON.parse(character.extensions || '{}');
	} catch { /* empty */ }

	return {
		spec: 'chara_card_v2',
		spec_version: '2.0',
		data: {
			name: character.name,
			description: character.description || '',
			personality: character.personality || '',
			scenario: character.scenario || '',
			first_mes: character.firstMessage || '',
			mes_example: character.mesExample || '',
			system_prompt: character.systemPrompt || '',
			post_history_instructions: character.postHistoryInstructions || '',
			alternate_greetings: altGreetings,
			tags: tagsList,
			creator: character.creator || '',
			creator_notes: character.creatorNotes || '',
			character_version: character.characterVersion || '',
			character_book: null,
			extensions
		}
	};
}

// ---- Helpers ----

export function parseCharacterBook(raw: unknown): CharaBook | null {
	if (!raw || typeof raw !== 'object') return null;
	const book = raw as Record<string, unknown>;
	const rawEntries = book.entries;
	if (!Array.isArray(rawEntries) || rawEntries.length === 0) return null;

	const entries: CharaBookEntry[] = rawEntries.map((e: Record<string, unknown>) => ({
		keys: Array.isArray(e.keys) ? e.keys.map(String) : [],
		content: str(e.content),
		enabled: e.enabled !== false,
		insertionOrder: typeof e.insertion_order === 'number' ? e.insertion_order : 100,
		caseSensitive: e.case_sensitive === true,
		constant: e.constant === true,
	})).filter(e => e.keys.length > 0 && e.content);

	if (entries.length === 0) return null;

	return {
		name: str(book.name) || 'Character Lorebook',
		entries,
	};
}

function str(v: unknown): string {
	return typeof v === 'string' ? v : '';
}

function arrStr(v: unknown): string[] {
	if (Array.isArray(v)) return v.map((x) => String(x));
	return [];
}

// CRC32 for PNG chunks
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
