// Roleplay text formatter. Stack-based pairing for *thoughts* and "speech",
// optional nested emphasis inside speech, plus an explicit narration wrapper
// for "everything else". Output is HTML safe to drop straight into a chat
// bubble — untrusted text is escaped, only the wrapper tags we generate get
// added on top.
//
// Usage:
//   renderRoleplay(content, { isTexting, nestedEmphasisInSpeech })
//
// Render order (per paragraph, after pulling code/link/image out of the way):
//   1. pair `&quot;` quotes → speech runs
//   2. pair single `*` markers → thought runs (lenient flank rules so "-*x*",
//      "(*x*)" and friends still pair correctly)
//   3. (optionally) drop thought pairs that lie entirely inside a speech run
//      when nestedEmphasisInSpeech is false
//   4. wrap everything outside speech/thought/link/code/image with
//      <span class="rp-narration"> so users can globally tint plain narration

export interface RpFormatOptions {
	isTexting?: boolean;
	nestedEmphasisInSpeech?: boolean;
}

const PH = /\x00[A-Z]{2}\d+\x00/g;

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function escapeAttr(s: string): string {
	return escapeHtml(s);
}

interface Pair {
	open: number;
	close: number;
	openLen: number;
	closeLen: number;
}

// Generic stack-based pairing. `markers` is a sorted list of marker positions
// (each with a length). A position can OPEN if the char after the marker is
// non-space and not another marker char; can CLOSE if the char before is the
// same. Closers prefer the most recent opener on the stack. Anything that
// could open but didn't close gets pushed.
function pairMarkers(
	text: string,
	markers: { pos: number; len: number }[],
	allowOpen: (m: { pos: number; len: number }) => boolean,
	allowClose: (m: { pos: number; len: number }) => boolean
): Pair[] {
	const pairs: Pair[] = [];
	const stack: { pos: number; len: number }[] = [];
	for (const m of markers) {
		const canClose = allowClose(m);
		const canOpen = allowOpen(m);
		if (canClose && stack.length > 0) {
			const opener = stack.pop()!;
			pairs.push({ open: opener.pos, close: m.pos, openLen: opener.len, closeLen: m.len });
		} else if (canOpen) {
			stack.push(m);
		}
	}
	pairs.sort((a, b) => a.open - b.open);
	return pairs;
}

// Find single-asterisk markers. Skip ** which is reserved for markdown bold —
// we don't render bold here but want to leave anyone else's bold alone.
function findThoughtMarkers(text: string): { pos: number; len: number }[] {
	const out: { pos: number; len: number }[] = [];
	for (let i = 0; i < text.length; i++) {
		if (text[i] !== '*') continue;
		const prev = i > 0 ? text[i - 1] : '';
		const next = i < text.length - 1 ? text[i + 1] : '';
		if (prev === '*' || next === '*') continue;
		out.push({ pos: i, len: 1 });
	}
	return out;
}

// Find paired-quote markers. Quotes were already escaped to `&quot;` (6 chars) upstream.
function findQuoteMarkers(text: string): { pos: number; len: number }[] {
	const out: { pos: number; len: number }[] = [];
	const re = /&quot;/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) !== null) {
		out.push({ pos: m.index, len: 6 });
	}
	return out;
}

// Lenient flank tests. A marker can OPEN if the next char is real content
// (non-space, non-marker, not the end of the paragraph). It can CLOSE if the
// previous char is real content. Handles "-*x*", "(*x*)", "—*x*", `"*x*"` and
// similar without getting confused by adjacent punctuation.
function isContentChar(c: string): boolean {
	if (!c) return false;
	if (/\s/.test(c)) return false;
	if (c === '\x00') return false; // placeholder boundary
	return true;
}

function makeFlankTests(text: string) {
	return {
		canOpen(m: { pos: number; len: number }): boolean {
			const next = m.pos + m.len < text.length ? text[m.pos + m.len] : '';
			return isContentChar(next);
		},
		canClose(m: { pos: number; len: number }): boolean {
			const prev = m.pos > 0 ? text[m.pos - 1] : '';
			return isContentChar(prev);
		}
	};
}

interface Wrap {
	start: number;
	end: number; // exclusive
	openTag: string;
	closeTag: string;
	innerStart: number; // where original inner text begins
	innerEnd: number; // exclusive — where original inner text ends
	kind: 'speech' | 'thought';
}

