/**
 * The shape of a search result, and the two numbers that bound it.
 *
 * Split out of search.ts because the command palette is a CLIENT component and
 * needs `MIN_QUERY` to decide whether to dispatch at all. Importing that
 * constant from search.ts dragged `lib/db.ts` — and therefore Prisma and
 * `node:fs` — into the browser bundle, which finally broke the build outright
 * with "the chunking context does not support external modules".
 *
 * The types alone were always safe (`import type` is erased). One shared
 * constant was enough to pull the server in behind it.
 *
 * THIS FILE MUST NEVER IMPORT ANYTHING. That property is the whole point: it is
 * the contract both sides agree on, so neither drags the other across the
 * boundary. Add a value here only if the client legitimately needs it.
 */

export type SearchGroupId =
  | 'orders'
  | 'purchaseOrders'
  | 'proformas'
  | 'parts'
  | 'parties'
  | 'documents';

export interface SearchHit {
  id: string;
  /** Where selecting it goes. */
  href: string;
  /** The thing itself — a number, a part, a name. */
  label: string;
  /** What it is and where it sits, so two similar numbers are told apart. */
  sublabel: string;
  /** Extra right-aligned context: a stage, a status, a manufacturer. */
  meta?: string;
  /** Why this row matched, when it was not the label. */
  matchedOn?: string;
}

export interface SearchGroup {
  id: SearchGroupId;
  label: string;
  hits: SearchHit[];
}

export interface SearchOutcome {
  query: string;
  groups: SearchGroup[];
  total: number;
  /** True when a group was cut short, so the UI can say so rather than imply completeness. */
  truncated: boolean;
}

/** Per group. Small on purpose: a palette is for finding one thing, not browsing. */
export const PER_GROUP = 6;

/** Below this a search matches half the database and helps nobody. */
export const MIN_QUERY = 2;
