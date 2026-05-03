/**
 * CHUB.ai (chub.ai / venus.chub.ai) API client.
 *
 * Read-only browse + binary download. No auth needed for public projects.
 * Built so we can bolt on auth (CH-API-KEY), favourites, and richer metadata
 * later without breaking callers.
 */

import { logger } from '$lib/server/logger.js';
import { getAdminSettingNumber } from '$lib/server/adminSettings.js';

const CHUB_API_BASE = 'https://api.chub.ai';
const CHUB_USER_AGENT = 'Skald/1.x (+https://github.com/) chub-browse';
const FETCH_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 30_000;

/**
 * Server-wide outbound throttle so we play nice with CHUB. Sliding-window
 * timestamps shared across all users — if we'd blow past the per-minute cap we
 * wait just long enough for the oldest call to fall off the window. Capped wait
 * so a request never blocks for more than ~10s; past that, propagate as a
 * normal failure and let the user retry.
 */
const chubCallTimestamps: number[] = [];
const CHUB_THROTTLE_WINDOW_MS = 60_000;
const CHUB_THROTTLE_MAX_WAIT_MS = 10_000;

async function chubThrottle(): Promise<void> {
	const max = getAdminSettingNumber('chubGlobalRateLimit') || 120;
	const start = Date.now();
	while (true) {
		const now = Date.now();
		const cutoff = now - CHUB_THROTTLE_WINDOW_MS;
		while (chubCallTimestamps.length && chubCallTimestamps[0] < cutoff) {
			chubCallTimestamps.shift();
		}
		if (chubCallTimestamps.length < max) {
			chubCallTimestamps.push(now);
			return;
		}
		const waitFor = Math.min(
			500,
			CHUB_THROTTLE_WINDOW_MS - (now - chubCallTimestamps[0]) + 25,
		);
		if (now - start + waitFor > CHUB_THROTTLE_MAX_WAIT_MS) {
			logger.warn('chub global throttle saturated', { max, waitedMs: now - start });
			throw new Error('CHUB API is busy — please retry in a moment.');
		}
		await new Promise((r) => setTimeout(r, waitFor));
	}
}

async function chubFetch(url: string, init: RequestInit): Promise<Response> {
	await chubThrottle();
	return fetch(url, init);
}

export type ChubNamespace = 'characters' | 'lorebooks';

export type ChubSort = 'download_count' | 'last_activity_at' | 'created_at' | 'rating' | 'n_favorites';

export interface ChubSearchOptions {
	namespace: ChubNamespace;
	search?: string;
	page?: number;
	first?: number; // page size
	sort?: ChubSort;
	asc?: boolean;
	nsfw?: boolean;
	include_forks?: boolean;
	tags?: string;
	exclude_tags?: string;
	min_tokens?: number;
}

/** Normalised card for the UI. We pass `raw` through too so callers can grow
 *  without us having to keep this in sync every release. */
export interface ChubCard {
	id: number;
	fullPath: string;
	name: string;
	tagline: string;
	description: string;
	avatar_url: string | null;
	max_res_url: string | null;
	creator: string;
	tags: string[];
	topics: string[];
	nsfw: boolean;
	starCount: number;
	nTokens: number;
	nMessages: number;
	nFavorites: number;
	rating: number;
	ratingCount: number;
	createdAt: string | null;
	lastActivityAt: string | null;
	raw: unknown;
}

export interface ChubSearchResult {
	nodes: ChubCard[];
	count: number;
	page: number;
	first: number;
}

function withTimeout(ms: number): { signal: AbortSignal; cancel: () => void } {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), ms);
	return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

function toStringArray(v: unknown): string[] {
	if (Array.isArray(v)) return v.filter((x) => typeof x === 'string') as string[];
	if (typeof v === 'string') {
		try {
			const parsed = JSON.parse(v);
			if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === 'string');
		} catch { /* fallthrough */ }
		return v.split(',').map((s) => s.trim()).filter(Boolean);
	}
	return [];
}

