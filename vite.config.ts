import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

function gracefulShutdown(): Plugin {
	return {
		name: 'graceful-shutdown',
		configureServer(server) {
			function shutdown() {
				server.close().then(() => process.exit(0));
				// Force exit after 2s if close hangs
				setTimeout(() => process.exit(0), 2000);
			}
			process.on('SIGINT', shutdown);
			process.on('SIGTERM', shutdown);
		}
	};
}

export default defineConfig({
	plugins: [sveltekit(), tailwindcss(), gracefulShutdown()],
	define: {
		'__APP_VERSION__': JSON.stringify(pkg.version)
	},
	server: {
		host: true,
	}
});
