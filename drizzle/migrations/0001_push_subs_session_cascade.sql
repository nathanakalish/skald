-- DB-L1: tighten push_subscriptions.session_id from SET NULL to CASCADE.
-- A push subscription without its originating session is useless (we can't
-- attribute / revoke it on logout), so we want the row gone when the session
-- is gone. SQLite can't ALTER an existing FK, so do the 12-step rebuild.
-- defer_foreign_keys handles the brief window where the table doesn't exist
-- but other tables still nominally reference it.
PRAGMA defer_foreign_keys = ON;

CREATE TABLE push_subscriptions_new (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
	endpoint TEXT NOT NULL,
	keys_p256dh TEXT NOT NULL,
	keys_auth TEXT NOT NULL,
	user_agent TEXT,
	created_at TEXT DEFAULT (datetime('now'))
);

INSERT INTO push_subscriptions_new (id, user_id, session_id, endpoint, keys_p256dh, keys_auth, user_agent, created_at)
SELECT id, user_id, session_id, endpoint, keys_p256dh, keys_auth, user_agent, created_at
FROM push_subscriptions;

DROP TABLE push_subscriptions;
ALTER TABLE push_subscriptions_new RENAME TO push_subscriptions;

-- Indexes were dropped along with the old table; recreate them so this boot
-- doesn't briefly run without them (baseline migrations ran earlier in the
-- same boot and won't get another chance until next start).
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint ON push_subscriptions(user_id, endpoint);
