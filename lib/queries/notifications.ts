import { db } from '@/lib/db';
import { assessSla, getStage, resolveRailAnchor } from '@/lib/domain/stages';
import { exceptionDef } from '@/lib/domain/exceptions';

/**
 * WHAT THE BELL IS FOR.
 *
 * The badge on the bell used to be a hard-coded red dot: permanently lit, meaning
 * nothing. An indicator that is always on is worse than no indicator, because it
 * trains the operator to ignore the one place the app has to say "look here".
 *
 * So it is derived, and only from things a person actually has to do something
 * about:
 *
 *   · an order blocked by an open exception — it cannot move at all
 *   · an order past twice its expected time in stage — the SLA is breached
 *   · a task that is overdue
 *   · an order running late — expected time passed, not yet doubled
 *   · unread messages on an order
 *
 * Deliberately NOT included: anything merely informational. "Order advanced" is
 * not a notification, it is history, and the Communication tab already has it.
 * Every row here answers "what will go wrong if I ignore this".
 */

export type AlertSeverity = 'CRITICAL' | 'WARNING' | 'INFO';

export interface AlertItem {
  id: string;
  severity: AlertSeverity;
  /** Short kind, for grouping and the icon. */
  kind: 'BLOCKED' | 'BREACHED' | 'OVERDUE_TASK' | 'AT_RISK' | 'UNREAD';
  title: string;
  /** What is actually wrong, in a sentence. */
  detail: string;
  href: string;
  /** The order it concerns, for the chip. */
  orderAlias?: string;
  /** Sort key — most urgent, then oldest. */
  since: string;
}

export interface NotificationFeed {
  items: AlertItem[];
  counts: { critical: number; warning: number; info: number; total: number };
}

/** Ordered by how much trouble they represent. */
const RANK: Record<AlertSeverity, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };

export async function getNotifications(now = new Date()): Promise<NotificationFeed> {
  const [exceptions, live, overdueTasks, unread] = await Promise.all([
    db.exceptionRecord.findMany({
      where: { status: { in: ['OPEN', 'IN_PROGRESS'] } },
      select: {
        id: true,
        type: true,
        reason: true,
        severity: true,
        openedAt: true,
        workOrder: { select: { alias: true, status: true } },
      },
      orderBy: { openedAt: 'asc' },
      take: 40,
    }),
    // Live orders, for the SLA sweep. Only what assessSla needs.
    db.workOrder.findMany({
      where: { status: { in: ['ACTIVE', 'BLOCKED'] } },
      select: { alias: true, stage: true, stageEnteredAt: true },
      take: 400,
    }),
    db.task.findMany({
      where: { status: { in: ['OPEN', 'IN_PROGRESS'] }, dueAt: { lt: now } },
      select: {
        id: true,
        title: true,
        dueAt: true,
        priority: true,
        workOrder: { select: { alias: true } },
      },
      orderBy: { dueAt: 'asc' },
      take: 20,
    }),
    // Grouped in JS rather than with groupBy: the alias is needed for the link
    // anyway, so a second round trip to resolve ids would buy nothing.
    db.communication.findMany({
      // workOrderId is required on Communication, so there is nothing to exclude.
      where: { isUnread: true },
      select: { workOrder: { select: { alias: true } } },
      take: 200,
    }),
  ]);

  const items: AlertItem[] = [];

  for (const e of exceptions) {
    const def = exceptionDef(e.type);
    items.push({
      id: `exc-${e.id}`,
      severity: e.severity === 'CRITICAL' || e.severity === 'HIGH' ? 'CRITICAL' : 'WARNING',
      kind: 'BLOCKED',
      title: `${e.workOrder.alias} is blocked — ${def?.label ?? e.type.replace(/_/g, ' ').toLowerCase()}`,
      detail: e.reason,
      href: `/orders/${e.workOrder.alias}`,
      orderAlias: e.workOrder.alias,
      since: e.openedAt.toISOString(),
    });
  }

  for (const wo of live) {
    const { anchorStageId } = resolveRailAnchor(wo.stage);
    const sla = assessSla(anchorStageId, wo.stageEnteredAt, now);
    if (sla.status === 'ON_TRACK') continue;
    const stage = getStage(anchorStageId);
    const over = Math.round(sla.overdueHours);
    items.push({
      id: `sla-${wo.alias}`,
      severity: sla.status === 'BREACHED' ? 'CRITICAL' : 'WARNING',
      kind: sla.status === 'BREACHED' ? 'BREACHED' : 'AT_RISK',
      title:
        sla.status === 'BREACHED'
          ? `${wo.alias} has overrun ${stage.code} ${stage.label}`
          : `${wo.alias} is running late at ${stage.code} ${stage.label}`,
      detail: `${over} hour${over === 1 ? '' : 's'} past the ${stage.expectedHours}-hour expectation. ${stage.nextAction}`,
      href: `/orders/${wo.alias}`,
      orderAlias: wo.alias,
      since: wo.stageEnteredAt.toISOString(),
    });
  }

  for (const t of overdueTasks) {
    const hours = t.dueAt ? Math.round((now.getTime() - t.dueAt.getTime()) / 3_600_000) : 0;
    items.push({
      id: `task-${t.id}`,
      severity: t.priority === 'URGENT' ? 'CRITICAL' : 'WARNING',
      kind: 'OVERDUE_TASK',
      title: t.title,
      detail: `Due ${hours} hour${hours === 1 ? '' : 's'} ago${t.workOrder ? ` on ${t.workOrder.alias}` : ''}.`,
      href: t.workOrder ? `/orders/${t.workOrder.alias}?tab=tasks` : '/dashboard',
      orderAlias: t.workOrder?.alias,
      since: (t.dueAt ?? now).toISOString(),
    });
  }

  // One row per ORDER, not per message: five unread notes on one order is one
  // thing to go and read, and five rows would crowd out the blocked orders above.
  const unreadByAlias = new Map<string, number>();
  for (const c of unread) {
    const alias = c.workOrder.alias;
    unreadByAlias.set(alias, (unreadByAlias.get(alias) ?? 0) + 1);
  }
  for (const [alias, n] of [...unreadByAlias].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    items.push({
      id: `unread-${alias}`,
      severity: 'INFO',
      kind: 'UNREAD',
      title: `${n} unread message${n === 1 ? '' : 's'} on ${alias}`,
      detail: 'Someone has written on this order and nobody has read it yet.',
      href: `/orders/${alias}?tab=communication`,
      orderAlias: alias,
      since: now.toISOString(),
    });
  }

  items.sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.since.localeCompare(b.since));

  return {
    items,
    counts: {
      critical: items.filter((i) => i.severity === 'CRITICAL').length,
      warning: items.filter((i) => i.severity === 'WARNING').length,
      info: items.filter((i) => i.severity === 'INFO').length,
      total: items.length,
    },
  };
}
