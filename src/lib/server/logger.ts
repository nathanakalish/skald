/**
 * Tiny structured JSON logger — one line per record to stderr, optionally
 * mirrored to a file.
 *
 * LOG_LEVEL sets the threshold (default "info"). Levels go trace → debug → info → warn → error.
 * Use logger.child({ requestId, ... }) to bind fields for the lifetime of a request.
 * Sensitive keys are scrubbed recursively before output (see REDACT_KEYS).
 *
 * File sink: set LOG_FILE=/path/to/file.log to also append JSON lines to a file.
 *   LOG_FILE_MAX_BYTES   — rotate when file exceeds this size (default 10 MB).
 *   LOG_FILE_MAX_FILES   — number of rotated backups to keep (default 5, named .1 .. .N).
 * Rotation is best-effort: failures fall back to stderr-only and never crash the caller.
 */

import { appendFileSync, mkdirSync, renameSync, statSync, unlinkSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

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
	/**
	 * Record a numeric observation against a named histogram. Aggregated in memory
	 * and periodically flushed as a single info log (`metrics: snapshot`) with
	 * count/min/max/p50/p95/p99/avg per metric. Cheap — just an array push.
	 */
	metric(name: string, value: number): void;
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

	const line = (() => {
		try { return JSON.stringify(record) + '\n'; }
		catch { return JSON.stringify({ ts: record.ts, level, msg, _err: 'serialize_failed' }) + '\n'; }
	})();

	try {
		const colored =
			process.stderr.isTTY && level === 'warn'  ? '\x1b[33m' + line + '\x1b[0m' :
			process.stderr.isTTY && level === 'error' ? '\x1b[31m' + line + '\x1b[0m' :
			line;
		process.stderr.write(colored);
	} catch {
		try { console.error(`[${level}] ${msg}`); } catch { /* ignore */ }
	}

	writeToFile(line);
}

// --- File sink ----------------------------------------------------------------
// Synchronous appends to keep ordering predictable and avoid losing the tail on
// crash. Volume is low (info-level lifecycle + warn/error), so the blocking cost
// is fine. If someone cranks LOG_LEVEL=trace in production the perf hit is on
// them.

const LOG_FILE = process.env.LOG_FILE?.trim() || '';
const LOG_FILE_MAX_BYTES = parsePositiveInt(process.env.LOG_FILE_MAX_BYTES, 10 * 1024 * 1024);
const LOG_FILE_MAX_FILES = parsePositiveInt(process.env.LOG_FILE_MAX_FILES, 5);

let fileSinkBroken = false;
let fileSinkInitialized = false;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
	if (!raw) return fallback;
	const n = Number(raw);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function ensureLogDir(): void {
	if (fileSinkInitialized || !LOG_FILE) return;
	try {
		mkdirSync(dirname(LOG_FILE), { recursive: true });
		fileSinkInitialized = true;
	} catch (err) {
		fileSinkBroken = true;
		try { process.stderr.write(`[logger] failed to create log dir: ${String(err)}\n`); } catch { /* ignore */ }
	}
}

function rotateIfNeeded(): void {
	let size = 0;
	try {
		size = statSync(LOG_FILE).size;
	} catch {
		return; // file doesn't exist yet
	}
	if (size < LOG_FILE_MAX_BYTES) return;

	// Walk from oldest to newest so we don't clobber.
	try {
		const oldest = `${LOG_FILE}.${LOG_FILE_MAX_FILES}`;
		if (existsSync(oldest)) {
			try { unlinkSync(oldest); } catch { /* ignore */ }
		}
		for (let i = LOG_FILE_MAX_FILES - 1; i >= 1; i--) {
			const src = `${LOG_FILE}.${i}`;
			const dst = `${LOG_FILE}.${i + 1}`;
			if (existsSync(src)) {
				try { renameSync(src, dst); } catch { /* ignore */ }
			}
		}
		renameSync(LOG_FILE, `${LOG_FILE}.1`);
	} catch (err) {
		// If rotation fails (race with another writer, EXDEV, etc.) just keep
		// appending to the current file rather than losing the line.
		try { process.stderr.write(`[logger] rotation failed: ${String(err)}\n`); } catch { /* ignore */ }
	}
}

