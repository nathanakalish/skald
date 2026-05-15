import type { ChatMessage } from '$lib/providers/base.js';
import { logger } from '$lib/server/logger.js';

/**
 * One named slot in the prompt pipeline. Slots get sorted by `order`,
 * filtered for `enabled`, then concatenated into the final ChatMessage[].
 */
export interface PromptSlot {
	/** Identifier (e.g. 'system', 'persona', 'lorebook'). */
	name: string;
	/** Sort key. Lower = earlier in the prompt. */
	order: number;
	/** Messages this slot contributes. */
	messages: ChatMessage[];
	/** Set false to skip during assembly. */
	enabled: boolean;
}

/**
 * Everything needed to assemble a prompt. Caller fills this in from the chat row + character + persona + lorebook hits.
 */
export interface PromptContext {
	character: {
		name: string;
		description?: string | null;
		personality?: string | null;
		scenario?: string | null;
		systemPrompt?: string | null;
		mesExample?: string | null;
		postHistoryInstructions?: string | null;
		firstMessage?: string | null;
		alternateGreetings?: string | null;
	};
	persona: {
		name: string;
		description?: string | null;
	} | null;
	chatMode: 'story' | 'texting';
	chatMessages: { role: string; content: string; createdAt?: string | null }[];
	/** Lorebook entries that matched the current context */
	lorebookEntries: { content: string; insertionOrder: number }[];
	/** Special modes */
	isGreeting?: boolean;
	isRegenerate?: boolean;
	isImpersonate?: boolean;
	/** Optional guided-reply text. For impersonation it steers the LLM
	 * writing as the persona; for regular replies it's an out-of-band
	 * direction the character should follow without quoting. */
	guidance?: string;
	/** Custom system prompt to prepend (user-defined instructions) */
	customPrompt?: string;
	/** Lorebook injection depth (messages from end). Default: 4 */
	lorebookDepth?: number;
	/** Render mode: 'roleplay' for RP formatting, 'markdown' for full markdown */
	renderMode?: 'roleplay' | 'markdown';
	/** Custom slot ordering — array of slot names in desired order */
	slotOrder?: string[];
	/** Optional rolling summary of compacted earlier messages. Injected right after the system prompt. */
	compactionSummary?: string | null;
}

// Slot ordering. Big gaps so future slots can wedge themselves in without renumbering.
const ORDER = {
	SYSTEM_PROMPT:    100,
	PERSONA:          200,
	CHARACTER_CARD:   300,
	LOREBOOK:         400,
	EXAMPLE_MESSAGES: 500,
	CHAT_HISTORY:     600,
	LOREBOOK_INLINE:  650,  // lorebook entries with low insertionOrder land closer to history
	POST_HISTORY:     700,
	NUDGE:            800,
} as const;

function replaceVars(text: string, charName: string, userName: string): string {
	return text
		.replace(/\{\{char\}\}/gi, charName)
		.replace(/\{\{user\}\}/gi, userName);
}

/** Parse SillyTavern-style mes_example blocks into chat message pairs. */
function parseExampleMessages(mesExample: string): ChatMessage[] {
	if (!mesExample?.trim()) return [];

	const results: ChatMessage[] = [];
	const blocks = mesExample.split(/<START>/i).filter((b) => b.trim());

	for (const block of blocks) {
		const lines = block.trim().split('\n');
		let currentRole: 'user' | 'assistant' | null = null;
		let currentContent = '';

		for (const line of lines) {
			const userMatch = line.match(/^\{\{user\}\}\s*:\s*(.*)/i);
			const charMatch = line.match(/^\{\{char\}\}\s*:\s*(.*)/i);

			if (userMatch) {
				if (currentRole && currentContent.trim()) {
					results.push({ role: currentRole, content: currentContent.trim() });
				}
				currentRole = 'user';
				currentContent = userMatch[1];
			} else if (charMatch) {
				if (currentRole && currentContent.trim()) {
					results.push({ role: currentRole, content: currentContent.trim() });
				}
				currentRole = 'assistant';
				currentContent = charMatch[1];
			} else if (currentRole) {
				currentContent += '\n' + line;
			}
		}
		if (currentRole && currentContent.trim()) {
			results.push({ role: currentRole, content: currentContent.trim() });
		}
	}

	return results;
}

