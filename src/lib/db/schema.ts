import { sqliteTable, text, integer, real, primaryKey, unique, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const users = sqliteTable('users', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	username: text('username').notNull().unique(),
	role: text('role', { enum: ['admin', 'user'] }).notNull().default('user'),
	pictureUrl: text('picture_url'),
	createdAt: text('created_at').default(sql`(datetime('now'))`)
});

export const sessions = sqliteTable('sessions', {
	id: text('id').primaryKey(), // crypto random token
	userId: integer('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	expiresAt: text('expires_at').notNull(),
	createdAt: text('created_at').default(sql`(datetime('now'))`),
	lastSeenAt: text('last_seen_at').default(sql`(datetime('now'))`),
	userAgent: text('user_agent'),
	// Set by an admin/owner via `Signed in devices` to disable notifications on
	// THIS device. The client checks the timestamp on each load and, if it has
	// changed since its last sync, unsubscribes push + resets the banner.
	notificationsDisabledAt: text('notifications_disabled_at')
});

export const characters = sqliteTable('characters', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	description: text('description').default(''),
	personality: text('personality').default(''),
	firstMessage: text('first_message').default(''),
	scenario: text('scenario').default(''),
	systemPrompt: text('system_prompt').default(''),
	avatarPath: text('avatar_path'),
	creatorNotes: text('creator_notes').default(''),
	tags: text('tags').default(''),
	// V2/V3 card fields
	mesExample: text('mes_example').default(''),
	postHistoryInstructions: text('post_history_instructions').default(''),
	alternateGreetings: text('alternate_greetings').default('[]'),
	creator: text('creator').default(''),
	characterVersion: text('character_version').default(''),
	extensions: text('extensions').default('{}'),
	theme: text('theme').default('{}'),
	themeUserModified: integer('theme_user_modified', { mode: 'boolean' }).default(false),
	backgroundPath: text('background_path'),
	chubFullPath: text('chub_full_path'),
	chubLastActivityAt: text('chub_last_activity_at'),
	createdAt: text('created_at').default(sql`(datetime('now'))`),
	updatedAt: text('updated_at').default(sql`(datetime('now'))`)
});

