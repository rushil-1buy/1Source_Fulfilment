'use client';

/**
 * The pagination bar used under every table on the platform.
 *
 * Deliberately always visible, even on a single page of results. The audience
 * here includes people who distrust software: a control that disappears when it
 * has nothing to do reads as the page having lost a feature, and "Page 1 of 1"
 * is itself the reassurance that nothing is hidden below the fold.
 *
 * Three zones, left to right: how many rows to show, where you are, and a plain
 * statement of the position. No jargon, no icons without a label underneath.
 */

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface TablePaginationProps {
  /** Zero-based. */
  pageIndex: number;
  pageCount: number;
  pageSize: number;
  /** Rows after filtering — what "entries" counts. */
  totalRows: number;
  onPageChange: (index: number) => void;
  onPageSizeChange: (size: number) => void;
  pageSizeOptions?: number[];
  /** Plural noun for the rows, e.g. "orders", "invoices". */
  rowNoun?: string;
  className?: string;
}

/**
 * The window of page numbers to render. Always includes the first and last page
 * and the current page's immediate neighbours; everything else collapses to an
 * ellipsis so the bar never grows wider than its row.
 */
function pageWindow(current: number, total: number): (number | 'gap')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i);

  const out: (number | 'gap')[] = [0];
  const from = Math.max(1, current - 1);
  const to = Math.min(total - 2, current + 1);

  if (from > 1) out.push('gap');
  for (let i = from; i <= to; i++) out.push(i);
  if (to < total - 2) out.push('gap');
  out.push(total - 1);
  return out;
}

function StepButton({
  label,
  icon: Icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: typeof ChevronLeft;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        'grid size-7 shrink-0 place-items-center rounded-[7px] transition-colors',
        disabled
          ? 'text-fg-tertiary/40 cursor-not-allowed'
          : 'text-fg-secondary hover:bg-surface-3 hover:text-fg',
      )}
    >
      <Icon className="size-4" strokeWidth={2} aria-hidden />
    </button>
  );
}

export function TablePagination({
  pageIndex,
  pageCount,
  pageSize,
  totalRows,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
  rowNoun = 'entries',
  className,
}: TablePaginationProps) {
  // A table with no rows still shows the bar, reading "Page 1 of 1" — see above.
  const pages = Math.max(1, pageCount);
  const current = Math.min(pageIndex, pages - 1);
  const first = totalRows === 0 ? 0 : current * pageSize + 1;
  const last = Math.min((current + 1) * pageSize, totalRows);

  return (
    <div
      className={cn(
        'border-line-subtle mt-2.5 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2.5 border-t pt-3',
        className,
      )}
    >
      {/* ── How many rows ─────────────────────────────────────────────────── */}
      <label className="text-fg-secondary flex shrink-0 items-center gap-2 text-[12.5px]">
        Show
        <span className="relative inline-flex">
          <select
            value={pageSize}
            onChange={(e) => {
              onPageSizeChange(Number(e.target.value));
              onPageChange(0); // a new page size makes the old page number meaningless
            }}
            aria-label={`Number of ${rowNoun} to show on each page`}
            className={cn(
              'border-line text-fg bg-surface-1 tnum appearance-none rounded-full border',
              'py-1 pr-7 pl-3.5 text-[12.5px] font-medium',
              'hover:border-line-strong focus-visible:ring-accent/40 cursor-pointer transition-colors focus-visible:ring-2 focus-visible:outline-none',
            )}
          >
            {pageSizeOptions.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <ChevronRight
            className="text-fg-tertiary pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 rotate-90"
            strokeWidth={2}
            aria-hidden
          />
        </span>
        {rowNoun}
      </label>

      {/* ── Where you are ─────────────────────────────────────────────────── */}
      <nav
        className="mx-auto flex shrink-0 items-center gap-0.5"
        aria-label={`${rowNoun} pages`}
      >
        <StepButton
          label="First page"
          icon={ChevronsLeft}
          disabled={current === 0}
          onClick={() => onPageChange(0)}
        />
        <StepButton
          label="Previous page"
          icon={ChevronLeft}
          disabled={current === 0}
          onClick={() => onPageChange(current - 1)}
        />

        {pageWindow(current, pages).map((p, i) =>
          p === 'gap' ? (
            <span
              key={`gap-${i}`}
              className="text-fg-tertiary grid size-8 place-items-center text-[12.5px]"
              aria-hidden
            >
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => onPageChange(p)}
              aria-label={`Page ${p + 1}`}
              aria-current={p === current ? 'page' : undefined}
              className={cn(
                'tnum grid size-8 shrink-0 place-items-center rounded-full text-[12.5px] transition-colors',
                p === current
                  ? 'bg-fg text-surface-1 font-semibold'
                  : 'text-fg-secondary hover:bg-surface-3 hover:text-fg',
              )}
            >
              {p + 1}
            </button>
          ),
        )}

        <StepButton
          label="Next page"
          icon={ChevronRight}
          disabled={current >= pages - 1}
          onClick={() => onPageChange(current + 1)}
        />
        <StepButton
          label="Last page"
          icon={ChevronsRight}
          disabled={current >= pages - 1}
          onClick={() => onPageChange(pages - 1)}
        />
      </nav>

      {/* ── Plain statement of position ───────────────────────────────────── */}
      <div className="text-fg-secondary ml-auto shrink-0 text-[12.5px]">
        <span className="hidden sm:inline">
          {totalRows > 0 && (
            <>
              Showing{' '}
              <span className="tnum text-fg font-medium">
                {first}–{last}
              </span>{' '}
              of <span className="tnum text-fg font-medium">{totalRows}</span> ·{' '}
            </>
          )}
        </span>
        Page <span className="tnum text-fg font-medium">{current + 1}</span> of{' '}
        <span className="tnum text-fg font-medium">{pages}</span>
      </div>
    </div>
  );
}
