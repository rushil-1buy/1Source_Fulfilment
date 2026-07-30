import { PageHeader, PageShell, Panel, Money } from '@/components/ui/Layout';
import { RecordTable, type ColumnSpec } from '@/components/ui/RecordTable';
import { listCustomsEntries } from '@/lib/queries/modules';

/**
 * Never prerendered.
 *
 * Every screen here reads live operational data. Without this, Next prerenders
 * at build time and serves a snapshot of the database taken during CI — an
 * orders list frozen at deploy, and on a serverless host with no build-time
 * database, a build that fails outright.
 */
export const dynamic = 'force-dynamic';


export const metadata = { title: 'Customs & Compliance' };

const COLUMNS: ColumnSpec[] = [
  { key: 'order', label: 'Work order', kind: 'mono', mobile: 'primary', width: '150px' },
  { key: 'boeNumber', label: 'Bill of Entry number', termKey: 'boe', kind: 'mono', mobile: 'secondary', width: '170px' },
  { key: 'portCode', label: 'Port', kind: 'chip', mobile: 'hidden', width: '110px' },
  { key: 'agent', label: 'Customs agent', mobile: 'hidden' },
  { key: 'status', label: 'Clearance status', kind: 'status', mobile: 'meta', width: '160px' },
  { key: 'assessableValue', label: 'Assessable value', termKey: 'taxableValue', kind: 'money', mobile: 'hidden' },
  { key: 'dutyBcd', label: 'Basic customs duty', termKey: 'bcd', kind: 'money', mobile: 'hidden' },
  { key: 'dutySws', label: 'Social welfare surcharge', termKey: 'sws', kind: 'money', mobile: 'hidden' },
  { key: 'dutyIgst', label: 'Import tax (recoverable)', termKey: 'importIgst', kind: 'money', mobile: 'meta' },
  { key: 'realCost', label: 'Real cost to us', kind: 'money', mobile: 'meta' },
  { key: 'totalDuty', label: 'Total paid to customs', kind: 'money', mobile: 'hidden' },
  { key: 'customsRate', label: 'Customs exchange rate', termKey: 'customsExchangeRate', kind: 'number', mobile: 'hidden', width: '170px' },
  { key: 'ourRate', label: 'Our locked rate', termKey: 'fxRate', kind: 'number', mobile: 'hidden', width: '140px' },
  { key: 'openQueries', label: 'Queries raised', kind: 'number', mobile: 'meta', width: '130px' },
  { key: 'provenance', label: 'Source', termKey: 'provenance', kind: 'provenance', mobile: 'hidden', width: '110px' },
  { key: 'filedAt', label: 'Filed', kind: 'date', mobile: 'hidden', width: '120px' },
  { key: 'outOfChargeAt', label: 'Released', termKey: 'outOfCharge', kind: 'date', mobile: 'hidden', width: '120px' },
];

export default async function CustomsPage() {
  const rows = await listCustomsEntries();
  const recoverable = rows.reduce((a, r) => a + Number(r.recoverable ?? 0), 0);
  const realCost = rows.reduce((a, r) => a + Number(r.realCost ?? 0), 0);
  const unpaid = rows.filter((r) => r.status !== 'OUT_OF_CHARGE').length;

  return (
    <PageShell width="full">
      <PageHeader
        title="Customs & Compliance"
        plainTitle="Customs"
        termKey="boe"
        description="Every import entry filed with Indian Customs by our agent. Duty is broken out by head because only part of it is a real cost — the import tax comes back to us as input credit."
      />
      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Panel><Stat label="Entries filed" value={String(rows.length)} /></Panel>
        <Panel><Stat label="Not yet released" value={String(unpaid)} tone={unpaid > 0 ? 'warning' : undefined} /></Panel>
        <Panel><Stat label="Real cost (not recoverable)" value={<Money amount={realCost} withSymbol compact />} tone="warning" /></Panel>
        <Panel><Stat label="Recoverable as credit" value={<Money amount={recoverable} withSymbol compact />} tone="success" /></Panel>
      </div>
      <RecordTable
        columns={COLUMNS}
        rows={rows}
        exportName="customs-entries"
        searchPlaceholder="Search by order, entry number or port…"
        emptyTitle="No customs entries yet"
        emptyDescription="An entry is filed once an import consignment reaches the border."
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
