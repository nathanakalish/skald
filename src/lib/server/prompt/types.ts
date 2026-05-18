/**
 * Shared types for the prompt-construction subsystem. Keep them lean — anything
 * that's only used inside one slot builder lives next to that builder, not here.
 */
import type { ChatMessage, SamplerSettings } from '$lib/providers/base.js';
import type { chats, characters, providers, personas } from '$lib/db/schema.js';
import type { MessageRow } from '$lib/server/chatTree.js';
import type { TokenBudget } from '$lib/services/tokenizer.js';

export type ChatRow = typeof chats.$inferSelect;
type CharacterRow = typeof characters.$inferSelect;
type ProviderRow = typeof providers.$inferSelect;
type PersonaRow = typeof personas.$inferSelect;

export type ChatMode = 'story' | 'texting';
export type RenderMode = 'roleplay' | 'markdown';

/**
 * One named slot in the prompt pipeline. Slots get sorted by `order`,
 * filtered for `enabled`, then concatenated into the final ChatMessage[].
 *
 * `order` uses big gaps (multiples of 100) so future slots can wedge themselves
 * in without renumbering. Sub-slots use parent+offset (e.g. customPrompt at
 * SYSTEM_PROMPT + 10).
 */
export interface PromptSlot {
	name: string;
	order: number;
	enabled: boolean;
	messages: ChatMessage[];
}

/**
 * Slot ordering constants. Single source of truth — UI, builder, and the
 * custom-slot-order remapper all read from this.
 *
 * Layout intent: setup (system/persona/character/lorebook/examples) → context
 * (compactionSummary/timeline) → live history → post-history → recency hooks
 * (guidance/nudge). Compaction summary sits right before the live history so
 * the model reads it as "this is what already happened" before "this is what
 * is happening now".
 */
export const SLOT_ORDER = {
	SYSTEM_PROMPT: 100,
	PERSONA: 200,
	CHARACTER_CARD: 300,
	LOREBOOK: 400,
	EXAMPLE_MESSAGES: 500,
	COMPACTION_SUMMARY: 560,
	CHAT_HISTORY: 600,
	POST_HISTORY: 700,
	NUDGE: 800,
} as const;

/**
 * Sub-slot offsets relative to a parent order. Keeps fine positioning out of
 * the main constant table.
 */
export const SUB_SLOT_OFFSETS = {
	customPrompt: 10,        // SYSTEM_PROMPT + 10
	timeline: -1,            // CHAT_HISTORY - 1
	guidance: 50,            // POST_HISTORY + 50
	starterNudge: 10,        // NUDGE + 10
} as const;

/**
 * Slots that the budget enforcer is allowed to drop when the prompt still
 * overflows after history trimming. Ordered by ascending pain — `examples`
 * comes first because losing them only costs a vibe-check; load-bearing slots
 * (system, character, persona, history, guidance, customPrompt, starterNudge)
 * are NEVER in this list.
 */
export const DROPPABLE_SLOTS = [
	'examples',
	'compactionSummary',
	'timeline',
	'postHistory',
	'greetingContext',
] as const;

/**
 * Options for a single prompt build. Comes from the API route or queue job.
 */
export interface ProcessOptions {
	chatId: number;
	/** Drop the last assistant message before building. */
	regenerate?: boolean;
	/** Greeting / first-message generation. Changes slot composition for both modes. */
	greeting?: boolean;
	/** Flip roles, swap to impersonate slot builder, treat guidance differently. */
	impersonate?: boolean;
	/**
	 * Out-of-band steering for this turn. For reply: merged with chat.replyGuidance.
	 * For impersonate: used as-is, NEVER merged with chat.replyGuidance.
	 */
	guidance?: string;
}

/**
 * Resolved guidance for a single build. `sources` exists so the audit log can
 * say exactly what contributed.
 */
export interface ResolvedGuidance {
	effective: string | undefined;
	sources: {
		chatWide: boolean;
		perMessage: boolean;
	};
}

/**
 * Everything `buildSlots` needs to compose the prompt. Output of `loadPromptContext`.
 * Pure data — no DB handles, no functions. Safe to log or serialize for debugging.
 */
export interface ResolvedContext {
	chat: ChatRow;
	character: CharacterRow;
	persona: PersonaRow | null;
	activeProvider: ProviderRow;
	activeModel: string;
	samplerSettings: SamplerSettings;
	contextSize: number;
	maxResponseTokens: number;
	customPrompt: string;
	lorebookDepth: number;
	streamingEnabled: boolean;
	includeReasoning: boolean;
	chatMode: ChatMode;
	renderMode: RenderMode;
	/** User-defined slot reorder, if any. */
	slotOrder: string[] | undefined;
	/** Active-path messages with compacted ones already filtered out. */
	chatMessages: MessageRow[];
	/** Resolved lorebook entries for the current history. */
	lorebookEntries: { content: string; insertionOrder: number }[];
	/** Pre-resolved guidance (already merged for reply, raw for impersonate). */
	guidance: ResolvedGuidance;
	chatUserId: number;
	opts: ProcessOptions;
}

/**
 * Final return shape of `buildChatContext`. Stable contract for chatProcessor,
 * compactionService, and the token-stats route.
 */
export interface BuildChatContextResult {
	chat: ChatRow;
	character: CharacterRow;
	activeProvider: ProviderRow;
	activeModel: string;
	samplerSettings: SamplerSettings;
	llmMessages: ChatMessage[];
	tokenStats: TokenBudget;
	streamingEnabled: boolean;
	chatUserId: number;
	/** Unique id for this build. Lets logs and the UI cross-reference. */
	buildId: string;
}
