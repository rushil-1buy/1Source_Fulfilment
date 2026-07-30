import { db } from '@/lib/db';
import { dashboardSummary } from '@/lib/queries/orders';
import { ControlTower } from './ControlTower';

export const metadata = { title: 'Dashboard' };

/**
 * Thin server wrapper: fetch, serialize, hand off. All presentation lives in the
 * client component, so icon components never have to cross the RSC boundary
 * (React cannot serialize a function prop).
 */
export default async function DashboardPage() {
  const { rows, kpis } = await dashboardSummary();

  const [transitions, tasks] = await Promise.all([
    db.stageTransition.findMany({
      take: 12,
      orderBy: { createdAt: 'desc' },
      include: { workOrder: { select: { id: true, alias: true } } },
    }),
    db.task.findMany({
      where: { status: { in: ['OPEN', 'IN_PROGRESS'] } },
      take: 8,
      orderBy: [{ priority: 'desc' }, { dueAt: 'asc' }],
      include: { workOrder: { select: { id: true, alias: true } } },
    }),
  ]);

  return (
    <ControlTower
      rows={rows}
      kpis={kpis}
      activity={transitions.map((t) => ({
        id: t.id,
        orderId: t.workOrder.id,
        alias: t.workOrder.alias,
        toStage: t.toStage,
        actorLabel: t.actorLabel,
        createdAt: t.createdAt.toISOString(),
      }))}
      tasks={tasks.map((t) => ({
        id: t.id,
        title: t.title,
        priority: t.priority,
        dueAt: t.dueAt ? t.dueAt.toISOString() : null,
        ownerRole: t.ownerRole,
        orderId: t.workOrder?.id ?? null,
        alias: t.workOrder?.alias ?? null,
      }))}
    />
  );
}
