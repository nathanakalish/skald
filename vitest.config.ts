import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

/**
 * Standalone Vitest config — kept separate from `vite.config.ts` so the test
 * runner doesn't drag in the SvelteKit plugin (which requires `.svelte-kit`
 * sync state and is awkward in CI).
 *
 * Initial scope (per CODE-REVIEW.md L12): pure-ish utility modules. We do not
 * yet test Svelte components or full HTTP routes — those would need a JSDOM
 * environment and a SvelteKit test server respectively.
 */
export default defineConfig({
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts'],
		globals: false,
		// In CI: verbose shows individual test names in the step log, and
		// github-actions writes test annotations + the summary panel.
		// Locally: default is cleaner.
		reporters: process.env.CI ? ['verbose', 'github-actions'] : ['default'],
	},
	resolve: {
		alias: {
			$lib: resolve(__dirname, './src/lib')
		}
	}
});
