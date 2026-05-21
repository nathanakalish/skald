/**
 * Auto-grow a textarea up to N rows, then switch to internal scrolling.
 * Tracks visible row count for callers that style based on tall/short input.
 *
 * Usage in a Svelte component:
 *   const sizer = new TextareaAutosizer({ maxRows: 5 });
 *   $effect(() => sizer.bind(textareaEl));      // attach + ResizeObserver
 *   $effect(() => { void input; sizer.measure(); }); // re-measure on input change
 *   let isTall = $derived(sizer.rows >= 4);
 */
export interface TextareaAutosizerOptions {
	maxRows?: number;
}

export class TextareaAutosizer {
	private el: HTMLTextAreaElement | null = null;
	private ro: ResizeObserver | null = null;
	private lastWidth = 0;
	readonly maxRows: number;

	/** Current visible row count (1..maxRows). Reactive when read inside Svelte. */
	rows = $state(1);

	constructor(opts: TextareaAutosizerOptions = {}) {
		this.maxRows = opts.maxRows ?? 5;
	}

	/**
	 * Attach to the given element and start a width-only ResizeObserver.
	 * Call from a `$effect` and return the result so cleanup runs on unmount.
	 */
	bind = (el: HTMLTextAreaElement | null | undefined): (() => void) | void => {
		if (!el) return;
		this.el = el;
		this.lastWidth = el.getBoundingClientRect().width;
		this.ro = new ResizeObserver((entries) => {
			const newWidth = entries[0]?.contentRect.width ?? 0;
			if (Math.abs(newWidth - this.lastWidth) > 0.5) {
				this.lastWidth = newWidth;
				this.measure();
			}
		});
		this.ro.observe(el);
		// One measurement upfront so the initial render is right.
		this.measure();
		return () => {
			this.ro?.disconnect();
			this.ro = null;
			this.el = null;
		};
	};

	/** Recompute height + row count. Cheap; safe to call after every keystroke. */
	measure = (): void => {
		const el = this.el;
		if (!el) return;
		// Capture whether the user was anchored at the bottom *before* we mutate the
		// height (which trashes scrollTop/scrollHeight). During impersonation streaming
		// we want to keep following the new text, but only if the user hasn't scrolled
		// up to read something earlier.
		const prevScrollTop = el.scrollTop;
		const prevClientHeight = el.clientHeight;
		const prevScrollHeight = el.scrollHeight;
		const wasAtBottom = prevScrollHeight - prevScrollTop - prevClientHeight <= 4;
		el.style.height = 'auto';
		el.style.overflowY = 'hidden';
		const style = getComputedStyle(el);
		const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
		const paddingTop = parseFloat(style.paddingTop);
		const paddingBottom = parseFloat(style.paddingBottom);
		const borderTop = parseFloat(style.borderTopWidth);
		const borderBottom = parseFloat(style.borderBottomWidth);
		const maxHeight = lineHeight * this.maxRows + paddingTop + paddingBottom + borderTop + borderBottom;
		const fullHeight = el.scrollHeight + borderTop + borderBottom;
		const newHeight = Math.min(fullHeight, maxHeight);
		el.style.height = Math.ceil(newHeight) + 'px';
		el.style.overflowY = el.scrollHeight + borderTop + borderBottom > maxHeight ? 'auto' : 'hidden';
		if (wasAtBottom) {
			el.scrollTop = el.scrollHeight;
		} else {
			// Preserve the user's scroll position so they can read while streaming continues.
			el.scrollTop = prevScrollTop;
		}
		const contentHeight = el.scrollHeight - paddingTop - paddingBottom;
		this.rows = Math.max(1, Math.min(this.maxRows, Math.ceil((contentHeight + 0.5) / lineHeight)));
	};
}
