// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { Logger } from '$lib/server/logger.js';

declare global {
	const __APP_VERSION__: string;

	namespace App {
		// interface Error {}
		interface Locals {
			user: { id: number; username: string; role: string; pictureUrl: string | null } | null;
			/** Per-request UUID (also echoed to client as `x-request-id`). */
			requestId: string;
			/** Child logger pre-bound with `requestId` and `userId` (when known). */
			logger: Logger;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
