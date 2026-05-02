import sharp from 'sharp';

export interface ExtractedThemePair {
	dark: Record<string, string>;
	light: Record<string, string>;
}

/**
 * Pull a character theme palette out of an avatar image buffer.
 * Downscales the image, k-means-clusters the dominant colors, then derives
 * BOTH a dark-mode and light-mode theme from the palette so the character
 * looks right whatever color mode the user's on.
 *
 * Returns `{ dark, light }`, or null if extraction flops.
 */
export async function extractThemeFromAvatar(
	buffer: Buffer
): Promise<ExtractedThemePair | null> {
	try {
		// Downscale to 64x64 — plenty of fidelity for palette work, fast to chew through.
		const { data, info } = await sharp(buffer)
			.resize(64, 64, { fit: 'cover' })
			.removeAlpha()
			.raw()
			.toBuffer({ resolveWithObject: true });

		const pixels = extractPixels(data, info.width, info.height);
		if (pixels.length === 0) return null;

		// 5 dominant colors is enough for a usable palette without overfitting.
		const clusters = kMeans(pixels, 5, 20);
		if (clusters.length === 0) return null;

		// Score by saturation × brightness so we surface the most vibrant color.
		const scored = clusters.map((c) => ({
			color: c,
			saturation: saturation(c),
			brightness: luminance(c),
			vibrance: saturation(c) * (0.3 + luminance(c) * 0.7),
		}));

		// Primary = most vibrant color that isn't dark-as-night or blown-out white.
		scored.sort((a, b) => b.vibrance - a.vibrance);
		const primary = scored.find(
			(s) => s.brightness > 0.08 && s.brightness < 0.85 && s.saturation > 0.1
		)?.color ?? scored[0].color;

		// Darkest + lightest clusters become the bg anchors for dark/light themes.
		const byBrightness = [...scored].sort((a, b) => a.brightness - b.brightness);
		const darkest = byBrightness[0].color;
		const lightest = byBrightness[byBrightness.length - 1].color;

		return {
			dark: buildDarkTheme(primary, darkest),
			light: buildLightTheme(primary, lightest),
		};
	} catch {
		return null;
	}
}

// ─── Pixel extraction ──────────────────────────────────────

type RGB = [number, number, number];

function extractPixels(data: Buffer, width: number, height: number): RGB[] {
	const pixels: RGB[] = [];
	for (let i = 0; i < width * height * 3; i += 3) {
		pixels.push([data[i], data[i + 1], data[i + 2]]);
	}
	return pixels;
}

// ─── K-means clustering ────────────────────────────────────

function kMeans(pixels: RGB[], k: number, iterations: number): RGB[] {
	// Seed centroids by sampling evenly-spaced pixels. Cheap and good enough —
	// kmeans++ would be fancier but we only have 5 clusters and 20 iterations.
	const step = Math.max(1, Math.floor(pixels.length / k));
	let centroids: RGB[] = [];
	for (let i = 0; i < k; i++) {
		centroids.push([...pixels[Math.min(i * step, pixels.length - 1)]]);
	}

	for (let iter = 0; iter < iterations; iter++) {
		// Assign each pixel to its nearest centroid.
		const buckets: RGB[][] = centroids.map(() => []);
		for (const px of pixels) {
			let minDist = Infinity;
			let best = 0;
			for (let c = 0; c < centroids.length; c++) {
				const d = colorDistSq(px, centroids[c]);
				if (d < minDist) {
					minDist = d;
					best = c;
				}
			}
			buckets[best].push(px);
		}

		// Recompute centroids as the mean of their bucket. Empty bucket => keep old.
		const newCentroids: RGB[] = [];
		for (let c = 0; c < k; c++) {
			const bucket = buckets[c];
			if (bucket.length === 0) {
				newCentroids.push(centroids[c]);
				continue;
			}
			const avg: RGB = [0, 0, 0];
			for (const px of bucket) {
				avg[0] += px[0];
				avg[1] += px[1];
				avg[2] += px[2];
			}
			newCentroids.push([
				Math.round(avg[0] / bucket.length),
				Math.round(avg[1] / bucket.length),
				Math.round(avg[2] / bucket.length),
			]);
		}
		centroids = newCentroids;
	}

	return centroids;
}

