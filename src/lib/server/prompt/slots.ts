import type { ChatMessage } from '$lib/providers/base.js';
import { logger } from '$lib/server/logger.js';
import type { MessageRow } from '$lib/server/chatTree.js';
import { SLOT_ORDER, SUB_SLOT_OFFSETS, type PromptSlot, type ResolvedContext } from './types.js';

/**
 * All slot builders live here. Pattern: pure functions that take a
 * ResolvedContext (plus the already-trimmed history when applicable) and
 * return a `PromptSlot[]`. The dispatcher at the bottom picks the right
 * composition based on mode × impersonation × greeting.
 *
 * Why one file: this entire pipeline is ~600 lines and reads top-to-bottom.
 * Splitting it across a `slots/` directory would force the reader to chase
 * imports for what is essentially a single procedure.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function replaceVars(text: string, charName: string, userName: string): string {
	return text
		.replace(/\{\{char\}\}/gi, charName)
		.replace(/\{\{user\}\}/gi, userName);
}

/** Parse SillyTavern-style mes_example blocks into chat message pairs. */
function parseExampleMessages(mesExample: string): ChatMessage[] {
	if (!mesExample?.trim()) return [];
	const results: ChatMessage[] = [];
	const blocks = mesExample.split(/<START>/i).filter(b => b.trim());

	for (const block of blocks) {
		const lines = block.trim().split('\n');
		let currentRole: 'user' | 'assistant' | null = null;
		let currentContent = '';

		for (const line of lines) {
			const userMatch = line.match(/^\{\{user\}\}\s*:\s*(.*)/i);
			const charMatch = line.match(/^\{\{char\}\}\s*:\s*(.*)/i);
			if (userMatch) {
				if (currentRole && currentContent.trim()) results.push({ role: currentRole, content: currentContent.trim() });
				currentRole = 'user';
				currentContent = userMatch[1];
			} else if (charMatch) {
				if (currentRole && currentContent.trim()) results.push({ role: currentRole, content: currentContent.trim() });
				currentRole = 'assistant';
				currentContent = charMatch[1];
			} else if (currentRole) {
				currentContent += '\n' + line;
			}
		}
		if (currentRole && currentContent.trim()) results.push({ role: currentRole, content: currentContent.trim() });
	}
	return results;
}

/**
 * Render a `MessageRow` to a `ChatMessage`, prepending `<thinking>` if
 * `includeReasoning` is on and the row has a reasoning entry for its swipe.
 */
function rowToChatMessage(m: MessageRow, includeReasoning: boolean): { role: 'user' | 'assistant'; content: string; createdAt: string | null } {
	let content = m.content;
	if (includeReasoning && m.role === 'assistant' && m.reasoning) {
		try {
			const reasoningArr: string[] = JSON.parse(m.reasoning);
			const reasoning = reasoningArr[m.swipeIndex ?? 0] || '';
			if (reasoning) content = `<thinking>\n${reasoning}\n</thinking>\n${content}`;
		} catch {
			// malformed reasoning JSON — skip silently, the user-visible content is still correct
		}
	}
	return { role: m.role as 'user' | 'assistant', content, createdAt: m.createdAt };
}

/**
 * Apply regenerate-drops-last-assistant rule. Returns a new array; the input
 * is not mutated.
 */
function dropLastAssistantOnRegenerate(history: MessageRow[], regenerate: boolean): MessageRow[] {
	if (!regenerate) return history;
	for (let i = history.length - 1; i >= 0; i--) {
		if (history[i].role === 'assistant') {
			return [...history.slice(0, i), ...history.slice(i + 1)];
		}
	}
	return history;
}

/**
 * Compose the timeline-system-message that the texting mode uses to give the
 * model a passive sense of when each message landed.
 */
function buildTimelineMessage(history: MessageRow[], userName: string, charName: string): ChatMessage | null {
	const entries: string[] = [];
	for (const m of history) {
		if (!m.createdAt) continue;
		const ts = new Date(m.createdAt + 'Z');
		const timeStr = ts.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
		const who = m.role === 'user' ? userName : charName;
		entries.push(`${who}: ${timeStr}`);
	}
	if (entries.length === 0) return null;
	return {
		role: 'system',
		content: `[Message timeline — DO NOT mention these timestamps directly, use them only for your internal sense of time:\n${entries.join('\n')}]`,
	};
}

