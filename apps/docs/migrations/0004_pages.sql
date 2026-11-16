-- A header and a footer for the pages of each doc. Plain text, where {page}, {total} and {title} are filled in.
-- hide_first leaves them off the first page, for a cover page.
-- The footer starts as page numbers, as print showed them before.
ALTER TABLE docs_docs ADD COLUMN header TEXT NOT NULL DEFAULT '';
ALTER TABLE docs_docs ADD COLUMN footer TEXT NOT NULL DEFAULT '{page} / {total}';
ALTER TABLE docs_docs ADD COLUMN hide_first INTEGER NOT NULL DEFAULT 0;