/**
 * Build the prompt slots for story mode.
 */
function buildStorySlots(ctx: PromptContext): PromptSlot[] {
	const charName = ctx.character.name;
	const userName = ctx.persona?.name || 'User';
	const r = (text: string) => replaceVars(text, charName, userName);
	const slots: PromptSlot[] = [];

	// --- System prompt (writing instructions) ---
	// Default "main prompt". V2 cards can override or compose with this via the
	// {{original}} macro — if the user's character.systemPrompt has {{original}},
	// we splice this in. Otherwise it just replaces ours wholesale.
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
			  `Mix these three styles naturally in your responses to create vivid, immersive writing.`
		)
	].join('\n\n');

	let systemPromptContent = defaultSystemPrompt;
	if (ctx.character.systemPrompt?.trim()) {
		// V2 spec: character.system_prompt overrides the main prompt; {{original}}
		// gets substituted with the default block so users can compose if they want.
		systemPromptContent = ctx.character.systemPrompt.includes('{{original}}')
			? ctx.character.systemPrompt.replace(/\{\{original\}\}/gi, defaultSystemPrompt)
			: ctx.character.systemPrompt;
	}

	slots.push({
		name: 'system',
		order: ORDER.SYSTEM_PROMPT,
		enabled: true,
		messages: [{ role: 'system', content: r(systemPromptContent) }]
	});

	// --- Custom user instructions ---
	if (ctx.customPrompt?.trim()) {
		slots.push({
			name: 'customPrompt',
			order: ORDER.SYSTEM_PROMPT + 10,
			enabled: true,
			messages: [{ role: 'system', content: r(ctx.customPrompt.trim()) }]
		});
	}

	// --- Persona ---
	if (ctx.persona?.description) {
		slots.push({
			name: 'persona',
			order: ORDER.PERSONA,
			enabled: true,
			messages: [{ role: 'system', content: r(`[${userName}'s persona: ${ctx.persona.description}]`) }]
		});
	}

	// --- Character card ---
	// Description / personality / scenario always go in — these describe WHO the
	// character is, separate from the writing-style instructions above.
	const charParts = [
		ctx.character.description,
		ctx.character.personality && `### Personality\n${ctx.character.personality}`,
		ctx.character.scenario && `### Scenario\n${ctx.character.scenario}`
	].filter(Boolean) as string[];

	if (charParts.length > 0) {
		slots.push({
			name: 'character',
			order: ORDER.CHARACTER_CARD,
			enabled: true,
			messages: [{ role: 'system', content: r(charParts.join('\n\n')) }]
		});
	}

	// --- Example messages ---
	if (ctx.character.mesExample) {
		const examples = parseExampleMessages(ctx.character.mesExample);
		if (examples.length > 0) {
			slots.push({
				name: 'examples',
				order: ORDER.EXAMPLE_MESSAGES,
				enabled: true,
				messages: [
					{ role: 'system', content: '[Example Chat]' },
					...examples.map(m => ({ ...m, content: r(m.content) })),
					{ role: 'system', content: '[Start a new Chat]' }
				]
			});
		}
	}

	// --- Chat history with lorebook depth injection ---
	let history = ctx.chatMessages;

	// On regenerate, drop the most recent assistant message so we don't ask the model
	// to follow up its own reply.
	if (ctx.isRegenerate) {
		for (let i = history.length - 1; i >= 0; i--) {
			if (history[i].role === 'assistant') {
				history = [...history.slice(0, i), ...history.slice(i + 1)];
				break;
			}
		}
	}

	const historyMessages: ChatMessage[] = history.map(m => ({
		role: m.role as 'user' | 'assistant',
		content: r(m.content)
	}));

	// Inject lorebook entries N messages from the end of history. Putting world info
	// near the latest turns keeps it in the model's attention window where it actually matters.
	if (ctx.lorebookEntries.length > 0) {
		const loreContent = ctx.lorebookEntries
			.sort((a, b) => a.insertionOrder - b.insertionOrder)
			.map(e => e.content)
			.join('\n\n');

		const loreMessage: ChatMessage = { role: 'system', content: r(`[Relevant World Info:\n${loreContent}]`) };

		const injectionDepth = ctx.lorebookDepth ?? 4;
		const insertAt = Math.max(0, historyMessages.length - injectionDepth);
		historyMessages.splice(insertAt, 0, loreMessage);
	}

	slots.push({
		name: 'history',
		order: ORDER.CHAT_HISTORY,
		enabled: true,
		messages: historyMessages
	});

	// --- Post-history instructions ---
	if (ctx.character.postHistoryInstructions) {
		slots.push({
			name: 'postHistory',
			order: ORDER.POST_HISTORY,
			enabled: true,
			messages: [{ role: 'system', content: r(ctx.character.postHistoryInstructions) }]
		});
	}

	return slots;
}

