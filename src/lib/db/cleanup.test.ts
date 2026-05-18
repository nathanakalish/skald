// Integration test for cleanup paths around chats: verifies that the FKs
// added by DB-H1 actually fire (SET NULL on the override columns), that the
// CRUD-M8 soft-delete column exists and is left null by default, and that
// dropping a parent provider/persona/message doesn't take chats with it.
//
// This spins up a brand-new in-memory SQLite, runs the baseline migrations,
// and exercises the relationships from raw SQL so the test never depends on
// the Drizzle layer being wired to a real file DB.

import { describe, it, expect, beforeEach } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { runBaselineMigrations } from './baselineMigrations.js';

function seed(db: BetterSqlite3.Database) {
	db.pragma('foreign_keys = ON');
	runBaselineMigrations(db);

	const userId = db.prepare("INSERT INTO users (username, role) VALUES ('u1', 'user')").run().lastInsertRowid as number;
	const charId = db.prepare("INSERT INTO characters (name) VALUES ('Char1')").run().lastInsertRowid as number;
	const providerId = db.prepare("INSERT INTO providers (user_id, name, type, endpoint) VALUES (?, 'p1', 'openai', 'https://x')").run(userId).lastInsertRowid as number;
	const personaId = db.prepare("INSERT INTO personas (user_id, name) VALUES (?, 'persona1')").run(userId).lastInsertRowid as number;
	const chatId = db.prepare(
		"INSERT INTO chats (user_id, character_id, override_provider_id, override_persona_id, override_compaction_provider_id) VALUES (?, ?, ?, ?, ?)"
	).run(userId, charId, providerId, personaId, providerId).lastInsertRowid as number;
	const msgId = db.prepare(
		"INSERT INTO messages (chat_id, role, content) VALUES (?, 'user', 'hi')"
	).run(chatId).lastInsertRowid as number;
	db.prepare("UPDATE chats SET active_leaf_id = ?, compacted_up_to_message_id = ?, previous_compacted_up_to_message_id = ? WHERE id = ?")
		.run(msgId, msgId, msgId, chatId);

	return { userId, charId, providerId, personaId, chatId, msgId };
}

describe('chats cleanup paths', () => {
	let db: BetterSqlite3.Database;

	beforeEach(() => {
		db = new BetterSqlite3(':memory:');
	});

	it('adds the soft-delete column and leaves it null by default', () => {
		const { chatId } = seed(db);
		const row = db.prepare('SELECT deleted_at FROM chats WHERE id = ?').get(chatId) as { deleted_at: number | null };
		expect(row.deleted_at).toBeNull();
	});

	it('SETs override_provider_id to NULL when the provider is deleted', () => {
		const { providerId, chatId } = seed(db);
		db.prepare('DELETE FROM providers WHERE id = ?').run(providerId);
		const row = db.prepare('SELECT override_provider_id, override_compaction_provider_id FROM chats WHERE id = ?').get(chatId) as {
			override_provider_id: number | null;
			override_compaction_provider_id: number | null;
		};
		expect(row.override_provider_id).toBeNull();
		expect(row.override_compaction_provider_id).toBeNull();
	});

	it('SETs override_persona_id to NULL when the persona is deleted', () => {
		const { personaId, chatId } = seed(db);
		db.prepare('DELETE FROM personas WHERE id = ?').run(personaId);
		const row = db.prepare('SELECT override_persona_id FROM chats WHERE id = ?').get(chatId) as { override_persona_id: number | null };
		expect(row.override_persona_id).toBeNull();
	});

	it('SETs active_leaf_id and compaction pointers to NULL when the message is deleted', () => {
		const { msgId, chatId } = seed(db);
		db.prepare('DELETE FROM messages WHERE id = ?').run(msgId);
		const row = db.prepare('SELECT active_leaf_id, compacted_up_to_message_id, previous_compacted_up_to_message_id FROM chats WHERE id = ?').get(chatId) as {
			active_leaf_id: number | null;
			compacted_up_to_message_id: number | null;
			previous_compacted_up_to_message_id: number | null;
		};
		expect(row.active_leaf_id).toBeNull();
		expect(row.compacted_up_to_message_id).toBeNull();
		expect(row.previous_compacted_up_to_message_id).toBeNull();
	});

	it('cascades messages when a chat is hard-deleted (sanity check)', () => {
		const { chatId, msgId } = seed(db);
		db.prepare('DELETE FROM chats WHERE id = ?').run(chatId);
		const m = db.prepare('SELECT id FROM messages WHERE id = ?').get(msgId);
		expect(m).toBeUndefined();
	});
});
