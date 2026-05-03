/**
 * Tiny structured JSON logger — one line per record to stderr.
 *
 * LOG_LEVEL sets the threshold (default "info"). Levels go trace → debug → info → warn → error.
 * Use logger.child({ requestId, ... }) to bind fields for the lifetime of a request.
 * Sensitive keys are scrubbed recursively before output (see REDACT_KEYS).
 */

export type LogLevelName = 'trace' | 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevelName, number> = {
	trace: 10,
	debug: 20,
	info: 30,
	warn: 40,
	error: 50,
};

function resolveThreshold(): number {
	const raw = (process.env.LOG_LEVEL || 'info').toLowerCase() as LogLevelName;
	return LEVELS[raw] ?? LEVELS.info;
}

const threshold = resolveThreshold();

/** Useful if you want to skip building an expensive field object when the level is filtered out anyway. */
export function isLevelEnabled(level: LogLevelName): boolean {
	return LEVELS[level] >= threshold;
}

// Keys whose values get replaced with [REDACTED] anywhere they appear in the field tree.
const REDACT_KEYS = new Set([
	'password', 'pass', 'pwd',
	'apikey', 'api_key',
	'authorization', 'cookie', 'set-cookie',
	'sessiontoken', 'session_token', 'sessionid', 'session_id',
	'token', 'access_token', 'refresh_token', 'id_token',
	'code_verifier', 'code_challenge', 'pkce',
	'client_secret', 'clientsecret',
	'vapidprivatekey', 'vapid_private_key',
	'p256dh', 'keys_p256dh', 'keys_auth',
]);

const REDACTED = '[REDACTED]';
const MAX_DEPTH = 6;

function shouldRedactKey(key: string): boolean {
	return REDACT_KEYS.has(key.toLowerCase());
}

function sanitize(value: unknown, depth = 0): unknown {
	if (depth > MAX_DEPTH) return '[depth-limit]';
	if (value === null || value === undefined) return value;
	if (value instanceof Error) {
		return { name: value.name, message: value.message, stack: value.stack };
	}
	if (Array.isArray(value)) return value.map((v) => sanitize(v, depth + 1));
	if (typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			if (shouldRedactKey(k)) {
				out[k] = REDACTED;
			} else {
				out[k] = sanitize(v, depth + 1);
			}
		}
		return out;
	}
	return value;
}

interface LoggerImpl {
	trace(msg: string, fields?: Record<string, unknown>): void;
	debug(msg: string, fields?: Record<string, unknown>): void;
	info(msg: string, fields?: Record<string, unknown>): void;
	warn(msg: string, fields?: Record<string, unknown>): void;
	error(msg: string, fields?: Record<string, unknown>): void;
	child(bound: Record<string, unknown>): LoggerImpl;
	time(label: string, fields?: Record<string, unknown>): { end(extras?: Record<string, unknown>): number };
}

function emit(level: LogLevelName, msg: string, bound: Record<string, unknown>, fields?: Record<string, unknown>) {
	if (LEVELS[level] < threshold) return;

	const merged = fields ? { ...bound, ...fields } : bound;
	const sanitized = sanitize(merged) as Record<string, unknown>;

	const record = {
		ts: new Date().toISOString(),
		level,
		msg,
		...sanitized,
	};

	try {
		process.stderr.write(JSON.stringify(record) + '\n');
	} catch {
		// best-effort fallback
		try { console.error(`[${level}] ${msg}`); } catch { /* ignore */ }
	}
}

function makeLogger(bound: Record<string, unknown>): LoggerImpl {
	return {
		trace: (msg, fields) => emit('trace', msg, bound, fields),
		debug: (msg, fields) => emit('debug', msg, bound, fields),
		info: (msg, fields) => emit('info', msg, bound, fields),
		warn: (msg, fields) => emit('warn', msg, bound, fields),
		error: (msg, fields) => emit('error', msg, bound, fields),
		child: (extra) => makeLogger({ ...bound, ...extra }),
		time: (label, fields) => {
			const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
			return {
				end(extras) {
					const dt = Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0) * 1000) / 1000;
					emit('debug', label, bound, { ...(fields ?? {}), ...(extras ?? {}), durationMs: dt });
					return dt;
				},
			};
		},
	};
}

export const logger: LoggerImpl = makeLogger({});
export type Logger = LoggerImpl;