/**
 * Build the prompt slots for story mode impersonation.
 */
function buildStoryImpersonateSlots(ctx: PromptContext): PromptSlot[] {
	const charName = ctx.character.name;
	const userName = ctx.persona?.name || 'User';
	const r = (text: string) => replaceVars(text, charName, userName);
	const slots: PromptSlot[] = [];

	const systemParts: string[] = [
		`Write ${userName}'s next reply in a fictional chat between ${charName} and ${userName}.`,
		`IMPORTANT: You are writing as ${userName}, NOT as ${charName}. Do NOT write ${charName}'s dialogue or actions.`
	];

	if (ctx.persona?.description) {
		systemParts.push(`${userName}'s persona:\n${ctx.persona.description}`);
	}

	systemParts.push(
		`Write ${userName}'s response — their dialogue, actions, thoughts, and narration — in the same style and tone as their previous messages. Stay consistent with ${userName}'s established personality and voice.`
	);

	if (ctx.guidance?.trim()) {
		systemParts.push(
			`Guidance from ${userName} for this reply (treat as direction, not dialogue — express it in ${userName}'s voice):\n${ctx.guidance.trim()}`
		);
	}

	slots.push({
		name: 'system',
		order: ORDER.SYSTEM_PROMPT,
		enabled: true,
		messages: [{ role: 'system', content: r(systemParts.join('\n\n')) }]
	});

	// Chat history with the roles flipped so the model writes as the user.
	slots.push({
		name: 'history',
		order: ORDER.CHAT_HISTORY,
		enabled: true,
		messages: ctx.chatMessages.map(m => ({
			role: (m.role === 'user' ? 'assistant' : 'user') as 'user' | 'assistant',
			content: r(m.content)
		}))
	});

	return slots;
}

/**
 * Build the prompt slots for texting mode.
 */