function writeToFile(line: string): void {
	if (!LOG_FILE || fileSinkBroken) return;
	ensureLogDir();
	if (fileSinkBroken) return;
	try {
		rotateIfNeeded();
		appendFileSync(LOG_FILE, line);
	} catch (err) {
		fileSinkBroken = true;
		try { process.stderr.write(`[logger] file sink disabled after error: ${String(err)}\n`); } catch { /* ignore */ }
	}
}

// --- Metrics ------------------------------------------------------------------
// Tiny in-process histogram. Per metric we keep a bounded reservoir of recent
// observations; on flush we compute count/min/max/avg + p50/p95/p99 and emit a
// single info log. No external deps, no Prometheus — just enough to spot drift
// in a single-node deployment via grep.

const METRIC_FLUSH_MS = parsePositiveInt(process.env.LOG_METRICS_FLUSH_MS, 60_000);
const METRIC_RESERVOIR_CAP = parsePositiveInt(process.env.LOG_METRICS_RESERVOIR, 1000);
const METRICS_ENABLED = (process.env.LOG_METRICS ?? 'true').toLowerCase() !== 'false';

const metricBuckets = new Map<string, number[]>();
let metricFlushTimer: ReturnType<typeof setInterval> | null = null;

function recordMetric(name: string, value: number): void {
	if (!METRICS_ENABLED || !Number.isFinite(value)) return;
	let bucket = metricBuckets.get(name);
	if (!bucket) {
		bucket = [];
		metricBuckets.set(name, bucket);
	}
	// Reservoir-ish: once full, randomly replace to keep a representative sample
	// without unbounded memory under high call rates.
	if (bucket.length < METRIC_RESERVOIR_CAP) {
		bucket.push(value);
	} else {
		const idx = Math.floor(Math.random() * bucket.length);
		bucket[idx] = value;
	}
	ensureMetricTimer();
}

function ensureMetricTimer(): void {
	if (metricFlushTimer || !METRICS_ENABLED) return;
	if (typeof setInterval === 'undefined') return;
	metricFlushTimer = setInterval(flushMetrics, METRIC_FLUSH_MS);
	metricFlushTimer.unref?.();
}

function percentile(sorted: number[], p: number): number {
	if (sorted.length === 0) return 0;
	const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
	return sorted[idx];
}

function flushMetrics(): void {
	if (metricBuckets.size === 0) return;
	const snapshot: Record<string, unknown> = {};
	for (const [name, values] of metricBuckets) {
		if (values.length === 0) continue;
		const sorted = [...values].sort((a, b) => a - b);
		const sum = sorted.reduce((s, v) => s + v, 0);
		snapshot[name] = {
			count: sorted.length,
			min: round2(sorted[0]),
			max: round2(sorted[sorted.length - 1]),
			avg: round2(sum / sorted.length),
			p50: round2(percentile(sorted, 50)),
			p95: round2(percentile(sorted, 95)),
			p99: round2(percentile(sorted, 99)),
		};
	}
	metricBuckets.clear();
	if (Object.keys(snapshot).length > 0) {
		emit('info', 'metrics: snapshot', {}, snapshot);
	}
}

function round2(n: number): number {
	return Math.round(n * 100) / 100;
}

// Test/diagnostic hooks. Not part of the public Logger type.
export function _flushMetricsForTest(): void { flushMetrics(); }
export function _resetMetricsForTest(): void {
	metricBuckets.clear();
	if (metricFlushTimer) { clearInterval(metricFlushTimer); metricFlushTimer = null; }
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
		metric: (name, value) => recordMetric(name, value),
	};
}

export const logger: LoggerImpl = makeLogger({});
export type Logger = LoggerImpl;
