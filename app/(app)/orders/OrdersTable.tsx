'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { ClipboardList, GitBranch, Layers, MessageSquare, PenLine, Plus } from 'lucide-react';
import type { OrderRow } from '@/lib/queries/orders';
import { DataTable } from '@/components/ui/DataTable';
import { EditOrderDialog } from './EditOrderDialog';
import { Chip, StatusChip } from '@/components/ui/Badges';
import { Button, Money, MonoId, Pct } from '@/components/ui/Layout';
import { Hint } from '@/components/ui/InfoTooltip';
import { MicroRail } from '@/components/flow/FlowRail';
import { PAYMENT_METHOD_META, TEST_SCOPE_META } from '@/lib/domain/enums';
import { cn, humanDuration } from '@/lib/utils';
import { PHASE_DEFS, type PhaseId } from '@/lib/domain/stages';

type Filter = 'ALL' | 'ACTIVE' | 'BLOCKED' | 'LATE' | 'CLOSED';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'ACTIVE', label: 'Active' },
  { id: 'BLOCKED', label: 'Blocked' },
  { id: 'LATE', label: 'Running late' },
  { id: 'CLOSED', label: 'Closed' },
];

export function OrdersTable({ rows }: { rows: OrderRow[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('ALL');
  /** The row whose edit dialog is open. */
  const [editing, setEditing] = useState<OrderRow | null>(null);

  const filtered = useMemo(() => {
    switch (filter) {
      case 'ACTIVE':
        return rows.filter((r) => r.status === 'ACTIVE');
      case 'BLOCKED':
        return rows.filter((r) => r.isBlocked);
      case 'LATE':
        return rows.filter((r) => r.slaStatus !== 'ON_TRACK' && r.status !== 'CLOSED');
      case 'CLOSED':
        return rows.filter((r) => r.status === 'CLOSED');
      default:
        return rows;
    }
  }, [rows, filter]);

  const columns = useMemo<ColumnDef<OrderRow, unknown>[]>(
    () => [
      {
        id: 'alias',
        accessorKey: 'alias',
        header: 'Order',
        meta: {
          termKey: 'workOrder',
          plainLabel: 'Job',
          mobile: 'primary',
          width: '150px',
          exportValue: (r) => (r as OrderRow).alias,
        },
        cell: ({ row }) => {
          const r = row.original;
          return (
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="flex items-center gap-1.5">
                <MonoId value={r.alias} copyable={false} />
                {!r.nameLocked && (
                  <Hint
                    content={
                      <span>
                        Waiting for the supplier&apos;s proforma invoice. The Work Order name
                        completes automatically once it&apos;s recorded.
                      </span>
                    }
                  >
                    <span>
                      <Chip tone="warning" size="sm">
                        SPI pending
                      </Chip>
                    </span>
                  </Hint>
                )}
              </span>
              {/* Without this, a customer order split across three suppliers
                  shows three rows with the same customer and near-identical
                  names, and the natural reading is duplicated data. */}
              {r.splitOf > 1 && (
                <Hint
                  content={
                    <span>
                      {r.customerPoNumber} is sourced from {r.splitOf} suppliers, so it runs as{' '}
                      {r.splitOf} work orders — one each. This is number {r.splitIndex}. Open it to
                      see the other legs and what share each covers.
                    </span>
                  }
                >
                  <span>
                    <Chip tone="info" size="sm" icon={GitBranch}>
                      {r.splitIndex} of {r.splitOf}
                    </Chip>
                  </span>
                </Hint>
              )}
              {/* The mirror of the split chip: several rows sharing one bulk
                  supplier order differ only by customer, so without this they
                  read as duplicated data too. */}
              {r.bulkOf > 1 && (
                <Hint
                  content={
                    <span>
                      {r.supplierPoNumber} is one bulk order covering {r.bulkOf} customer orders —
                      pooled demand. Each keeps its own job, quote and delivery, but they share one
                      inbound shipment. This is number {r.bulkIndex}.
                    </span>
                  }
                >
                  <span>
                    <Chip tone="accent" size="sm" icon={Layers}>
                      Bulk {r.bulkIndex} of {r.bulkOf}
                    </Chip>
                  </span>
                </Hint>
              )}
              <Hint content={<span className="font-mono text-[10.5px]">{r.canonicalName}</span>}>
                <span className="text-fg-tertiary block max-w-[190px] truncate font-mono text-[9.5px]">
                  {r.canonicalName}
                </span>
              </Hint>
            </span>
          );
        },
      },
      {
        id: 'customerName',
        accessorKey: 'customerName',
        header: 'Customer',
        meta: { mobile: 'secondary', exportValue: (r) => (r as OrderRow).customerName },
        cell: ({ row }) => (
          <span className="block max-w-[170px] truncate" title={row.original.customerName}>
            {row.original.customerName}
          </span>
        ),
      },
      {
        id: 'supplierName',
        accessorKey: 'supplierName',
        header: 'Supplier',
        meta: { mobile: 'meta', exportValue: (r) => (r as OrderRow).supplierName },
        cell: ({ row }) => (
          <span className="block max-w-[160px] truncate" title={row.original.supplierName}>
            {row.original.supplierName}
          </span>
        ),
      },
      {
        id: 'stage',
        accessorKey: 'stageLabel',
        header: 'Current stage',
        meta: {
          termKey: 'stage',
          plainLabel: 'Current step',
          mobile: 'meta',
          width: '230px',
          exportValue: (r) => `${(r as OrderRow).stageCode} ${(r as OrderRow).stageLabel}`,
        },
        cell: ({ row }) => {
          const r = row.original;
          return (
            <span className="flex min-w-0 flex-col gap-1">
              <span className="flex items-center gap-1.5">
                <span
                  className={cn(
                    'font-mono text-[9.5px]',
                    r.isBlocked ? 'text-danger' : 'text-fg-tertiary',
                  )}
                >
                  {r.stageCode}
                </span>
                <span
                  className={cn(
                    'truncate text-[12.5px]',
                    r.isBlocked && 'text-danger font-semibold',
                  )}
                >
                  {r.stageLabel}
                </span>
              </span>
              <MicroRail
                data={{
                  currentStage: r.stage,
                  ctx: r.ctx,
                  isBlocked: r.isBlocked,
                  stageEnteredAt: r.stageEnteredAt,
                  completedStageIds: r.completedStageIds,
                }}
              />
            </span>
          );
        },
      },
      {
        id: 'phase',
        accessorKey: 'phase',
        header: 'Phase',
        meta: { mobile: 'hidden', width: '150px', exportValue: (r) => (r as OrderRow).phase },
        cell: ({ row }) => {
          const p = PHASE_DEFS[row.original.phase as PhaseId];
          return (
            <span className="text-fg-secondary flex items-center gap-1.5 text-[12px]">
              <span className="bg-surface-3 text-fg-tertiary grid size-4 shrink-0 place-items-center rounded-full text-[9px] font-semibold">
                {row.original.phase}
              </span>
              <span className="truncate">{p?.label ?? '—'}</span>
            </span>
          );
        },
      },
      {
        id: 'slaStatus',
        accessorKey: 'slaStatus',
        header: 'Timing',
        meta: {
          termKey: 'slaStatus',
          plainLabel: 'Running late?',
          mobile: 'meta',
          width: '140px',
          exportValue: (r) => (r as OrderRow).slaStatus,
        },
        cell: ({ row }) => {
          const r = row.original;
          if (r.status === 'CLOSED') return <span className="text-fg-tertiary">—</span>;
          return (
            <span className="flex min-w-0 flex-col gap-0.5">
              <StatusChip status={r.slaStatus} size="sm" />
              <span className="text-fg-tertiary text-[10px]">
                {humanDuration(r.hoursInStage)} here
              </span>
            </span>
          );
        },
      },
      {
        id: 'paymentMethod',
        accessorKey: 'paymentMethod',
        header: 'Payment',
        meta: {
          termKey: 'paymentMethod',
          mobile: 'meta',
          width: '120px',
          exportValue: (r) => (r as OrderRow).paymentMethod,
        },
        cell: ({ row }) => (
          <Chip
            tone={row.original.paymentMethod === 'ESCROW' ? 'accent' : 'neutral'}
            size="sm"
          >
            {PAYMENT_METHOD_META[row.original.paymentMethod].label}
          </Chip>
        ),
      },
      {
        id: 'testing',
        accessorFn: (r) => (r.testingRequired ? (r.testScope ?? 'YES') : 'NO'),
        header: 'Testing',
        meta: {
          termKey: 'testScope',
          mobile: 'hidden',
          width: '120px',
          exportValue: (r) =>
            (r as OrderRow).testingRequired ? ((r as OrderRow).testScope ?? 'Yes') : 'No',
        },
        cell: ({ row }) => {
          const r = row.original;
          if (!r.testingRequired) return <span className="text-fg-tertiary text-[12px]">Not required</span>;
          return (
            <Chip tone="warning" size="sm">
              {r.testScope ? TEST_SCOPE_META[r.testScope].label : 'Required'}
            </Chip>
          );
        },
      },
      {
        id: 'sellValue',
        accessorKey: 'sellValue',
        header: 'Sell value',
        meta: {
          termKey: 'sellValue',
          align: 'right',
          mobile: 'meta',
          width: '130px',
          exportValue: (r) => (r as OrderRow).sellValue / 100,
        },
        cell: ({ row }) => <Money amount={row.original.sellValue} compact />,
      },
      {
        id: 'landedCost',
        accessorKey: 'landedCost',
        header: 'Landed cost',
        meta: {
          termKey: 'landedCost',
          plainLabel: 'True total cost',
          align: 'right',
          mobile: 'hidden',
          width: '130px',
          exportValue: (r) => (r as OrderRow).landedCost / 100,
        },
        cell: ({ row }) => <Money amount={row.original.landedCost} compact />,
      },
      {
        id: 'trueMarginPct',
        accessorKey: 'trueMarginPct',
        header: 'True margin',
        meta: {
          termKey: 'trueMargin',
          align: 'right',
          mobile: 'meta',
          // Wide enough for "Below floor" beside a percentage without wrapping.
          width: '168px',
          exportValue: (r) => (r as OrderRow).trueMarginPct.toFixed(2),
        },
        cell: ({ row }) => {
          const r = row.original;
          return (
            <Hint
              content={
                <div className="space-y-1">
                  <div>
                    True margin <b>{r.trueMarginPct.toFixed(1)}%</b> — recoverable taxes correctly
                    excluded from cost.
                  </div>
                  <div className="text-fg-tertiary">
                    Before tax credits it would look like {r.marginBeforeCreditsPct.toFixed(1)}%.
                  </div>
                </div>
              }
            >
              {/* The money gets a line to itself so its right edge is identical
                  on every row — that is the entire point of a right-aligned money
                  column, and the "Low" chip sharing the line was displacing it.
                  The percentage and the warning sit beneath, subordinate. */}
              <span className="inline-flex flex-col items-end gap-0.5">
                <Money amount={r.trueMargin} compact tone="auto" />
                <span className="flex items-center gap-1.5">
                  {r.belowFloor && (
                    <Chip tone="danger" size="sm">
                      Below floor
                    </Chip>
                  )}
                  <Pct value={r.trueMarginPct} tone="auto" className="text-[11px]" />
                </span>
              </span>
            </Hint>
          );
        },
      },
      {
        id: 'status',
        accessorKey: 'status',
        header: 'Status',
        meta: { mobile: 'meta', width: '136px', exportValue: (r) => (r as OrderRow).status },
        cell: ({ row }) => (
          // The chip is the status; unread messages are an attention signal, not a
          // status. Wrapping them onto one line let the count displace the chip, so
          // the chip now owns the first line and the signal sits under it.
          <span className="inline-flex min-w-0 flex-col items-start gap-1">
            <StatusChip status={row.original.status} size="sm" />
            {row.original.unreadComms > 0 && (
              <Hint content={<span>{row.original.unreadComms} unread message(s)</span>}>
                <span className="text-warning inline-flex items-center gap-1 text-[11px] whitespace-nowrap">
                  <MessageSquare className="size-3 shrink-0" aria-hidden />
                  {row.original.unreadComms} unread
                </span>
              </Hint>
            )}
          </span>
        ),
      },
      {
        id: 'sourcingRef',
        accessorFn: (r) => r.sourcingRef ?? '',
        header: 'RFQ / Sourcing ID',
        // Hidden by default, but present so searching an enquiry number finds the
        // order it produced. Turn it on from the Columns menu when needed.
        meta: {
          termKey: 'sourcingRef',
          mobile: 'hidden',
          width: '170px',
          exportValue: (r) => (r as OrderRow).sourcingRef ?? '',
        },
        cell: ({ row }) =>
          row.original.sourcingRef ? (
            <MonoId value={row.original.sourcingRef} truncate />
          ) : (
            <span className="text-fg-tertiary text-[12px]">—</span>
          ),
      },
      {
        id: 'actions',
        // Not sortable, not searchable, never exported — it is a control, not data.
        enableSorting: false,
        enableGlobalFilter: false,
        header: '',
        meta: { align: 'right', width: '84px', mobile: 'actions', exportValue: () => '' },
        cell: ({ row }) => {
          const r = row.original;
          const closed = r.status === 'CLOSED' || r.status === 'CANCELLED';
          return (
            <Hint
              content={
                <span>
                  {closed
                    ? 'A closed order is a historical record and is not edited from here.'
                    : 'Edit the terms, or link a customer order and the quotes to this job.'}
                </span>
              }
            >
              <button
                type="button"
                disabled={closed}
                // Stops the row's own click from opening the order underneath.
                onClick={(e) => {
                  e.stopPropagation();
                  setEditing(r);
                }}
                aria-label={`Edit ${r.alias}`}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 rounded-[7px] border px-2 py-1 text-[11.5px] transition-colors',
                  closed
                    ? 'border-line-subtle text-fg-tertiary/50 cursor-not-allowed'
                    : 'border-line-subtle text-fg-secondary hover:bg-surface-3 hover:text-fg',
                )}
              >
                <PenLine className="size-3.5" strokeWidth={2} aria-hidden />
                Edit
              </button>
            </Hint>
          );
        },
      },
    ],
    [],
  );

  return (
    <>
    {editing && (
      <EditOrderDialog
        key={editing.id}
        order={editing}
        open
        onOpenChange={(o) => !o && setEditing(null)}
      />
    )}
    <DataTable
      rowNoun="orders"
      initialColumnVisibility={{ sourcingRef: false }}
      columns={columns}
      data={filtered}
      getRowId={(r) => r.id}
      // Route by the readable alias so the URL and breadcrumb say WO-2026-0106
      // rather than an opaque id.
      onRowClick={(r) => router.push(`/orders/${r.alias}`)}
      searchPlaceholder="Search by order, customer, supplier, part, RFQ…"
      exportName="work-orders"
      emptyTitle="No work orders yet"
      emptyDescription="A work order is created when you link a supplier PO to a customer PO in Create PO."
      emptyAction={
        <Button variant="primary" icon={Plus} onClick={() => router.push('/create-po')}>
          Create a PO
        </Button>
      }
      toolbarExtra={
        <div className="border-line-subtle bg-surface-1 flex shrink-0 items-center gap-0.5 rounded-[8px] border p-0.5">
          {FILTERS.map((f) => {
            const count =
              f.id === 'ALL'
                ? rows.length
                : f.id === 'ACTIVE'
                  ? rows.filter((r) => r.status === 'ACTIVE').length
                  : f.id === 'BLOCKED'
                    ? rows.filter((r) => r.isBlocked).length
                    : f.id === 'LATE'
                      ? rows.filter((r) => r.slaStatus !== 'ON_TRACK' && r.status !== 'CLOSED').length
                      : rows.filter((r) => r.status === 'CLOSED').length;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                aria-pressed={filter === f.id}
                className={cn(
                  'rounded-[6px] px-2 py-1 text-[12px] whitespace-nowrap transition-colors',
                  filter === f.id
                    ? 'bg-accent-subtle text-accent-text font-medium'
                    : 'text-fg-tertiary hover:text-fg hover:bg-surface-3',
                )}
              >
                {f.label}
                <span className="tnum ml-1 opacity-60">{count}</span>
              </button>
            );
          })}
        </div>
      }
      renderSubRow={(r) => <OrderDetailStrip row={r} />}
    />
    </>
  );
}

