import { db } from '@/lib/db';
import { PageHeader, PageShell } from '@/components/ui/Layout';
import { AgenticSimulator } from '@/components/agentic/AgenticSimulator';

/** Reads a live order to name the walkthrough, so it is never prerendered. */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Autonomous flow' };

export default async function AgenticPage() {
  /*
   * Named after a real order in the system rather than a placeholder.
   *
   * The walkthrough is an argument about how THIS platform would run, and
   * pointing it at an order somebody can also open in the Control Tower is what
   * keeps it from reading as a slide.
   */
  const order = await db.workOrder.findFirst({
    where: { alias: 'AGENTIC-DEMO' },
    select: { alias: true },
  });

  return (
    <PageShell width="full">
      <PageHeader
        title="Autonomous fulfilment"
        description="How the flow runs when an agent works it — and the points where it hands back to a person. A walkthrough, not a live run."
      />
      <AgenticSimulator orderAlias={order?.alias ?? 'AGENTIC-DEMO'} />
    </PageShell>
  );
}
