// Global per-chat generation state buffer.
//
// Tracks in-flight LLM generations regardless of which chat (if any) the
// user is currently viewing. Lets ChatView restore typing indicator,
// accumulated tokens and reasoning when the user navigates away from a
// streaming chat and returns.
//
// Layout's SSE handler writes here; ChatView reads from here on mount and
// observes via $effect for updates that arrived while it was unmounted.
//
// PERF-CH2 / FRONT-C3: use SvelteMap (reactive Map) and per-entry $state
// so token pushes mutate one field in place instead of cloning the whole
// Map on every event. With multiple concurrent streams firing ~30 events
// per second, the old `new Map(_generations)` clone was the dominant
// per-token cost on the client.

import { SvelteMap } from 'svelte/reactivity';

export interface GenerationState {
	chatId: number;
	status: 'streaming' | 'done' | 'error';
	accumulated: string;
	accumulatedReasoning: string;
	isRegenerate: boolean;
	isImpersonation: boolean;
	originalMessageId: number | null;
	startedAt: number;
	lastEventAt: number;
	error: string | null;
	tokenStats: any | null;
}

const _generations = new SvelteMap<number, GenerationState>();

function ensureStreamingState(chatId: number): GenerationState {
	let gen = _generations.get(chatId);
	if (!gen) {
		// Wrap in $state so per-field mutations stay reactive without
		// having to reassign the Map entry.
		gen = $state({
			chatId,
			status: 'streaming',
			accumulated: '',
			accumulatedReasoning: '',
			isRegenerate: false,
			isImpersonation: false,
			originalMessageId: null,
			startedAt: Date.now(),
			lastEventAt: Date.now(),
			error: null,
			tokenStats: null
		});
		_generations.set(chatId, gen);
	}
	return gen;
}

export const generationsStore = {
	get all() {
		return _generations;
	},
	get(chatId: number): GenerationState | undefined {
		return _generations.get(chatId);
	},
	has(chatId: number): boolean {
		return _generations.has(chatId);
	},
	isStreaming(chatId: number): boolean {
		return _generations.get(chatId)?.status === 'streaming';
	},
	start(chatId: number, opts: { isRegenerate?: boolean; isImpersonation?: boolean; originalMessageId?: number | null } = {}) {
		const existing = _generations.get(chatId);
		if (existing && existing.status === 'streaming') return;
		const gen: GenerationState = $state({
			chatId,
			status: 'streaming',
			accumulated: '',
			accumulatedReasoning: '',
			isRegenerate: opts.isRegenerate ?? false,
			isImpersonation: opts.isImpersonation ?? false,
			originalMessageId: opts.originalMessageId ?? null,
			startedAt: Date.now(),
			lastEventAt: Date.now(),
			error: null,
			tokenStats: null
		});
		_generations.set(chatId, gen);
	},
	pushToken(chatId: number, token: string) {
		const gen = ensureStreamingState(chatId);
		if (gen.status !== 'streaming') gen.status = 'streaming';
		gen.accumulated += token;
		gen.lastEventAt = Date.now();
	},
	// Used for catch-up events on reconnect: the server sends the full
	// accumulated text as a single blob, not a delta.
	setAccumulated(chatId: number, text: string) {
		const gen = ensureStreamingState(chatId);
		if (gen.status !== 'streaming') gen.status = 'streaming';
		gen.accumulated = text;
		gen.lastEventAt = Date.now();
	},
	pushReasoning(chatId: number, reasoning: string) {
		const gen = ensureStreamingState(chatId);
		if (gen.status !== 'streaming') gen.status = 'streaming';
		gen.accumulatedReasoning += reasoning;
		gen.lastEventAt = Date.now();
	},
	setAccumulatedReasoning(chatId: number, text: string) {
		const gen = ensureStreamingState(chatId);
		if (gen.status !== 'streaming') gen.status = 'streaming';
		gen.accumulatedReasoning = text;
		gen.lastEventAt = Date.now();
	},
	setTokenStats(chatId: number, stats: any) {
		const gen = ensureStreamingState(chatId);
		if (gen.status !== 'streaming') gen.status = 'streaming';
		gen.tokenStats = stats;
		gen.lastEventAt = Date.now();
	},
	setError(chatId: number, error: string) {
		const gen = _generations.get(chatId);
		if (!gen) return;
		gen.status = 'error';
		gen.error = error;
		gen.lastEventAt = Date.now();
	},
	complete(chatId: number) {
		const gen = _generations.get(chatId);
		if (!gen) return;
		gen.status = 'done';
		gen.lastEventAt = Date.now();
	},
	clear(chatId: number) {
		_generations.delete(chatId);
	}
};