function buildWrapsForParagraph(text: string, opts: RpFormatOptions): Wrap[] {
	const flanks = makeFlankTests(text);

	const quoteMarkers = findQuoteMarkers(text);
	const speechPairs = pairMarkers(text, quoteMarkers, flanks.canOpen, flanks.canClose);

	const thoughtMarkers = findThoughtMarkers(text);
	let thoughtPairs = pairMarkers(text, thoughtMarkers, flanks.canOpen, flanks.canClose);

	// Optionally strip thought pairs that sit entirely inside a speech run.
	if (opts.nestedEmphasisInSpeech === false && speechPairs.length > 0) {
		thoughtPairs = thoughtPairs.filter((tp) => {
			for (const sp of speechPairs) {
				if (tp.open > sp.open && tp.close < sp.close + sp.closeLen) return false;
			}
			return true;
		});
	}

	// Drop thought pairs that straddle a speech boundary (open outside, close
	// inside, or vice versa). That's almost always a stray-asterisk situation
	// and rendering it produces broken nesting.
	thoughtPairs = thoughtPairs.filter((tp) => {
		for (const sp of speechPairs) {
			const tpInside = tp.open > sp.open && tp.open < sp.close + sp.closeLen;
			const tcInside = tp.close > sp.open && tp.close < sp.close + sp.closeLen;
			if (tpInside !== tcInside) return false;
		}
		return true;
	});

	const wraps: Wrap[] = [];
	for (const sp of speechPairs) {
		wraps.push({
			start: sp.open,
			end: sp.close + sp.closeLen,
			innerStart: sp.open + sp.openLen,
			innerEnd: sp.close,
			openTag: '<span class="rp-speech">&ldquo;',
			closeTag: '&rdquo;</span>',
			kind: 'speech'
		});
	}
	for (const tp of thoughtPairs) {
		wraps.push({
			start: tp.open,
			end: tp.close + tp.closeLen,
			innerStart: tp.open + tp.openLen,
			innerEnd: tp.close,
			openTag: '<em class="rp-thought">',
			closeTag: '</em>',
			kind: 'thought'
		});
	}
	return wraps;
}

// Render a paragraph by walking it left-to-right, emitting wrap open/close tags
// at the right boundaries and dropping the original marker chars. Wraps may nest
// (a thought inside a speech run) but cannot overlap — we filtered to guarantee
// that above.
function renderParagraph(text: string, opts: RpFormatOptions): string {
	if (!text) return text;
	const wraps = buildWrapsForParagraph(text, opts);
	if (wraps.length === 0) return text;

	// Build event lists keyed by character position.
	const opens = new Map<number, Wrap[]>(); // sorted: outer (largest range) first
	const closes = new Map<number, Wrap[]>(); // sorted: inner (smallest range) first
	const skips = new Set<number>(); // marker characters to omit

	for (const w of wraps) {
		(opens.get(w.start) ?? opens.set(w.start, []).get(w.start)!).push(w);
		(closes.get(w.end) ?? closes.set(w.end, []).get(w.end)!).push(w);
		// mark the original marker characters as skipped
		for (let i = w.start; i < w.innerStart; i++) skips.add(i);
		for (let i = w.innerEnd; i < w.end; i++) skips.add(i);
	}
	for (const arr of opens.values()) {
		arr.sort((a, b) => b.end - b.start - (a.end - a.start)); // larger range opens first
	}
	for (const arr of closes.values()) {
		arr.sort((a, b) => a.end - a.start - (b.end - b.start)); // smaller range closes first
	}

	let out = '';
	for (let i = 0; i <= text.length; i++) {
		const cs = closes.get(i);
		if (cs) for (const w of cs) out += w.closeTag;
		if (i === text.length) break;
		const os = opens.get(i);
		if (os) for (const w of os) out += w.openTag;
		if (!skips.has(i)) out += text[i];
	}
	return out;
}

// After speech/thought wrapping, walk the HTML and wrap any top-level text
// nodes (the ones not inside a tag) with `.rp-narration`. Placeholders
// (\x00…\x00) and pure-whitespace runs are left untouched so they don't get
// the class applied.
function wrapNarration(html: string): string {
	let out = '';
	let depth = 0;
	let i = 0;
	while (i < html.length) {
		const ch = html[i];
		if (ch === '<') {
			const end = html.indexOf('>', i);
			if (end === -1) {
				out += html.slice(i);
				break;
			}
			const tag = html.slice(i, end + 1);
			out += tag;
			if (tag.startsWith('</')) {
				depth = Math.max(0, depth - 1);
			} else if (!tag.endsWith('/>') && !/^<(br|hr|img|input|source|wbr)\b/i.test(tag)) {
				depth++;
			}
			i = end + 1;
			continue;
		}
		const next = html.indexOf('<', i);
		const chunk = next === -1 ? html.slice(i) : html.slice(i, next);
		if (depth === 0) {
			// Split chunks around placeholders so they stay outside the narration
			// span (placeholders later expand into images, links, code blocks etc.
			// which deserve their own styling and shouldn't be tinted as narration).
			out += chunk.replace(
				/(\x00[A-Z]{2}\d+\x00)|([^\x00]+)/g,
				(_m, ph: string | undefined, txt: string | undefined) => {
					if (ph) return ph;
					if (!txt) return '';
					if (!txt.trim()) return txt;
					// Keep leading/trailing whitespace OUTSIDE the span so successive
					// narration runs don't visually collide.
					const m = txt.match(/^(\s*)([\s\S]*?)(\s*)$/);
					if (!m) return `<span class="rp-narration">${txt}</span>`;
					const [, lead, mid, trail] = m;
					if (!mid) return txt;
					return `${lead}<span class="rp-narration">${mid}</span>${trail}`;
				}
			);
		} else {
			out += chunk;
		}
		i = next === -1 ? html.length : next;
	}
	return out;
}

