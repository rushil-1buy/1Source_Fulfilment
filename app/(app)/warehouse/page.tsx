import { PageHeader, PageShell } from '@/components/ui/Layout';
import { TabbedTables, type TableSection } from '@/components/ui/TabbedTables';
import { listWarehouseActivity } from '@/lib/queries/modules';

/**
 * Never prerendered.
 *
 * Every screen here reads live operational data. Without this, Next prerenders
 * at build time and serves a snapshot of the database taken during CI — an
 * orders list frozen at deploy, and on a serverless host with no build-time
 * database, a build that fails outright.
 */
export const dynamic = 'force-dynamic';


export const metadata = { title: 'Warehouse' };

export default async function WarehousePage() {
  const { receipts, inspections, repacks, deliveries } = await listWarehouseActivity();

  const sections: TableSection[] = [
    {
      id: 'receipts',
      label: 'Goods received',
      description:
        'What physically arrived, checked against the packing list. This is where a shortfall or damage is first caught, which is far easier to claim early than late.',
      rows: receipts,
      columns: [
        { key: 'order', label: 'Work order', kind: 'mono', mobile: 'primary', width: '150px' },
        { key: 'grnNumber', label: 'Goods receipt number', termKey: 'grn', kind: 'mono', mobile: 'secondary', width: '170px' },
        { key: 'receivedAt', label: 'Received', kind: 'datetime', mobile: 'meta', width: '170px' },
        { key: 'cartons', label: 'Cartons', kind: 'number', mobile: 'meta', width: '100px' },
        { key: 'storageLocation', label: 'Storage location', termKey: 'storageLocation', kind: 'mono', mobile: 'meta', width: '150px', empty: 'Not put away' },
        { key: 'lines', label: 'Part lines', kind: 'number', mobile: 'hidden', width: '110px' },
        { key: 'expectedQty', label: 'Quantity expected', kind: 'number', mobile: 'meta' },
        { key: 'receivedQty', label: 'Quantity received', kind: 'number', mobile: 'meta' },
        { key: 'shortfall', label: 'Shortfall', kind: 'boolean', mobile: 'meta', width: '110px' },
        { key: 'receivedBy', label: 'Received by', mobile: 'hidden' },
      ],
    },
    {
      id: 'inspections',
      label: 'Inspections',
      description:
        'Our own detailed check of what arrived. Passing this is the gate that unlocks the final payment to the supplier — nothing is released before it.',
      rows: inspections,
      columns: [
        { key: 'order', label: 'Work order', kind: 'mono', mobile: 'primary', width: '150px' },
        { key: 'reportNo', label: 'Inspection report', kind: 'mono', mobile: 'secondary', width: '170px' },
        { key: 'status', label: 'Result', termKey: 'inspectionVerdict', kind: 'status', mobile: 'meta', width: '140px' },
        { key: 'inspector', label: 'Inspector', mobile: 'meta' },
        { key: 'checksDone', label: 'Checks completed', kind: 'number', mobile: 'meta', width: '150px' },
        { key: 'checksTotal', label: 'Checks in total', kind: 'number', mobile: 'hidden', width: '140px' },
        { key: 'startedAt', label: 'Started', kind: 'datetime', mobile: 'hidden', width: '170px' },
        { key: 'signedOffAt', label: 'Signed off', kind: 'datetime', mobile: 'hidden', width: '170px' },
      ],
    },
    {
      id: 'repacks',
      label: 'Rebrand & repack',
      description:
        'Our value-add as Merchant of Record. Labelling and paperwork are applied to the outer carton only — manufacturer reels, trays and part markings stay untouched, so traceability is preserved.',
      rows: repacks,
      columns: [
        { key: 'order', label: 'Work order', kind: 'mono', mobile: 'primary', width: '150px' },
        { key: 'jobNo', label: 'Repack job', termKey: 'repackJob', kind: 'mono', mobile: 'secondary', width: '160px' },
        { key: 'status', label: 'Status', kind: 'status', mobile: 'meta', width: '140px' },
        { key: 'cartonCount', label: 'Cartons packed', kind: 'number', mobile: 'meta', width: '140px' },
        { key: 'serialsCaptured', label: 'Serial numbers captured', kind: 'number', mobile: 'meta' },
        { key: 'repackCost', label: 'Repack cost', kind: 'money', mobile: 'hidden' },
        { key: 'qcBy', label: 'Quality checked by', mobile: 'hidden' },
        { key: 'startedAt', label: 'Started', kind: 'datetime', mobile: 'hidden', width: '170px' },
        { key: 'completedAt', label: 'Completed', kind: 'datetime', mobile: 'hidden', width: '170px' },
      ],
    },
    {
      id: 'deliveries',
      label: 'Proof of delivery',
      description:
        'Signed confirmation that the customer received the goods. This closes the delivery obligation and is our evidence in any later dispute about whether goods arrived.',
      rows: deliveries,
      columns: [
        { key: 'order', label: 'Work order', kind: 'mono', mobile: 'primary', width: '150px' },
        { key: 'podNumber', label: 'Delivery proof number', termKey: 'pod', kind: 'mono', mobile: 'secondary', width: '180px' },
        { key: 'signedBy', label: 'Signed by', mobile: 'meta' },
        { key: 'deliveredAt', label: 'Delivered', kind: 'datetime', mobile: 'meta', width: '170px' },
        { key: 'sharedAt', label: 'Shared with customer', kind: 'datetime', mobile: 'hidden', width: '180px' },
        { key: 'provenance', label: 'Source', termKey: 'provenance', kind: 'provenance', mobile: 'hidden', width: '110px' },
      ],
    },
  ];

  return (
    <PageShell width="full">
      <PageHeader
        title="Warehouse"
        description="Everything that happens once goods reach us — receiving, inspecting, rebranding and repacking, and proving delivery to the customer."
      />
      <TabbedTables sections={sections} />
    </PageShell>
  );
}
