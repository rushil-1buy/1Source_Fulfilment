import { PageHeader, PageShell } from '@/components/ui/Layout';
import {
  getAggregation,
  listAggregations,
  listApprovedSuppliers,
  listDemandCandidates,
} from '@/lib/queries/aggregation';
import { AggregationWorkbench } from './AggregationWorkbench';

export const metadata = { title: 'Demand Aggregation' };
export const dynamic = 'force-dynamic';

/**
 * DEMAND AGGREGATION — pooling the same part across several customer orders.
 *
 * The shape the platform already handled was one customer order split across
 * several suppliers. This is the other direction: several customer orders
 * consolidated into one bulk purchase order, to reach a volume price none of them
 * reaches alone.
 *
 * The two together give a genuine many-to-many between the customer side and the
 * supplier side, with the allocation carried line by line.
 *
 * What pooling deliberately does not do is merge the customers. Each keeps its own
 * work order against the shared bulk order, because each needs its own proforma
 * invoice, tax invoice, e-way bill and proof of delivery — documents that name one
 * buyer and cannot be combined.
 */
export default async function DemandAggregationPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; pool?: string }>;
}) {
  const sp = await searchParams;
  const editing = sp.pool ?? null;

  const [candidates, pools, suppliers, current] = await Promise.all([
    listDemandCandidates(editing ? { excludeAggregationId: editing } : {}),
    listAggregations(),
    listApprovedSuppliers(),
    editing ? getAggregation(editing) : Promise.resolve(null),
  ]);

  return (
    <PageShell>
      <PageHeader
        title="Demand Aggregation"
        description="Pool the same part across several customer orders and buy it once, in bulk. Each customer keeps its own work order against the shared order — only the buying is combined."
        termKey="coverage"
      />
      <AggregationWorkbench
        candidates={candidates}
        pools={pools}
        suppliers={suppliers}
        initialView={sp.view === 'pools' ? 'pools' : 'open'}
        editing={current}
      />
    </PageShell>
  );
}