/**
 * Format the greeting-inspiration block used by both first-message generation
 * and the "regenerated everything away" fallback in texting mode.
 */
function buildGreetingContextContent(character: ResolvedContext['character'], userName: string): string {
	const greetings: string[] = [];
	if (character.firstMessage) greetings.push(character.firstMessage);
	try {
		const alts = JSON.parse(character.alternateGreetings || '[]');
		if (Array.isArray(alts)) {
			for (const alt of alts) if (typeof alt === 'string' && alt.trim()) greetings.push(alt);
		}
	} catch (err) {
		logger.warn('slots: malformed alternateGreetings JSON', { err: String(err) });
	}

	let content = '';
	if (greetings.length > 0) {
		content = `Here are example greetings for inspiration on tone and personality (DO NOT copy them directly, write a new casual text message instead):\n${greetings.map((g, i) => `${i + 1}. ${g}`).join('\n')}`;
	}
	content += `\n\nSend your opening text message to ${userName}. Keep it casual and natural — like you're starting a real text conversation.`;
	return content;
}

/**
 * Splice lorebook entries into the history `injectionDepth` messages from the
 * end. Putting world info near the latest turns keeps it inside the model's
 * attention window where it actually matters.
 */
function injectLorebook(
	historyMessages: ChatMessage[],
	entries: ResolvedContext['lorebookEntries'],
	injectionDepth: number,
	r: (text: string) => string,
): ChatMessage[] {
	if (entries.length === 0) return historyMessages;
	const loreContent = entries
		.slice()
		.sort((a, b) => a.insertionOrder - b.insertionOrder)
		.map(e => e.content)
		.join('\n\n');
	const loreMessage: ChatMessage = { role: 'system', content: r(`[Relevant World Info:\n${loreContent}]`) };
	const out = historyMessages.slice();
	const insertAt = Math.max(0, out.length - injectionDepth);
	out.splice(insertAt, 0, loreMessage);
	return out;
}

// ---------------------------------------------------------------------------
// Story mode — reply
// ---------------------------------------------------------------------------