export const chats = sqliteTable('chats', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	characterId: integer('character_id')
		.notNull()
		.references(() => characters.id, { onDelete: 'cascade' }),
	title: text('title').default('New Chat'),
	mode: text('mode').default('story'),
	pinned: integer('pinned').default(0),
	pinOrder: integer('pin_order').default(0),
	activeLeafId: integer('active_leaf_id').references((): AnySQLiteColumn => messages.id, { onDelete: 'set null' }),
	// Per-chat overrides (null = use global default)
	overrideProviderId: integer('override_provider_id').references((): AnySQLiteColumn => providers.id, { onDelete: 'set null' }),
	overrideModel: text('override_model'),
	overrideTemperature: real('override_temperature'),
	overrideMaxTokens: integer('override_max_tokens'),
	overrideCustomPrompt: text('override_custom_prompt'),
	overridePersonaId: integer('override_persona_id').references((): AnySQLiteColumn => personas.id, { onDelete: 'set null' }),
	overrideIncludeReasoning: integer('override_include_reasoning', { mode: 'boolean' }),
	overrideReasoningEffort: text('override_reasoning_effort'),
	overrideRenderMode: text('override_render_mode'),
	// Compaction state + per-chat overrides (null override = use global default)
	compactionSummary: text('compaction_summary'),
	compactedUpToMessageId: integer('compacted_up_to_message_id').references((): AnySQLiteColumn => messages.id, { onDelete: 'set null' }),
	compactionLastRunAt: text('compaction_last_run_at'),
	// Previous-run snapshot so the user can re-process the last batch.
	previousCompactionSummary: text('previous_compaction_summary'),
	previousCompactedUpToMessageId: integer('previous_compacted_up_to_message_id').references((): AnySQLiteColumn => messages.id, { onDelete: 'set null' }),
	overrideCompactionEnabled: integer('override_compaction_enabled', { mode: 'boolean' }),
	overrideCompactionThreshold: integer('override_compaction_threshold'),
	overrideCompactionMode: text('override_compaction_mode'),
	overrideCompactionTargetPercent: integer('override_compaction_target_percent'),
	overrideCompactionFixedCount: integer('override_compaction_fixed_count'),
	overrideCompactionWindowPercent: integer('override_compaction_window_percent'),
	overrideCompactionProviderId: integer('override_compaction_provider_id').references((): AnySQLiteColumn => providers.id, { onDelete: 'set null' }),
	overrideCompactionModel: text('override_compaction_model'),
	unread: integer('unread').default(0),
	muted: integer('muted', { mode: 'boolean' }).default(false),
	useCharacterTheme: integer('use_character_theme', { mode: 'boolean' }).default(true),
	allowExternalResources: integer('allow_external_resources', { mode: 'boolean' }),
	// Denormalised tail (truncated to 200 chars). Maintained by the helpers in
	// src/lib/db/chatTail.ts so the sidebar list query doesn't need a per-row
	// "latest message" subquery.
	lastMessage: text('last_message').default(''),
	lastMessageRole: text('last_message_role').default(''),
	// Background impersonation drafts: each entry is a {draft, reasoning,
	// guidance?, generatedAt} swipe. Status is null when there's nothing
	// pending, 'streaming' while the LLM is producing the latest entry,
	// 'done' once it finishes, 'error' on failure. The index points at the
	// swipe currently mirrored into the user's textarea.
	impersonationSwipes: text('impersonation_swipes'),
	impersonationSwipeIndex: integer('impersonation_swipe_index').default(0),
	impersonationStatus: text('impersonation_status'),
	// Chat-wide reply guidance: appended to per-message reply guidance on
	// every assistant generation. Lets the user set a persistent steer
	// ("keep it short", "avoid X") without retyping it on every send.
	replyGuidance: text('reply_guidance'),
	// Holding slot for impersonation guidance orphaned by deleting the user
	// message that owned it. Prefills the chat-bar's "Guide impersonation…"
	// modal next time it's opened, then clears once the user impersonates.
	pendingImpersonationGuidance: text('pending_impersonation_guidance'),
	// Server-mirrored unsent textarea draft + inline edit buffer. Drives
	// cross-device "pick up where I left off" sync. The *_at fields are
	// epoch-ms timestamps used for last-write-wins resolution when two
	// devices race. All five clear when the message is sent (api/chat/send)
	// or saved/cancelled (api/messages/[id]).
	pendingDraft: text('pending_draft'),
	pendingDraftAt: integer('pending_draft_at'),
	editingMessageId: integer('editing_message_id'),
	editingMessageContent: text('editing_message_content'),
	editingMessageAt: integer('editing_message_at'),
	// CRUD-M8 soft-delete: epoch-ms timestamp when the user deleted the chat.
	// `null` means live. Hidden from the sidebar list + rejected by send/stream
	// once set. Row stays around for an out-of-band purge / undelete window;
	// no scheduled purge yet — deletedAt rows accumulate until a future job
	// or an admin sweep cleans them.
	deletedAt: integer('deleted_at'),
	createdAt: text('created_at').default(sql`(datetime('now'))`),
	updatedAt: text('updated_at').default(sql`(datetime('now'))`)
});

export const messages = sqliteTable('messages', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	chatId: integer('chat_id')
		.notNull()
		.references(() => chats.id, { onDelete: 'cascade' }),
	role: text('role', { enum: ['system', 'user', 'assistant'] }).notNull(),
	content: text('content').notNull(),
	swipes: text('swipes').default('[]'),
	swipeIndex: integer('swipe_index').default(0),
	reasoning: text('reasoning').default('[]'),
	// User-message-only: the guided-reply guidance text that produced this
	// message (or its current swipe). Lets the UI offer a Guide menu item
	// on the assistant reply so the user can revise the guidance and re-run.
	guidance: text('guidance'),
	// User-message-only: the impersonation guidance that was used when the
	// active impersonation draft for this message was generated. Kept
	// separate from `guidance` so impersonation steering can never leak
	// into the LLM's reply prompt — guidance is for the assistant reply,
	// impersonationGuidance is just for inspection / re-impersonation.
	impersonationGuidance: text('impersonation_guidance'),
	parentId: integer('parent_id').references((): any => messages.id, { onDelete: 'set null' }),
	createdAt: text('created_at').default(sql`(datetime('now'))`)
});

