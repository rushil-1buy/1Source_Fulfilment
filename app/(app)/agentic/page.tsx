import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { getStage } from '@/lib/domain/stages';
import { PageHeader, PageShell } from '@/components/ui/Layout';
import { AgenticRunner } from '@/components/agentic/AgenticRunner';

/** The order genuinely moves here, so nothing about this page may be cached. */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Autonomous flow' };

export default async function AgenticPage() {
  const order = await db.workOrder.findFirst({
    where: { alias: 'AGENTIC-DEMO' },
    select: { id: true, alias: true, stage: true },
  });
  if (!order) notFound();

  const stage = getStage(order.stage);
  return (
    <PageShell width="full">
      <PageHeader
        title="Autonomous fulfilment"
        description="The agent working a real order, through the real gates. It advances what it is allowed to advance and stops where a person is required."
      />
      <AgenticRunner
        orderId={order.id}
        orderAlias={order.alias}
        startCode={stage.code}
        startLabel={stage.label}
      />
    </PageShell>
  );
}
