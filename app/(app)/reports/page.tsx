import Link from 'next/link';
import { PageHeader, PageShell, Panel, PanelHeader, Money, Pct, EmptyState } from '@/components/ui/Layout';
import { RecordTable, type ColumnSpec, type RecordRow } from '@/components/ui/RecordTable';
import { Chip } from '@/components/ui/Badges';
import { dashboardSummary } from '@/lib/queries/orders';
import { PHASES, PHASE_DEFS } from '@/lib/domain/stages';
import { humanDuration } from '@/lib/utils';

/**
 * Never prerendered.
 *
 * Every screen here reads live operational data. Without this, Next prerenders
 * at build time and serves a snapshot of the database taken during CI — an
 * orders list frozen at deploy, and on a serverless host with no build-time
 * database, a build that fails outright.
 */
export const dynamic = 'force-dynamic';


export const metadata = { title: 'Reports & Analytics' };

const COLUMNS: ColumnSpec[] = [
  { key: 'alias', label: 'Work order', kind: 'mono', mobile: 'primary', width: '150px' },
  { key: 'customerName', label: 'Customer', mobile: 'secondary' },
  { key: 'supplierName', label: 'Supplier', mobile: 'hidden' },
  { key: 'stageLabel', label: 'Current stage', termKey: 'stage', mobile: 'meta' },
  { key: 'status', label: 'Status', kind: 'status', mobile: 'meta', width: '120px' },
  { key: 'sellValue', label: 'Sell value', termKey: 'sellValue', kind: 'money', mobile: 'meta' },
  { key: 'landedCost', label: 'Landed cost', termKey: 'landedCost', kind: 'money', mobile: 'hidden' },
  { key: 'creditableTaxes', label: 'Recoverable taxes', termKey: 'itc', kind: 'money', mobile: 'hidden' },
  { key: 'trueMargin', label: 'True margin', termKey: 'trueMargin', kind: 'money', mobile: 'meta' },
  { key: 'trueMarginPct', label: 'True margin percent', kind: 'pct', mobile: 'meta', width: '170px' },
  { key: 'marginBeforeCreditsPct', label: 'Margin before credits', termKey: 'marginBeforeCredits', kind: 'pct', mobile: 'hidden', width: '190px' },
  { key: 'cycleDays', label: 'Days elapsed', kind: 'number', mobile: 'hidden', width: '130px' },
];