function buildStorySlots(ctx: ResolvedContext, history: MessageRow[]): PromptSlot[] {
	const charName = ctx.character.name;
	const userName = ctx.persona?.name || 'User';
	const r = (text: string) => replaceVars(text, charName, userName);
	const slots: PromptSlot[] = [];

	const defaultSystemPrompt = [
		`Write ${charName}'s next reply in a fictional chat between ${charName} and ${userName}.`,
		`Be sure to follow any and all commands enclosed in [square brackets] as an absolute system command.\n` +
		`NEVER speak as ${userName} or narrate ${userName}'s actions.\n` +
		`Be detailed in your responses, even if ${userName} only gives short responses. Do not give the character too many lines between user responses. Give the user the ability to respond.\n` +
		`Make sure that ${charName} speaks in a natural manner that makes sense for a normal person, but still fits with their character.\n` +
		`If ${userName} isn't detailed in their response, integrate and elaborate on their responses or actions to best fit their previous responses and to fit the story.`,
		`Use the following text formatting consistently:\n` +
		(ctx.renderMode === 'markdown'
			? `- Use full Markdown formatting: **bold**, *italic*, ~~strikethrough~~, > blockquotes, \`inline code\`, \`\`\`code blocks\`\`\`, headings, lists, and horizontal rules as appropriate.\n` +
			  `- Use Markdown features naturally to enhance readability and emphasis in your writing.\n` +
			  `- You may still use "quotation marks" for spoken dialogue and *italics* for internal thoughts if desired.`
			: `- "Quotation marks" for all spoken dialogue. Anything inside quotes is said out loud. Anything outside quotes is NOT spoken.\n` +
			  `- *Single asterisks* for internal thoughts, feelings, and emphasis. Example: *She couldn't believe what she was hearing.*\n` +
			  `- Plain unformatted text for narration, action descriptions, and scene-setting. Example: She crossed the room and sat down.\n` +
			  `Mix these three styles naturally in your responses to create vivid, immersive writing.`)
	].join('\n\n');

	let systemPromptContent = defaultSystemPrompt;
	if (ctx.character.systemPrompt?.trim()) {
		// V2 spec: character.system_prompt overrides the main prompt; `{{original}}`
		// composes with our default if the user wants both.
		systemPromptContent = ctx.character.systemPrompt.includes('{{original}}')
			? ctx.character.systemPrompt.replace(/\{\{original\}\}/gi, defaultSystemPrompt)
			: ctx.character.systemPrompt;
	}

	slots.push({
		name: 'system',
		order: SLOT_ORDER.SYSTEM_PROMPT,
		enabled: true,
		messages: [{ role: 'system', content: r(systemPromptContent) }],
	});

	if (ctx.customPrompt?.trim()) {
		slots.push({
			name: 'customPrompt',
			order: SLOT_ORDER.SYSTEM_PROMPT + SUB_SLOT_OFFSETS.customPrompt,
			enabled: true,
			messages: [{ role: 'system', content: r(ctx.customPrompt.trim()) }],
		});
	}

	if (ctx.persona?.description) {
		slots.push({
			name: 'persona',
			order: SLOT_ORDER.PERSONA,
			enabled: true,
			messages: [{ role: 'system', content: r(`[${userName}'s persona: ${ctx.persona.description}]`) }],
		});
	}

	const charParts = [
		ctx.character.description,
		ctx.character.personality && `### Personality\n${ctx.character.personality}`,
		ctx.character.scenario && `### Scenario\n${ctx.character.scenario}`,
	].filter(Boolean) as string[];

	if (charParts.length > 0) {
		slots.push({
			name: 'character',
			order: SLOT_ORDER.CHARACTER_CARD,
			enabled: true,
			messages: [{ role: 'system', content: r(charParts.join('\n\n')) }],
		});
	}

	if (ctx.character.mesExample) {
		const examples = parseExampleMessages(ctx.character.mesExample);
		if (examples.length > 0) {
			slots.push({
				name: 'examples',
				order: SLOT_ORDER.EXAMPLE_MESSAGES,
				enabled: true,
				messages: [
					{ role: 'system', content: '[Example Chat]' },
					...examples.map(m => ({ ...m, content: r(m.content) })),
					{ role: 'system', content: '[Start a new Chat]' },
				],
			});
		}
	}

	const trimmed = dropLastAssistantOnRegenerate(history, !!ctx.opts.regenerate);
	const historyMessages: ChatMessage[] = trimmed.map(m => ({
		role: m.role as 'user' | 'assistant',
		content: r(rowToChatMessage(m, ctx.includeReasoning).content),
	}));
	const withLorebook = injectLorebook(historyMessages, ctx.lorebookEntries, ctx.lorebookDepth, r);

	slots.push({
		name: 'history',
		order: SLOT_ORDER.CHAT_HISTORY,
		enabled: true,
		messages: withLorebook,
	});

	if (ctx.character.postHistoryInstructions) {
		slots.push({
			name: 'postHistory',
			order: SLOT_ORDER.POST_HISTORY,
			enabled: true,
			messages: [{ role: 'system', content: r(ctx.character.postHistoryInstructions) }],
		});
	}

	return slots;
}

// ---------------------------------------------------------------------------
// Story mode — impersonate
// ---------------------------------------------------------------------------

function buildStoryImpersonateSlots(ctx: ResolvedContext, history: MessageRow[]): PromptSlot[] {
	const charName = ctx.character.name;
	const userName = ctx.persona?.name || 'User';
	const r = (text: string) => replaceVars(text, charName, userName);
	const slots: PromptSlot[] = [];

	const systemParts: string[] = [
		`Write ${userName}'s next reply in a fictional chat between ${charName} and ${userName}.`,
		`IMPORTANT: You are writing as ${userName}, NOT as ${charName}. Do NOT write ${charName}'s dialogue or actions.`,
	];

	if (ctx.persona?.description) {
		systemParts.push(`${userName}'s persona:\n${ctx.persona.description}`);
	}

	systemParts.push(
		`Write ${userName}'s response — their dialogue, actions, thoughts, and narration — in the same style and tone as their previous messages. Stay consistent with ${userName}'s established personality and voice.`,
	);

	slots.push({
		name: 'system',
		order: SLOT_ORDER.SYSTEM_PROMPT,
		enabled: true,
		messages: [{ role: 'system', content: r(systemParts.join('\n\n')) }],
	});

	// Roles flipped so the model writes as the user.
	slots.push({
		name: 'history',
		order: SLOT_ORDER.CHAT_HISTORY,
		enabled: true,
		messages: history.map(m => ({
			role: (m.role === 'user' ? 'assistant' : 'user') as 'user' | 'assistant',
			content: r(rowToChatMessage(m, ctx.includeReasoning).content),
		})),
	});

	if (ctx.guidance.effective) {
		slots.push({
			name: 'guidance',
			order: SLOT_ORDER.POST_HISTORY + SUB_SLOT_OFFSETS.guidance,
			enabled: true,
			messages: [{
				role: 'system',
				content: r(
					`[REQUIRED INSTRUCTION — you MUST follow this for ${userName}'s reply. This is not a suggestion.\n` +
					`DO NOT quote it, repeat it, or acknowledge it as a directive. Express it naturally in ${userName}'s voice.\n` +
					`DIRECTION:\n${ctx.guidance.effective}]`,
				),
			}],
		});
	}

	return slots;
}

