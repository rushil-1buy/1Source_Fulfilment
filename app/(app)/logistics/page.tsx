import { PageHeader, PageShell } from '@/components/ui/Layout';
import { RecordTable, type ColumnSpec } from '@/components/ui/RecordTable';
import { listShipments } from '@/lib/queries/modules';

/**
 * Never prerendered.
 *
 * Every screen here reads live operational data. Without this, Next prerenders
 * at build time and serves a snapshot of the database taken during CI — an
 * orders list frozen at deploy, and on a serverless host with no build-time
 * database, a build that fails outright.
 */
export const dynamic = 'force-dynamic';


export const metadata = { title: 'Logistics' };

const COLUMNS: ColumnSpec[] = [
  { key: 'order', label: 'Work order', kind: 'mono', mobile: 'primary', width: '150px' },
  { key: 'leg', label: 'Shipping leg', termKey: 'shipmentLeg', mobile: 'secondary', width: '180px' },
  { key: 'route', label: 'Route', mobile: 'meta' },
  { key: 'carrier', label: 'Carrier', kind: 'chip', mobile: 'meta', width: '110px' },
  { key: 'service', label: 'Service', mobile: 'hidden', width: '170px' },
  { key: 'awb', label: 'Tracking number', termKey: 'awb', kind: 'mono', mobile: 'meta', width: '150px' },
  { key: 'status', label: 'Status', kind: 'status', mobile: 'meta', width: '150px' },
  { key: 'pieces', label: 'Pieces', kind: 'number', mobile: 'hidden', width: '90px' },
  { key: 'chargeableWeightKg', label: 'Chargeable weight', termKey: 'chargeableWeight', kind: 'number', mobile: 'hidden', width: '160px' },
  { key: 'freightAmount', label: 'Freight cost', kind: 'money', mobile: 'hidden' },
  { key: 'events', label: 'Tracking events', kind: 'number', mobile: 'hidden', width: '140px' },
  { key: 'provenance', label: 'Source', termKey: 'provenance', kind: 'provenance', mobile: 'hidden', width: '110px' },
  { key: 'dispatchedAt', label: 'Dispatched', kind: 'date', mobile: 'hidden', width: '130px' },
  { key: 'deliveredAt', label: 'Delivered', kind: 'date', mobile: 'hidden', width: '130px' },
];

export default async function LogisticsPage() {
  const rows = await listShipments();
  return (
    <PageShell width="full">
      <PageHeader
        title="Logistics"
        plainTitle="Shipping"
        termKey="shipmentLeg"
        description="All four shipping legs across every order — parts out to the laboratory, back to the supplier, the import consignment to us, and the final delivery to the customer. Each leg is tracked separately because each has its own carrier, cost and paperwork."
      />
      <RecordTable
        columns={COLUMNS}
        rows={rows}
        exportName="shipments"
        searchPlaceholder="Search by order, tracking number or route…"
        emptyTitle="Nothing has shipped yet"
      />
    </PageShell>
  );
}
