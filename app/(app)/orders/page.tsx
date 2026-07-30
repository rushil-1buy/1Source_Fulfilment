import { PageHeader, PageShell } from '@/components/ui/Layout';
import { listOrders } from '@/lib/queries/orders';
import { OrdersTable } from './OrdersTable';

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
