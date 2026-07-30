import { PageHeader, PageShell } from '@/components/ui/Layout';
import { RecordTable, type ColumnSpec } from '@/components/ui/RecordTable';
import { listTestRequests } from '@/lib/queries/modules';

/**
 * Never prerendered.
 *
 * Every screen here reads live operational data. Without this, Next prerenders
 * at build time and serves a snapshot of the database taken during CI — an
 * orders list frozen at deploy, and on a serverless host with no build-time
 * database, a build that fails outright.
 */
export const dynamic = 'force-dynamic';


export const metadata = { title: 'Testing Laboratory' };

const COLUMNS: ColumnSpec[] = [
  { key: 'order', label: 'Work order', kind: 'mono', mobile: 'primary', width: '150px' },
  { key: 'requestNo', label: 'Test request', kind: 'mono', mobile: 'secondary', width: '140px' },
  { key: 'labRef', label: 'Laboratory reference', kind: 'mono', mobile: 'hidden', width: '160px' },
  { key: 'scope', label: 'Test scope', termKey: 'testScope', kind: 'chip', mobile: 'meta', width: '130px' },
  { key: 'sampleSize', label: 'Sample size', kind: 'number', mobile: 'hidden', width: '120px' },
  { key: 'aql', label: 'Acceptable quality level', termKey: 'aql', mobile: 'hidden', width: '160px' },
  { key: 'status', label: 'Progress', kind: 'status', mobile: 'meta', width: '140px' },
  { key: 'verdict', label: 'Verdict', termKey: 'testVerdict', kind: 'status', mobile: 'meta', width: '120px' },
  { key: 'failedQty', label: 'Pieces failed', kind: 'number', mobile: 'meta', width: '120px' },
  { key: 'reportNo', label: 'Report number', kind: 'mono', mobile: 'hidden', width: '170px' },
  { key: 'testCost', label: 'Testing cost', kind: 'money', mobile: 'hidden' },
  { key: 'reverseCharged', label: 'Reverse charged', termKey: 'reverseCharge', kind: 'boolean', mobile: 'hidden', width: '140px' },
  { key: 'provenance', label: 'Source', termKey: 'provenance', kind: 'provenance', mobile: 'hidden', width: '110px' },
  { key: 'submittedAt', label: 'Submitted', kind: 'date', mobile: 'hidden', width: '130px' },
];

export default async function TestingPage() {
  const rows = await listTestRequests();
  const failed = rows.filter((r) => r.verdict === 'FAIL').length;
  return (
    <PageShell width="full">
      <PageHeader
        title="Testing Laboratory"
        plainTitle="Lab testing"
        termKey="testScope"
        description={`Independent verification before a full shipment moves. ${rows.length} requests raised, ${failed} failed. A failure blocks its order until someone chooses a resolution route in that order's Testing tab.`}
      />
      <RecordTable
        columns={COLUMNS}
        rows={rows}
        exportName="test-requests"
        searchPlaceholder="Search by order, request or report number…"
        emptyTitle="No test requests raised"
        emptyDescription="A request is created when a supplier is instructed to send parts to the laboratory."
      />
    </PageShell>
  );
}
