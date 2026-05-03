import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// LOG_LEVEL is read once at module load, so we have to reset modules between tests
// to actually change the threshold. That's what loadLogger() does.

let writeSpy: ReturnType<typeof vi.spyOn>;
let captured: string[];

async function loadLogger(level: string) {
	process.env.LOG_LEVEL = level;
	vi.resetModules();
	captured = [];
	writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => {
		captured.push(typeof chunk === 'string' ? chunk : chunk.toString());
		return true;
	});
	return await import('./logger.js');
}

function lines(): Record<string, unknown>[] {
	return captured.flatMap((c) =>
		c.split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>),
	);
}

describe('logger', () => {
	const origLevel = process.env.LOG_LEVEL;

	afterEach(() => {
		writeSpy?.mockRestore();
		process.env.LOG_LEVEL = origLevel;
	});

	describe('level filtering', () => {
		it('drops debug when LOG_LEVEL=warn', async () => {
			const { logger } = await loadLogger('warn');
			logger.debug('quiet');
			logger.info('also quiet');
			logger.warn('loud');
			logger.error('shouty');

			const out = lines();
			expect(out).toHaveLength(2);
			expect(out[0].level).toBe('warn');
			expect(out[1].level).toBe('error');
		});

		it('emits everything at LOG_LEVEL=trace', async () => {
			const { logger } = await loadLogger('trace');
			logger.trace('a');
			logger.debug('b');
			logger.info('c');
			logger.warn('d');
			logger.error('e');
			expect(lines()).toHaveLength(5);
		});

		it('isLevelEnabled honours threshold', async () => {
			const { isLevelEnabled } = await loadLogger('info');
			expect(isLevelEnabled('debug')).toBe(false);
			expect(isLevelEnabled('info')).toBe(true);
			expect(isLevelEnabled('error')).toBe(true);
		});
	});

	describe('redaction', () => {
		it('redacts known sensitive keys recursively', async () => {
			const { logger } = await loadLogger('info');
			logger.info('test', {
				apiKey: 'sk-secret',
				password: 'hunter2',
				nested: { authorization: 'Bearer xyz', other: 'ok' },
				list: [{ token: 'leak' }, 'plain'],
			});

			const [rec] = lines();
			expect(rec.apiKey).toBe('[REDACTED]');
			expect(rec.password).toBe('[REDACTED]');
			expect((rec.nested as any).authorization).toBe('[REDACTED]');
			expect((rec.nested as any).other).toBe('ok');
			expect((rec.list as any)[0].token).toBe('[REDACTED]');
			expect((rec.list as any)[1]).toBe('plain');
		});

		it('serialises Error instances', async () => {
			const { logger } = await loadLogger('info');
			logger.error('boom', { err: new Error('exploded') });
			const [rec] = lines();
			expect((rec.err as any).message).toBe('exploded');
			expect((rec.err as any).name).toBe('Error');
			expect(typeof (rec.err as any).stack).toBe('string');
		});
	});

	describe('child', () => {
		it('merges parent fields onto every emit', async () => {
			const { logger } = await loadLogger('info');
			const child = logger.child({ requestId: 'req-1', userId: 42 });
			child.info('first');
			child.warn('second', { extra: 'yes' });

			const [a, b] = lines();
			expect(a.requestId).toBe('req-1');
			expect(a.userId).toBe(42);
			expect(b.requestId).toBe('req-1');
			expect(b.userId).toBe(42);
			expect(b.extra).toBe('yes');
		});

		it('child fields override parent on the same key', async () => {
			const { logger } = await loadLogger('info');
			const child = logger.child({ scope: 'parent' }).child({ scope: 'child' });
			child.info('x');
			expect(lines()[0].scope).toBe('child');
		});
	});

	describe('time', () => {
		it('logs durationMs at debug', async () => {
			const { logger } = await loadLogger('debug');
			const t = logger.time('work', { hint: 'a' });
			const dt = t.end({ extra: 'b' });
			expect(typeof dt).toBe('number');
			expect(dt).toBeGreaterThanOrEqual(0);

			const [rec] = lines();
			expect(rec.level).toBe('debug');
			expect(rec.msg).toBe('work');
			expect(rec.hint).toBe('a');
			expect(rec.extra).toBe('b');
			expect(typeof rec.durationMs).toBe('number');
		});
	});
});
