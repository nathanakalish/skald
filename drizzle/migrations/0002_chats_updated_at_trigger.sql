-- DB-L2: keep chats.updated_at honest at the DB layer.
-- App code currently sets it on every write, but a missed call (or a direct
-- SQL touch) would leave the column stale. The trigger fires AFTER UPDATE
-- and only when the row content actually changed (the WHEN clause prevents
-- the trigger from looping on its own SET). NEW.updated_at is excluded from
-- the change check so an explicit app-supplied timestamp still wins.
CREATE TRIGGER IF NOT EXISTS chats_updated_at
AFTER UPDATE ON chats
FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
	UPDATE chats SET updated_at = datetime('now') WHERE id = NEW.id;
END;