function buildTextingSlots(ctx: PromptContext): PromptSlot[] {
	const charName = ctx.character.name;
	const userName = ctx.persona?.name || 'User';
	const r = (text: string) => replaceVars(text, charName, userName);
	const slots: PromptSlot[] = [];

	// --- System prompt ---
	const now = new Date();
	const currentTime = now.toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });

	const systemParts: string[] = [
		`You are ${charName}, texting with ${userName}. This is a text message conversation — write SHORT, casual text messages like a real person would.`,
		`STRICT FORMATTING RULES: Write ONLY the text message itself. Absolutely NO narration, NO actions, NO *asterisks*, NO italics, NO "quoted speech", NO roleplay formatting, NO describing what you're doing, NO stage directions, NO inner thoughts. Just the message text as it would appear in a real texting app.`,
		`NEVER suggest meeting up, hanging out, coming over, or doing anything in person. NEVER say you're "waiting" for ${userName} or ask where they are. You exist only in this text conversation — you cannot meet, visit, or interact physically. Keep the conversation entirely within texting.`,
		`The current date and time is ${currentTime}. You have an innate sense of when each message was sent — use this to naturally gauge response delays, reference the time of day, or acknowledge late-night or early-morning texting. Never mention timestamps or metadata directly.`
	];

	if (ctx.character.personality) {
		systemParts.push(`Your personality: ${ctx.character.personality}`);
	}
	if (ctx.character.description) {
		systemParts.push(`About you: ${ctx.character.description}`);
	}

	slots.push({
		name: 'system',
		order: ORDER.SYSTEM_PROMPT,
		enabled: true,
		messages: [{ role: 'system', content: r(systemParts.join('\n')) }]
	});

	// --- Custom user instructions ---
	if (ctx.customPrompt?.trim()) {
		slots.push({
			name: 'customPrompt',
			order: ORDER.SYSTEM_PROMPT + 10,
			enabled: true,
			messages: [{ role: 'system', content: r(ctx.customPrompt.trim()) }]
		});
	}

	// --- Persona ---
	if (ctx.persona?.description) {
		slots.push({
			name: 'persona',
			order: ORDER.PERSONA,
			enabled: true,
			messages: [{ role: 'system', content: r(`[User persona: ${ctx.persona.description}]`) }]
		});
	}

	// --- Greeting context (for first message generation) ---
	if (ctx.isGreeting) {
		const greetings: string[] = [];
		if (ctx.character.firstMessage) greetings.push(ctx.character.firstMessage);
		try {
			const alts = JSON.parse(ctx.character.alternateGreetings || '[]');
			if (Array.isArray(alts)) {
				for (const alt of alts) {
					if (typeof alt === 'string' && alt.trim()) greetings.push(alt);
				}
			}
		} catch (err) { logger.warn('prompt: malformed alternateGreetings JSON', { err: String(err) }); }

		let greetingContent = '';
		if (greetings.length > 0) {
			greetingContent = `Here are example greetings for inspiration on tone and personality (DO NOT copy them directly, write a new casual text message instead):\n${greetings.map((g, i) => `${i + 1}. ${g}`).join('\n')}`;
		}
		greetingContent += `\n\nSend your opening text message to ${userName}. Keep it casual and natural — like you're starting a real text conversation.`;

		slots.push({
			name: 'greetingContext',
			order: ORDER.NUDGE,
			enabled: true,
			messages: [{ role: 'system', content: r(greetingContent) }]
		});
	}

	// --- Chat history with lorebook depth injection ---
	let history = ctx.chatMessages;

	if (ctx.isRegenerate) {
		for (let i = history.length - 1; i >= 0; i--) {
			if (history[i].role === 'assistant') {
				history = [...history.slice(0, i), ...history.slice(i + 1)];
				break;
			}
		}
			// If regenerating wiped the history, treat it as a greeting regen.
		if (history.length === 0 && !ctx.isGreeting) {
			const greetings: string[] = [];
			if (ctx.character.firstMessage) greetings.push(ctx.character.firstMessage);
			try {
				const alts = JSON.parse(ctx.character.alternateGreetings || '[]');
				if (Array.isArray(alts)) {
					for (const alt of alts) {
						if (typeof alt === 'string' && alt.trim()) greetings.push(alt);
					}
				}
			} catch (err) { logger.warn('prompt: malformed alternateGreetings JSON', { err: String(err) }); }

			let greetingContent = '';
			if (greetings.length > 0) {
				greetingContent = `Here are example greetings for inspiration on tone and personality (DO NOT copy them directly, write a new casual text message instead):\n${greetings.map((g, i) => `${i + 1}. ${g}`).join('\n')}`;
			}
			greetingContent += `\n\nSend your opening text message to ${userName}. Keep it casual and natural — like you're starting a real text conversation.`;

			slots.push({
				name: 'greetingContext',
				order: ORDER.NUDGE,
				enabled: true,
				messages: [{ role: 'system', content: r(greetingContent) }]
			});
		}
	}

	const historyMessages: ChatMessage[] = history.map(m => ({
		role: m.role as 'user' | 'assistant',
		content: r(m.content)
	}));

	// Build a timeline system message so the AI has a sense of when each text was sent.
	const timelineEntries: string[] = [];
	for (const m of history) {
		if (m.createdAt) {
			const ts = new Date(m.createdAt + 'Z');
			const timeStr = ts.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
			const who = m.role === 'user' ? userName : charName;
			timelineEntries.push(`${who}: ${timeStr}`);
		}
	}
	if (timelineEntries.length > 0) {
		slots.push({
			name: 'timeline',
			order: ORDER.CHAT_HISTORY - 1,
			enabled: true,
			messages: [{ role: 'system', content: `[Message timeline — DO NOT mention these timestamps directly, use them only for your internal sense of time:\n${timelineEntries.join('\n')}]` }]
		});
	}

	if (ctx.lorebookEntries.length > 0) {
		const loreContent = ctx.lorebookEntries
			.sort((a, b) => a.insertionOrder - b.insertionOrder)
			.map(e => e.content)
			.join('\n\n');

		const loreMessage: ChatMessage = { role: 'system', content: r(`[Relevant World Info:\n${loreContent}]`) };

		const injectionDepth = ctx.lorebookDepth ?? 4;
		const insertAt = Math.max(0, historyMessages.length - injectionDepth);
		historyMessages.splice(insertAt, 0, loreMessage);
	}

	slots.push({
		name: 'history',
		order: ORDER.CHAT_HISTORY,
		enabled: true,
		messages: historyMessages
	});

	// --- Nudge for empty chat (greeting generation) ---
	if (historyMessages.length === 0) {
		slots.push({
			name: 'starterNudge',
			order: ORDER.NUDGE + 10,
			enabled: true,
			messages: [{ role: 'user', content: r(`[Start the conversation by sending your first text message to ${userName}.]`) }]
		});
	}

	return slots;
}

