export interface ChatListCursor {
	updatedAt: string;
	id: number;
}

export function encodeChatListCursor(updatedAt: string | null, id: number): string | null {
	if (!updatedAt) return null;
	return `${updatedAt}:${id}`;
}

export function parseChatListCursor(cursor: string): ChatListCursor | null {
	const splitAt = cursor.lastIndexOf(':');
	if (splitAt <= 0 || splitAt === cursor.length - 1) return null;

	const updatedAt = cursor.slice(0, splitAt);
	const id = Number(cursor.slice(splitAt + 1));
	if (!Number.isSafeInteger(id) || id <= 0) return null;

	return { updatedAt, id };
}
