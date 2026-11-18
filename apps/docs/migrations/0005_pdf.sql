-- PDFs in the library. A PDF is a row in docs_docs with kind 'pdf', so it has the same folder, category, tags,
-- share link and permissions as a doc. Its bytes are one row in docs_files, in R2 under docs/<company id>/<doc id>/<file id>.
-- Only the latest file is kept: a new upload replaces the old file, and the old file is deleted.
ALTER TABLE docs_docs ADD COLUMN kind TEXT NOT NULL DEFAULT 'doc';  -- doc or pdf
ALTER TABLE docs_docs ADD COLUMN file_id TEXT;                      -- pdf: the docs_files row of the current file
ALTER TABLE docs_files ADD COLUMN name TEXT;                        -- pdf: the file name from the upload, cleaned