function pickNumber(v: unknown, fallback = 0): number {
	const n = typeof v === 'string' ? Number(v) : (v as number);
	return Number.isFinite(n) ? n : fallback;
}

function pickString(v: unknown, fallback = ''): string {
	return typeof v === 'string' ? v : fallback;
}

function normaliseNode(raw: unknown): ChubCard | null {
	if (!raw || typeof raw !== 'object') return null;
	const r = raw as Record<string, unknown>;
	const fullPath = pickString(r.fullPath);
	if (!fullPath) return null;
	const creator = fullPath.split('/')[0] || pickString(r.username);
	return {
		id: pickNumber(r.id),
		fullPath,
		name: pickString(r.name) || fullPath,
		tagline: pickString(r.tagline),
		description: pickString(r.description),
		avatar_url: typeof r.avatar_url === 'string' ? r.avatar_url : null,
		max_res_url: typeof r.max_res_url === 'string' ? r.max_res_url : null,
		creator,
		tags: toStringArray(r.tags),
		topics: toStringArray(r.topics),
		nsfw: Boolean(r.nsfw_image) || Boolean(r.nsfw_text) || Boolean((r as Record<string, unknown>).nsfw),
		starCount: pickNumber(r.starCount),
		nTokens: pickNumber(r.nTokens),
		nMessages: pickNumber(r.nMessages),
		nFavorites: pickNumber(r.n_favorites),
		rating: pickNumber(r.rating),
		ratingCount: pickNumber(r.ratingCount),
		createdAt: typeof r.createdAt === 'string' ? r.createdAt : null,
		lastActivityAt: typeof r.lastActivityAt === 'string' ? r.lastActivityAt : null,
		raw,
	};
}

export async function chubSearch(opts: ChubSearchOptions): Promise<ChubSearchResult> {
	const page = Math.max(1, opts.page ?? 1);
	const first = Math.min(48, Math.max(1, opts.first ?? 24));

	const params = new URLSearchParams();
	params.set('namespace', opts.namespace);
	params.set('first', String(first));
	params.set('page', String(page));
	params.set('sort', opts.sort ?? 'download_count');
	params.set('asc', String(Boolean(opts.asc)));
	params.set('nsfw', String(Boolean(opts.nsfw)));
	params.set('include_forks', String(Boolean(opts.include_forks)));
	params.set('require_lore', 'false');
	params.set('require_images', 'false');
	params.set('require_example_dialogues', 'false');
	params.set('require_alternate_greetings', 'false');
	params.set('venus', 'true');
	params.set('count', 'true');
	if (opts.search?.trim()) params.set('search', opts.search.trim().slice(0, 300));
	if (opts.tags) params.set('tags', opts.tags.slice(0, 1000));
	if (opts.exclude_tags) params.set('exclude_tags', opts.exclude_tags.slice(0, 1000));
	if (opts.min_tokens != null) params.set('min_tokens', String(opts.min_tokens));

	const url = `${CHUB_API_BASE}/search?${params.toString()}`;
	const startedAt = Date.now();
	logger.debug('chub: search', { namespace: opts.namespace, page, first, sort: opts.sort, hasQuery: !!opts.search?.trim() });
	const { signal, cancel } = withTimeout(FETCH_TIMEOUT_MS);
	try {
		const res = await chubFetch(url, {
			method: 'GET',
			headers: { Accept: 'application/json', 'User-Agent': CHUB_USER_AGENT },
			signal,
		});
		if (!res.ok) {
			const text = await res.text().catch(() => '');
			throw new Error(`CHUB search failed (${res.status}): ${text.slice(0, 200)}`);
		}
		const json = (await res.json()) as Record<string, unknown>;
		// Response shape varies: some endpoints wrap in { data: { nodes, count } },
		// others put nodes/count at the top level. Handle both.
		const data = (json.data && typeof json.data === 'object' ? (json.data as Record<string, unknown>) : json);
		const rawNodes = Array.isArray(data.nodes)
			? data.nodes
			: Array.isArray((json as Record<string, unknown>).nodes)
				? ((json as Record<string, unknown>).nodes as unknown[])
				: [];
		const count = pickNumber(data.count ?? (json as Record<string, unknown>).count, rawNodes.length);
		const nodes = rawNodes
			.map((n) => normaliseNode(n))
			.filter((n): n is ChubCard => n !== null);
		logger.debug('chub: search complete', { count, returned: nodes.length, durationMs: Date.now() - startedAt });
		return { nodes, count, page, first };
	} finally {
		cancel();
	}
}

