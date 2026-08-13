/**
 * WHAT IS ON ONE TEAM'S DESK.
 *
 * The Control Tower answers "where is every order", which is the right question
 * for whoever runs the whole thing and the wrong one for everybody else. A
 * Finance clerk opening it sees eleven orders, nine of which are somebody else's
 * problem, and has to work out which two are theirs before they can start.
 *
 * So each team gets the same orders sorted into four questions they actually
 * ask, in the order they ask them:
 *
 *   NEEDS_ME     the next action is mine — this is the work
 *   WAITING      mine to answer for, but the ball is with someone else
 *   INCOMING     not mine yet; the step after this one is
 *   DONE_HERE    nothing of ours left on it
 *
 * The split between NEEDS_ME and WAITING is the one that matters. A stage owned
 * by the supplier whose next action is ours IS our work — chasing them is the
 * job. A stage we own whose next action is the customs agent's is not: we are
 * accountable, but there is nothing to do until they move. Collapsing those two
 * into "my orders" is what makes a queue people stop trusting.
 */

import type { Stakeholder } from './enums';

/** One order's relationship to one team, most urgent first. */
export type QueueBucket = 'NEEDS_ME' | 'WAITING' | 'INCOMING' | 'DONE_HERE';

/** The fields a bucketing decision depends on. Deliberately not the whole row. */
export interface QueueInput {
  owner: Stakeholder;
  nextActionOwner: Stakeholder;
  nextStageOwner: Stakeholder | null;
  slaStatus: 'ON_TRACK' | 'AT_RISK' | 'BREACHED';
  isBlocked: boolean;
  status: string;
}

export function bucketFor(row: QueueInput, team: Stakeholder): QueueBucket {
  // A closed or cancelled order is nobody's work, whoever owned it last.
  if (row.status === 'CLOSED' || row.status === 'CANCELLED') return 'DONE_HERE';
  if (row.nextActionOwner === team) return 'NEEDS_ME';
  if (row.owner === team) return 'WAITING';
  if (row.nextStageOwner === team) return 'INCOMING';
  return 'DONE_HERE';
}

/**
 * Ranked so the top of a queue is always the thing to open first.
 *
 * Blocked outranks breached: a breached order is late, a blocked one has stopped
 * and will stay stopped until somebody intervenes. Sorting purely by lateness
 * buries the ones that cannot move at all.
 */
export function urgencyOf(row: QueueInput): number {
  if (row.isBlocked) return 0;
  if (row.slaStatus === 'BREACHED') return 1;
  if (row.slaStatus === 'AT_RISK') return 2;
  return 3;
}

export interface TeamQueues<T> {
  needsMe: T[];
  waiting: T[];
  incoming: T[];
  /** Of `needsMe` — the ones already late. Counted, not a separate list. */
  overdue: number;
  /** Of `needsMe` — stopped and needing intervention. */
  blocked: number;
}

/**
 * Sorts a team's orders into their queues.
 *
 * `needsMe` is ranked; the other two keep the order they arrived in, because
 * they are reference rather than a worklist and a shifting order makes them
 * harder to scan.
 */
export function queuesFor<T extends QueueInput>(rows: T[], team: Stakeholder): TeamQueues<T> {
  const needsMe: T[] = [];
  const waiting: T[] = [];
  const incoming: T[] = [];

  for (const row of rows) {
    const bucket = bucketFor(row, team);
    if (bucket === 'NEEDS_ME') needsMe.push(row);
    else if (bucket === 'WAITING') waiting.push(row);
    else if (bucket === 'INCOMING') incoming.push(row);
  }

  needsMe.sort((a, b) => urgencyOf(a) - urgencyOf(b));

  return {
    needsMe,
    waiting,
    incoming,
    overdue: needsMe.filter((r) => r.slaStatus === 'BREACHED').length,
    blocked: needsMe.filter((r) => r.isBlocked).length,
  };
}

/**
 * Who each team is currently waiting on, and how many orders are stuck there.
 *
 * This is the handoff view. A queue tells a team what to do; this tells them why
 * the rest is not moving, and it is the thing that turns "our orders are late"
 * into "we are waiting on the lab for four of them".
 */
export function waitingOn<T extends QueueInput>(rows: T[], team: Stakeholder): Map<Stakeholder, number> {
  const out = new Map<Stakeholder, number>();
  for (const row of rows) {
    if (bucketFor(row, team) !== 'WAITING') continue;
    out.set(row.nextActionOwner, (out.get(row.nextActionOwner) ?? 0) + 1);
  }
  return out;
}

/**
 * Who is waiting on THIS team, and for how many orders.
 *
 * The mirror of `waitingOn`, and the reason both exist: a team that can see who
 * it is holding up prioritises differently from one that only sees its own list.
 */
export function holdingUp<T extends QueueInput>(rows: T[], team: Stakeholder): Map<Stakeholder, number> {
  const out = new Map<Stakeholder, number>();
  for (const row of rows) {
    if (bucketFor(row, team) !== 'NEEDS_ME') continue;
    // The party accountable for the stage, when it is not us, is who we are
    // holding up. Where we own it too, nobody outside is blocked by us.
    if (row.owner !== team) out.set(row.owner, (out.get(row.owner) ?? 0) + 1);
  }
  return out;
}