/**
 * Build the prompt slots for texting mode impersonation.
 */
function buildTextingImpersonateSlots(ctx: PromptContext): PromptSlot[] {
	const charName = ctx.character.name;
	const userName = ctx.persona?.name || 'User';
	const r = (text: string) => replaceVars(text, charName, userName);
	const slots: PromptSlot[] = [];

	const now = new Date();
	const currentTime = now.toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });

	const systemParts: string[] = [
		`You are ${userName}, texting with ${charName}. This is a text message conversation — write SHORT, casual text messages like a real person would. Absolutely NO narration, NO actions, NO *asterisks*, NO "quoted speech", NO roleplay formatting — just the message text.`,
		`The current date and time is ${currentTime}.`
	];

	if (ctx.persona?.description) {
		systemParts.push(ctx.persona.description);
	}

	const charInfo = [ctx.character.personality, ctx.character.description].filter(Boolean).join('. ');
	if (charInfo) {
		systemParts.push(`About ${charName}: ${charInfo}`);
	}

	systemParts.push(
		`Write ${userName}'s next text message based on the conversation so far. Stay in character as ${userName} and respond naturally to what ${charName} said.`
	);

	if (ctx.guidance?.trim()) {
		systemParts.push(
			`Guidance from ${userName} for this reply (treat as direction, not the literal text — express it in ${userName}'s voice as a casual text message):\n${ctx.guidance.trim()}`
		);
	}

	slots.push({
		name: 'system',
		order: ORDER.SYSTEM_PROMPT,
		enabled: true,
		messages: [{ role: 'system', content: r(systemParts.join('\n')) }]
	});

	// Build timeline for time awareness
	const timelineEntries: string[] = [];;
	for (const m of ctx.chatMessages) {
		if (m.createdAt) {
			const ts = new Date(m.createdAt + 'Z');
			const timeStr = ts.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
			const who = m.role === 'user' ? userName : charName;
			timelineEntries.push(`${who}: ${timeStr}`);
		}
	}
	if (timelineEntries.length > 0) {
		slots.push({
			name: 'timeline',
			order: ORDER.CHAT_HISTORY - 1,
			enabled: true,
			messages: [{ role: 'system', content: `[Message timeline — DO NOT mention these timestamps directly, use them only for your internal sense of time:\n${timelineEntries.join('\n')}]` }]
		});
	}

	// Chat history with roles flipped
	slots.push({
		name: 'history',
		order: ORDER.CHAT_HISTORY,
		enabled: true,
		messages: ctx.chatMessages.map(m => ({
			role: (m.role === 'user' ? 'assistant' : 'user') as 'user' | 'assistant',
			content: r(m.content)
		}))
	});

	return slots;
}

/**
 * Pick the right slot builder (mode × impersonation), then flatten the slots
 * into the ChatMessage[] the LLM actually sees.
 */
