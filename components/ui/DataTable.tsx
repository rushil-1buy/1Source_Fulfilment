'use client';

/**
 * THE DATATABLE — master prompt §8.1.
 *
 * Every requirement in §8.1 is enforced structurally, so no screen can skip it:
 *  * Column headers go through <ColumnHeader>, which ALWAYS renders the
 *    visible-at-rest ⓘ with What / Why / Example content from the glossary.
 *    A column without a termKey or inline entry simply has no tooltip to show,
 *    but the affordance and the plumbing are never bypassed.
 *  * Sticky header, sortable columns, global search, per-column visibility,
 *    density toggle, CSV export of the CURRENT view, pagination.
 *  * Numbers right-aligned with tabular figures.
 *  * Full state coverage: loading skeleton, empty, no-results-after-filtering
 *    (with a clear-filters action), and error.
 *  * Never bleeds: the table scrolls inside its own container, and below `md`
 *    it becomes stacked cards instead.
 */

import { Fragment, useMemo, useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table';
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Download,
  Rows3,
  Search,
  X,
} from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { cn } from '@/lib/utils';
import { ColumnHeader } from './InfoTooltip';
import { Button, EmptyState, SkeletonRows } from './Layout';
import { TablePagination } from './TablePagination';
import { usePreferences } from '@/components/providers/Preferences';

/** Extra per-column configuration, read from `column.meta`. */
export interface DataColumnMeta {
  /** Glossary key driving the mandatory header tooltip. */
  termKey?: string;
  /** Plain English mode label. */
  plainLabel?: string;
  align?: 'left' | 'right' | 'center';
  /**
   * How the column appears in the mobile card layout.
   *  primary   — the card's headline
   *  secondary — the card's sub-headline
   *  meta      — a label/value row in the card body
   *  actions   — a control strip BELOW the card, outside its clickable area.
   *              Anything interactive must use this: the card itself is a
   *              button, and a button inside a button is invalid HTML.
   *  hidden    — omitted on mobile
   */
  mobile?: 'primary' | 'secondary' | 'meta' | 'actions' | 'hidden';
  /** Plain value for CSV export, when the cell renders rich content. */
  exportValue?: (row: unknown) => string | number | null | undefined;
  /** Fixed width, e.g. "120px". */
  width?: string;
}

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends unknown, TValue> extends DataColumnMeta {}
}

export interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  /** Stable id for a row, used for keys and row links. */
  getRowId?: (row: T) => string;
  onRowClick?: (row: T) => void;
  loading?: boolean;
  error?: string | null;
  /** Shown when there is genuinely no data at all. */
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  /** Placeholder for the search box. */
  searchPlaceholder?: string;
  /** File stem for the CSV export. */
  exportName?: string;
  /** Extra controls rendered in the toolbar, before the right-hand group. */
  toolbarExtra?: React.ReactNode;
  /**
   * The section's own create control, rendered alongside Columns, density and
   * CSV so every table's actions sit in one place.
   */
  primaryAction?: React.ReactNode;
  pageSize?: number;
  /** Plural noun for a row, used by the pagination bar: "Show 10 orders". */
  rowNoun?: string;
  /**
   * Columns hidden on first render. They stay searchable and exportable and can
   * be switched on from the Columns menu — useful for a reference nobody scans
   * but everybody occasionally searches.
   */
  initialColumnVisibility?: VisibilityState;
  className?: string;
  /** Renders under each row when expanded. */
  renderSubRow?: (row: T) => React.ReactNode;
}

