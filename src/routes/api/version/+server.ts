import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { requireUser } from '$lib/server/auth.js';

const GITHUB_REPO = 'nathanakalish/skald';

/** Compare two semver strings. Returns >0 if a > b, <0 if a < b, 0 if equal. */
function compareSemver(a: string, b: string): number {
	const pa = a.split('.').map(Number);
	const pb = b.split('.').map(Number);
	for (let i = 0; i < 3; i++) {
		const diff = (pa[i] || 0) - (pb[i] || 0);
		if (diff !== 0) return diff;
	}
	return 0;
}

export const GET: RequestHandler = async (event) => {
	requireUser(event);

	const current = __APP_VERSION__;

	let latest: string | null = null;
	let updateAvailable = false;

	try {
		// Fetch tags via GitHub API — supports GITHUB_TOKEN env var for private repos
		const headers: Record<string, string> = {
			'Accept': 'application/vnd.github+json',
			'User-Agent': 'Skald'
		};
		const token = process.env.GITHUB_TOKEN;
		if (token) {
			headers['Authorization'] = `Bearer ${token}`;
		}

		const res = await fetch(
			`https://api.github.com/repos/${GITHUB_REPO}/tags?per_page=10`,
			{ headers, signal: AbortSignal.timeout(5000) }
		);

		if (res.ok) {
			const tags: { name: string }[] = await res.json();
			// Find the highest semver tag (format: v1.2.3)
			let highestVersion: string | null = null;
			for (const tag of tags) {
				const match = tag.name.match(/^v?(\d+\.\d+\.\d+)$/);
				if (match) {
					const ver = match[1];
					if (!highestVersion || compareSemver(ver, highestVersion) > 0) {
						highestVersion = ver;
					}
				}
			}
			latest = highestVersion;
			if (latest && compareSemver(latest, current) > 0) {
				updateAvailable = true;
			}
		}
	} catch {
		// Network error — skip update check
	}

	return json({
		current,
		latest,
		updateAvailable,
		repoUrl: `https://github.com/${GITHUB_REPO}`
	});
};
