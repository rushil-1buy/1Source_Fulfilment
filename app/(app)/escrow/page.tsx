import { PageHeader, PageShell, Panel } from '@/components/ui/Layout';
import { RecordTable, type ColumnSpec } from '@/components/ui/RecordTable';
import { Money } from '@/components/ui/Layout';
import { listEscrowAccounts } from '@/lib/queries/modules';

export const metadata = { title: 'Escrow' };

const COLUMNS: ColumnSpec[] = [
  { key: 'order', label: 'Work order', kind: 'mono', mobile: 'primary', width: '150px' },
  { key: 'escrowRef', label: 'Escrow reference', termKey: 'escrowRef', kind: 'mono', mobile: 'secondary', width: '170px' },
  { key: 'supplier', label: 'Beneficiary supplier', mobile: 'meta' },
  { key: 'stage', label: 'Order is at', termKey: 'stage', mobile: 'hidden' },
  { key: 'status', label: 'Escrow status', kind: 'status', mobile: 'meta', width: '150px' },
  { key: 'agreedAmount', label: 'Agreed amount', kind: 'money', mobile: 'hidden' },
  { key: 'fundedAmount', label: 'Funded', kind: 'money', mobile: 'meta' },
  { key: 'releasedAmount', label: 'Released', kind: 'money', mobile: 'hidden' },
  { key: 'heldAmount', label: 'Held right now', termKey: 'escrowHeld', kind: 'money', mobile: 'meta' },
  { key: 'feeAmount', label: 'Provider fee', kind: 'money', mobile: 'hidden' },
  { key: 'movements', label: 'Movements', kind: 'number', mobile: 'hidden', width: '110px' },
  { key: 'provenance', label: 'Source', termKey: 'provenance', kind: 'provenance', mobile: 'hidden', width: '110px' },
];

export default async function EscrowPage() {
  const rows = await listEscrowAccounts();
  const held = rows.reduce((a, r) => a + Number(r.heldAmount ?? 0), 0);
  const released = rows.reduce((a, r) => a + Number(r.releasedAmount ?? 0), 0);
  const fees = rows.reduce((a, r) => a + Number(r.feeAmount ?? 0), 0);

  return (
    <PageShell width="full">
      <PageHeader
        title="Escrow"
        plainTitle="Held money"
        termKey="escrowHeld"
        description="Money sitting with a neutral third party, released only against a business milestone. The final release always requires two Finance approvers and a passed inbound inspection."
      />
      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Panel><Stat label="Accounts open" value={String(rows.length)} /></Panel>
        <Panel><Stat label="Held right now" value={<Money amount={held} withSymbol compact />} tone="warning" /></Panel>
        <Panel><Stat label="Released to suppliers" value={<Money amount={released} withSymbol compact />} tone="success" /></Panel>
        <Panel><Stat label="Provider fees" value={<Money amount={fees} withSymbol compact />} /></Panel>
      </div>
      <RecordTable
        columns={COLUMNS}
        rows={rows}
        exportName="escrow-accounts"
        searchPlaceholder="Search by order, reference or supplier…"
        emptyTitle="No escrow accounts yet"
        emptyDescription="An escrow account is opened when a work order on escrow terms becomes active."
      />
    </PageShell>
  );
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'warning' | 'success' }) {
  return (
    <div className="min-w-0">
      <div className="text-fg-tertiary text-[10px] font-semibold tracking-[0.05em] uppercase">{label}</div>
      <div className={`tnum mt-1 text-[19px] leading-none font-semibold ${tone === 'warning' ? 'text-warning' : tone === 'success' ? 'text-success' : 'text-fg'}`}>{value}</div>
    </div>
  );
}
