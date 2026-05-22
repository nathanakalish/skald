import { json } from '@sveltejs/kit';

// Convenience builders for the same shape we use everywhere: { error: string } + matching status.
// Use these instead of hand-writing `return json({ error: '...' }, { status: 404 });` so any future
// change to the error envelope (codes, structured fields, telemetry) happens in one spot.

export const ApiError = {
	badRequest: (message = 'Bad request') => json({ error: message }, { status: 400 }),
	unauthorized: (message = 'Unauthorized') => json({ error: message }, { status: 401 }),
	forbidden: (message = 'Forbidden') => json({ error: message }, { status: 403 }),
	notFound: (message = 'Not found') => json({ error: message }, { status: 404 }),
	conflict: (message = 'Conflict') => json({ error: message }, { status: 409 }),
  gone: (message = 'Gone') => json({ error: message }, { status: 410 }),
  payloadTooLarge: (message = 'Payload too large') => json({ error: message }, { status: 413 }),
  tooMany: (message = 'Too many requests') => json({ error: message }, { status: 429 }),
  server: (message = 'Internal server error') => json({ error: message }, { status: 500 }),
  badGateway: (message = 'Bad gateway') => json({ error: message }, { status: 502 }),
	unavailable: (message = 'Service unavailable') => json({ error: message }, { status: 503 }),
};
