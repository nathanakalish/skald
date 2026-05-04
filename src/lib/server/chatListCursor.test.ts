import { describe, expect, it } from 'vitest';
import { encodeChatListCursor, parseChatListCursor } from './chatListCursor.js';

describe('chat list cursors', () => {
	it('round-trips timestamps containing colons', () => {
		const cursor = encodeChatListCursor('2026-05-03 14:15:16', 123);

		expect(cursor).toBe('2026-05-03 14:15:16:123');
		expect(parseChatListCursor(cursor!)).toEqual({
			updatedAt: '2026-05-03 14:15:16',
			id: 123
		});
	});

	it('round-trips ISO timestamps containing colons', () => {
		const cursor = encodeChatListCursor('2026-05-03T14:15:16.789Z', 456);

		expect(parseChatListCursor(cursor!)).toEqual({
			updatedAt: '2026-05-03T14:15:16.789Z',
			id: 456
		});
	});

	it('rejects malformed cursors', () => {
		expect(parseChatListCursor('')).toBeNull();
		expect(parseChatListCursor('2026-05-03')).toBeNull();
		expect(parseChatListCursor('2026-05-03 14:15:16:')).toBeNull();
		expect(parseChatListCursor('2026-05-03 14:15:16:nope')).toBeNull();
	});
});
