import type { Env } from "@openact/core/server";
import type { Format, Resource, Term, TermKind } from "../shared/rules.ts";

/**
 * The Library's "content" service, for other apps: appService<LibraryContentService>("library", "content").
 * It reads one company's published library. Never the Content Vault and never anyone's My Library.
 * It checks no access: the calling app checks its own permissions for that company first.
 */
export interface LibraryContentService {
  /** The visible values of one of the company's lists. Empty when the company turned the list off. */
  listTerms(env: Env, companyId: string, kind: TermKind): Promise<Term[]>;
  listResources(
    env: Env,
    companyId: string,
    opts?: { q?: string; formats?: Format[]; typeIds?: string[]; topicIds?: string[]; audienceIds?: string[]; since?: string; limit?: number }
  ): Promise<Resource[]>;
  getResource(env: Env, companyId: string, id: string): Promise<Resource | null>;
  /** Keyword search over the company's resources (BM25), best first. */
  search(env: Env, companyId: string, query: string, limit?: number): Promise<Resource[]>;
  /** The web app path of a resource, such as /a/library/r/<id>. */
  resourcePath(id: string): string;
}