export const personas = sqliteTable('personas', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	displayName: text('display_name').default(''),
	description: text('description').default(''),
	avatarPath: text('avatar_path'),
	isDefault: integer('is_default', { mode: 'boolean' }).default(false),
	createdAt: text('created_at').default(sql`(datetime('now'))`)
});

export const lorebooks = sqliteTable('lorebooks', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	description: text('description').default(''),
	characterId: integer('character_id').references(() => characters.id, { onDelete: 'set null' }),
	enabled: integer('enabled', { mode: 'boolean' }).default(true),
	chubFullPath: text('chub_full_path'),
	chubLastActivityAt: text('chub_last_activity_at'),
	iconUrl: text('icon_url'),
	createdAt: text('created_at').default(sql`(datetime('now'))`)
});

export const lorebookEntries = sqliteTable('lorebook_entries', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	lorebookId: integer('lorebook_id')
		.notNull()
		.references(() => lorebooks.id, { onDelete: 'cascade' }),
	keywords: text('keywords').notNull(),
	content: text('content').notNull(),
	insertionOrder: integer('insertion_order').default(100),
	enabled: integer('enabled', { mode: 'boolean' }).default(true),
	caseSensitive: integer('case_sensitive', { mode: 'boolean' }).default(false),
	constant: integer('constant', { mode: 'boolean' }).default(false)
});

export const chatLorebooks = sqliteTable('chat_lorebooks', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	chatId: integer('chat_id')
		.notNull()
		.references(() => chats.id, { onDelete: 'cascade' }),
	lorebookId: integer('lorebook_id')
		.notNull()
		.references(() => lorebooks.id, { onDelete: 'cascade' }),
	createdAt: text('created_at').default(sql`(datetime('now'))`)
}, (t) => ({
	uniqChatLorebook: unique().on(t.chatId, t.lorebookId)
}));

export const chatLorebookEntryOverrides = sqliteTable('chat_lorebook_entry_overrides', {
	chatId: integer('chat_id')
		.notNull()
		.references(() => chats.id, { onDelete: 'cascade' }),
	entryId: integer('entry_id')
		.notNull()
		.references(() => lorebookEntries.id, { onDelete: 'cascade' }),
	enabled: integer('enabled', { mode: 'boolean' }),
	constant: integer('constant', { mode: 'boolean' })
}, (t) => ({
	pk: primaryKey({ columns: [t.chatId, t.entryId] })
}));

export const providers = sqliteTable('providers', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	type: text('type').notNull(),
	endpoint: text('endpoint').notNull(),
	apiKey: text('api_key').default(''),
	defaultModel: text('default_model').default(''),
	enabled: integer('enabled', { mode: 'boolean' }).default(true),
	maxConcurrent: integer('max_concurrent').default(1),
	// Generation settings (per-provider profile)
	temperature: real('temperature').default(0.8),
	topP: real('top_p').default(1.0),
	topK: integer('top_k').default(0),
	maxTokens: integer('max_tokens').default(1024),
	contextSize: integer('context_size').default(32768),
	repetitionPenalty: real('repetition_penalty').default(1.0),
	frequencyPenalty: real('frequency_penalty').default(0.0),
	presencePenalty: real('presence_penalty').default(0.0),
	storyContextMessages: integer('story_context_messages').default(40),
	textingContextMessages: integer('texting_context_messages').default(20),
	customPrompt: text('custom_prompt').default(''),
	lorebookDepth: integer('lorebook_depth').default(4),
	streamingEnabled: integer('streaming_enabled', { mode: 'boolean' }).default(true),
	includeReasoning: integer('include_reasoning', { mode: 'boolean' }).default(false),
	reasoningEffort: text('reasoning_effort').default('off'),
	textingTypingSpeed: integer('texting_typing_speed').default(35),
	textingTypingMax: integer('texting_typing_max').default(4000),
	textingInitialDelay: integer('texting_initial_delay').default(1500),
	sortOrder: integer('sort_order').default(0),
	createdAt: text('created_at').default(sql`(datetime('now'))`)
});

