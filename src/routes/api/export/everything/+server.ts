import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth.js';
import { buildEverythingBundle } from '$lib/server/bundle.js';
import { startExportJob, isExportRunning } from '$lib/server/exportJobs.js';

/** Legacy sync export — still works but may be slow for large DBs. */
export const GET: RequestHandler = async (event) => {
	const user = requireUser(event);
	const url = event.url;
	const flag = (k: string, def = true) => {
		const v = url.searchParams.get(k);
		if (v == null) return def;
		return v === 'true' || v === '1';
	};

	const result = await buildEverythingBundle(user.id, {
		includePersonas: flag('personas', true),
		includeSettings: flag('settings', true),
		includeThemes: flag('themes', true),
		includeProviders: flag('providers', false)
	});

	const stamp = new Date().toISOString().slice(0, 10);
	event.locals.logger?.info('export: everything (sync)', {
		bytes: result.buffer.byteLength, counts: result.counts,
	});
	return new Response(new Uint8Array(result.buffer), {
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename="skald-backup-${stamp}.skald.zip"`,
			'X-Bundle-Counts': JSON.stringify(result.counts)
		}
	});
};

/** Kick off a background export job for the authenticated user. */
export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const body = await event.request.json().catch(() => ({}));

	const opts = {
		includePersonas: body.personas !== false,
		includeSettings: body.settings !== false,
		includeThemes: body.themes !== false,
		includeProviders: body.providers !== false,
	};

	if (isExportRunning(user.id)) {
		event.locals.logger?.warn('export: everything (async) rejected — already running', {});
		return json({ ok: false, reason: 'already_running' }, { status: 409 });
	}

	startExportJob(user.id, opts);
	event.locals.logger?.info('export: everything (async) started', { opts });
	return json({ ok: true });
};
