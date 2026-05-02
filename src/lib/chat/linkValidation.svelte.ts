/**
 * Async link validation for chat message HTML. Walks the rendered message
 * container, finds `<a data-check-url>` anchors, hits /api/check-link to see
 * if each URL resolves, and replaces broken anchors with their text content
 * so chat messages don't display dead links.
 *
 * Pulled out of ChatView.svelte; the component creates one validator per
 * mount and ditches it on unmount.
 */
const LINK_VALIDATE_DEBOUNCE_MS = 500;
const LINK_VALIDATE_DOM_SETTLE_MS = 50;

export class LinkValidator {
	private cache = new Map<string, boolean>();
	private pending = false;
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;

	/** Single-URL fetch with cache. Public for callers that want a direct check. */
	async checkLink(url: string): Promise<boolean> {
		const cached = this.cache.get(url);
		if (cached !== undefined) return cached;
		try {
			const res = await fetch('/api/check-link', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ url })
			});
			const data = await res.json();
			this.cache.set(url, data.valid);
			return data.valid;
		} catch {
			this.cache.set(url, false);
			return false;
		}
	}

	/** Walk container, validate unchecked anchors, replace broken ones with text. */
	async validate(container: HTMLElement | null | undefined): Promise<void> {
		if (this.pending || !container) return;
		this.pending = true;

		try {
			// Let the DOM settle after the latest message render.
			await new Promise((r) => setTimeout(r, LINK_VALIDATE_DOM_SETTLE_MS));

			const anchors = container.querySelectorAll<HTMLAnchorElement>(
				'a[data-check-url]:not([data-checked])'
			);
			if (anchors.length === 0) return;

			anchors.forEach((a) => a.setAttribute('data-checked', ''));

			const uniqueUrls = [...new Set(Array.from(anchors).map((a) => a.dataset.checkUrl!))];
			await Promise.all(uniqueUrls.map((url) => this.checkLink(url)));

			anchors.forEach((a) => {
				const url = a.dataset.checkUrl!;
				if (!this.cache.get(url)) {
					a.replaceWith(document.createTextNode(a.textContent || ''));
				}
			});
		} finally {
			this.pending = false;
		}
	}

	/**
	 * Debounced wrapper. Call from a `$effect` and return `validator.cleanup`
	 * to ensure the pending timer is cleared on unmount.
	 */
	scheduleValidate(container: HTMLElement | null | undefined): void {
		if (this.debounceTimer) clearTimeout(this.debounceTimer);
		this.debounceTimer = setTimeout(() => {
			this.debounceTimer = null;
			void this.validate(container);
		}, LINK_VALIDATE_DEBOUNCE_MS);
	}

	/** Clear pending debounce timer. Safe to call multiple times. */
	cleanup = (): void => {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
	};
}
