import { PageHeader, PageShell } from '@/components/ui/Layout';
import { listOrders } from '@/lib/queries/orders';
import { OrdersTable } from './OrdersTable';

/**
 * Never prerendered.
 *
 * Every screen here reads live operational data. Without this, Next prerenders
 * at build time and serves a snapshot of the database taken during CI — an
 * orders list frozen at deploy, and on a serverless host with no build-time
 * database, a build that fails outright.
 */
export const dynamic = 'force-dynamic';


export const metadata = { title: 'Orders' };

export default async function OrdersPage() {
  const rows = await listOrders();

  return (
    <PageShell width="full">
      <PageHeader
        title="Orders"
        plainTitle="Jobs"
        termKey="workOrder"
        description="Internal work orders. Each one ties a customer's order, our quote, our supplier order and the supplier's quote into a single job, tracked end to end."
      />
      <OrdersTable rows={rows} />
    </PageShell>
  );
}