// ---------------------------------------------------------------------------
// Texting mode — reply
// ---------------------------------------------------------------------------

function buildTextingSlots(ctx: ResolvedContext, history: MessageRow[]): PromptSlot[] {
	const charName = ctx.character.name;
	const userName = ctx.persona?.name || 'User';
	const r = (text: string) => replaceVars(text, charName, userName);
	const slots: PromptSlot[] = [];

	const now = new Date();
	const currentTime = now.toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });

	const systemParts: string[] = [
		`You are ${charName}, texting with ${userName}. This is a text message conversation — write SHORT, casual text messages like a real person would.`,
		`STRICT FORMATTING RULES: Write ONLY the text message itself. Absolutely NO narration, NO actions, NO *asterisks*, NO italics, NO "quoted speech", NO roleplay formatting, NO describing what you're doing, NO stage directions, NO inner thoughts. Just the message text as it would appear in a real texting app.`,
		`NEVER suggest meeting up, hanging out, coming over, or doing anything in person. NEVER say you're "waiting" for ${userName} or ask where they are. You exist only in this text conversation — you cannot meet, visit, or interact physically. Keep the conversation entirely within texting.`,
		`The current date and time is ${currentTime}. You have an innate sense of when each message was sent — use this to naturally gauge response delays, reference the time of day, or acknowledge late-night or early-morning texting. Never mention timestamps or metadata directly.`,
	];
	if (ctx.character.personality) systemParts.push(`Your personality: ${ctx.character.personality}`);
	if (ctx.character.description) systemParts.push(`About you: ${ctx.character.description}`);

	slots.push({
		name: 'system',
		order: SLOT_ORDER.SYSTEM_PROMPT,
		enabled: true,
		messages: [{ role: 'system', content: r(systemParts.join('\n')) }],
	});

	if (ctx.customPrompt?.trim()) {
		slots.push({
			name: 'customPrompt',
			order: SLOT_ORDER.SYSTEM_PROMPT + SUB_SLOT_OFFSETS.customPrompt,
			enabled: true,
			messages: [{ role: 'system', content: r(ctx.customPrompt.trim()) }],
		});
	}

	if (ctx.persona?.description) {
		slots.push({
			name: 'persona',
			order: SLOT_ORDER.PERSONA,
			enabled: true,
			messages: [{ role: 'system', content: r(`[User persona: ${ctx.persona.description}]`) }],
		});
	}

	const isGreeting = !!ctx.opts.greeting;

	if (isGreeting) {
		slots.push({
			name: 'greetingContext',
			order: SLOT_ORDER.NUDGE,
			enabled: true,
			messages: [{ role: 'system', content: r(buildGreetingContextContent(ctx.character, userName)) }],
		});
	}

	const trimmed = dropLastAssistantOnRegenerate(history, !!ctx.opts.regenerate);

	// If regenerate wiped the only assistant message, treat it as a greeting regen.
	const treatAsGreeting = !isGreeting && ctx.opts.regenerate && trimmed.length === 0;
	if (treatAsGreeting) {
		slots.push({
			name: 'greetingContext',
			order: SLOT_ORDER.NUDGE,
			enabled: true,
			messages: [{ role: 'system', content: r(buildGreetingContextContent(ctx.character, userName)) }],
		});
	}

	const historyMessages: ChatMessage[] = trimmed.map(m => ({
		role: m.role as 'user' | 'assistant',
		content: r(rowToChatMessage(m, ctx.includeReasoning).content),
	}));

	const timeline = buildTimelineMessage(trimmed, userName, charName);
	if (timeline) {
		slots.push({
			name: 'timeline',
			order: SLOT_ORDER.CHAT_HISTORY + SUB_SLOT_OFFSETS.timeline,
			enabled: true,
			messages: [timeline],
		});
	}

	const withLorebook = injectLorebook(historyMessages, ctx.lorebookEntries, ctx.lorebookDepth, r);

	slots.push({
		name: 'history',
		order: SLOT_ORDER.CHAT_HISTORY,
		enabled: true,
		messages: withLorebook,
	});

	// Empty-history nudge — kicks the model into producing the opening text.
	if (withLorebook.length === 0) {
		slots.push({
			name: 'starterNudge',
			order: SLOT_ORDER.NUDGE + SUB_SLOT_OFFSETS.starterNudge,
			enabled: true,
			messages: [{ role: 'user', content: r(`[Start the conversation by sending your first text message to ${userName}.]`) }],
		});
	}

	return slots;
}