export function buildPrompt(ctx: PromptContext): ChatMessage[] {
	return buildPromptWithSlots(ctx).messages;
}

/**
 * Same as buildPrompt but also returns the resolved slot data so callers can
 * report per-slot token usage in the UI.
 */
export function buildPromptWithSlots(ctx: PromptContext): {
	messages: ChatMessage[];
	slots: { name: string; messages: ChatMessage[] }[];
} {
	let slots: PromptSlot[];

	if (ctx.isImpersonate) {
		slots = ctx.chatMode === 'texting'
			? buildTextingImpersonateSlots(ctx)
			: buildStoryImpersonateSlots(ctx);
	} else {
		slots = ctx.chatMode === 'texting'
			? buildTextingSlots(ctx)
			: buildStorySlots(ctx);
	}

	// Compaction summary, if present, slots in right after the system prompt at
	// SYSTEM_PROMPT + 5 — that way the customPrompt (SYSTEM_PROMPT + 10) still
	// lands after it.
	if (ctx.compactionSummary?.trim()) {
		const charName = ctx.character.name;
		const userName = ctx.persona?.name || 'User';
		slots.push({
			name: 'compactionSummary',
			order: ORDER.SYSTEM_PROMPT + 5,
			enabled: true,
			messages: [{
				role: 'system',
				content: replaceVars(
					`[Summary of the story so far (this replaces the earlier portion of the conversation, which has been compacted):\n${ctx.compactionSummary.trim()}]`,
					charName,
					userName,
				)
			}]
		});
	}

	// Non-impersonate guidance: out-of-band system instruction the
	// character should follow without quoting. Sits right before the post-
	// history nudge so it's the most recent thing the model sees.
	if (!ctx.isImpersonate && ctx.guidance?.trim()) {
		const charName = ctx.character.name;
		const userName = ctx.persona?.name || 'User';
		slots.push({
			name: 'guidance',
			order: ORDER.POST_HISTORY + 50,
			enabled: true,
			messages: [{
				role: 'system',
				content: replaceVars(
					`[Out-of-band guidance from {{user}} for your next reply. Treat this as direction only — do NOT quote, paraphrase, or reference it as something {{user}} said. Write your reply as {{char}} normally would, but shaped by this guidance:\n${ctx.guidance.trim()}]`,
					charName,
					userName,
				)
			}]
		});
	}

	// Apply custom slot ordering if provided
	if (ctx.slotOrder && ctx.slotOrder.length > 0) {
		const orderMap: Record<string, number> = {};
		ctx.slotOrder.forEach((name, i) => {
			orderMap[name] = (i + 1) * 100;
		});

		// Slot-to-parent mapping for sub-slots
		const subSlotParents: Record<string, { parent: string; offset: number }> = {
			customPrompt: { parent: 'system', offset: 10 },
			timeline: { parent: 'history', offset: -1 },
			greetingContext: { parent: 'history', offset: 200 },
			starterNudge: { parent: 'history', offset: 210 },
			// Runtime-added slots: pin them near the right neighbour so they
			// keep their intended position even when the user reshuffles the
			// main slot order. Without this, `guidance` keeps its default
			// 750 and `compactionSummary` keeps 105, which can land them in
			// weird spots once the user-defined orders are remapped to
			// (i+1)*100.
			guidance: { parent: 'history', offset: 250 },
			compactionSummary: { parent: 'system', offset: 5 },
		};

		for (const slot of slots) {
			if (orderMap[slot.name] !== undefined) {
				slot.order = orderMap[slot.name];
			} else if (subSlotParents[slot.name]) {
				const { parent, offset } = subSlotParents[slot.name];
				if (orderMap[parent] !== undefined) {
					slot.order = orderMap[parent] + offset;
				}
			}
		}
	}

	// Sort by order, filter disabled, flatten
	const activeSlots = slots.filter(s => s.enabled).sort((a, b) => a.order - b.order);
	return {
		messages: activeSlots.flatMap(s => s.messages),
		slots: activeSlots.map(s => ({ name: s.name, messages: s.messages }))
	};
}
