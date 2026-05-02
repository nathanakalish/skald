/**
 * Single source of truth for rendering user-controlled markdown to HTML.
 * Wraps `marked` with `DOMPurify` so raw `<script>` / `onerror=` payloads
 * inside character cards / chat messages can never reach the DOM as
 * executable nodes.
 *
 * Used by ChatView, CharacterEditModal, CharacterInfoModal, etc.
 */
import { marked } from 'marked';
import DOMPurify from 'isomorphic-dompurify';

export interface RenderOptions {
	breaks?: boolean;
}

/**
 * Render markdown → sanitized HTML safe for `{@html}`.
 * Keeps target / rel attributes so post-processing can still set
 * `target="_blank" rel="noopener"` on links.
 */
export function renderMarkdown(input: string, opts: RenderOptions = {}): string {
	if (!input) return '';
	const raw = marked.parse(input, { async: false, breaks: opts.breaks ?? true }) as string;
	return DOMPurify.sanitize(raw, { ADD_ATTR: ['target', 'rel'] });
}

/**
 * Sanitize raw HTML (no markdown pass). Used by character notes panes that
 * already contain author-supplied HTML. `<style>` is allowed because the
 * rendered HTML is wrapped in a sandboxed iframe.
 */
export function sanitizeRichHtml(input: string): string {
	if (!input) return '';
	return DOMPurify.sanitize(input, {
		ADD_TAGS: ['style'],
		ADD_ATTR: ['target', 'rel']
	});
}
