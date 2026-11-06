-- Personal side panel lists for the projects app. They belong to one person and are not project data,
-- so changing them does not bump a project's revision.

-- Projects a person pinned to the top of the panel.
CREATE TABLE projects_pins (
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, project_id)
);
CREATE INDEX idx_projects_pins_project ON projects_pins (project_id);

-- Tasks a person opened lately, for the Recent list. The server keeps the newest 20 per person.
CREATE TABLE projects_recent_tasks (
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  task_id    TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  opened_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, task_id)
);
CREATE INDEX idx_projects_recent_user ON projects_recent_tasks (user_id, opened_at);
CREATE INDEX idx_projects_recent_project ON projects_recent_tasks (project_id);