/**
 * The expanded row.
 *
 * Previously four unrelated fields strung edge to edge, which read as leftovers
 * rather than a panel. Now three labelled groups — what the job IS, what it is
 * WORTH, and where it STANDS — each a label/value ladder with figures aligned on
 * their own column so they can be compared down the list, and an accent rule on
 * the left tying the panel to the row it belongs to.
 */
function OrderDetailStrip({ row: r }: { row: OrderRow }) {
  const escrow = r.paymentMethod === 'ESCROW';
  return (
    <div className="border-accent/40 min-w-0 border-l-2 pl-3">
      <div className="grid min-w-0 gap-x-8 gap-y-4 lg:grid-cols-3">
        {/* ── What the job is ─────────────────────────────────────────────── */}
        <SubGroup title="Identity">
          <SubRow label="Work order name">
            <MonoId value={r.canonicalName} truncate />
          </SubRow>
          {r.provisionalName && r.provisionalName !== r.canonicalName && (
            <SubRow label="Previously" hint="Still searchable — people quote it in email.">
              <span className="text-fg-tertiary font-mono text-[11px]">{r.provisionalName}</span>
            </SubRow>
          )}
          {r.sourcingRef && (
            <SubRow label="RFQ / Sourcing ID">
              <MonoId value={r.sourcingRef} truncate />
            </SubRow>
          )}
          <SubRow label="Parts on this order">
            <span className="tnum">{r.lineCount}</span>
          </SubRow>
          <SubRow label="Delivery terms">{r.incoterms}</SubRow>
        </SubGroup>

        {/* ── What it is worth ────────────────────────────────────────────── */}
        <SubGroup title="Commercials">
          <SubRow label="Sell value" align="right">
            <Money amount={r.sellValue} />
          </SubRow>
          <SubRow label="Buy value" align="right">
            <Money amount={r.buyValue} />
          </SubRow>
          <SubRow label="Landed cost" align="right">
            <Money amount={r.landedCost} />
          </SubRow>
          <SubRow
            label="Recoverable taxes"
            hint="Excluded from landed cost — they come back as input credit."
            align="right"
          >
            <Money amount={r.creditableTaxes} />
          </SubRow>
          <SubRow label="True margin" align="right" emphasis>
            <span className="flex items-center justify-end gap-1.5">
              <Money amount={r.trueMargin} tone="auto" />
              <Pct value={r.trueMarginPct} tone="auto" className="text-[11px]" />
              {r.belowFloor && (
                <Chip tone="danger" size="sm">
                  Low
                </Chip>
              )}
            </span>
          </SubRow>
        </SubGroup>

        {/* ── Where it stands ─────────────────────────────────────────────── */}
        <SubGroup title="Position">
          <SubRow label="Stage">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="text-fg-tertiary font-mono text-[10.5px]">{r.stageCode}</span>
              <span className="truncate">{r.stageLabel}</span>
            </span>
          </SubRow>
          <SubRow label="Time in this stage" align="right">
            {r.status === 'CLOSED' ? (
              <span className="text-fg-tertiary">Closed</span>
            ) : (
              <span className={cn(r.slaStatus !== 'ON_TRACK' && 'text-warning')}>
                {humanDuration(r.hoursInStage)}
                <span className="text-fg-tertiary"> of {humanDuration(r.expectedHours)}</span>
              </span>
            )}
          </SubRow>
          <SubRow
            label="Held in escrow"
            hint={escrow ? undefined : 'This order is not paid through escrow.'}
            align="right"
          >
            {r.escrowHeld > 0 ? (
              <Money amount={r.escrowHeld} />
            ) : (
              <span className="text-fg-tertiary">
                {escrow ? 'Nothing held' : 'Not applicable'}
              </span>
            )}
          </SubRow>
          <SubRow label="Open items" align="right">
            {r.openTasks === 0 && r.unreadComms === 0 ? (
              <span className="text-fg-tertiary">None</span>
            ) : (
              <span className="flex items-center justify-end gap-1.5">
                {r.openTasks > 0 && (
                  <Chip size="sm" tone="neutral">
                    {r.openTasks} task{r.openTasks === 1 ? '' : 's'}
                  </Chip>
                )}
                {r.unreadComms > 0 && (
                  <Chip size="sm" tone="warning">
                    {r.unreadComms} unread
                  </Chip>
                )}
              </span>
            )}
          </SubRow>
        </SubGroup>
      </div>

      {/* A block is the most important thing about a row, so it spans the panel. */}
      {r.blockReason && (
        <div className="border-danger-border bg-danger-subtle mt-4 flex min-w-0 items-start gap-2 rounded-[8px] border px-3 py-2.5">
          <span className="text-danger mt-px shrink-0 text-[11px] font-semibold tracking-[0.04em] uppercase">
            Blocked
          </span>
          <span className="text-fg-secondary min-w-0 text-[12px] leading-relaxed">
            {r.blockReason}
          </span>
        </div>
      )}
    </div>
  );
}

