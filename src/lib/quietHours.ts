/**
 * Quiet hours / Do-Not-Disturb helper.
 * Times are HH:MM strings in the local timezone of the device.
 * Window may wrap midnight (e.g. start=22:00, end=07:00).
 */

function parseHHMM(s: string): number | null {
	const m = /^(\d{1,2}):(\d{2})$/.exec(s ?? '');
	if (!m) return null;
	const h = Number(m[1]);
	const min = Number(m[2]);
	if (h < 0 || h > 23 || min < 0 || min > 59) return null;
	return h * 60 + min;
}

export function isWithinQuietHours(
	start: string,
	end: string,
	now: Date = new Date()
): boolean {
	const s = parseHHMM(start);
	const e = parseHHMM(end);
	if (s == null || e == null || s === e) return false;
	const cur = now.getHours() * 60 + now.getMinutes();
	if (s < e) return cur >= s && cur < e;
	// Wraps midnight.
	return cur >= s || cur < e;
}