/** Parsed `creator/slug` from a CHUB fullPath, with the optional namespace prefix stripped. */
function parseFullPath(raw: string): { creator: string; slug: string; safeSlug: string } {
	const trimmed = raw.trim();
	if (!trimmed || trimmed.includes('..') || !trimmed.includes('/') || trimmed.length > 200) {
		throw new Error('Invalid CHUB fullPath');
	}
	const segments = trimmed.split('/').filter(Boolean);
	if (segments[0] === 'characters' || segments[0] === 'lorebooks') segments.shift();
	if (segments.length < 2) throw new Error('Invalid CHUB fullPath');
	const creator = segments[0];
	const slug = segments.slice(1).join('/');
	if (!/^[A-Za-z0-9_.-]+$/.test(creator) || !/^[A-Za-z0-9_./-]+$/.test(slug)) {
		throw new Error('Invalid CHUB fullPath');
	}
	const safeSlug = `${creator}_${slug}`.replace(/[^a-zA-Z0-9_-]+/g, '_');
	return { creator, slug, safeSlug };
}

function encodeSlug(slug: string): string {
	return slug.split('/').map(encodeURIComponent).join('/');
}

/** Detail returned to the preview pane. Character/lorebook fields overlap a lot,
 *  so we share one shape and mark which fields are actually populated for each. */
export interface ChubPreview {
	type: 'character' | 'lorebook';
	fullPath: string;
	name: string;
	creator: string;
	tagline: string;
	description: string;
	avatar_url: string | null;
	max_res_url: string | null;
	tags: string[];
	topics: string[];
	nsfw: boolean;
	starCount: number;
	nFavorites: number;
	nTokens: number;
	rating: number;
	ratingCount: number;
	createdAt: string | null;
	lastActivityAt: string | null;
	// Character-only
	personality: string;
	scenario: string;
	first_message: string;
	example_dialogs: string;
	system_prompt: string;
	post_history_instructions: string;
	alternate_greetings: string[];
	creator_notes: string;
	// Lorebook-only
	lorebookEntryCount: number;
	lorebookEntries: { keys: string[]; content: string }[];
}

/**
 * Fetch the full project metadata for a CHUB character or lorebook so the browse
 * modal can show its preview pane. Calls the same `?full=true` endpoint that
 * `chubDownload` uses, just shaped for display rather than re-import.
 */
