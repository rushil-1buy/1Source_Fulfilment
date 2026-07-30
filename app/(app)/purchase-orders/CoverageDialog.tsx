'use client';

/**
 * What "part sourced" means on a given customer order, with the arithmetic.
 *
 * The status is derived from line allocations, so this shows those allocations:
 * ordered against covered against short, per line, naming the supplier order that
 * covers each part. A label nobody can check is worse than no label, and "why is
 * this partial" has to be answerable without opening the database.
 *
 * It also offers the two ways to close a gap, because being told about a shortfall
 * and then having to go and find the right screen is where the work stalls.
 */

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { CircleAlert, FilePlus2, Link2, ListChecks, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  getCustomerPoCoverage,
  linkSupplierPoToCustomerPo,
  type CustomerPoCoverage,
} from '@/lib/actions/work-order';
import { Button, SectionLabel } from '@/components/ui/Layout';
import { Chip } from '@/components/ui/Badges';
import { formatMoney } from '@/lib/domain/money';
import { cn } from '@/lib/utils';

const STATE_META = {
  NOT_SOURCED: { label: 'Not sourced', tone: 'neutral' as const },
  PARTLY_SOURCED: { label: 'Part sourced', tone: 'warning' as const },
  FULLY_SOURCED: { label: 'Fully sourced', tone: 'success' as const },
};

