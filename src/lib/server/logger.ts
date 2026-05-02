/**
 * Tiny structured JSON logger. Writes one JSON object per line to stderr.
 *
 * Levels (numeric, lower = more verbose):
 *   trace=10, debug=20, info=30, warn=40, error=50
 *
 * Set the threshold via env var LOG_LEVEL (default "info").
 */

type LogLevelName = 'trace' | 'debug' | 'info' | 'warn' | 'error';

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

function emit(level: LogLevelName, msg: string, fields?: Record<string, unknown>) {
	if (LEVELS[level] < threshold) return;

	let extras: Record<string, unknown> | undefined = fields;
	// Auto-serialise Error instances with stack
	if (fields) {
		extras = {};
		for (const [k, v] of Object.entries(fields)) {
			if (v instanceof Error) {
				extras[k] = { name: v.name, message: v.message, stack: v.stack };
			} else {
				extras[k] = v;
			}
		}
	}

	const record = {
		ts: new Date().toISOString(),
		level,
		msg,
		...(extras ?? {}),
	};

	try {
		process.stderr.write(JSON.stringify(record) + '\n');
	} catch {
		// best-effort fallback
		try { console.error(`[${level}] ${msg}`); } catch { /* ignore */ }
	}
}

export const logger = {
	trace: (msg: string, fields?: Record<string, unknown>) => emit('trace', msg, fields),
	debug: (msg: string, fields?: Record<string, unknown>) => emit('debug', msg, fields),
	info: (msg: string, fields?: Record<string, unknown>) => emit('info', msg, fields),
	warn: (msg: string, fields?: Record<string, unknown>) => emit('warn', msg, fields),
	error: (msg: string, fields?: Record<string, unknown>) => emit('error', msg, fields),
};