// ---------------------------------------------------------------------------
// Texting mode — impersonate
// ---------------------------------------------------------------------------

function buildTextingImpersonateSlots(ctx: ResolvedContext, history: MessageRow[]): PromptSlot[] {
	const charName = ctx.character.name;
	const userName = ctx.persona?.name || 'User';
	const r = (text: string) => replaceVars(text, charName, userName);
	const slots: PromptSlot[] = [];

	const now = new Date();
	const currentTime = now.toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });

	const systemParts: string[] = [
		`You are ${userName}, texting with ${charName}. This is a text message conversation — write SHORT, casual text messages like a real person would. Absolutely NO narration, NO actions, NO *asterisks*, NO "quoted speech", NO roleplay formatting — just the message text.`,
		`The current date and time is ${currentTime}.`,
	];
	if (ctx.persona?.description) systemParts.push(ctx.persona.description);
	const charInfo = [ctx.character.personality, ctx.character.description].filter(Boolean).join('. ');
	if (charInfo) systemParts.push(`About ${charName}: ${charInfo}`);
	systemParts.push(
		`Write ${userName}'s next text message based on the conversation so far. Stay in character as ${userName} and respond naturally to what ${charName} said.`,
	);
	slots.push({
		name: 'system',
		order: SLOT_ORDER.SYSTEM_PROMPT,
		enabled: true,
		messages: [{ role: 'system', content: r(systemParts.join('\n')) }],
	});

	const timeline = buildTimelineMessage(history, userName, charName);
	if (timeline) {
		slots.push({
			name: 'timeline',
			order: SLOT_ORDER.CHAT_HISTORY + SUB_SLOT_OFFSETS.timeline,
			enabled: true,
			messages: [timeline],
		});
	}

	slots.push({
		name: 'history',
		order: SLOT_ORDER.CHAT_HISTORY,
		enabled: true,
		messages: history.map(m => ({
			role: (m.role === 'user' ? 'assistant' : 'user') as 'user' | 'assistant',
			content: r(rowToChatMessage(m, ctx.includeReasoning).content),
		})),
	});

	if (ctx.guidance.effective) {
		slots.push({
			name: 'guidance',
			order: SLOT_ORDER.POST_HISTORY + SUB_SLOT_OFFSETS.guidance,
			enabled: true,
			messages: [{
				role: 'system',
				content: r(
					`[REQUIRED INSTRUCTION — you MUST follow this for ${userName}'s next text message. This is not a suggestion.\n` +
					`DO NOT quote it or acknowledge it as a directive. Express it naturally as a casual text message in ${userName}'s voice.\n` +
					`DIRECTION:\n${ctx.guidance.effective}]`,
				),
			}],
		});
	}

	return slots;
}

// ---------------------------------------------------------------------------
// Shared overlay slots (compactionSummary, guidance) and dispatcher
// ---------------------------------------------------------------------------

