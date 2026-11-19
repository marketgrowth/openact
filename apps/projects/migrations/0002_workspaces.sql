-- Projects is workspace-aware ("scope": "workspace"). Each project belongs to one workspace of its company.
-- Existing projects go to their company's default workspace.
-- A project inserted without a workspace (duplicate company, the projects API) goes to the default workspace too.

ALTER TABLE projects ADD COLUMN workspace_id TEXT REFERENCES workspaces (id) ON DELETE SET NULL;
CREATE INDEX idx_projects_workspace ON projects (company_id, workspace_id);

UPDATE projects SET workspace_id = (
  SELECT w.id FROM workspaces w WHERE w.company_id = projects.company_id AND w.is_default = 1
) WHERE company_id IS NOT NULL;

CREATE TRIGGER projects_default_workspace AFTER INSERT ON projects
WHEN NEW.workspace_id IS NULL AND NEW.company_id IS NOT NULL
BEGIN
  UPDATE projects SET workspace_id = (
    SELECT w.id FROM workspaces w WHERE w.company_id = NEW.company_id AND w.is_default = 1
  ) WHERE id = NEW.id;
END;
