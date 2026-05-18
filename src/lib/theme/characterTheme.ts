/**
 * Character theme JSON helpers.
 *
 * `characters.theme` is a JSON string. Two shapes exist in the wild:
 *   1. NEW: `{ dark: { background, ... }, light: { background, ... } }`
 *   2. LEGACY (pre-light-theme): `{ background, ... }` — treated as the dark
 *      variant; the same colors get reused for light mode if a light variant
 *      isn't present.
 *
 * `pickCharacterTheme` parses the JSON and returns the variant matching the
 * caller's effective mode. `parseCharacterTheme` returns the raw shape so
 * editors can read both halves.
 */

interface CharacterThemePair {
	dark: Record<string, string>;
	light: Record<string, string>;
}

function isPair(obj: unknown): obj is CharacterThemePair {
	if (!obj || typeof obj !== 'object') return false;
	const o = obj as Record<string, unknown>;
	return (
		(typeof o.dark === 'object' && o.dark !== null) ||
		(typeof o.light === 'object' && o.light !== null)
	);
}

export function parseCharacterTheme(themeJson: string | null | undefined): CharacterThemePair {
	if (!themeJson) return { dark: {}, light: {} };
	let parsed: unknown;
	try { parsed = JSON.parse(themeJson); } catch { return { dark: {}, light: {} }; }
	if (isPair(parsed)) {
		const p = parsed as { dark?: Record<string, string>; light?: Record<string, string> };
		return { dark: p.dark ?? {}, light: p.light ?? {} };
	}
	// Legacy single-object shape: treat as dark, reuse for light.
	const flat = (parsed && typeof parsed === 'object') ? parsed as Record<string, string> : {};
	return { dark: flat, light: flat };
}

export function pickCharacterTheme(
	themeJson: string | null | undefined,
	mode: 'dark' | 'light'
): Record<string, string> {
	const { dark, light } = parseCharacterTheme(themeJson);
	if (mode === 'light') {
		return Object.keys(light).length > 0 ? light : dark;
	}
	return Object.keys(dark).length > 0 ? dark : light;
}

export function characterHasAnyTheme(themeJson: string | null | undefined): boolean {
	const { dark, light } = parseCharacterTheme(themeJson);
	return Object.values(dark).some((v) => v) || Object.values(light).some((v) => v);
}
