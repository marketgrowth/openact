-- Search by meaning. Tasks are embedded with Workers AI and stored in Vectorize.
-- Triggers put changed tasks in an outbox. The Worker reads the outbox after writes and on a cron,
-- so every change is indexed, including changes made by the AI agent.
-- Only the title, the phase and, when the project allows note search, the notes are embedded.
-- Moving a card between columns does not re-embed the task.

CREATE TABLE vector_outbox (
  task_id   TEXT PRIMARY KEY,
  op        TEXT NOT NULL CHECK (op IN ('upsert', 'delete')),
  queued_at INTEGER NOT NULL,
  attempts  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_vector_outbox_queued ON vector_outbox (queued_at);

CREATE TRIGGER tasks_vector_insert AFTER INSERT ON tasks
BEGIN
  INSERT INTO vector_outbox (task_id, op, queued_at) VALUES (NEW.id, 'upsert', CAST(strftime('%s', 'now') AS INTEGER) * 1000)
  ON CONFLICT (task_id) DO UPDATE SET op = 'upsert', queued_at = excluded.queued_at, attempts = 0;
END;

CREATE TRIGGER tasks_vector_update AFTER UPDATE OF title, phase, notes, project_id ON tasks
BEGIN
  INSERT INTO vector_outbox (task_id, op, queued_at) VALUES (NEW.id, 'upsert', CAST(strftime('%s', 'now') AS INTEGER) * 1000)
  ON CONFLICT (task_id) DO UPDATE SET op = 'upsert', queued_at = excluded.queued_at, attempts = 0;
END;

CREATE TRIGGER tasks_vector_delete AFTER DELETE ON tasks
BEGIN
  INSERT INTO vector_outbox (task_id, op, queued_at) VALUES (OLD.id, 'delete', CAST(strftime('%s', 'now') AS INTEGER) * 1000)
  ON CONFLICT (task_id) DO UPDATE SET op = 'delete', queued_at = excluded.queued_at, attempts = 0;
END;

-- Index every task that exists today.
INSERT INTO vector_outbox (task_id, op, queued_at)
SELECT id, 'upsert', CAST(strftime('%s', 'now') AS INTEGER) * 1000 FROM tasks;
