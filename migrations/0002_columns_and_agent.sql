-- Custom board columns, the per-project AI agent policy, and the agent action log.

-- Each project has its own columns. A column's category says what its tasks mean:
-- backlog and todo are not started, doing and review are in progress, done counts as finished.
-- tasks.status always holds the category of the task's column, so progress and late checks keep working.
CREATE TABLE board_columns (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  category   TEXT NOT NULL CHECK (category IN ('backlog', 'todo', 'doing', 'review', 'done')),
  position   REAL NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_columns_project ON board_columns (project_id, position);

ALTER TABLE tasks ADD COLUMN column_id TEXT REFERENCES board_columns (id) ON DELETE SET NULL;

-- Give every existing project the five default columns, then place each task in the column for its status.
INSERT INTO board_columns (id, project_id, name, category, position, created_at)
SELECT lower(hex(randomblob(16))), p.id, d.name, d.category, d.position, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM projects p
CROSS JOIN (
  SELECT 'Backlog' AS name, 'backlog' AS category, 1000 AS position
  UNION ALL SELECT 'To do', 'todo', 2000
  UNION ALL SELECT 'In progress', 'doing', 3000
  UNION ALL SELECT 'Review', 'review', 4000
  UNION ALL SELECT 'Done', 'done', 5000
) d;

UPDATE tasks
SET column_id = (SELECT c.id FROM board_columns c WHERE c.project_id = tasks.project_id AND c.category = tasks.status);

-- What the AI agent may do for each role in this project, as JSON, for example
-- {"viewer":"ask","editor":"edit","owner":"admin"}. Empty means the defaults.
ALTER TABLE projects ADD COLUMN ai_policy TEXT NOT NULL DEFAULT '{}';

-- Every action the agent takes or proposes. Pending actions wait for the person to approve them.
CREATE TABLE agent_actions (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  user_id      TEXT REFERENCES users (id) ON DELETE SET NULL,
  thread_id    TEXT,
  run_id       TEXT,
  tool_call_id TEXT,
  tool         TEXT NOT NULL,
  args         TEXT NOT NULL,
  summary      TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('done', 'failed', 'pending', 'approved', 'rejected', 'expired', 'denied')),
  result       TEXT,
  created_at   TEXT NOT NULL,
  decided_at   TEXT
);
CREATE INDEX idx_agent_actions_project ON agent_actions (project_id, created_at);
