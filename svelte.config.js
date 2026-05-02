import adapter from '@sveltejs/adapter-node';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter(),
		version: {
			// Pin SvelteKit's runtime version to package.json so /api/version
			// (which returns __APP_VERSION__) can be compared against the
			// running build's `version` from $app/environment.
			name: pkg.version,
			// Poll every 5 minutes so long-lived PWA tabs detect new builds
			// without relying on visibility/online events alone.
			pollInterval: 5 * 60 * 1000
		}
	},
	vitePlugin: {
		dynamicCompileOptions: ({ filename }) =>
			filename.includes('node_modules') ? undefined : { runes: true }
	}
};

export default config;
