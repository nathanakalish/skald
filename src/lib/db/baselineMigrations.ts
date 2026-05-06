import type Database from 'better-sqlite3';
import { builtinThemes } from './themes.js';

/**
 * Idempotent baseline migrations: runs every boot, every step is guarded
 * by `IF NOT EXISTS` / `PRAGMA table_info` checks. New schema changes
 * should be added as drizzle migrations (drizzle/migrations/) — this file
 * exists to seed an empty DB and to apply the pre-drizzle history that
 * predates the migrations folder.
 */
export function runBaselineMigrations(sqlite: Database.Database): void {
	// Run migrations inline — create tables if they don't exist
	sqlite.exec(`
		CREATE TABLE IF NOT EXISTS characters (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			description TEXT DEFAULT '',
			personality TEXT DEFAULT '',
			first_message TEXT DEFAULT '',
			scenario TEXT DEFAULT '',
			system_prompt TEXT DEFAULT '',
			avatar_path TEXT,
			creator_notes TEXT DEFAULT '',
			tags TEXT DEFAULT '',
			chub_full_path TEXT,
			chub_last_activity_at TEXT,
			created_at TEXT DEFAULT (datetime('now')),
			updated_at TEXT DEFAULT (datetime('now'))
		);
	
		CREATE TABLE IF NOT EXISTS chats (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
			title TEXT DEFAULT 'New Chat',
			active_leaf_id INTEGER,
			last_message TEXT DEFAULT '',
			last_message_role TEXT DEFAULT '',
			created_at TEXT DEFAULT (datetime('now')),
			updated_at TEXT DEFAULT (datetime('now'))
		);
	
		CREATE TABLE IF NOT EXISTS messages (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
			role TEXT NOT NULL CHECK(role IN ('system', 'user', 'assistant')),
			content TEXT NOT NULL,
			swipe_index INTEGER DEFAULT 0,
			parent_id INTEGER,
			created_at TEXT DEFAULT (datetime('now'))
		);
	
		CREATE TABLE IF NOT EXISTS personas (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			description TEXT DEFAULT '',
			avatar_path TEXT,
			is_default INTEGER DEFAULT 0,
			created_at TEXT DEFAULT (datetime('now'))
		);
	
		CREATE TABLE IF NOT EXISTS lorebooks (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			description TEXT DEFAULT '',
			character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,
			enabled INTEGER DEFAULT 1,
			chub_full_path TEXT,
			chub_last_activity_at TEXT,
			icon_url TEXT,
			created_at TEXT DEFAULT (datetime('now'))
		);
	
		CREATE TABLE IF NOT EXISTS lorebook_entries (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			lorebook_id INTEGER NOT NULL REFERENCES lorebooks(id) ON DELETE CASCADE,
			keywords TEXT NOT NULL,
			content TEXT NOT NULL,
			insertion_order INTEGER DEFAULT 100,
			enabled INTEGER DEFAULT 1,
			case_sensitive INTEGER DEFAULT 0,
			constant INTEGER DEFAULT 0
		);
	
		CREATE TABLE IF NOT EXISTS providers (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			type TEXT NOT NULL CHECK(type IN ('openai', 'anthropic', 'ollama', 'zai', 'gemini')),
			endpoint TEXT NOT NULL,
			api_key TEXT DEFAULT '',
			default_model TEXT DEFAULT '',
			enabled INTEGER DEFAULT 1,
			created_at TEXT DEFAULT (datetime('now'))
		);
	
		CREATE TABLE IF NOT EXISTS presets (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			temperature REAL DEFAULT 0.8,
			top_p REAL DEFAULT 1.0,
			top_k INTEGER DEFAULT 0,
			max_tokens INTEGER DEFAULT 512,
			repetition_penalty REAL DEFAULT 1.0,
			frequency_penalty REAL DEFAULT 0.0,
			presence_penalty REAL DEFAULT 0.0,
			is_default INTEGER DEFAULT 0
		);
	`);
	
	// Add V2/V3 character card columns (idempotent ALTER TABLE)
	const charCols = sqlite.prepare("PRAGMA table_info('characters')").all() as { name: string }[];
	const charColNames = new Set(charCols.map((c) => c.name));
	const v2Additions: [string, string][] = [
		['mes_example', "TEXT DEFAULT ''"],
		['post_history_instructions', "TEXT DEFAULT ''"],
		['alternate_greetings', "TEXT DEFAULT '[]'"],
		['creator', "TEXT DEFAULT ''"],
		['character_version', "TEXT DEFAULT ''"],
		['extensions', "TEXT DEFAULT '{}'"],
	];
	for (const [col, def] of v2Additions) {
		if (!charColNames.has(col)) {
			sqlite.exec(`ALTER TABLE characters ADD COLUMN ${col} ${def}`);
		}
	}
	
	// Seed default preset if none exists
	const presetCount = sqlite.prepare('SELECT COUNT(*) as count FROM presets').get() as { count: number };
	if (presetCount.count === 0) {
		sqlite.prepare(`
			INSERT INTO presets (name, temperature, top_p, max_tokens, is_default)
			VALUES ('Default', 0.8, 1.0, 512, 1)
		`).run();
	}
	
	// Add display_name column to personas (idempotent)
	const personaCols = sqlite.prepare("PRAGMA table_info('personas')").all() as { name: string }[];
	const personaColNames = new Set(personaCols.map((c) => c.name));
	if (!personaColNames.has('display_name')) {
		sqlite.exec("ALTER TABLE personas ADD COLUMN display_name TEXT DEFAULT ''");
	}
	
	// Add pinned/pin_order columns to chats (idempotent)
	const chatCols = sqlite.prepare("PRAGMA table_info('chats')").all() as { name: string }[];
	const chatColNames = new Set(chatCols.map((c) => c.name));
	if (!chatColNames.has('pinned')) {
		sqlite.exec('ALTER TABLE chats ADD COLUMN pinned INTEGER DEFAULT 0');
	}
	if (!chatColNames.has('pin_order')) {
		sqlite.exec('ALTER TABLE chats ADD COLUMN pin_order INTEGER DEFAULT 0');
	}
	
	// Add mode column to chats (idempotent)
	if (!chatColNames.has('mode')) {
		sqlite.exec("ALTER TABLE chats ADD COLUMN mode TEXT DEFAULT 'story'");
	}
	if (!chatColNames.has('active_leaf_id')) {
		sqlite.exec('ALTER TABLE chats ADD COLUMN active_leaf_id INTEGER');
	}
	
	// Add swipes column to messages (idempotent)
	const msgCols = sqlite.prepare("PRAGMA table_info('messages')").all() as { name: string }[];
	const msgColNames = new Set(msgCols.map((c) => c.name));
	if (!msgColNames.has('swipes')) {
		sqlite.exec("ALTER TABLE messages ADD COLUMN swipes TEXT DEFAULT '[]'");
	}
	
	// Add context limit columns to presets (idempotent)
	const presetCols = sqlite.prepare("PRAGMA table_info('presets')").all() as { name: string }[];
	const presetColNames = new Set(presetCols.map((c) => c.name));
	if (!presetColNames.has('story_context_messages')) {
		sqlite.exec('ALTER TABLE presets ADD COLUMN story_context_messages INTEGER DEFAULT 40');
	}
	if (!presetColNames.has('texting_context_messages')) {
		sqlite.exec('ALTER TABLE presets ADD COLUMN texting_context_messages INTEGER DEFAULT 20');
	}
	if (!presetColNames.has('context_size')) {
		sqlite.exec('ALTER TABLE presets ADD COLUMN context_size INTEGER DEFAULT 32768');
	}
	if (!presetColNames.has('custom_prompt')) {
		sqlite.exec("ALTER TABLE presets ADD COLUMN custom_prompt TEXT DEFAULT ''");
	}
	if (!presetColNames.has('lorebook_depth')) {
		sqlite.exec('ALTER TABLE presets ADD COLUMN lorebook_depth INTEGER DEFAULT 4');
	}
	if (!presetColNames.has('streaming_enabled')) {
		sqlite.exec('ALTER TABLE presets ADD COLUMN streaming_enabled INTEGER DEFAULT 1');
	}
	if (!presetColNames.has('include_reasoning')) {
		sqlite.exec('ALTER TABLE presets ADD COLUMN include_reasoning INTEGER DEFAULT 0');
	}
	
	// Add per-chat override columns (idempotent)
	const chatCols2 = sqlite.prepare("PRAGMA table_info('chats')").all() as { name: string }[];
	const chatColNames2 = new Set(chatCols2.map((c) => c.name));
	if (!chatColNames2.has('override_provider_id')) {
		sqlite.exec('ALTER TABLE chats ADD COLUMN override_provider_id INTEGER');
	}
	if (!chatColNames2.has('override_model')) {
		sqlite.exec('ALTER TABLE chats ADD COLUMN override_model TEXT');
	}
	if (!chatColNames2.has('override_temperature')) {
		sqlite.exec('ALTER TABLE chats ADD COLUMN override_temperature REAL');
	}
	if (!chatColNames2.has('override_max_tokens')) {
		sqlite.exec('ALTER TABLE chats ADD COLUMN override_max_tokens INTEGER');
	}
	if (!chatColNames2.has('override_custom_prompt')) {
		sqlite.exec('ALTER TABLE chats ADD COLUMN override_custom_prompt TEXT');
	}
	if (!chatColNames2.has('override_persona_id')) {
		sqlite.exec('ALTER TABLE chats ADD COLUMN override_persona_id INTEGER');
	}
	if (!chatColNames2.has('override_include_reasoning')) {
		sqlite.exec('ALTER TABLE chats ADD COLUMN override_include_reasoning INTEGER');
	}
	if (!chatColNames2.has('override_reasoning_effort')) {
		sqlite.exec('ALTER TABLE chats ADD COLUMN override_reasoning_effort TEXT');
	}
	
	// Add reasoning_effort column to presets
	const presetCols3 = sqlite.prepare("PRAGMA table_info(presets)").all() as { name: string }[];
	const presetColNames3 = new Set(presetCols3.map(c => c.name));
	if (!presetColNames3.has('reasoning_effort')) {
		sqlite.exec("ALTER TABLE presets ADD COLUMN reasoning_effort TEXT DEFAULT 'off'");
	}
	if (!presetColNames3.has('texting_typing_speed')) {
		sqlite.exec('ALTER TABLE presets ADD COLUMN texting_typing_speed INTEGER DEFAULT 35');
	}
	if (!presetColNames3.has('texting_typing_max')) {
		sqlite.exec('ALTER TABLE presets ADD COLUMN texting_typing_max INTEGER DEFAULT 4000');
	}
	if (!presetColNames3.has('texting_initial_delay')) {
		sqlite.exec('ALTER TABLE presets ADD COLUMN texting_initial_delay INTEGER DEFAULT 1500');
	}
	
	// Migrate providers table CHECK constraint to include 'zai' (idempotent)
	// SQLite doesn't allow ALTER CHECK, so we check if the constraint needs updating
	try {
		// Test if 'zai' is allowed — if not, we need to recreate the table
		sqlite.exec("INSERT INTO providers (name, type, endpoint) VALUES ('__test_zai__', 'zai', 'test')");
		sqlite.exec("DELETE FROM providers WHERE name = '__test_zai__'");
	} catch {
		// CHECK constraint blocks 'zai', recreate table
		sqlite.exec(`
			CREATE TABLE providers_new (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				name TEXT NOT NULL,
				type TEXT NOT NULL CHECK(type IN ('openai', 'anthropic', 'ollama', 'zai', 'gemini')),
				endpoint TEXT NOT NULL,
				api_key TEXT DEFAULT '',
				default_model TEXT DEFAULT '',
				enabled INTEGER DEFAULT 1,
				created_at TEXT DEFAULT (datetime('now'))
			);
			INSERT INTO providers_new SELECT * FROM providers;
			DROP TABLE providers;
			ALTER TABLE providers_new RENAME TO providers;
		`);
	}
	
	// Add reasoning column to messages (JSON array parallel to swipes)
	const msgCols3 = sqlite.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
	const msgColNames3 = new Set(msgCols3.map(c => c.name));
	if (!msgColNames3.has('reasoning')) {
		sqlite.exec("ALTER TABLE messages ADD COLUMN reasoning TEXT DEFAULT '[]'");
	}
	
	// Add generation settings columns to providers (per-provider profiles)
	const provCols = sqlite.prepare("PRAGMA table_info(providers)").all() as { name: string }[];
	const provColNames = new Set(provCols.map(c => c.name));
	const providerSettingsCols: [string, string][] = [
		['temperature', 'REAL DEFAULT 0.8'],
		['top_p', 'REAL DEFAULT 1.0'],
		['top_k', 'INTEGER DEFAULT 0'],
		['max_tokens', 'INTEGER DEFAULT 1024'],
		['context_size', 'INTEGER DEFAULT 32768'],
		['repetition_penalty', 'REAL DEFAULT 1.0'],
		['frequency_penalty', 'REAL DEFAULT 0.0'],
		['presence_penalty', 'REAL DEFAULT 0.0'],
		['story_context_messages', 'INTEGER DEFAULT 40'],
		['texting_context_messages', 'INTEGER DEFAULT 20'],
		['custom_prompt', "TEXT DEFAULT ''"],
		['lorebook_depth', 'INTEGER DEFAULT 4'],
		['streaming_enabled', 'INTEGER DEFAULT 1'],
		['include_reasoning', 'INTEGER DEFAULT 0'],
		['reasoning_effort', "TEXT DEFAULT 'off'"],
		['texting_typing_speed', 'INTEGER DEFAULT 35'],
		['texting_typing_max', 'INTEGER DEFAULT 4000'],
		['texting_initial_delay', 'INTEGER DEFAULT 1500'],
		['max_concurrent', 'INTEGER DEFAULT 1'],
	];
	let providerColsAdded = false;
	for (const [col, def] of providerSettingsCols) {
		if (!provColNames.has(col)) {
			sqlite.exec(`ALTER TABLE providers ADD COLUMN ${col} ${def}`);
			providerColsAdded = true;
		}
	}
	
	// Add sort_order column to providers (idempotent)
	if (!provColNames.has('sort_order')) {
		sqlite.exec(`ALTER TABLE providers ADD COLUMN sort_order INTEGER DEFAULT 0`);
		// Set initial sort order based on id
		sqlite.exec(`UPDATE providers SET sort_order = id WHERE sort_order = 0 OR sort_order IS NULL`);
	}
	
	// Migrate existing preset values into all providers (one-time migration)
	if (providerColsAdded) {
		const existingPreset = sqlite.prepare("SELECT * FROM presets WHERE is_default = 1").get() as Record<string, unknown> | undefined;
		if (existingPreset) {
			sqlite.prepare(`
				UPDATE providers SET
					temperature = ?, top_p = ?, top_k = ?, max_tokens = ?,
					context_size = ?, repetition_penalty = ?, frequency_penalty = ?, presence_penalty = ?,
					story_context_messages = ?, texting_context_messages = ?,
					custom_prompt = ?, lorebook_depth = ?, streaming_enabled = ?,
					include_reasoning = ?, reasoning_effort = ?,
					texting_typing_speed = ?, texting_typing_max = ?, texting_initial_delay = ?
			`).run(
				existingPreset.temperature ?? 0.8,
				existingPreset.top_p ?? 1.0,
				existingPreset.top_k ?? 0,
				existingPreset.max_tokens ?? 1024,
				existingPreset.context_size ?? 32768,
				existingPreset.repetition_penalty ?? 1.0,
				existingPreset.frequency_penalty ?? 0.0,
				existingPreset.presence_penalty ?? 0.0,
				existingPreset.story_context_messages ?? 40,
				existingPreset.texting_context_messages ?? 20,
				existingPreset.custom_prompt ?? '',
				existingPreset.lorebook_depth ?? 4,
				existingPreset.streaming_enabled ?? 1,
				existingPreset.include_reasoning ?? 0,
				existingPreset.reasoning_effort ?? 'off',
				existingPreset.texting_typing_speed ?? 35,
				existingPreset.texting_typing_max ?? 4000,
				existingPreset.texting_initial_delay ?? 1500
			);
		}
	}
	
	// Create themes table (idempotent)
	sqlite.exec(`
		CREATE TABLE IF NOT EXISTS themes (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			mode TEXT NOT NULL DEFAULT 'dark' CHECK(mode IN ('dark', 'light')),
			colors TEXT NOT NULL,
			is_active INTEGER DEFAULT 0,
			is_builtin INTEGER DEFAULT 0,
			created_at TEXT DEFAULT (datetime('now'))
		);
	
		CREATE TABLE IF NOT EXISTS settings (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		);
	`);
	
	// Seed built-in themes if none exist
	const themeCount = sqlite.prepare('SELECT COUNT(*) as count FROM themes WHERE is_builtin = 1').get() as { count: number };
	if (themeCount.count === 0) {
		const insertTheme = sqlite.prepare(
			'INSERT INTO themes (name, mode, colors, is_active, is_builtin) VALUES (?, ?, ?, ?, 1)'
		);
		for (let i = 0; i < builtinThemes.length; i++) {
			const t = builtinThemes[i];
			insertTheme.run(t.name, t.mode, JSON.stringify(t.colors), i === 0 ? 1 : 0);
		}
	}
	
	// Sync builtin theme colors to latest definitions
	{
		const builtinColorMap = new Map(builtinThemes.map(t => [t.name, t.colors]));
		const builtinRows = sqlite.prepare('SELECT id, name, colors FROM themes WHERE is_builtin = 1').all() as { id: number; name: string; colors: string }[];
		const updateStmt = sqlite.prepare('UPDATE themes SET colors = ? WHERE id = ?');
		for (const row of builtinRows) {
			const latest = builtinColorMap.get(row.name);
			if (latest) {
				const latestJson = JSON.stringify(latest);
				if (row.colors !== latestJson) {
					updateStmt.run(latestJson, row.id);
				}
			}
		}
	}
	
	// Seed default color-mode setting if not exists
	const colorMode = sqlite.prepare("SELECT value FROM settings WHERE key = 'colorMode'").get();
	if (!colorMode) {
		sqlite.prepare("INSERT INTO settings (key, value) VALUES ('colorMode', 'dark')").run();
	}
	
	// Add character theme column (idempotent)
	{
		const cols = sqlite.prepare("PRAGMA table_info('characters')").all() as { name: string }[];
		const names = new Set(cols.map(c => c.name));
		if (!names.has('theme')) {
			sqlite.exec("ALTER TABLE characters ADD COLUMN theme TEXT DEFAULT '{}'");
		}
	}
	
	// Add use_character_theme column to chats (idempotent)
	{
		const cols = sqlite.prepare("PRAGMA table_info('chats')").all() as { name: string }[];
		const names = new Set(cols.map(c => c.name));
		if (!names.has('use_character_theme')) {
			sqlite.exec("ALTER TABLE chats ADD COLUMN use_character_theme INTEGER DEFAULT 1");
		}
	}
	
	// Add allow_external_resources column to chats (idempotent)
	{
		const cols = sqlite.prepare("PRAGMA table_info('chats')").all() as { name: string }[];
		const names = new Set(cols.map(c => c.name));
		if (!names.has('allow_external_resources')) {
			sqlite.exec('ALTER TABLE chats ADD COLUMN allow_external_resources INTEGER');
		}
	}
	
	// Add unread column to chats (idempotent)
	{
		const cols = sqlite.prepare("PRAGMA table_info('chats')").all() as { name: string }[];
		const names = new Set(cols.map(c => c.name));
		if (!names.has('unread')) {
			sqlite.exec('ALTER TABLE chats ADD COLUMN unread INTEGER DEFAULT 0');
		}
	}
	
	// Add override_render_mode column to chats (idempotent)
	{
		const cols = sqlite.prepare("PRAGMA table_info('chats')").all() as { name: string }[];
		if (!cols.some(c => c.name === 'override_render_mode')) {
			sqlite.exec('ALTER TABLE chats ADD COLUMN override_render_mode TEXT');
		}
	}

	// Compaction columns on chats (idempotent)
	{
		const cols = sqlite.prepare("PRAGMA table_info('chats')").all() as { name: string }[];
		const names = new Set(cols.map(c => c.name));
		const compactionCols: [string, string][] = [
			['compaction_summary', 'TEXT'],
			['compacted_up_to_message_id', 'INTEGER'],
			['compaction_last_run_at', 'TEXT'],
			['override_compaction_enabled', 'INTEGER'],
			['override_compaction_threshold', 'INTEGER'],
			['override_compaction_mode', 'TEXT'],
			['override_compaction_target_percent', 'INTEGER'],
			['override_compaction_fixed_count', 'INTEGER'],
			['override_compaction_provider_id', 'INTEGER'],
			['override_compaction_model', 'TEXT'],
		];
		for (const [col, def] of compactionCols) {
			if (!names.has(col)) sqlite.exec(`ALTER TABLE chats ADD COLUMN ${col} ${def}`);
		}
	}

	// Add muted column to chats (per-chat notification mute, idempotent)
	{
		const cols = sqlite.prepare("PRAGMA table_info('chats')").all() as { name: string }[];
		if (!cols.some(c => c.name === 'muted')) {
			sqlite.exec('ALTER TABLE chats ADD COLUMN muted INTEGER DEFAULT 0');
		}
	}

	// Background impersonation drafts (idempotent). Lets impersonation streams
	// keep going even if the user navigates away or closes the tab — the
	// final text lands here so any device can pick it up next time the chat
	// opens. impersonation_swipes is a JSON array of {draft, reasoning,
	// guidance?, generatedAt} entries; impersonation_swipe_index points at
	// the currently-active one. Status is null/streaming/done/error.
	{
		const cols = sqlite.prepare("PRAGMA table_info('chats')").all() as { name: string }[];
		const names = new Set(cols.map(c => c.name));
		if (!names.has('impersonation_swipes')) {
			sqlite.exec('ALTER TABLE chats ADD COLUMN impersonation_swipes TEXT');
		}
		if (!names.has('impersonation_swipe_index')) {
			sqlite.exec('ALTER TABLE chats ADD COLUMN impersonation_swipe_index INTEGER DEFAULT 0');
		}
		if (!names.has('impersonation_status')) {
			sqlite.exec('ALTER TABLE chats ADD COLUMN impersonation_status TEXT');
		}
	}

	// Per-user-message guidance text (idempotent). Stores the guided-reply
	// instruction (if any) the user attached when sending or impersonating.
	{
		const cols = sqlite.prepare("PRAGMA table_info('messages')").all() as { name: string }[];
		const names = new Set(cols.map(c => c.name));
		if (!names.has('guidance')) {
			sqlite.exec('ALTER TABLE messages ADD COLUMN guidance TEXT');
		}
		if (!names.has('impersonation_guidance')) {
			sqlite.exec('ALTER TABLE messages ADD COLUMN impersonation_guidance TEXT');
		}
	}

	// Chat-wide reply guidance (idempotent).
	{
		const cols = sqlite.prepare("PRAGMA table_info('chats')").all() as { name: string }[];
		const names = new Set(cols.map(c => c.name));
		if (!names.has('reply_guidance')) {
			sqlite.exec('ALTER TABLE chats ADD COLUMN reply_guidance TEXT');
		}
	}
	
	// Add background_path column to characters (idempotent)
	{
		const cols = sqlite.prepare("PRAGMA table_info('characters')").all() as { name: string }[];
		const names = new Set(cols.map(c => c.name));
		if (!names.has('background_path')) {
			sqlite.exec("ALTER TABLE characters ADD COLUMN background_path TEXT");
		}
		// CHUB origin tracking
		if (!names.has('chub_full_path')) {
			sqlite.exec("ALTER TABLE characters ADD COLUMN chub_full_path TEXT");
		}
		if (!names.has('chub_last_activity_at')) {
			sqlite.exec("ALTER TABLE characters ADD COLUMN chub_last_activity_at TEXT");
		}
		// Tracks whether a user has manually edited the theme. When false,
		// uploading a new avatar will re-extract palette colors; once true,
		// avatar uploads leave the theme alone.
		if (!names.has('theme_user_modified')) {
			sqlite.exec("ALTER TABLE characters ADD COLUMN theme_user_modified INTEGER DEFAULT 0");
		}
	}

	// Denormalised chat tail + CHUB origin on lorebooks (idempotent).
	{
		const chatCols = sqlite.prepare("PRAGMA table_info('chats')").all() as { name: string }[];
		const chatNames = new Set(chatCols.map(c => c.name));
		if (!chatNames.has('last_message')) {
			sqlite.exec("ALTER TABLE chats ADD COLUMN last_message TEXT DEFAULT ''");
		}
		if (!chatNames.has('last_message_role')) {
			sqlite.exec("ALTER TABLE chats ADD COLUMN last_message_role TEXT DEFAULT ''");
		}

		const lbCols = sqlite.prepare("PRAGMA table_info('lorebooks')").all() as { name: string }[];
		const lbNames = new Set(lbCols.map(c => c.name));
		if (!lbNames.has('chub_full_path')) {
			sqlite.exec("ALTER TABLE lorebooks ADD COLUMN chub_full_path TEXT");
		}
		if (!lbNames.has('chub_last_activity_at')) {
			sqlite.exec("ALTER TABLE lorebooks ADD COLUMN chub_last_activity_at TEXT");
		}
		if (!lbNames.has('icon_url')) {
			sqlite.exec("ALTER TABLE lorebooks ADD COLUMN icon_url TEXT");
		}
	}
	
	// ─── Multi-user tables & columns ──────────────────────────
	sqlite.exec(`
		CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT NOT NULL UNIQUE,
			role TEXT NOT NULL DEFAULT 'user',
			picture_url TEXT,
			created_at TEXT DEFAULT (datetime('now'))
		);
	
		CREATE TABLE IF NOT EXISTS sessions (
			id TEXT PRIMARY KEY,
			user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			expires_at TEXT NOT NULL
		);
	
		CREATE TABLE IF NOT EXISTS user_settings (
			user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			key TEXT NOT NULL,
			value TEXT NOT NULL,
			PRIMARY KEY (user_id, key)
		);
	`);
	
	sqlite.exec(`
		CREATE TABLE IF NOT EXISTS admin_settings (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		);
	`);

	// Drop the leftover handoff table from the brief nonce-based OIDC flow.
	// Harmless if the table never existed.
	sqlite.exec('DROP TABLE IF EXISTS pending_oidc_logins');

	// Idempotent ALTER for users.picture_url (existing dev DBs predating the column).
	{
		const cols = sqlite.prepare("PRAGMA table_info('users')").all() as { name: string }[];
		if (!cols.some(c => c.name === 'picture_url')) {
			sqlite.exec("ALTER TABLE users ADD COLUMN picture_url TEXT");
		}
	}

	// Sessions metadata for the `Signed in devices` UI: created_at, last_seen_at,
	// user_agent, and a notifications-disabled timestamp the client uses to
	// detect a remote toggle and reset its banner-dismissal flag.
	{
		const cols = sqlite.prepare("PRAGMA table_info('sessions')").all() as { name: string }[];
		const names = new Set(cols.map(c => c.name));
		if (!names.has('created_at')) {
			sqlite.exec("ALTER TABLE sessions ADD COLUMN created_at TEXT");
			// Set to now for existing rows
			sqlite.exec("UPDATE sessions SET created_at = datetime('now') WHERE created_at IS NULL");
		}
		if (!names.has('last_seen_at')) {
			sqlite.exec("ALTER TABLE sessions ADD COLUMN last_seen_at TEXT");
			sqlite.exec("UPDATE sessions SET last_seen_at = datetime('now') WHERE last_seen_at IS NULL");
		}
		if (!names.has('user_agent')) {
			sqlite.exec("ALTER TABLE sessions ADD COLUMN user_agent TEXT");
		}
		if (!names.has('notifications_disabled_at')) {
			sqlite.exec("ALTER TABLE sessions ADD COLUMN notifications_disabled_at TEXT");
		}
	}
	
	sqlite.exec(`
		CREATE TABLE IF NOT EXISTS push_subscriptions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			endpoint TEXT NOT NULL,
			keys_p256dh TEXT NOT NULL,
			keys_auth TEXT NOT NULL,
			created_at TEXT DEFAULT (datetime('now'))
		);
	`);

	// Add session_id link to push_subscriptions so signing out a device can
	// also drop its push subscriptions.
	{
		const cols = sqlite.prepare("PRAGMA table_info('push_subscriptions')").all() as { name: string }[];
		if (!cols.some(c => c.name === 'session_id')) {
			sqlite.exec("ALTER TABLE push_subscriptions ADD COLUMN session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL");
		}
		if (!cols.some(c => c.name === 'user_agent')) {
			sqlite.exec("ALTER TABLE push_subscriptions ADD COLUMN user_agent TEXT");
		}
	}
	
	// Add user_id to content tables (idempotent)
	{
		const tables = ['characters', 'chats', 'personas', 'lorebooks', 'providers', 'presets', 'themes'];
		for (const table of tables) {
			const cols = sqlite.prepare(`PRAGMA table_info('${table}')`).all() as { name: string }[];
			if (!cols.some(c => c.name === 'user_id')) {
				sqlite.exec(`ALTER TABLE ${table} ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE`);
			}
		}
	}
	
	// Backfill: assign orphaned content (user_id IS NULL) to the first admin user.
	// EXCEPTION: built-in themes intentionally have user_id NULL — they're shared
	// across all users via the `or(isNull(userId), eq(userId, user.id))` query in
	// /api/themes. Sweeping them to the admin would hide them from every other
	// user, so the themes table is special-cased to skip rows with is_builtin=1.
	{
		const admin = sqlite.prepare(`SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`).get() as { id: number } | undefined;
		if (admin) {
			const tables = ['characters', 'chats', 'personas', 'lorebooks', 'providers', 'presets'];
			for (const table of tables) {
				sqlite.prepare(`UPDATE ${table} SET user_id = ? WHERE user_id IS NULL`).run(admin.id);
			}
			sqlite.prepare(`UPDATE themes SET user_id = ? WHERE user_id IS NULL AND is_builtin = 0`).run(admin.id);
		}
	}

	// Heal: an earlier version of the backfill above swept built-in themes to the
	// admin user, hiding them from every other user. Reset built-ins to user_id
	// NULL so they're shared again. Idempotent — no-op if already correct.
	sqlite.exec(`UPDATE themes SET user_id = NULL WHERE is_builtin = 1 AND user_id IS NOT NULL`);
	
	// Create chat_lorebooks join table (idempotent)
	sqlite.exec(`
		CREATE TABLE IF NOT EXISTS chat_lorebooks (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
			lorebook_id INTEGER NOT NULL REFERENCES lorebooks(id) ON DELETE CASCADE,
			created_at TEXT DEFAULT (datetime('now')),
			UNIQUE(chat_id, lorebook_id)
		);
	`);
	
	// Per-chat lorebook entry overrides (idempotent). NULL means "use the
	// entry's library default" for that field.
	sqlite.exec(`
		CREATE TABLE IF NOT EXISTS chat_lorebook_entry_overrides (
			chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
			entry_id INTEGER NOT NULL REFERENCES lorebook_entries(id) ON DELETE CASCADE,
			enabled INTEGER,
			constant INTEGER,
			PRIMARY KEY (chat_id, entry_id)
		);
	`);
	
	// Performance indexes (idempotent)
	sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_messages_chat_created ON messages(chat_id, created_at)`);
	sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_chats_user_updated ON chats(user_id, updated_at)`);
	sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_chats_user_pinned ON chats(user_id, pinned, pin_order)`);
	sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_chats_character ON chats(character_id)`);
	sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_characters_user_updated ON characters(user_id, updated_at)`);
	sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_lorebooks_user_created ON lorebooks(user_id, created_at)`);
	sqlite.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_settings_pk ON user_settings(user_id, key)`);
	sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_lorebook_entries_book ON lorebook_entries(lorebook_id)`);
	sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_chat_lorebooks_chat ON chat_lorebooks(chat_id)`);
	sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_chat_lorebooks_book ON chat_lorebooks(lorebook_id)`);
	sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_chat_lb_entry_overrides_chat ON chat_lorebook_entry_overrides(chat_id)`);
	sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_messages_parent ON messages(parent_id)`);
	// FK indexes — every layout/auth path filters by user_id, every cleanup uses expires_at
	sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`);
	sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)`);
	sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_characters_user ON characters(user_id)`);
	sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_personas_user ON personas(user_id)`);
	sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_lorebooks_user ON lorebooks(user_id)`);
	sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_providers_user ON providers(user_id)`);
	sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_providers_user_order ON providers(user_id, sort_order)`);
	sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_themes_user ON themes(user_id)`);
	sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_lorebooks_character ON lorebooks(character_id)`);
	sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id)`);
	sqlite.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint ON push_subscriptions(user_id, endpoint)`);
	sqlite.exec(`CREATE INDEX IF NOT EXISTS characters_chub_full_path_idx ON characters(chub_full_path)`);
	sqlite.exec(`CREATE INDEX IF NOT EXISTS lorebooks_chub_full_path_idx ON lorebooks(chub_full_path)`);
	// idx_regex_scripts_character lives further down, after the regex_scripts table is created
	
	// Create regex_scripts table (idempotent)
	sqlite.exec(`
		CREATE TABLE IF NOT EXISTS regex_scripts (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			name TEXT NOT NULL,
			find_regex TEXT NOT NULL,
			replace_string TEXT NOT NULL DEFAULT '',
			affect_user_input INTEGER DEFAULT 0,
			affect_ai_response INTEGER DEFAULT 0,
			character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE,
			enabled INTEGER DEFAULT 1,
			sort_order INTEGER DEFAULT 0,
			created_at TEXT DEFAULT (datetime('now'))
		);
	`);
	sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_regex_scripts_user ON regex_scripts(user_id)`);
	sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_regex_scripts_character ON regex_scripts(character_id)`);
	// Drop legacy local-auth columns from users (idempotent).
	// SQLite needs a table rebuild because password_hash was originally NOT NULL.
	{
		const cols = sqlite.prepare("PRAGMA table_info('users')").all() as { name: string }[];
		const names = new Set(cols.map(c => c.name));
		const hasLegacy = names.has('password_hash') || names.has('auth_provider') || names.has('force_password_change');
		if (hasLegacy) {
			sqlite.transaction(() => {
				sqlite.exec(`
					CREATE TABLE users_new (
						id INTEGER PRIMARY KEY AUTOINCREMENT,
						username TEXT NOT NULL UNIQUE,
						role TEXT NOT NULL DEFAULT 'user',
						created_at TEXT DEFAULT (datetime('now'))
					);
				`);
				sqlite.exec("INSERT INTO users_new (id, username, role, created_at) SELECT id, username, role, created_at FROM users");
				sqlite.exec('DROP TABLE users');
				sqlite.exec('ALTER TABLE users_new RENAME TO users');
			})();
		}
	}
	
	// Migrate providers CHECK constraint to include 'gemini' (idempotent)
	try {
		sqlite.exec("INSERT INTO providers (name, type, endpoint) VALUES ('__test_gemini__', 'gemini', 'test')");
		sqlite.exec("DELETE FROM providers WHERE name = '__test_gemini__'");
	} catch {
		// Get current table schema to preserve all columns
		const cols = (sqlite.prepare("PRAGMA table_info(providers)").all() as { name: string; type: string; notnull: number; dflt_value: string | null }[]);
		const colDefs = cols.map(c => {
			let def = `${c.name} ${c.type}`;
			if (c.name === 'id') def += ' PRIMARY KEY AUTOINCREMENT';
			if (c.name === 'type') def += " NOT NULL CHECK(type IN ('openai', 'anthropic', 'ollama', 'zai', 'gemini'))";
			else if (c.notnull && c.name !== 'id') def += ' NOT NULL';
			if (c.dflt_value !== null && c.name !== 'id') {
				const dv = c.dflt_value;
				def += ` DEFAULT ${dv.includes('(') ? `(${dv})` : dv}`;
			}
			return def;
		}).join(', ');
		const colNames = cols.map(c => c.name).join(', ');
		sqlite.exec(`
			CREATE TABLE providers_new (${colDefs});
			INSERT INTO providers_new (${colNames}) SELECT ${colNames} FROM providers;
			DROP TABLE providers;
			ALTER TABLE providers_new RENAME TO providers;
		`);
	}

	// Drop the providers.type CHECK constraint entirely. The provider registry
	// in src/lib/providers/profiles.ts is now the source of truth — adding a
	// new provider shouldn't require a DB migration.
	const providersSchema = (sqlite.prepare(
		"SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'providers'"
	).get() as { sql: string } | undefined)?.sql ?? '';
	if (/CHECK\s*\(\s*type\s+IN/i.test(providersSchema)) {
		const cols = (sqlite.prepare("PRAGMA table_info(providers)").all() as { name: string; type: string; notnull: number; dflt_value: string | null }[]);
		const colDefs = cols.map(c => {
			let def = `${c.name} ${c.type}`;
			if (c.name === 'id') def += ' PRIMARY KEY AUTOINCREMENT';
			else if (c.notnull) def += ' NOT NULL';
			if (c.dflt_value !== null && c.name !== 'id') {
				const dv = c.dflt_value;
				def += ` DEFAULT ${dv.includes('(') ? `(${dv})` : dv}`;
			}
			if (c.name === 'user_id') def += ' REFERENCES users(id) ON DELETE CASCADE';
			return def;
		}).join(', ');
		const colNames = cols.map(c => c.name).join(', ');
		sqlite.exec(`
			CREATE TABLE providers_new (${colDefs});
			INSERT INTO providers_new (${colNames}) SELECT ${colNames} FROM providers;
			DROP TABLE providers;
			ALTER TABLE providers_new RENAME TO providers;
		`);
	}

	// Hash any plaintext session ids in place (one-time, NOT idempotent by content alone).
	// Pre-1.45 stored the raw 64-hex token in sessions.id. Post-1.45 stores SHA-256(token).
	// Both are 64 lowercase hex chars, so we can't tell them apart by value — we use an
	// admin_settings flag to make sure this only ever runs once.
	{
		const alreadyDone = (sqlite.prepare("SELECT value FROM admin_settings WHERE key = 'session_ids_hashed'").get() as { value: string } | undefined)?.value === '1';
		if (!alreadyDone) {
			const rows = sqlite.prepare("SELECT id FROM sessions WHERE length(id) = 64 AND id GLOB '[0-9a-f]*'").all() as { id: string }[];
			if (rows.length > 0) {
				const upd = sqlite.prepare('UPDATE sessions SET id = ? WHERE id = ?');
				// Null out the FK before touching the PK. Setting it to the new hash
				// would fail too (new hash isn't in sessions yet). Nulling is fine —
				// it's the same thing ON DELETE SET NULL would do.
				const nullPushSubs = sqlite.prepare('UPDATE push_subscriptions SET session_id = NULL WHERE session_id = ?');
				// eslint-disable-next-line @typescript-eslint/no-require-imports
				const { createHash } = require('crypto') as typeof import('crypto');
				const tx = sqlite.transaction((batch: { id: string }[]) => {
					for (const r of batch) {
						const hashed = createHash('sha256').update(r.id).digest('hex');
						if (hashed !== r.id) {
							try {
								nullPushSubs.run(r.id);
								upd.run(hashed, r.id);
							} catch { /* duplicate – drop the orphan */
								sqlite.prepare('DELETE FROM sessions WHERE id = ?').run(r.id);
							}
						}
					}
				});
				tx(rows);
			}
			// Mark done regardless of whether there were rows — the schema is now
			// always hashed-at-creation, so this never needs to run again.
			sqlite.prepare("INSERT OR REPLACE INTO admin_settings (key, value) VALUES ('session_ids_hashed', '1')").run();
		}
	}
}
