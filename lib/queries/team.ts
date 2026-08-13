/**
 * One team's workspace, read from the same orders the Control Tower reads.
 *
 * Deliberately NOT a separate store or a per-team copy of the data. There is one
 * set of orders and one ladder; a team view is a lens over it. The moment a
 * team's numbers can disagree with the Control Tower's, somebody is working from
 * a figure nobody else can see, and reconciling those two is worse than the
 * problem the view was meant to solve.
 */

import { db } from '@/lib/db';
import { listOrders, type OrderRow } from './orders';
import { holdingUp, queuesFor, waitingOn, type TeamQueues } from '@/lib/domain/team-queue';
import { STAKEHOLDER_META, type Stakeholder } from '@/lib/domain/enums';

export interface TeamHandoff {
  party: Stakeholder;
  label: string;
  count: number;
}

export interface TeamMessage {
  id: string;
  orderId: string;
  alias: string;
  direction: string;
  channel: string;
  subject: string;
  counterparty: string;
  occurredAt: string;
  isUnread: boolean;
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
  /**
   * Recent correspondence on the orders this team touches.
   *
   * Scoped to the team's own orders rather than everything: a Finance clerk does
   * not need the testing laboratory's chatter about a lot they never see, and a
   * feed nobody can act on is a feed nobody reads.
   */
  messages: TeamMessage[];
}

const toHandoffs = (m: Map<Stakeholder, number>): TeamHandoff[] =>
  [...m.entries()]
    .map(([party, count]) => ({ party, label: STAKEHOLDER_META[party].short, count }))
    .sort((a, b) => b.count - a.count);

export async function teamWorkspace(team: Stakeholder): Promise<TeamWorkspace> {
  const orders = await listOrders();
  const live = orders.filter((o) => o.status !== 'CLOSED' && o.status !== 'CANCELLED');
  const queues = queuesFor(live, team);

  // Only the orders this team is on — see TeamWorkspace.messages.
  const mine = [...queues.needsMe, ...queues.waiting, ...queues.incoming];
  const byId = new Map(mine.map((o) => [o.id, o]));
  const rows = mine.length
    ? await db.communication.findMany({
        where: { workOrderId: { in: mine.map((o) => o.id) } },
        orderBy: { occurredAt: 'desc' },
        take: 40,
        include: { participants: { select: { role: true, stakeholder: true, name: true } } },
      })
    : [];

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
    messages: rows.map((c) => {
      // Whoever is on the other end of it from us. Falls back to the first named
      // participant, so a row never shows an empty counterparty.
      const other =
        c.participants.find((x) => !x.stakeholder.startsWith('ONE_BUY')) ?? c.participants[0];
      return {
        id: c.id,
        orderId: c.workOrderId,
        alias: byId.get(c.workOrderId)?.alias ?? '—',
        direction: c.direction,
        channel: c.channel,
        subject: c.subject,
        counterparty: other ? (other.name ?? other.stakeholder) : 'Internal',
        occurredAt: c.occurredAt.toISOString(),
        isUnread: c.isUnread,
      };
    }),
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