export async function chubFetchPreview(opts: {
	type: 'character' | 'lorebook';
	fullPath: string;
}): Promise<ChubPreview> {
	const { creator, slug } = parseFullPath(opts.fullPath);
	const namespace = opts.type === 'character' ? 'characters' : 'lorebooks';
	const url = `${CHUB_API_BASE}/api/${namespace}/${encodeURIComponent(creator)}/${encodeSlug(slug)}?full=true`;

	const { signal, cancel } = withTimeout(FETCH_TIMEOUT_MS);
	try {
		const res = await chubFetch(url, {
			method: 'GET',
			headers: { Accept: 'application/json', 'User-Agent': CHUB_USER_AGENT },
			signal,
		});
		if (!res.ok) {
			const text = await res.text().catch(() => '');
			logger.warn('chub preview failed', { status: res.status, fullPath: opts.fullPath, type: opts.type });
			throw new Error(`CHUB preview failed (${res.status}): ${text.slice(0, 200)}`);
		}
		const data = (await res.json()) as Record<string, unknown>;
		const node = (data && typeof data === 'object' ? (data as Record<string, unknown>).node : null) as Record<string, unknown> | null;
		if (!node) throw new Error('CHUB preview returned no project node');
		const def = (typeof node.definition === 'object' && node.definition !== null
			? (node.definition as Record<string, unknown>)
			: {}) as Record<string, unknown>;

		const altGreetings = Array.isArray(def.alternate_greetings)
			? (def.alternate_greetings as unknown[]).filter((s): s is string => typeof s === 'string')
			: [];

		// Lorebook entries live under definition.embedded_lorebook.entries (or sometimes def.entries).
		const embedded = (def.embedded_lorebook && typeof def.embedded_lorebook === 'object'
			? (def.embedded_lorebook as Record<string, unknown>)
			: null);
		const rawEntries = Array.isArray(embedded?.entries)
			? (embedded.entries as unknown[])
			: Array.isArray((def as Record<string, unknown>).entries)
				? ((def as Record<string, unknown>).entries as unknown[])
				: [];
		// Truncate per-entry content for preview to keep payload small.
		const lorebookEntries = rawEntries.slice(0, 50).map((e) => {
			const eo = (e && typeof e === 'object' ? (e as Record<string, unknown>) : {}) as Record<string, unknown>;
			const keys = Array.isArray(eo.keys)
				? (eo.keys as unknown[]).filter((k): k is string => typeof k === 'string')
				: typeof eo.keys === 'string' ? [eo.keys] : [];
			const content = pickString(eo.content).slice(0, 500);
			return { keys, content };
		});

		return {
			type: opts.type,
			fullPath: pickString(node.fullPath) || opts.fullPath,
			name: pickString(node.name) || slug,
			creator,
			tagline: pickString(node.tagline),
			description: pickString(node.description),
			avatar_url: typeof node.avatar_url === 'string' ? node.avatar_url : null,
			max_res_url: typeof node.max_res_url === 'string' ? node.max_res_url : null,
			tags: toStringArray((node as Record<string, unknown>).tags),
			topics: toStringArray(node.topics),
			nsfw: Boolean(node.nsfw_image) || Boolean((node as Record<string, unknown>).nsfw_text),
			starCount: pickNumber(node.starCount),
			nFavorites: pickNumber(node.n_favorites),
			nTokens: pickNumber(node.nTokens),
			rating: pickNumber(node.rating),
			ratingCount: pickNumber(node.ratingCount),
			createdAt: typeof node.createdAt === 'string' ? node.createdAt : null,
			lastActivityAt: typeof node.lastActivityAt === 'string' ? node.lastActivityAt : null,
			personality: pickString(def.personality) || pickString(def.tavern_personality),
			scenario: pickString(def.scenario),
			first_message: pickString(def.first_message),
			example_dialogs: pickString(def.example_dialogs),
			system_prompt: pickString(def.system_prompt),
			post_history_instructions: pickString(def.post_history_instructions),
			alternate_greetings: altGreetings,
			creator_notes: pickString((def as Record<string, unknown>).creator_notes),
			lorebookEntryCount: rawEntries.length,
			lorebookEntries,
		};
	} finally {
		cancel();
	}
}

/**
 * Download a character PNG (Tavern Card v2) or a lorebook JSON from CHUB.
 *
 * The legacy POST `/api/{namespace}/download` endpoints now return 405 from
 * Cloudflare. The reliable public path is:
 *   - Characters: pull the embedded Tavern Card PNG straight off the avatar
 *     CDN at `https://avatars.charhub.io/avatars/{creator}/{slug}/chara_card_v2.png`.
 *   - Lorebooks:  fetch the project JSON via `/api/lorebooks/{creator}/{slug}?full=true`
 *     and serialise `node.definition.embedded_lorebook` (Tavern v2 character_book
 *     shape, which our import endpoint already understands).
 */
