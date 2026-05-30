import { parseReasoning, parseSwipes } from '$lib/messageJson';

export interface Message {
	id: number;
	role: string;
	content: string;
	swipes: string[];
	swipeIndex: number;
	reasoning: string[];
	parentId: number | null;
	createdAt: string | null;
	guidance: string | null;
	impersonationGuidance: string | null;
}

export interface MessageImageRow {
	id: number;
	messageId: number;
	swipeIndex: number;
	filePath: string;
	prompt: string;
	model: string;
	providerId: number | null;
	isActive: boolean;
	createdAt: string | null;
}

export interface MessageSiblings {
	[messageId: number]: { index: number; total: number };
}

/**
 * Normalize a raw DB message row into the shape ChatView works with.
 * Falls back to `[content]` when swipes is empty so the swipe machinery always
 * has at least one entry to point at.
 */
export function parseMessage(m: any): Message {
	let swipes = parseSwipes(m.swipes);
	if (swipes.length === 0) swipes = [m.content];
	const reasoning = parseReasoning(m.reasoning);
	return {
		id: m.id,
		role: m.role,
		content: m.content,
		swipes,
		swipeIndex: m.swipeIndex ?? 0,
		reasoning,
		parentId: m.parentId ?? null,
		createdAt: m.createdAt ?? null,
		guidance: m.guidance ?? null,
		impersonationGuidance: m.impersonationGuidance ?? null
	};
}
