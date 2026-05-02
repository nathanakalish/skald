/**
 * Shared SSRF protection — blocks requests to private/internal networks.
 *
 * Two layers:
 *   1. `isPrivateHostname` — synchronous string-shape check (cheap fail-fast).
 *   2. `assertPublicHost`  — resolves DNS and rejects if any A/AAAA record
 *      points at a private/loopback range. Catches DNS rebinding where a
 *      public-looking hostname resolves to e.g. 169.254.169.254 (cloud
 *      metadata) or 10.0.0.0/8 (internal services).
 *
 * Heads up: there's still a TOCTOU window between resolution here and the
 * actual connect inside `fetch`. For self-hosted single-tenant setups that's
 * fine; for SaaS, route fetches through an egress proxy.
 */
import { lookup as dnsLookup } from 'node:dns/promises';

export function isPrivateHostname(hostname: string): boolean {
	return (
		hostname === 'localhost' ||
		hostname === '127.0.0.1' ||
		hostname === '::1' ||
		hostname === '0.0.0.0' ||
		hostname === '169.254.169.254' ||
		hostname.startsWith('10.') ||
		hostname.startsWith('192.168.') ||
		/^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
		hostname.endsWith('.local') ||
		hostname.endsWith('.internal')
	);
}

/**
 * True if the IPv4/IPv6 address is loopback, link-local, multicast, private,
 * or otherwise a bad target for an outbound public fetch.
 */
export function isPrivateIP(ip: string): boolean {
	// IPv4
	if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
		const parts = ip.split('.').map(Number);
		const [a, b] = parts;
		if (a === 0) return true;                        // 0.0.0.0/8
		if (a === 10) return true;                       // 10.0.0.0/8
		if (a === 127) return true;                      // loopback
		if (a === 169 && b === 254) return true;         // link-local + AWS metadata
		if (a === 172 && b >= 16 && b <= 31) return true;// 172.16.0.0/12
		if (a === 192 && b === 168) return true;         // 192.168.0.0/16
		if (a === 100 && b >= 64 && b <= 127) return true;// CGNAT 100.64.0.0/10
		if (a >= 224) return true;                       // multicast / reserved
		return false;
	}
	// IPv6 — normalize lowercase first
	const v6 = ip.toLowerCase();
	if (v6 === '::' || v6 === '::1') return true;
	if (v6.startsWith('fe80:') || v6.startsWith('fe80::')) return true; // link-local
	if (v6.startsWith('fc') || v6.startsWith('fd')) return true;        // unique-local fc00::/7
	if (v6.startsWith('ff')) return true;                                // multicast
	// IPv4-mapped IPv6 (::ffff:a.b.c.d) — unwrap and recurse.
	const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
	if (mapped) return isPrivateIP(mapped[1]);
	return false;
}

/**
 * Resolves `hostname` and throws if it points at any private/loopback address.
 * Call this immediately before issuing an outbound fetch. Returns silently on
 * success.
 *
 * Set `ALLOW_LOCAL_PROVIDERS=true` to disable the check entirely — useful for
 * single-user, self-hosted deploys that point Skald at a local Ollama on
 * `localhost` or `192.168.x.y`. Multi-user deployments should leave this off.
 */
export async function assertPublicHost(hostname: string): Promise<void> {
	if (process.env.ALLOW_LOCAL_PROVIDERS === 'true') return;
	if (isPrivateHostname(hostname)) {
		throw new Error(`refusing to fetch private host: ${hostname}`);
	}
	let addrs: { address: string }[];
	try {
		addrs = await dnsLookup(hostname, { all: true });
	} catch {
		// DNS failure — let fetch surface its own error.
		return;
	}
	for (const { address } of addrs) {
		if (isPrivateIP(address)) {
			throw new Error(`refusing to fetch ${hostname}: resolves to private IP ${address}`);
		}
	}
}
