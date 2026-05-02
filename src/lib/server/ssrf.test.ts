import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isPrivateHostname, isPrivateIP, assertPublicHost } from './ssrf.js';

describe('isPrivateHostname', () => {
	it.each([
		'localhost',
		'127.0.0.1',
		'::1',
		'0.0.0.0',
		'169.254.169.254',
		'10.0.0.5',
		'192.168.1.1',
		'172.16.0.1',
		'172.31.255.255',
		'foo.local',
		'bar.internal'
	])('flags %s as private', (host) => {
		expect(isPrivateHostname(host)).toBe(true);
	});

	it.each([
		'example.com',
		'api.openai.com',
		'8.8.8.8',
		'172.15.0.1', // just outside 172.16/12
		'172.32.0.1'
	])('lets %s through', (host) => {
		expect(isPrivateHostname(host)).toBe(false);
	});
});

describe('isPrivateIP', () => {
	it.each([
		'0.0.0.1',
		'10.5.6.7',
		'127.0.0.1',
		'169.254.169.254',
		'172.16.0.1',
		'172.31.255.255',
		'192.168.0.1',
		'100.64.0.1',
		'::',
		'::1',
		'fe80::1',
		'fc00::1',
		'fd12::34',
		'ff00::1',
		'::ffff:127.0.0.1',
		'::ffff:10.0.0.1'
	])('flags %s as private', (ip) => {
		expect(isPrivateIP(ip)).toBe(true);
	});

	it.each([
		'8.8.8.8',
		'1.1.1.1',
		'140.82.121.4',
		'2606:4700::1111',
		'::ffff:8.8.8.8'
	])('lets %s through', (ip) => {
		expect(isPrivateIP(ip)).toBe(false);
	});
});

describe('assertPublicHost', () => {
	const original = process.env.ALLOW_LOCAL_PROVIDERS;
	beforeEach(() => { delete process.env.ALLOW_LOCAL_PROVIDERS; });
	afterEach(() => {
		if (original === undefined) delete process.env.ALLOW_LOCAL_PROVIDERS;
		else process.env.ALLOW_LOCAL_PROVIDERS = original;
	});

	it('rejects literal private hostnames before DNS', async () => {
		await expect(assertPublicHost('localhost')).rejects.toThrow(/private host/i);
		await expect(assertPublicHost('127.0.0.1')).rejects.toThrow(/private host/i);
		await expect(assertPublicHost('169.254.169.254')).rejects.toThrow(/private host/i);
	});

	it('honors ALLOW_LOCAL_PROVIDERS=true', async () => {
		process.env.ALLOW_LOCAL_PROVIDERS = 'true';
		await expect(assertPublicHost('localhost')).resolves.toBeUndefined();
		await expect(assertPublicHost('192.168.1.1')).resolves.toBeUndefined();
	});
});
