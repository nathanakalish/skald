import type { ResolvedGuidance, ProcessOptions, ChatRow } from './types.js';

/**
 * Merge per-turn guidance with the chat-wide reply guidance.
 *
 * The two sources have different lifetimes — `chat.replyGuidance` is a
 * persistent steer the user set once ("keep replies short"), and `opts.guidance`
 * is one-off direction attached to a single send/regenerate. We concatenate so
 * the model sees both; per-turn comes last so it takes precedence in the
 * model's attention.
 *
 * Impersonation never reads `chat.replyGuidance` — that field steers the
 * *character's* replies and would leak weirdly into the user's voice. The
 * per-turn `opts.guidance` is the only source there.
 */
export function resolveGuidance(chat: ChatRow, opts: ProcessOptions): ResolvedGuidance {
	const perMessage = opts.guidance?.trim() || '';

	if (opts.impersonate) {
		return {
			effective: perMessage || undefined,
			sources: { chatWide: false, perMessage: !!perMessage },
		};
	}

	const chatWide = chat.replyGuidance?.trim() || '';

	if (chatWide && perMessage) {
		return {
			effective: `${chatWide}\n\n${perMessage}`,
			sources: { chatWide: true, perMessage: true },
		};
	}
	return {
		effective: chatWide || perMessage || undefined,
		sources: { chatWide: !!chatWide, perMessage: !!perMessage },
	};
}