export const presets = sqliteTable('presets', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	temperature: real('temperature').default(0.8),
	topP: real('top_p').default(1.0),
	topK: integer('top_k').default(0),
	maxTokens: integer('max_tokens').default(1024),
	contextSize: integer('context_size').default(32768),
	repetitionPenalty: real('repetition_penalty').default(1.0),
	frequencyPenalty: real('frequency_penalty').default(0.0),
	presencePenalty: real('presence_penalty').default(0.0),
	storyContextMessages: integer('story_context_messages').default(40),
	textingContextMessages: integer('texting_context_messages').default(20),
	customPrompt: text('custom_prompt').default(''),
	lorebookDepth: integer('lorebook_depth').default(4),
	streamingEnabled: integer('streaming_enabled', { mode: 'boolean' }).default(true),
	includeReasoning: integer('include_reasoning', { mode: 'boolean' }).default(false),
	reasoningEffort: text('reasoning_effort').default('off'),
	textingTypingSpeed: integer('texting_typing_speed').default(35),
	textingTypingMax: integer('texting_typing_max').default(4000),
	textingInitialDelay: integer('texting_initial_delay').default(1500),
	isDefault: integer('is_default', { mode: 'boolean' }).default(false)
});

export const themes = sqliteTable('themes', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	mode: text('mode', { enum: ['dark', 'light'] }).notNull().default('dark'),
	colors: text('colors').notNull(), // JSON object of color variables
	isActive: integer('is_active', { mode: 'boolean' }).default(false),
	isBuiltin: integer('is_builtin', { mode: 'boolean' }).default(false),
	createdAt: text('created_at').default(sql`(datetime('now'))`)
});

export const settings = sqliteTable('settings', {
	key: text('key').primaryKey(),
	value: text('value').notNull()
});

export const userSettings = sqliteTable('user_settings', {
	userId: integer('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	key: text('key').notNull(),
	value: text('value').notNull()
}, (t) => ({
	pk: primaryKey({ columns: [t.userId, t.key] })
}));

export const adminSettings = sqliteTable('admin_settings', {
	key: text('key').primaryKey(),
	value: text('value').notNull()
});

// Append-only audit trail for admin settings changes. SET NULL on user delete
// so history survives admin removal — admin_username preserves the original
// identity for readability.
export const adminSettingsAudit = sqliteTable('admin_settings_audit', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	key: text('key').notNull(),
	fromValue: text('from_value'),
	toValue: text('to_value').notNull(),
	adminUserId: integer('admin_user_id').references(() => users.id, { onDelete: 'set null' }),
	adminUsername: text('admin_username'),
	changedAt: text('changed_at').notNull().default(sql`(datetime('now'))`)
});

export const pushSubscriptions = sqliteTable('push_subscriptions', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
	// Best-effort link to the session that registered this subscription so
	// "sign out device" can also drop the device's push subs. CASCADEs to
	// match: a subscription orphaned from its session can't be attributed
	// or revoked, so we drop it with the session.
	sessionId: text('session_id').references(() => sessions.id, { onDelete: 'cascade' }),
	endpoint: text('endpoint').notNull(),
	keysP256dh: text('keys_p256dh').notNull(),
	keysAuth: text('keys_auth').notNull(),
	userAgent: text('user_agent'),
	createdAt: text('created_at').default(sql`(datetime('now'))`)
});

export const regexScripts = sqliteTable('regex_scripts', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	findRegex: text('find_regex').notNull(),
	replaceString: text('replace_string').notNull().default(''),
	affectUserInput: integer('affect_user_input', { mode: 'boolean' }).default(false),
	affectAiResponse: integer('affect_ai_response', { mode: 'boolean' }).default(false),
	characterId: integer('character_id').references(() => characters.id, { onDelete: 'cascade' }),
	enabled: integer('enabled', { mode: 'boolean' }).default(true),
	sortOrder: integer('sort_order').default(0),
	createdAt: text('created_at').default(sql`(datetime('now'))`)
});
