import type { Side } from "./companies.ts";
import type { Deploy } from "./deploy.ts";

/* The shape of a cross-company case. Read docs/security.md. */

/** Who calls: Beta's owner (the default), Beta's member, a new Beta person (for routes that end the session) or nobody. */
export type Who = "beta" | "betaMember" | "extra" | "none";

/** denied: the status must be 401, 403 or 404. any: the status is free, but the answer must hold no Alpha data. */
export type Expect = "denied" | "any";

export type Case = {
  /** The route as the deploy lists it, such as "PATCH /api/tasks/:taskId". */
  route: string;
  /** The path to call, mostly with Alpha's ids. */
  path: (alpha: Side, beta: Side) => string;
  who?: Who;
  /** A JSON body, or FormData for an upload. Send a body that would work for Alpha's own owner. */
  body?: (alpha: Side, beta: Side) => unknown;
  headers?: Record<string, string>;
  expect: Expect;
  /** Why the case looks the way it does, when that is not plain. */
  why?: string;
};

/** A file in test/cross-company/: more cases, and data for them. Put the word ALPHASECRET in Alpha's data. */
export type CaseModule = {
  cases: Case[];
  seed?: (d: Deploy, alpha: Side, beta: Side) => Promise<void>;
};
