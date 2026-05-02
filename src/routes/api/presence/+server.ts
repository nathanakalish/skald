import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { requireUser } from '$lib/server/auth.js';
import { presence } from '$lib/server/presence.js';

export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const body = await event.request.json();
	const { sessionId, activeChatId, focused } = body;

	if (!sessionId || typeof sessionId !== 'string') {
		return json({ ok: false }, { status: 400 });
	}

	// Only forward fields that were explicitly provided so partial pings
	// (e.g. focus/blur events without an activeChatId) don't clobber other state.
	const update: { activeChatId?: number | null; focused?: boolean } = {};
	if ('activeChatId' in body) {
		update.activeChatId = typeof activeChatId === 'number' ? activeChatId : null;
	}
	if ('focused' in body) {
		update.focused = !!focused;
	}

	presence.update(user.id, sessionId, update);

	return json({ ok: true });
};
