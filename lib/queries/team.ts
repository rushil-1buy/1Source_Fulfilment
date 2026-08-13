/**
 * One team's workspace, read from the same orders the Control Tower reads.
 *
 * Deliberately NOT a separate store or a per-team copy of the data. There is one
 * set of orders and one ladder; a team view is a lens over it. The moment a
 * team's numbers can disagree with the Control Tower's, somebody is working from
 * a figure nobody else can see, and reconciling those two is worse than the
 * problem the view was meant to solve.
 */

import { listOrders, type OrderRow } from './orders';
import { holdingUp, queuesFor, waitingOn, type TeamQueues } from '@/lib/domain/team-queue';
import { STAKEHOLDER_META, type Stakeholder } from '@/lib/domain/enums';

export interface TeamHandoff {
  party: Stakeholder;
  label: string;
  count: number;
}

export interface TeamWorkspace {
  team: Stakeholder;
  label: string;
  queues: TeamQueues<OrderRow>;
  /** Money this team is answerable for right now — only on the work that is theirs. */
  valueOnDesk: number;
  /** Who we are waiting on, biggest hold-up first. */
  waitingOn: TeamHandoff[];
  /** Who we are holding up, biggest first. The one that changes priorities. */
  holdingUp: TeamHandoff[];
  /** Every active order, for the "everyone else" context strip. */
  totalActive: number;
}

const toHandoffs = (m: Map<Stakeholder, number>): TeamHandoff[] =>
  [...m.entries()]
    .map(([party, count]) => ({ party, label: STAKEHOLDER_META[party].short, count }))
    .sort((a, b) => b.count - a.count);

export async function teamWorkspace(team: Stakeholder): Promise<TeamWorkspace> {
  const orders = await listOrders();
  const live = orders.filter((o) => o.status !== 'CLOSED' && o.status !== 'CANCELLED');
  const queues = queuesFor(live, team);

  return {
    team,
    label: STAKEHOLDER_META[team].label,
    queues,
    // Only what is actually on the desk. Including the waiting pile would make
    // the number bigger and the team's exposure look larger than it is.
    valueOnDesk: queues.needsMe.reduce((a, o) => a + o.sellValue, 0),
    waitingOn: toHandoffs(waitingOn(live, team)),
    holdingUp: toHandoffs(holdingUp(live, team)),
    totalActive: live.length,
  };
}

/** Counts for the switcher, so a team can see where the pressure is before moving. */
export async function teamLoads(): Promise<Record<string, { needsMe: number; overdue: number }>> {
  const orders = await listOrders();
  const live = orders.filter((o) => o.status !== 'CLOSED' && o.status !== 'CANCELLED');
  const out: Record<string, { needsMe: number; overdue: number }> = {};
  for (const team of ['ONE_BUY_SOURCING', 'ONE_BUY_FINANCE', 'ONE_BUY_INBOUND', 'ONE_BUY_OUTBOUND', 'ONE_BUY_INSPECTION'] as Stakeholder[]) {
    const q = queuesFor(live, team);
    out[team] = { needsMe: q.needsMe.length, overdue: q.overdue };
  }
  return out;
}
