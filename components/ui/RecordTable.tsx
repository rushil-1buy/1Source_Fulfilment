'use client';

/**
 * A tabular renderer driven entirely by a SERIALIZABLE column spec.
 *
 * Server pages describe their columns as data — no render functions — so every
 * list screen gets the §8.1 guarantees (visible-at-rest tooltip headers, search,
 * sorting, density, CSV export, designed empty states, stacked cards on mobile)
 * without each page hand-rolling a client component and risking omissions.
 */

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from './DataTable';
import { CoverageButton } from '@/app/(app)/purchase-orders/CoverageDialog';
import { Chip, ProvenanceBadge, StakeholderBadge, StatusChip } from './Badges';
import { Money, MonoId, Pct } from './Layout';
import type { Stakeholder } from '@/lib/domain/enums';
import { formatDate, formatDateTime } from '@/lib/utils';

export type CellKind =
  | 'text'
  | 'mono'
  | 'money'
  | 'number'
  | 'pct'
  | 'date'
  | 'datetime'
  | 'status'
  | 'chip'
  | 'stakeholder'
  | 'provenance'
  | 'boolean';

export interface ColumnSpec {
  key: string;
  label: string;
  /** Glossary key driving the mandatory header tooltip. */
  termKey?: string;
  plainLabel?: string;
  kind?: CellKind;
  /**
   * Renders a control instead of a value. Named rather than a function because
   * the spec crosses the server-to-client boundary and a function cannot.
   * The row supplies whatever the control needs.
   */
  action?: 'customerPoCoverage';
  align?: 'left' | 'right' | 'center';
  width?: string;
  mobile?: 'primary' | 'secondary' | 'meta' | 'actions' | 'hidden';
  /** For money columns: which row key holds the currency. Defaults to INR. */
  currencyKey?: string;
  /** Shown instead of an empty value. */
  empty?: string;
}

export type RecordRow = Record<string, unknown> & { id: string; href?: string };

function renderCell(spec: ColumnSpec, row: RecordRow) {
  if (spec.action === 'customerPoCoverage') {
    return <CoverageButton customerPoId={String(row.id)} sourcing={String(row.sourcing ?? '')} />;
  }
  const value = row[spec.key];
  const empty = spec.empty ?? '—';
  if (value === null || value === undefined || value === '') {
    return <span className="text-fg-tertiary">{empty}</span>;
  }

  switch (spec.kind) {
    case 'mono':
      return <MonoId value={String(value)} copyable={false} truncate />;
    case 'money': {
      const currency = (spec.currencyKey ? (row[spec.currencyKey] as string) : 'INR') || 'INR';
      return <Money amount={Number(value)} currency={currency} />;
    }
    case 'number':
      return <span className="tnum">{Number(value).toLocaleString('en-IN')}</span>;
    case 'pct':
      return <Pct value={Number(value)} tone="auto" />;
    case 'date':
      return <span className="tnum whitespace-nowrap">{formatDate(String(value))}</span>;
    case 'datetime':
      return <span className="tnum whitespace-nowrap">{formatDateTime(String(value))}</span>;
    case 'status':
      return <StatusChip status={String(value)} size="sm" />;
    case 'chip':
      return <Chip size="sm">{String(value)}</Chip>;
    case 'stakeholder':
      return <StakeholderBadge stakeholder={String(value) as Stakeholder} />;
    case 'provenance':
      return <ProvenanceBadge provenance={String(value)} />;
    case 'boolean':
      return value ? (
        <Chip tone="success" size="sm">
          Yes
        </Chip>
      ) : (
        <span className="text-fg-tertiary">No</span>
      );
    default:
      return <span className="block truncate">{String(value)}</span>;
  }
}

export function RecordTable({
  columns,
  rows,
  searchPlaceholder,
  exportName,
  emptyTitle,
  emptyDescription,
  pageSize,
  rowNoun,
  primaryAction,
  onRowClick,
}: {
  columns: ColumnSpec[];
  rows: RecordRow[];
  searchPlaceholder?: string;
  exportName?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  pageSize?: number;
  /** Plural noun for a row, so the pagination bar reads "Show 10 invoices". */
  rowNoun?: string;
  /** Create control, rendered in the toolbar's right-hand group. */
  primaryAction?: React.ReactNode;
  /**
   * Overrides the default href navigation when a row is clicked.
   *
   * For rows that open something in place — a document viewer, a drawer —
   * rather than navigating away. When set, `href` on the rows is ignored.
   */
  onRowClick?: (row: RecordRow) => void;
}) {
  const router = useRouter();

  const tableColumns = useMemo<ColumnDef<RecordRow, unknown>[]>(
    () =>
      columns.map((spec) => ({
        id: spec.key,
        accessorFn: (row) => row[spec.key],
        header: spec.label,
        meta: {
          termKey: spec.termKey,
          plainLabel: spec.plainLabel,
          align: spec.align ?? (['money', 'number', 'pct'].includes(spec.kind ?? '') ? 'right' : 'left'),
          width: spec.width,
          mobile: spec.mobile,
          exportValue: (row: unknown) => {
            const v = (row as RecordRow)[spec.key];
            if (v === null || v === undefined) return '';
            if (spec.kind === 'money') return Number(v) / 100;
            return String(v);
          },
        },
        cell: ({ row }) => renderCell(spec, row.original),
      })),
    [columns],
  );

  return (
    <DataTable
      columns={tableColumns}
      data={rows}
      getRowId={(r) => r.id}
      onRowClick={
        onRowClick ?? (rows.some((r) => r.href) ? (r) => r.href && router.push(r.href) : undefined)
      }
      searchPlaceholder={searchPlaceholder ?? 'Search…'}
      exportName={exportName ?? 'export'}
      emptyTitle={emptyTitle ?? 'Nothing here yet'}
      emptyDescription={emptyDescription}
      pageSize={pageSize ?? 10}
      rowNoun={rowNoun ?? 'entries'}
      primaryAction={primaryAction}
    />
  );
}
