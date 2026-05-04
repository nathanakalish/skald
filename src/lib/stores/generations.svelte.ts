// Global per-chat generation state buffer.
//
// Tracks in-flight LLM generations regardless of which chat (if any) the
// user is currently viewing. Lets ChatView restore typing indicator,
// accumulated tokens and reasoning when the user navigates away from a
// streaming chat and returns.
//
// Layout's SSE handler writes here; ChatView reads from here on mount and
// observes via $effect for updates that arrived while it was unmounted.

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

let _generations = $state(new Map<number, GenerationState>());

function bump() {
	// Reassign the Map so consumers using $derived/$effect see a new reference.
	_generations = new Map(_generations);
}

function ensureStreamingState(chatId: number): GenerationState {
	let gen = _generations.get(chatId);
	if (!gen) {
		gen = {
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
		};
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
		_generations.set(chatId, {
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
		bump();
	},
	pushToken(chatId: number, token: string) {
		const gen = ensureStreamingState(chatId);
		if (gen.status !== 'streaming') gen.status = 'streaming';
		gen.accumulated += token;
		gen.lastEventAt = Date.now();
		bump();
	},
	pushReasoning(chatId: number, reasoning: string) {
		const gen = ensureStreamingState(chatId);
		if (gen.status !== 'streaming') gen.status = 'streaming';
		gen.accumulatedReasoning += reasoning;
		gen.lastEventAt = Date.now();
		bump();
	},
	setTokenStats(chatId: number, stats: any) {
		const gen = ensureStreamingState(chatId);
		if (gen.status !== 'streaming') gen.status = 'streaming';
		gen.tokenStats = stats;
		gen.lastEventAt = Date.now();
		bump();
	},
	setError(chatId: number, error: string) {
		const gen = _generations.get(chatId);
		if (!gen) return;
		gen.status = 'error';
		gen.error = error;
		gen.lastEventAt = Date.now();
		bump();
	},
	complete(chatId: number) {
		const gen = _generations.get(chatId);
		if (!gen) return;
		gen.status = 'done';
		gen.lastEventAt = Date.now();
		bump();
	},
	clear(chatId: number) {
		if (!_generations.has(chatId)) return;
		_generations.delete(chatId);
		bump();
	}
};