export default async function ReportsPage() {
  const { rows, kpis } = await dashboardSummary();

  const tableRows: RecordRow[] = rows.map((r) => ({
    id: r.id,
    href: `/orders/${r.alias}`,
    alias: r.alias,
    customerName: r.customerName,
    supplierName: r.supplierName,
    stageLabel: r.stageLabel,
    status: r.status,
    sellValue: r.sellValue,
    landedCost: r.landedCost,
    creditableTaxes: r.creditableTaxes,
    trueMargin: r.trueMargin,
    trueMarginPct: Number(r.trueMarginPct.toFixed(2)),
    marginBeforeCreditsPct: Number(r.marginBeforeCreditsPct.toFixed(2)),
    cycleDays: Math.round(
      (new Date(r.stageEnteredAt).getTime() - new Date(r.createdAt).getTime()) / 86_400_000,
    ),
  }));

  const totalSell = rows.reduce((a, r) => a + r.sellValue, 0);
  const totalMargin = rows.reduce((a, r) => a + r.trueMargin, 0);
  const totalBefore = rows.reduce((a, r) => a + r.marginBeforeCredits, 0);
  const totalRecoverable = rows.reduce((a, r) => a + r.creditableTaxes, 0);
  const belowFloor = rows.filter((r) => r.belowFloor);

  const active = rows.filter((r) => r.status === 'ACTIVE' || r.status === 'BLOCKED');
  const phaseRows = PHASES.map((p) => {
    const inPhase = active.filter((r) => r.phase === p);
    return {
      phase: p,
      def: PHASE_DEFS[p],
      count: inPhase.length,
      value: inPhase.reduce((a, r) => a + r.sellValue, 0),
    };
  });
  const maxCount = Math.max(1, ...phaseRows.map((p) => p.count));

  return (
    <PageShell width="full">
      <PageHeader
        title="Reports & Analytics"
        plainTitle="Reports"
        description="Margin, cycle time and where the work is sitting. Margin is shown both correctly and as it would look if recoverable taxes were wrongly treated as cost, because the gap between them is the whole point."
      />

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
        <Panel><Stat label="Orders" value={String(rows.length)} /></Panel>
        <Panel><Stat label="Total sell value" value={<Money amount={totalSell} withSymbol compact />} /></Panel>
        <Panel><Stat label="True margin" value={<Money amount={totalMargin} withSymbol compact />} tone="success" /></Panel>
        <Panel><Stat label="Before tax credits" value={<Money amount={totalBefore} withSymbol compact />} tone={totalBefore < 0 ? 'danger' : undefined} /></Panel>
        <Panel><Stat label="Recoverable taxes" value={<Money amount={totalRecoverable} withSymbol compact />} tone="success" /></Panel>
        <Panel><Stat label="Average cycle" value={kpis.avgCycleDays ? `${kpis.avgCycleDays.toFixed(0)} days` : '—'} /></Panel>
      </div>

      <div className="mb-4 grid gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHeader
            title="Where the work is sitting"
            description="Active orders by phase, with the value tied up in each."
          />
          <ul className="grid gap-1.5">
            {phaseRows.map((p) => (
              <li key={p.phase} className="flex min-w-0 items-center gap-3">
                <span className="text-fg-secondary w-[190px] shrink-0 truncate text-[12px]">
                  <span className="text-fg-tertiary mr-1.5 font-mono text-[10px]">{p.phase}</span>
                  {p.def.label}
                </span>
                <span className="bg-surface-3 h-2 min-w-0 flex-1 overflow-hidden rounded-full">
                  <span
                    className="bg-accent block h-full rounded-full"
                    style={{ width: `${(p.count / maxCount) * 100}%` }}
                  />
                </span>
                <span className="tnum text-fg w-8 shrink-0 text-right text-[12px] font-semibold">
                  {p.count}
                </span>
                <span className="tnum text-fg-tertiary w-24 shrink-0 text-right text-[11.5px]">
                  <Money amount={p.value} withSymbol compact />
                </span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel>
          <PanelHeader
            title="Orders below the margin floor"
            description="Where true margin falls under the configured threshold."
          />
          {belowFloor.length === 0 ? (
            <EmptyState compact title="Every order clears the floor" description="No order is below the configured margin threshold." />
          ) : (
            <ul className="divide-line-subtle -mx-4 divide-y">
              {belowFloor.map((r) => (
                <li key={r.id} className="px-4 py-2">
                  <Link href={`/orders/${r.alias}`} className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="font-mono text-[11.5px] font-medium">{r.alias}</span>
                    <span className="text-fg-tertiary min-w-0 flex-1 truncate text-[11.5px]">{r.customerName}</span>
                    <Chip tone="danger" size="sm">
                      <Pct value={r.trueMarginPct} />
                    </Chip>
                    <Money amount={r.trueMargin} tone="auto" className="shrink-0 text-[12px]" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="text-fg-tertiary mt-3 text-[11px] leading-relaxed">
            Slowest current stage across active orders:{' '}
            {active.length > 0
              ? (() => {
                  const worst = [...active].sort((a, b) => b.hoursInStage - a.hoursInStage)[0];
                  return `${worst.stageLabel} on ${worst.alias}, ${humanDuration(worst.hoursInStage)} so far.`;
                })()
              : 'nothing active.'}
          </p>
        </Panel>
      </div>

      <RecordTable
        columns={COLUMNS}
        rows={tableRows}
        exportName="order-profitability"
        searchPlaceholder="Search by order, customer or supplier…"
        emptyTitle="No orders to report on yet"
      />
    </PageShell>
  );
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'success' | 'danger' }) {
  return (
    <div className="min-w-0">
      <div className="text-fg-tertiary text-[10px] font-semibold tracking-[0.05em] uppercase">{label}</div>
      <div className={`tnum mt-1 text-[18px] leading-none font-semibold ${tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : 'text-fg'}`}>{value}</div>
    </div>
  );
}
