-- Docs is workspace-aware ("scope": "workspace"). Each doc and each folder belongs to one workspace of its company.
-- A doc in a folder is always in the folder's workspace. Categories and tags stay company-wide.
-- Existing rows go to their company's default workspace.
-- A row inserted without a workspace (duplicate company, eSign saving a signed PDF) goes to its folder's workspace,
-- or to the default workspace when it has no folder.

ALTER TABLE docs_folders ADD COLUMN workspace_id TEXT REFERENCES workspaces (id) ON DELETE SET NULL;
ALTER TABLE docs_docs ADD COLUMN workspace_id TEXT REFERENCES workspaces (id) ON DELETE SET NULL;
CREATE INDEX idx_docs_folders_workspace ON docs_folders (company_id, workspace_id);
CREATE INDEX idx_docs_docs_workspace ON docs_docs (company_id, workspace_id);

UPDATE docs_folders SET workspace_id = (
  SELECT w.id FROM workspaces w WHERE w.company_id = docs_folders.company_id AND w.is_default = 1
);
UPDATE docs_docs SET workspace_id = (
  SELECT w.id FROM workspaces w WHERE w.company_id = docs_docs.company_id AND w.is_default = 1
);

CREATE TRIGGER docs_folders_default_workspace AFTER INSERT ON docs_folders
WHEN NEW.workspace_id IS NULL
BEGIN
  UPDATE docs_folders SET workspace_id = COALESCE(
    (SELECT p.workspace_id FROM docs_folders p WHERE p.id = NEW.parent_id),
    (SELECT w.id FROM workspaces w WHERE w.company_id = NEW.company_id AND w.is_default = 1)
  ) WHERE id = NEW.id;
END;

CREATE TRIGGER docs_docs_default_workspace AFTER INSERT ON docs_docs
WHEN NEW.workspace_id IS NULL
BEGIN
  UPDATE docs_docs SET workspace_id = COALESCE(
    (SELECT f.workspace_id FROM docs_folders f WHERE f.id = NEW.folder_id),
    (SELECT w.id FROM workspaces w WHERE w.company_id = NEW.company_id AND w.is_default = 1)
  ) WHERE id = NEW.id;
END;
