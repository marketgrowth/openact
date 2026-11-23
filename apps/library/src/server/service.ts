import type { Env } from "@openact/core/server";
import type { ItemKind, PublishedSource, PublishedUpdate, Term, TermKind } from "../shared/rules.ts";

/*
 * The Library's service for other apps. Get it with appService<LibraryContentService>("library", "content").
 * It returns published content only. It does not check access: check that the Library is on for the company,
 * and check your own permissions, before you call it. Read docs/library-app.md.
 */

export interface LibraryQuery {
  categoryIds?: string[];
  audienceIds?: string[];
  topicIds?: string[];
  q?: string;
  limit?: number;
}

export interface LibraryContentService {
  /** The visible items of one list, in order. Empty when the site turned the list off. */
  listTerms(env: Env, kind: TermKind): Promise<Term[]>;
  /** Published updates that match, newest first. `since` is a YYYY-MM-DD published date. */
  listUpdates(env: Env, opts?: LibraryQuery & { since?: string }): Promise<PublishedUpdate[]>;
  /** Published sources that match, with the Updated date. */
  listSources(env: Env, opts?: LibraryQuery): Promise<PublishedSource[]>;
  getUpdate(env: Env, id: string): Promise<PublishedUpdate | null>;
  getSource(env: Env, id: string): Promise<PublishedSource | null>;
  /** The page of an item in the web app, such as /a/library/updates/<id>. */
  itemPath(kind: ItemKind, id: string): string;
}