export function CoverageDialog({
  customerPoId,
  onOpenChange,
}: {
  customerPoId: string;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [data, setData] = useState<CustomerPoCoverage | null>(null);

  const load = () => {
    getCustomerPoCoverage(customerPoId).then((d) => d && setData(d));
  };
  useEffect(load, [customerPoId]);

  const money = (v: number, ccy = 'INR') => formatMoney(v, ccy, { withCode: true });

  const linkExisting = (supplierPoId: string) => {
    startTransition(async () => {
      const res = await linkSupplierPoToCustomerPo(supplierPoId, customerPoId);
      if (res.ok) {
        toast.success(res.message, { description: res.detail, duration: 10000 });
        load();
        router.refresh();
      } else {
        toast.error(res.message, { description: res.detail, duration: 12000 });
      }
    });
  };

  return (
    <Dialog.Root open onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px]" />
        <Dialog.Content className="bg-surface-1 border-line shadow-e4 fixed top-1/2 left-1/2 z-50 flex max-h-[92vh] w-[min(96vw,860px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[14px] border">
          <div className="border-line-subtle border-b px-5 py-3.5">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Dialog.Title className="text-fg min-w-0 text-[15px] font-semibold">
                <ListChecks className="mr-1.5 inline size-4 align-[-2px]" aria-hidden />
                Sourcing coverage · {data?.poNumber ?? '…'}
              </Dialog.Title>
              {data && (
                <Chip tone={STATE_META[data.state].tone} size="sm">
                  {STATE_META[data.state].label}
                  {data.state === 'PARTLY_SOURCED' && ` · ${Math.round(data.coveragePct)}%`}
                </Chip>
              )}
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="Close"
                  className="text-fg-tertiary hover:bg-surface-3 hover:text-fg ml-auto grid size-7 shrink-0 place-items-center rounded-[7px] transition-colors"
                >
                  <X className="size-4" strokeWidth={2} aria-hidden />
                </button>
              </Dialog.Close>
            </div>
            {data && (
              <Dialog.Description className="text-fg-secondary mt-1.5 text-[12.5px] leading-relaxed">
                {data.customer} · {money(data.totalValue, data.currency)}
              </Dialog.Description>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {!data ? (
              <p className="text-fg-tertiary text-[12.5px]">Working out the coverage…</p>
            ) : (
              <div className="grid min-w-0 grid-cols-1 gap-4">
                {/* Why it is what it is ─────────────────────────────────────── */}
                <div
                  className={cn(
                    'rounded-[9px] border px-3 py-2.5',
                    data.state === 'FULLY_SOURCED'
                      ? 'border-success-border bg-success-subtle'
                      : data.state === 'NOT_SOURCED'
                        ? 'border-line-subtle bg-surface-inset'
                        : 'border-warning-border bg-warning-subtle',
                  )}
                >
                  <SectionLabel>Why it reads this way</SectionLabel>
                  <p className="text-fg-secondary text-[12px] leading-relaxed">
                    {data.explanation}
                  </p>
                  <div className="text-fg-tertiary mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px]">
                    <span>
                      Ordered <span className="tnum text-fg">{data.orderedQty.toLocaleString('en-IN')}</span>
                    </span>
                    <span>
                      Covered{' '}
                      <span className="tnum text-fg">{data.allocatedQty.toLocaleString('en-IN')}</span>
                    </span>
                    <span>
                      Short{' '}
                      <span className={cn('tnum', data.shortfallQty > 0 ? 'text-warning' : 'text-fg')}>
                        {data.shortfallQty.toLocaleString('en-IN')}
                      </span>
                    </span>
                  </div>
                </div>

                {/* Line by line ────────────────────────────────────────────── */}
                <section className="min-w-0">
                  <SectionLabel>Line by line</SectionLabel>
                  <div className="border-line-subtle min-w-0 overflow-x-auto rounded-[9px] border">
                    <table className="w-full min-w-[620px] border-collapse text-left">
                      <thead>
                        <tr className="border-line-subtle bg-surface-2 border-b">
                          {[
                            ['Part', 'What the customer ordered'],
                            ['Ordered', 'Quantity on their order'],
                            ['Covered', 'Allocated to supplier orders'],
                            ['Short', 'Still to be bought'],
                            ['Covered by', 'Which supplier order accounts for it'],
                          ].map(([l, h]) => (
                            <th
                              key={l}
                              title={h}
                              className="text-fg-secondary px-3 py-2 text-[11px] font-semibold tracking-[0.03em] whitespace-nowrap uppercase"
                            >
                              {l}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-line-subtle divide-y">
                        {data.lines.map((l) => (
                          <tr key={l.customerPoLineId} className="align-top">
                            <td className="px-3 py-2">
                              <span className="text-fg block font-mono text-[11.5px]">{l.mpn}</span>
                              <span className="text-fg-tertiary block max-w-[min(34ch,100%)] text-[11px] leading-relaxed">
                                {l.description}
                              </span>
                            </td>
                            <td className="text-fg-secondary tnum px-3 py-2 text-[12px] whitespace-nowrap">
                              {l.orderedQty.toLocaleString('en-IN')} {l.uom}
                            </td>
                            <td className="tnum px-3 py-2 text-[12px] whitespace-nowrap">
                              <span className={l.allocatedQty === 0 ? 'text-fg-tertiary' : 'text-fg'}>
                                {l.allocatedQty.toLocaleString('en-IN')}
                              </span>
                            </td>
                            <td className="tnum px-3 py-2 text-[12px] whitespace-nowrap">
                              {l.shortfallQty === 0 ? (
                                <span className="text-success">None</span>
                              ) : (
                                <span className="text-warning font-semibold">
                                  {l.shortfallQty.toLocaleString('en-IN')}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {l.coveredBy.length === 0 ? (
                                <span className="text-fg-tertiary text-[11.5px]">
                                  Nothing bought yet
                                </span>
                              ) : (
                                <ul className="grid gap-0.5">
                                  {l.coveredBy.map((c, i) => (
                                    <li key={i} className="text-fg-secondary text-[11px]">
                                      <span className="font-mono">{c.supplierPoNumber}</span> ·{' '}
                                      {c.supplier} · {c.qty.toLocaleString('en-IN')}
                                      <span className="text-fg-tertiary"> ({c.workOrder})</span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                {/* Closing the gap ─────────────────────────────────────────── */}
                {data.shortfallQty > 0 && (
                  <section className="min-w-0">
                    <SectionLabel>Close the gap</SectionLabel>

                    {data.candidateSupplierPos.length > 0 ? (
                      <div className="border-line-subtle rounded-[9px] border">
                        <p className="text-fg-secondary border-line-subtle border-b px-3 py-2 text-[11.5px] leading-relaxed">
                          These supplier orders are already placed, carry a part this order still
                          needs, and are not yet allocated to anything. Linking one creates a work
                          order against this customer order.
                        </p>
                        <ul className="divide-line-subtle divide-y">
                          {data.candidateSupplierPos.map((c) => (
                            <li
                              key={c.id}
                              className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5"
                            >
                              <span className="min-w-0 flex-1">
                                <span className="text-fg block font-mono text-[12px]">
                                  {c.poNumber}
                                </span>
                                <span className="text-fg-tertiary block text-[11.5px]">
                                  {c.supplier} · {money(c.totalValue, c.currency)} ·{' '}
                                  {c.matchingParts} needed part{c.matchingParts === 1 ? '' : 's'}
                                </span>
                              </span>
                              <Button
                                variant="secondary"
                                size="sm"
                                icon={Link2}
                                disabled={pending}
                                onClick={() => linkExisting(c.id)}
                              >
                                Link this one
                              </Button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <p className="text-fg-tertiary border-line-subtle rounded-[9px] border px-3 py-2.5 text-[11.5px] leading-relaxed">
                        No unallocated supplier order carries the parts still needed, so the shortfall
                        has to be bought.
                      </p>
                    )}

                    <Button
                      variant="primary"
                      icon={FilePlus2}
                      className="mt-2.5"
                      onClick={() =>
                        router.push(`/create-po?mode=supplier&forCustomerPo=${data.id}`)
                      }
                    >
                      Raise a supplier order for the shortfall
                    </Button>
                    <p className="text-fg-tertiary mt-1 text-[11.5px] leading-relaxed">
                      Opens Create Purchase Order with this customer order already linked and the
                      short lines prefilled at the outstanding quantities.
                    </p>
                  </section>
                )}

                {/* Work orders already raised ─────────────────────────────── */}
                {data.workOrders.length > 0 && (
                  <section className="min-w-0">
                    <SectionLabel>Work orders on this customer order</SectionLabel>
                    <ul className="grid gap-1.5">
                      {data.workOrders.map((w) => (
                        <li key={w.id}>
                          <button
                            type="button"
                            onClick={() => router.push(`/orders/${w.id}`)}
                            className="border-line-subtle hover:bg-surface-3 flex w-full min-w-0 items-center gap-2 rounded-[8px] border px-3 py-2 text-left transition-colors"
                          >
                            <span className="text-fg font-mono text-[12px]">{w.alias}</span>
                            <span className="text-fg-tertiary min-w-0 flex-1 truncate text-[11.5px]">
                              {w.supplier}
                            </span>
                            <span className="text-accent-text shrink-0 text-[11.5px]">Open</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {data.state === 'NOT_SOURCED' && data.candidateSupplierPos.length === 0 && (
                  <div className="border-line-subtle flex items-start gap-2 rounded-[9px] border px-3 py-2.5">
                    <CircleAlert className="text-fg-tertiary mt-0.5 size-4 shrink-0" aria-hidden />
                    <span className="text-fg-secondary text-[11.5px] leading-relaxed">
                      Nothing has been bought against this order yet. Raise a supplier order to start
                      it — the button above prefills every line at its full quantity.
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="border-line-subtle flex flex-wrap justify-end gap-2 border-t px-5 py-3">
            <Dialog.Close asChild>
              <Button variant="secondary" icon={X}>
                Close
              </Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** The register's per-row control. */
export function CoverageButton({
  customerPoId,
  sourcing,
}: {
  customerPoId: string;
  sourcing: string;
}) {
  const [open, setOpen] = useState(false);
  const short = !sourcing.startsWith('Fully');
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        title="See exactly which lines are covered, and close any gap"
        className={cn(
          'inline-flex shrink-0 items-center gap-1.5 rounded-[7px] border px-2 py-1 text-[11.5px] whitespace-nowrap transition-colors',
          short
            ? 'border-accent-border bg-accent-subtle text-accent-text hover:bg-accent hover:text-accent-fg'
            : 'border-line-subtle text-fg-secondary hover:bg-surface-3 hover:text-fg',
        )}
      >
        <ListChecks className="size-3.5" strokeWidth={2} aria-hidden />
        {short ? 'Review & source' : 'Coverage'}
      </button>
      {open && (
        <CoverageDialog customerPoId={customerPoId} onOpenChange={(o) => !o && setOpen(false)} />
      )}
    </>
  );
}
