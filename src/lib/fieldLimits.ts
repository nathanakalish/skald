/**
 * Shared character-limit registry. Imported by both server code (to validate
 * inbound payloads) and client code (to render the soft-cap overlay + drive
 * the save-time blocking dialog). Anything that needs to change a limit
 * should change it here and nowhere else.
 *
 * Categories:
 *  - Short identifiers: names, usernames, URLs
 *  - Medium prose: descriptions, tags, scenarios
 *  - Long prose: system prompts, greetings, lorebook content, summaries
 *  - Chat content: user messages and edits (large; users paste long passages)
 *
 * Limits are deliberately generous — they exist to stop pathological abuse,
 * not to police normal use.
 */

export const FIELD_LIMITS = {
	// short identifiers
	name: 200,
	username: 64,
	tagLine: 500,
	url: 2048,
	colorValue: 64,
	// medium prose
	description: 10_000,
	scenario: 10_000,
	personality: 10_000,
	creatorNotes: 5_000,
	tags: 2_000,
	replyGuidance: 5_000,
	regexPattern: 500,
	regexReplacement: 5_000,
	// long prose / templates
	systemPrompt: 50_000,
	prompt: 50_000,
	firstMessage: 50_000,
	mesExample: 50_000,
	postHistoryInstructions: 20_000,
	greeting: 50_000,
	lorebookEntryContent: 50_000,
	lorebookEntryKeys: 5_000,
	// chat content — generous since people paste in long roleplay context
	messageContent: 200_000,
	compactionSummary: 100_000,
} as const;

export type FieldLimitKey = keyof typeof FIELD_LIMITS;