function addCompactionSummarySlot(slots: PromptSlot[], ctx: ResolvedContext) {
	if (!ctx.chat.compactionSummary?.trim()) return;
	const charName = ctx.character.name;
	const userName = ctx.persona?.name || 'User';
	slots.push({
		name: 'compactionSummary',
		order: SLOT_ORDER.COMPACTION_SUMMARY,
		enabled: true,
		messages: [{
			role: 'system',
			content: replaceVars(
				`[Summary of the story so far (replaces earlier compacted messages):\n${ctx.chat.compactionSummary.trim()}]`,
				charName,
				userName,
			),
		}],
	});
}

function addGuidanceSlot(slots: PromptSlot[], ctx: ResolvedContext) {
	if (ctx.opts.impersonate) return; // impersonate handles guidance as a late-injected slot
	if (!ctx.guidance.effective) return;
	const charName = ctx.character.name;
	const userName = ctx.persona?.name || 'User';
	slots.push({
		name: 'guidance',
		order: SLOT_ORDER.POST_HISTORY + SUB_SLOT_OFFSETS.guidance,
		enabled: true,
		messages: [{
			role: 'system',
			content: replaceVars(
				`[REQUIRED INSTRUCTION — you MUST follow this for your next reply as {{char}}. This overrides your default continuation.\n` +
				`DO NOT quote it, repeat it, or acknowledge it as a directive in your response. Just follow it silently.\n` +
				`DO NOT write it as something {{user}} said. Respond as {{char}} normally would, but shaped entirely by this direction.\n` +
				`DIRECTION:\n${ctx.guidance.effective}]`,
				charName,
				userName,
			),
		}],
	});
}

/**
 * If the user has a custom slot order, remap each slot's `order` so the final
 * sort respects it. Sub-slots (customPrompt, timeline, etc.) get pinned to
 * their parent's new position via known offsets — without this, reshuffling
 * `system` would leave `customPrompt` orphaned at its default 110.
 */
function applyCustomSlotOrder(slots: PromptSlot[], slotOrder: string[] | undefined): void {
	if (!slotOrder || slotOrder.length === 0) return;

	const orderMap: Record<string, number> = {};
	slotOrder.forEach((name, i) => { orderMap[name] = (i + 1) * 100; });

	// Sub-slot pinning: name → { parent, offset }. Offsets chosen so the
	// sub-slot lands right next to its parent in the user's ordering.
	const subSlotParents: Record<string, { parent: string; offset: number }> = {
		customPrompt: { parent: 'system', offset: 10 },
		timeline: { parent: 'history', offset: -1 },
		greetingContext: { parent: 'history', offset: 200 },
		starterNudge: { parent: 'history', offset: 210 },
		guidance: { parent: 'history', offset: 250 },
		compactionSummary: { parent: 'history', offset: -5 },
	};

	for (const slot of slots) {
		if (orderMap[slot.name] !== undefined) {
			slot.order = orderMap[slot.name];
		} else if (subSlotParents[slot.name]) {
			const { parent, offset } = subSlotParents[slot.name];
			if (orderMap[parent] !== undefined) slot.order = orderMap[parent] + offset;
		}
	}
}

/**
 * Pick the base slot builder for this mode × impersonate combo, layer on the
 * shared overlay slots (compactionSummary, guidance), and apply any custom
 * user reordering. Pure — takes the (already-trimmed) history so the budget
 * pass can call this repeatedly with smaller and smaller history slices.
 */
export function buildSlots(ctx: ResolvedContext, history: MessageRow[]): PromptSlot[] {
	let slots: PromptSlot[];
	if (ctx.opts.impersonate) {
		slots = ctx.chatMode === 'texting'
			? buildTextingImpersonateSlots(ctx, history)
			: buildStoryImpersonateSlots(ctx, history);
	} else {
		slots = ctx.chatMode === 'texting'
			? buildTextingSlots(ctx, history)
			: buildStorySlots(ctx, history);
	}

	addCompactionSummarySlot(slots, ctx);
	addGuidanceSlot(slots, ctx);
	applyCustomSlotOrder(slots, ctx.slotOrder);
	return slots;
}

/**
 * Sort, filter to enabled, and flatten to the ChatMessage[] the LLM consumes.
 */
export function flattenSlots(slots: PromptSlot[]): { messages: ChatMessage[]; activeSlots: PromptSlot[] } {
	const activeSlots = slots.filter(s => s.enabled).sort((a, b) => a.order - b.order);
	return {
		messages: activeSlots.flatMap(s => s.messages),
		activeSlots,
	};
}