function colorDistSq(a: RGB, b: RGB): number {
	const dr = a[0] - b[0];
	const dg = a[1] - b[1];
	const db = a[2] - b[2];
	return dr * dr + dg * dg + db * db;
}

// ─── Color math helpers ────────────────────────────────────

function luminance(c: RGB): number {
	return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
}

function saturation(c: RGB): number {
	const max = Math.max(c[0], c[1], c[2]);
	const min = Math.min(c[0], c[1], c[2]);
	if (max === 0) return 0;
	return (max - min) / max;
}

function toHex(c: RGB): string {
	return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

function darken(c: RGB, factor: number): RGB {
	return [
		Math.round(c[0] * factor),
		Math.round(c[1] * factor),
		Math.round(c[2] * factor),
	];
}

function lighten(c: RGB, factor: number): RGB {
	return [
		Math.min(255, Math.round(c[0] + (255 - c[0]) * factor)),
		Math.min(255, Math.round(c[1] + (255 - c[1]) * factor)),
		Math.min(255, Math.round(c[2] + (255 - c[2]) * factor)),
	];
}

function mix(a: RGB, b: RGB, t: number): RGB {
	return [
		Math.round(a[0] + (b[0] - a[0]) * t),
		Math.round(a[1] + (b[1] - a[1]) * t),
		Math.round(a[2] + (b[2] - a[2]) * t),
	];
}

// ─── Theme generation ──────────────────────────────────────

function buildDarkTheme(primary: RGB, darkBase: RGB): Record<string, string> {
	// Dark theme anchored on the primary + darkest cluster.
	const bg = darken(mix(darkBase, primary, 0.15), 0.35);
	const card = lighten(bg, 0.1);
	const secondary = lighten(bg, 0.15);
	const muted = lighten(bg, 0.22);
	const border = lighten(bg, 0.18);
	const accent = darken(primary, 0.8);

	// Foregrounds need to stay light enough to read on dark bg.
	const fg = lighten(primary, 0.8);
	const cardFg = lighten(primary, 0.75);
	const mutedFg = lighten(primary, 0.45);
	const primaryFg: RGB = luminance(primary) > 0.5 ? [15, 15, 15] : [245, 245, 245];

	// Speech color is just a lighter tint of primary.
	const speech = lighten(primary, 0.35);

	return {
		background: toHex(bg),
		foreground: toHex(fg),
		card: toHex(card),
		'card-foreground': toHex(cardFg),
		primary: toHex(primary),
		'primary-foreground': toHex(primaryFg),
		secondary: toHex(secondary),
		muted: toHex(muted),
		'muted-foreground': toHex(mutedFg),
		accent: toHex(accent),
		border: toHex(border),
		speech: toHex(speech),
	};
}

function buildLightTheme(primary: RGB, lightBase: RGB): Record<string, string> {
	// Light theme: pale tinted backgrounds in the same primary hue. We mix the
	// lightest cluster with white so the bg never goes muddy even when the
	// avatar is mostly dark.
	const bgBase = mix(lightBase, [255, 255, 255], 0.7);
	const bg = mix(bgBase, primary, 0.05);
	const card = mix(bg, [255, 255, 255], 0.4);
	const secondary = darken(bg, 0.94);
	const muted = darken(bg, 0.9);
	const border = darken(bg, 0.85);
	const accent = lighten(primary, 0.65);

	// Foregrounds need to be dark enough to read on light bg. Anchor on the
	// primary's hue but push way down in luminance so contrast stays AA.
	const fg = darken(primary, 0.25);
	const cardFg = darken(primary, 0.2);
	const mutedFg = mix(darken(primary, 0.45), [80, 80, 80], 0.4);
	const primaryFg: RGB = luminance(primary) > 0.5 ? [15, 15, 15] : [250, 250, 250];

	// Speech color is a darker, more saturated take on primary.
	const speech = darken(primary, 0.55);

	return {
		background: toHex(bg),
		foreground: toHex(fg),
		card: toHex(card),
		'card-foreground': toHex(cardFg),
		primary: toHex(primary),
		'primary-foreground': toHex(primaryFg),
		secondary: toHex(secondary),
		muted: toHex(muted),
		'muted-foreground': toHex(mutedFg),
		accent: toHex(accent),
		border: toHex(border),
		speech: toHex(speech),
	};
}
