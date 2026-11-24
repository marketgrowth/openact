import type { Env } from "@openact/core/server";
import type { Format, Resource, Term, TermKind } from "../shared/rules.ts";

/**
 * The Library's "content" service, for other apps: appService<LibraryContentService>("library", "content").
 * It returns published resources only. It checks no access: the calling app checks its own permissions first.
 */
export interface LibraryContentService {
  /** The visible values of one list. Empty when the site turned the list off. */
  listTerms(env: Env, kind: TermKind): Promise<Term[]>;
  listResources(
    env: Env,
    opts?: { q?: string; formats?: Format[]; typeIds?: string[]; topicIds?: string[]; audienceIds?: string[]; since?: string; limit?: number }
  ): Promise<Resource[]>;
  getResource(env: Env, id: string): Promise<Resource | null>;
  /** Keyword search over the resources' text (BM25), best first. */
  search(env: Env, query: string, limit?: number): Promise<Resource[]>;
  /** The web app path of a resource, such as /a/library/r/<id>. */
  resourcePath(id: string): string;
}