/** One labelled cluster inside the expanded row. */
function SubGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0">
      <h3 className="text-fg-tertiary border-line-subtle mb-2 border-b pb-1.5 text-[10px] font-semibold tracking-[0.07em] uppercase">
        {title}
      </h3>
      <dl className="grid min-w-0 gap-1.5">{children}</dl>
    </section>
  );
}

/**
 * A label/value pair. Values sit in their own right-hand column so figures line
 * up vertically — the whole reason for a ladder rather than stacked blocks.
 */
function SubRow({
  label,
  hint,
  align = 'left',
  emphasis,
  children,
}: {
  label: string;
  hint?: string;
  align?: 'left' | 'right';
  emphasis?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3',
        emphasis && 'border-line-subtle mt-0.5 border-t pt-1.5',
      )}
    >
      <dt className="text-fg-tertiary min-w-0 text-[11.5px]" title={hint}>
        {label}
        {hint && <span className="text-fg-tertiary/60"> ⓘ</span>}
      </dt>
      <dd
        className={cn(
          'min-w-0 text-[12.5px]',
          emphasis ? 'text-fg font-semibold' : 'text-fg-secondary',
          align === 'right' && 'tnum text-right',
        )}
      >
        {children}
      </dd>
    </div>
  );
}

export { ClipboardList };
