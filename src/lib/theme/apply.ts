/**
 * Apply a theme to <html> by writing CSS variables, toggling the `dark` class,
 * and updating the <meta name="theme-color"> tag for PWA chrome.
 *
 * Pulled out of `+layout.svelte` so the layout component doesn't carry
 * DOM-mutation logic. Pure side-effecting function — call from inside an
 * `$effect` keyed on the active theme.
 *
 * The theme shape matches rows from `/api/themes`. `colors` may arrive as a
 * JSON string (raw DB row) or an already-parsed object.
 */

interface ThemeLike {
	colors: string | Record<string, unknown>;
	mode: 'dark' | 'light' | string;
}

function resolveToBrowserColor(input: string): string | null {
	if (typeof document === 'undefined') return null;
	const probe = document.createElement('div');
	probe.style.color = '';
	probe.style.color = input;
	if (!probe.style.color) return null;
	probe.style.position = 'absolute';
	probe.style.pointerEvents = 'none';
	probe.style.opacity = '0';
	document.body.appendChild(probe);
	const resolved = getComputedStyle(probe).color;
	probe.remove();
	return resolved || null;
}

function getThemeChromeColor(colors: Record<string, unknown>): string | null {
	if (typeof document === 'undefined') return null;
	const fromTheme = typeof colors.background === 'string' ? resolveToBrowserColor(colors.background) : null;
	if (fromTheme) return fromTheme;
	const cssVar = getComputedStyle(document.documentElement).getPropertyValue('--background').trim();
	if (!cssVar) return null;
	return resolveToBrowserColor(cssVar);
}

export function applyTheme(theme: ThemeLike | null | undefined): void {
	if (!theme) return;
	if (typeof document === 'undefined') return;

	let colors: Record<string, unknown>;
	try {
		colors = typeof theme.colors === 'string' ? JSON.parse(theme.colors) : theme.colors;
	} catch {
		return;
	}
	if (!colors || typeof colors !== 'object') return;

	const root = document.documentElement;
	for (const [key, value] of Object.entries(colors)) {
		if (typeof value === 'string') {
			root.style.setProperty(`--${key}`, value);
		}
	}

	// Dark/light class follows the theme's mode.
	const isDark = theme.mode === 'dark';
	root.classList.toggle('dark', isDark);
	root.style.colorScheme = isDark ? 'dark' : 'light';

	// Sync <meta name="theme-color"> so iOS PWA status bar / keyboard tint and
	// Android UI chrome match the active theme. iOS standalone PWAs are flaky
	// about re-reading this meta tag when only `.content` is mutated; removing
	// the existing element and appending a fresh one forces Safari to reread.
	const chromeColor = getThemeChromeColor(colors as Record<string, unknown>);
	if (!chromeColor) return;
	try {
		document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.parentNode?.removeChild(m));
		const meta = document.createElement('meta');
		meta.name = 'theme-color';
		meta.content = chromeColor;
		document.head.appendChild(meta);
	} catch {
		/* non-fatal */
	}
}