export function DataTable<T>({
  columns,
  data,
  getRowId,
  onRowClick,
  loading,
  error,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  emptyAction,
  searchPlaceholder = 'Search…',
  exportName = 'export',
  toolbarExtra,
  primaryAction,
  pageSize = 10,
  rowNoun = 'entries',
  initialColumnVisibility,
  className,
  renderSubRow,
}: DataTableProps<T>) {
  const { density, setDensity, label: pick } = usePreferences();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
    initialColumnVisibility ?? {},
  );
  const [expanded, setExpanded] = useState<string | null>(null);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter, columnVisibility },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
    getRowId: getRowId ? (row) => getRowId(row) : undefined,
    globalFilterFn: 'includesString',
  });

  const rows = table.getRowModel().rows;
  const isFiltered = globalFilter.trim().length > 0;
  const compact = density === 'compact';

  const exportCsv = () => {
    const visible = table.getVisibleLeafColumns();
    const header = visible.map((c) => headerText(c.columnDef.header, c.id));
    const body = table.getFilteredRowModel().rows.map((r) =>
      visible.map((c) => {
        const meta = c.columnDef.meta;
        if (meta?.exportValue) return meta.exportValue(r.original);
        const v = r.getValue(c.id);
        return v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
      }),
    );
    const csv = [header, ...body]
      .map((line) => line.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${exportName}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Toolbar ───────────────────────────────────────────────────────────────
  const toolbar = (
    <div className="mb-2.5 flex min-w-0 flex-wrap items-center gap-2">
      <div className="relative min-w-0 flex-1 sm:max-w-[320px]">
        <Search
          className="text-fg-tertiary pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
          aria-hidden
        />
        <input
          type="search"
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className="bg-surface-1 border-line-subtle focus:border-accent text-fg placeholder:text-fg-tertiary w-full rounded-[8px] border py-1.5 pr-2.5 pl-8 text-[13px] outline-none"
        />
        {isFiltered && (
          <button
            type="button"
            onClick={() => setGlobalFilter('')}
            aria-label="Clear search"
            className="text-fg-tertiary hover:text-fg absolute top-1/2 right-2 -translate-y-1/2"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        )}
      </div>

      {toolbarExtra}

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {primaryAction}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button variant="secondary" size="sm" icon={Columns3}>
              <span className="hidden sm:inline">Columns</span>
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={6}
              className="bg-surface-2 border-line shadow-e3 z-50 max-h-[60vh] min-w-[200px] overflow-y-auto rounded-[10px] border p-1"
            >
              {table.getAllLeafColumns().map((col) => (
                <DropdownMenu.CheckboxItem
                  key={col.id}
                  checked={col.getIsVisible()}
                  onCheckedChange={(v) => col.toggleVisibility(Boolean(v))}
                  onSelect={(e) => e.preventDefault()}
                  className="text-fg-secondary data-highlighted:bg-surface-3 data-highlighted:text-fg flex cursor-pointer items-center gap-2 rounded-[7px] px-2 py-1.5 text-[13px] outline-none"
                >
                  <span
                    className={cn(
                      'grid size-3.5 place-items-center rounded-[3px] border',
                      col.getIsVisible()
                        ? 'bg-accent border-accent text-accent-fg'
                        : 'border-line-strong',
                    )}
                    aria-hidden
                  >
                    {col.getIsVisible() && <span className="text-[9px] leading-none">✓</span>}
                  </span>
                  {headerText(col.columnDef.header, col.id)}
                </DropdownMenu.CheckboxItem>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>

        <Button
          variant="secondary"
          size="sm"
          icon={Rows3}
          onClick={() => setDensity(compact ? 'comfortable' : 'compact')}
          title={compact ? 'Switch to comfortable rows' : 'Switch to compact rows'}
        >
          <span className="hidden sm:inline">{compact ? 'Comfortable' : 'Compact'}</span>
        </Button>

        <Button variant="secondary" size="sm" icon={Download} onClick={exportCsv}>
          <span className="hidden sm:inline">CSV</span>
        </Button>
      </div>
    </div>
  );

  // ── States ────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className={className}>
        {toolbar}
        <div className="bg-surface-1 border-line-subtle rounded-[12px] border">
          <EmptyState
            title="This did not load"
            description={error}
            action={
              <Button variant="secondary" onClick={() => window.location.reload()}>
                Try again
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={className}>
        {toolbar}
        <div className="bg-surface-1 border-line-subtle rounded-[12px] border p-4">
          <SkeletonRows rows={8} cols={Math.min(6, columns.length)} />
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className={className}>
        {toolbar}
        <div className="bg-surface-1 border-line-subtle rounded-[12px] border">
          <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />
        </div>
      </div>
    );
  }

  return (
    <div className={cn('min-w-0', className)}>
      {toolbar}

      <div className="bg-surface-1 border-line-subtle min-w-0 overflow-hidden rounded-[12px] border">
        {rows.length === 0 ? (
          <EmptyState
            title="No matches"
            description={`Nothing matches “${globalFilter}”. Try a different search, or clear it to see everything again.`}
            action={
              <Button variant="secondary" onClick={() => setGlobalFilter('')} icon={X}>
                Clear search
              </Button>
            }
          />
        ) : (
          <>
            {/* ── Table at md and up. Scrolls inside itself, never widens the page ── */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full border-collapse text-left">
                <thead className="bg-surface-1 sticky top-0 z-10">
                  {table.getHeaderGroups().map((hg) => (
                    <tr key={hg.id} className="border-line-subtle border-b">
                      {/* The expander leads and row actions trail — the usual
                          arrangement, and it leaves the last column free for the
                          controls that act on the row. */}
                      {renderSubRow && <th className="w-8" aria-label="Expand" />}
                      {hg.headers.map((header) => {
                        const meta = header.column.columnDef.meta;
                        const sorted = header.column.getIsSorted();
                        const canSort = header.column.getCanSort();
                        return (
                          <th
                            key={header.id}
                            scope="col"
                            style={meta?.width ? { width: meta.width } : undefined}
                            className={cn(
                              'text-fg-tertiary px-3 py-2 text-[11px] font-semibold tracking-[0.03em] whitespace-nowrap uppercase',
                              meta?.align === 'right' && 'text-right',
                              meta?.align === 'center' && 'text-center',
                            )}
                          >
                            <span
                              className={cn(
                                'inline-flex items-center gap-1',
                                meta?.align === 'right' && 'flex-row-reverse',
                              )}
                            >
                              <ColumnHeader
                                label={headerText(header.column.columnDef.header, header.column.id)}
                                plainLabel={meta?.plainLabel}
                                termKey={meta?.termKey}
                                align={meta?.align}
                              />
                              {canSort && (
                                <button
                                  type="button"
                                  onClick={header.column.getToggleSortingHandler()}
                                  aria-label={`Sort by ${headerText(
                                    header.column.columnDef.header,
                                    header.column.id,
                                  )}`}
                                  className={cn(
                                    'text-fg-tertiary hover:text-accent shrink-0 transition-opacity',
                                    sorted ? 'text-accent opacity-100' : 'opacity-35 hover:opacity-100',
                                  )}
                                >
                                  {sorted === 'desc' ? (
                                    <ArrowDown className="size-3" strokeWidth={2.4} aria-hidden />
                                  ) : (
                                    <ArrowUp className="size-3" strokeWidth={2.4} aria-hidden />
                                  )}
                                </button>
                              )}
                            </span>
                          </th>
                        );
                      })}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const isOpen = expanded === row.id;
                    return (
                      // The key belongs on the Fragment, since a row may render
                      // two sibling <tr>s (the row plus its expanded detail).
                      <Fragment key={row.id}>
                        <tr
                          onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                          className={cn(
                            'border-line-subtle border-b last:border-0 transition-colors',
                            isOpen && 'bg-surface-inset/60',
                            onRowClick && 'hover:bg-surface-3 cursor-pointer',
                          )}
                        >
                          {renderSubRow && (
                            <td className="pl-2">
                              {/* A real control, not a bare glyph: a hit target with
                                  a hover surface, and it takes the accent colour
                                  while open so the row and the panel below it read
                                  as one thing. */}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpanded(isOpen ? null : row.id);
                                }}
                                aria-label={isOpen ? 'Hide details' : 'Show details'}
                                aria-expanded={isOpen}
                                className={cn(
                                  'grid size-6 place-items-center rounded-[6px] border transition-colors',
                                  isOpen
                                    ? 'border-accent-border bg-accent-subtle text-accent-text'
                                    : 'text-fg-tertiary hover:bg-surface-3 hover:text-fg border-transparent',
                                )}
                              >
                                <ChevronRight
                                  className={cn(
                                    'size-3.5 transition-transform duration-150',
                                    isOpen && 'rotate-90',
                                  )}
                                  strokeWidth={2.4}
                                  aria-hidden
                                />
                              </button>
                            </td>
                          )}
                          {row.getVisibleCells().map((cell) => {
                            const meta = cell.column.columnDef.meta;
                            return (
                              <td
                                key={cell.id}
                                className={cn(
                                  'px-3 align-middle text-[12.5px]',
                                  compact ? 'py-1.5' : 'py-2.5',
                                  meta?.align === 'right' && 'tnum text-right',
                                  meta?.align === 'center' && 'text-center',
                                )}
                              >
                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                              </td>
                            );
                          })}
                        </tr>
                        {renderSubRow && isOpen && (
                          <tr className="border-line-subtle border-b">
                            <td
                              colSpan={row.getVisibleCells().length + 1}
                              className="bg-surface-inset border-line-subtle border-t px-4 py-4"
                            >
                              {renderSubRow(row.original)}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* ── Stacked cards below md (§8.1) ── */}
            <ul className="divide-line-subtle divide-y md:hidden">
              {rows.map((row) => {
                const cells = row.getVisibleCells();
                const byMobile = (kind: DataColumnMeta['mobile']) =>
                  cells.filter((c) => c.column.columnDef.meta?.mobile === kind);
                const primary = byMobile('primary');
                const secondary = byMobile('secondary');
                const metaCells = byMobile('meta');
                // If a table declares no mobile hints, fall back to the first
                // column as the headline and the next three as meta rows.
                const hasHints = primary.length + secondary.length + metaCells.length > 0;
                const headline = hasHints ? primary : cells.slice(0, 1);
                const subline = hasHints ? secondary : cells.slice(1, 2);
                const details = hasHints ? metaCells : cells.slice(2, 6);
                const actions = byMobile('actions');

                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                      className={cn(
                        'w-full px-3 py-3 text-left',
                        onRowClick && 'active:bg-surface-3',
                      )}
                    >
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        {headline.map((c) => (
                          <span key={c.id} className="min-w-0 text-[13px] font-semibold">
                            {flexRender(c.column.columnDef.cell, c.getContext())}
                          </span>
                        ))}
                      </div>
                      {subline.length > 0 && (
                        <div className="text-fg-secondary mt-1 flex flex-wrap items-center gap-2 text-[12px]">
                          {subline.map((c) => (
                            <span key={c.id} className="min-w-0">
                              {flexRender(c.column.columnDef.cell, c.getContext())}
                            </span>
                          ))}
                        </div>
                      )}
                      {details.length > 0 && (
                        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
                          {details.map((c) => (
                            <div key={c.id} className="min-w-0">
                              <dt className="text-fg-tertiary text-[9.5px] tracking-[0.04em] uppercase">
                                {pick(
                                  headerText(c.column.columnDef.header, c.column.id),
                                  c.column.columnDef.meta?.plainLabel,
                                )}
                              </dt>
                              <dd className="text-fg-secondary truncate text-[12px]">
                                {flexRender(c.column.columnDef.cell, c.getContext())}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      )}
                    </button>
                    {/* Outside the card's button, so nested interactive elements
                        are impossible by construction. */}
                    {actions.length > 0 && (
                      <div className="flex flex-wrap items-center justify-end gap-2 px-3 pb-3">
                        {actions.map((c) => (
                          <span key={c.id} className="min-w-0">
                            {flexRender(c.column.columnDef.cell, c.getContext())}
                          </span>
                        ))}
                      </div>
                    )}
                    {renderSubRow && (
                      <div className="border-line-subtle bg-surface-inset border-t px-3 py-2.5">
                        {renderSubRow(row.original)}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      {/* ── Pagination ──
          Shown whenever the table has rows, not only when it spills onto a second
          page. See TablePagination for why "Page 1 of 1" is worth stating. */}
      {rows.length > 0 && (
        <TablePagination
          pageIndex={table.getState().pagination.pageIndex}
          pageCount={table.getPageCount()}
          pageSize={table.getState().pagination.pageSize}
          totalRows={table.getFilteredRowModel().rows.length}
          onPageChange={(i) => table.setPageIndex(i)}
          onPageSizeChange={(n) => table.setPageSize(n)}
          rowNoun={rowNoun}
        />
      )}
    </div>
  );
}

/** Header definitions may be strings or renderers; CSV and menus need text. */
function headerText(header: unknown, fallback: string): string {
  if (typeof header === 'string') return header;
  return fallback;
}
