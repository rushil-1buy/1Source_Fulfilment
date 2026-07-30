import { PageHeader, PageShell } from '@/components/ui/Layout';
import { RecordTable, type ColumnSpec } from '@/components/ui/RecordTable';
import { listApprovedVendors } from '@/lib/queries/modules';

export const metadata = { title: 'Approved Vendor List' };

const COLUMNS: ColumnSpec[] = [
  { key: 'name', label: 'Supplier', mobile: 'primary', width: '250px' },
  { key: 'code', label: 'Supplier code', kind: 'mono', mobile: 'hidden', width: '120px' },
  { key: 'country', label: 'Location', mobile: 'secondary' },
  { key: 'status', label: 'Approval status', termKey: 'avlStatus', kind: 'status', mobile: 'meta', width: '150px' },
  { key: 'approvedUpto', label: 'Approved until', kind: 'date', mobile: 'meta', width: '140px' },
  { key: 'categories', label: 'Categories approved for' },
  { key: 'certifications', label: 'Certifications', mobile: 'hidden' },
  { key: 'qualityRating', label: 'Quality rating', kind: 'number', mobile: 'meta', width: '120px' },
  { key: 'deliveryRating', label: 'Delivery rating', kind: 'number', mobile: 'hidden', width: '120px' },
  { key: 'riskScore', label: 'Risk score', kind: 'number', mobile: 'hidden', width: '110px' },
  { key: 'currency', label: 'Currency', kind: 'chip', mobile: 'hidden', width: '100px' },
  { key: 'incoterms', label: 'Delivery terms', termKey: 'incoterms', kind: 'chip', mobile: 'hidden', width: '130px' },
  { key: 'orderCount', label: 'Orders placed', kind: 'number', mobile: 'hidden', width: '120px' },
];

export default async function ApprovedVendorListPage() {
  const rows = await listApprovedVendors();
  const approved = rows.filter((r) => r.status === 'APPROVED').length;
  return (
    <PageShell width="full">
      <PageHeader
        title="Approved Vendor List"
        plainTitle="Approved suppliers"
        termKey="avlStatus"
        description={`The only suppliers we are permitted to buy from. ${approved} of ${rows.length} are currently approved and unexpired — a purchase order cannot be raised on any of the others.`}
      />
      <RecordTable
      rowNoun="suppliers"
        columns={COLUMNS}
        rows={rows}
        exportName="approved-vendor-list"
        searchPlaceholder="Search suppliers, categories, certifications…"
        emptyTitle="No suppliers on the list"
        emptyDescription="Suppliers must be onboarded and approved before any purchase order can be raised on them."
      />
    </PageShell>
  );
}