export function renderRoleplay(content: string, opts: RpFormatOptions = {}): string {
	if (!content) return '';

	// Normalize smart quotes to plain ones BEFORE escaping, so smart and
	// straight quotes pair with each other consistently.
	let text = content.trimStart()
		.replace(/[\u201C\u201D]/g, '"')
		.replace(/[\u2018\u2019]/g, "'");

	// Stage 1 — yank code blocks out first so their innards are immune to all
	// the formatting passes that follow.
	const codeBlocks: string[] = [];
	text = text.replace(/```([\s\S]*?)```/g, (_, code) => {
		codeBlocks.push(code.replace(/^\n/, '').replace(/\n$/, ''));
		return `\x00CB${codeBlocks.length - 1}\x00`;
	});

	// Stage 2 — inline code with backticks.
	const inlineCode: string[] = [];
	text = text.replace(/`([^`\n]+)`/g, (_, code) => {
		inlineCode.push(code);
		return `\x00IC${inlineCode.length - 1}\x00`;
	});

	// Stage 3 — markdown images. Has to run before link extraction or the leading
	// `!` will be eaten by the link pattern.
	const images: string[] = [];
	text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt: string, url: string) => {
		images.push(
			`<img src="${escapeAttr(url)}" alt="${escapeAttr(alt)}" class="my-2 max-w-full cursor-pointer rounded-lg" />`
		);
		return `\x00IM${images.length - 1}\x00`;
	});

	// Stage 4 — markdown links to http(s) URLs.
	const links: string[] = [];
	text = text.replace(
		/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
		(_m, label: string, url: string) => {
			const safeUrl = escapeAttr(url);
			links.push(
				`<a href="${safeUrl}" title="${safeUrl}" target="_blank" rel="noopener noreferrer" class="rp-link" data-check-url="${safeUrl}">${escapeHtml(label)}</a>`
			);
			return `\x00LK${links.length - 1}\x00`;
		}
	);

	// Stage 5 — escape any remaining HTML special chars in the body. Placeholders
	// (\x00…\x00) survive because they don't contain any of the escape targets.
	text = escapeHtml(text);

	// Stage 6 — protect imperial measurements like 5'1" or 6' 2" so the inch mark
	// doesn't get paired up as a stray quote.
	text = text.replace(/(\d)'(\s?\d+)&quot;/g, '$1\u2032$2\u2033');

	// Stage 7 — per-paragraph speech/thought wrapping.
	if (!opts.isTexting) {
		text = text
			.split(/\n\n/)
			.map((para) => renderParagraph(para, opts))
			.join('\n\n');

		// Stage 8 — narration wrapping on top of the post-format string.
		text = wrapNarration(text);
	}

	// Stage 9 — restore everything we extracted earlier.
	text = text.replace(/\x00CB(\d+)\x00/g, (_m, i: string) =>
		`<code class="rp-code">${escapeHtml(codeBlocks[+i])}</code>`
	);
	text = text.replace(/\x00IC(\d+)\x00/g, (_m, i: string) =>
		`<code class="rp-code">${escapeHtml(inlineCode[+i])}</code>`
	);
	text = text.replace(/\x00IM(\d+)\x00/g, (_m, i: string) => images[+i]);
	text = text.replace(/\x00LK(\d+)\x00/g, (_m, i: string) => links[+i]);

	return text;
}

// Lightweight preview formatter for the chat-list sidebar: same pairing rules
// but no narration wrapping, no images, no code blocks.
export function renderRoleplayPreview(content: string, opts: RpFormatOptions = {}): string {
	if (!content) return '';
	let text = content
		.replace(/!\[[^\]]*\]\([^)]+\)/g, '')
		.replace(/```([\s\S]*?)```/g, '$1')
		.trim();
	if (!text) return '';
	text = text
		.replace(/[\u201C\u201D]/g, '"')
		.replace(/[\u2018\u2019]/g, "'");
	text = escapeHtml(text);
	text = text.replace(/(\d)'(\s?\d+)&quot;/g, '$1\u2032$2\u2033');
	if (opts.isTexting) return text;
	return text
		.split(/\n\n/)
		.map((p) => renderParagraph(p, opts))
		.join('\n\n');
}
