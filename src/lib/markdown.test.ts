import { describe, it, expect } from 'vitest';
import { renderMarkdown, sanitizeRichHtml } from './markdown.js';

describe('renderMarkdown', () => {
	it('returns empty string for falsy input', () => {
		expect(renderMarkdown('')).toBe('');
	});

	it('renders basic markdown to HTML', () => {
		const html = renderMarkdown('**bold** and *italic*');
		expect(html).toContain('<strong>bold</strong>');
		expect(html).toContain('<em>italic</em>');
	});

	it('strips inline <script> tags', () => {
		const html = renderMarkdown('hello<script>alert(1)</script> world');
		expect(html).not.toContain('<script>');
		expect(html).not.toContain('alert(1)');
	});

	it('strips event handler attributes', () => {
		const html = renderMarkdown('<img src=x onerror="alert(1)">');
		expect(html).not.toMatch(/onerror/i);
	});

	it('renders fenced code blocks', () => {
		const html = renderMarkdown('```\nconst x = 1;\n```');
		expect(html).toContain('<pre>');
		expect(html).toContain('<code>');
	});

	it('preserves link target/rel attributes (allow-listed)', () => {
		const html = renderMarkdown('<a href="https://example.com" target="_blank" rel="noopener">x</a>');
		expect(html).toContain('target="_blank"');
		expect(html).toContain('rel="noopener"');
	});
});

describe('sanitizeRichHtml', () => {
	it('returns empty string for falsy input', () => {
		expect(sanitizeRichHtml('')).toBe('');
	});

	it('strips <script> tags', () => {
		const out = sanitizeRichHtml('<p>hi</p><script>alert(1)</script>');
		expect(out).not.toContain('<script>');
	});

	it('keeps <style> tags inside body context (sandboxed iframe)', () => {
		const out = sanitizeRichHtml('<div><style>p { color: red }</style><p>hi</p></div>');
		expect(out).toContain('<style>');
	});

	it('strips javascript: hrefs', () => {
		const out = sanitizeRichHtml('<a href="javascript:alert(1)">x</a>');
		expect(out).not.toMatch(/javascript:/i);
	});
});