export async function chubDownload(opts: {
	type: 'character' | 'lorebook';
	fullPath: string;
}): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
	const { creator, slug, safeSlug } = parseFullPath(opts.fullPath);
	const startedAt = Date.now();
	logger.debug('chub: download', { fullPath: opts.fullPath, type: opts.type });

	const { signal, cancel } = withTimeout(DOWNLOAD_TIMEOUT_MS);
	try {
		if (opts.type === 'character') {
			const url = `https://avatars.charhub.io/avatars/${encodeURIComponent(creator)}/${encodeSlug(slug)}/chara_card_v2.png`;
			const res = await chubFetch(url, {
				method: 'GET',
				headers: { Accept: 'image/png, application/octet-stream', 'User-Agent': CHUB_USER_AGENT },
				signal,
			});
			if (!res.ok) {
				const text = await res.text().catch(() => '');
				logger.warn('chub download failed', { status: res.status, fullPath: opts.fullPath, type: 'character' });
				throw new Error(`CHUB download failed (${res.status}): ${text.slice(0, 200)}`);
			}
			const buffer = Buffer.from(await res.arrayBuffer());
			logger.info('chub: download complete', {
				fullPath: opts.fullPath, type: 'character', bytes: buffer.length, durationMs: Date.now() - startedAt,
			});
			return {
				buffer,
				contentType: res.headers.get('content-type') || 'image/png',
				filename: `${safeSlug}.png`,
			};
		}

		// lorebook
		const projectUrl = `${CHUB_API_BASE}/api/lorebooks/${encodeURIComponent(creator)}/${encodeSlug(slug)}?full=true`;
		const res = await chubFetch(projectUrl, {
			method: 'GET',
			headers: { Accept: 'application/json', 'User-Agent': CHUB_USER_AGENT },
			signal,
		});
		if (!res.ok) {
			const text = await res.text().catch(() => '');
			logger.warn('chub download failed', { status: res.status, fullPath: opts.fullPath, type: 'lorebook' });
			throw new Error(`CHUB download failed (${res.status}): ${text.slice(0, 200)}`);
		}
		const data = (await res.json()) as Record<string, unknown>;
		const node = (data && typeof data === 'object' ? (data as Record<string, unknown>).node : null) as Record<string, unknown> | null;
		const definition = node && typeof node.definition === 'object' && node.definition !== null
			? (node.definition as Record<string, unknown>)
			: null;
		const embedded = definition && typeof definition.embedded_lorebook === 'object'
			? definition.embedded_lorebook
			: null;
		// Fall back to the definition itself if it already looks like a character_book.
		const book = embedded ?? (definition && Array.isArray((definition as Record<string, unknown>).entries) ? definition : null);
		if (!book) {
			logger.warn('chub lorebook missing embedded_lorebook', { fullPath: opts.fullPath });
			throw new Error('CHUB lorebook is empty or has no entries');
		}
		// Wrap in the shape our import endpoint already auto-detects.
		// Make the CHUB project name AUTHORITATIVE (override any junk `name`
		// embedded in the lorebook itself, e.g. generic strings like
		// "Exported" that some uploads ship with).
		const projectName = pickString((node as Record<string, unknown>)?.name) || slug;
		const wrapped = { ...((book as Record<string, unknown>) ?? {}), name: projectName };
		const buffer = Buffer.from(JSON.stringify(wrapped), 'utf-8');
		logger.info('chub: download complete', {
			fullPath: opts.fullPath, type: 'lorebook', bytes: buffer.length, durationMs: Date.now() - startedAt,
		});
		return { buffer, contentType: 'application/json', filename: `${safeSlug}.json` };
	} finally {
		cancel();
	}
}
