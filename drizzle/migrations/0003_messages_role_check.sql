-- DB-L3: enforce messages.role at the DB layer.
-- Drizzle's text-enum is a TypeScript hint only — nothing stops a future bug
-- (or a manual sqlite3 session) from writing 'tool' or '' and corrupting
-- prompt assembly. A CHECK constraint would be ideal but SQLite can't add
-- one to an existing column without a full table rebuild, which is too
-- expensive on the messages table. Triggers achieve the same enforcement
-- without copying every row.
CREATE TRIGGER IF NOT EXISTS messages_role_check_insert
BEFORE INSERT ON messages
FOR EACH ROW
WHEN NEW.role NOT IN ('system', 'user', 'assistant')
BEGIN
	SELECT RAISE(ABORT, 'invalid messages.role (must be system/user/assistant)');
END;

CREATE TRIGGER IF NOT EXISTS messages_role_check_update
BEFORE UPDATE OF role ON messages
FOR EACH ROW
WHEN NEW.role NOT IN ('system', 'user', 'assistant')
BEGIN
	SELECT RAISE(ABORT, 'invalid messages.role (must be system/user/assistant)');
END;
