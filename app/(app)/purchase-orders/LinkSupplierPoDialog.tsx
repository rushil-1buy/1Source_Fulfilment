'use client';

/**
 * Claiming a supplier order for one or more customer orders.
 *
 * For stock bought ahead of demand: the order goes out first and the customer
 * orders arrive later — sometimes several of them, each wanting part of the same
 * shipment. Linking is what creates the work orders, so this is not an edit; it is
 * the moment the jobs come into existence.
 *
 * The centre of the dialog is an allocation matrix — supplier lines down the side,
 * chosen customer orders across the top, quantities in the cells. That shape is
 * not decoration: "who gets how many of what" is a two-dimensional question, and
 * any other layout makes the reader hold one axis in their head.
 *
 * Every cell is editable and every column totals, so an over-allocation shows up
 * in the table before the server ever has to refuse it.
 */

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import * as Dialog from '@radix-ui/react-dialog';
import { CircleAlert, Link2, TriangleAlert, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  getLinkPreview,
  linkSupplierPoToCustomerPos,
  type LinkPreview,
} from '@/lib/actions/work-order';
import {
  allocationIsValid,
  planAllocation,
  type ClaimingCustomerPo,
  type SupplierLineAvail,
} from '@/lib/domain/allocate';
import { Button, SectionLabel } from '@/components/ui/Layout';
import { Chip } from '@/components/ui/Badges';
import { formatMoney } from '@/lib/domain/money';
import { cn, formatDate } from '@/lib/utils';

const input =
  'bg-surface-1 border-line-subtle focus:border-accent text-fg w-full rounded-[7px] border px-2 py-1 text-[12px] outline-none';

export function LinkSupplierPoDialog({
  supplierPoId,
  onOpenChange,
}: {
  supplierPoId: string;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [data, setData] = useState<LinkPreview | null>(null);
  /** Chosen customer orders, in the order picked — which is allocation order. */
  const [chosen, setChosen] = useState<string[]>([]);
  const [piByPo, setPiByPo] = useState<Record<string, string>>({});
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');

  useEffect(() => {
    let live = true;
    getLinkPreview(supplierPoId).then((d) => {
      if (!live || !d) return;
      setData(d);
      // Pre-select the best part-number overlap: the order this stock was almost
      // certainly bought for. Shown rather than assumed, and removable.
      const best = d.candidates.find((c) => c.matchingParts > 0);
      if (best) setChosen([best.id]);
    });
    return () => {
      live = false;
    };
  }, [supplierPoId]);

  const supplierLines: SupplierLineAvail[] = useMemo(
    () => data?.supplierPo.lineAvailability ?? [],
    [data],
  );

  const claiming: ClaimingCustomerPo[] = useMemo(() => {
    if (!data) return [];
    return chosen
      .map((id) => data.candidates.find((c) => c.id === id))
      .filter((c): c is NonNullable<typeof c> => Boolean(c))
      .map((c) => ({
        customerPoId: c.id,
        poNumber: c.poNumber,
        customer: c.customer,
        poDate: c.poDate,
        requestedDate: c.requestedDate,
        lines: c.lines,
      }));
  }, [data, chosen]);

  const plan = useMemo(
    () => planAllocation(supplierLines, claiming, overrides),
    [supplierLines, claiming, overrides],
  );
  const willCreate = plan.perCustomer.filter((c) => c.units > 0).length;
  const valid = allocationIsValid(plan) && chosen.length > 0;
  const blocking = plan.problems.filter((p) => p.severity === 'BLOCKING');
  const warnings = plan.problems.filter((p) => p.severity === 'WARNING');

  const toggle = (id: string) => {
    setChosen((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    // Overrides are keyed by customer order, so a stale one would silently
    // reappear if that order were removed and re-added.
    setOverrides((prev) => {
      const next: Record<string, number> = {};
      for (const [k, v] of Object.entries(prev)) if (!k.startsWith(`${id}:`)) next[k] = v;
      return next;
    });
  };

  const submit = () => {
    startTransition(async () => {
      const res = await linkSupplierPoToCustomerPos({
        supplierPoId,
        allocations: plan.rows.flatMap((r) =>
          r.cells
            .filter((c) => c.quantity > 0)
            .map((c) => ({
              customerPoId: c.customerPoId,
              customerPoLineId: c.customerPoLineId,
              supplierPoLineId: c.supplierPoLineId,
              quantity: c.quantity,
            })),
        ),
        customerPiByPo: piByPo,
        reason: reason.trim() || undefined,
      });
      if (res.ok) {
        toast.success(res.message, { description: res.detail, duration: 15000 });
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(res.message, { description: res.detail, duration: 13000 });
      }
    });
  };

  const spo = data?.supplierPo;

  return (
    <Dialog.Root open onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px]" />
        <Dialog.Content className="bg-surface-1 border-line shadow-e4 fixed top-1/2 left-1/2 z-50 flex max-h-[92vh] w-[min(97vw,1140px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[14px] border">
          <div className="border-line-subtle border-b px-5 py-3.5">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Dialog.Title className="text-fg min-w-0 text-[15px] font-semibold">
                <Link2 className="mr-1.5 inline size-4 align-[-2px]" aria-hidden />
                Link {spo?.poNumber ?? 'this order'} to customer orders
              </Dialog.Title>
              {spo && (
                <Chip tone="neutral" size="sm">
                  {spo.supplier}
                </Chip>
              )}
              {spo && spo.linkedWorkOrders.length > 0 && (
                <Chip tone="info" size="sm">
                  Already on {spo.linkedWorkOrders.length} work order
                  {spo.linkedWorkOrders.length === 1 ? '' : 's'}
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
            <Dialog.Description className="text-fg-secondary mt-1.5 text-[12.5px] leading-relaxed">
              Pick every customer order this stock is for. Each one gets its own work order against
              the shared supplier order — quotes, invoices and deliveries stay separate; only the
              buying was combined.
            </Dialog.Description>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {!data ? (
              <p className="text-fg-tertiary text-[12.5px]">Loading the order…</p>
            ) : (
              <div className="grid gap-4">
                {spo!.linkedWorkOrders.length > 0 && (
                  <div className="border-info/40 bg-info-subtle rounded-[9px] border px-3 py-2.5">
                    <SectionLabel>Already claimed</SectionLabel>
                    <p className="text-fg-secondary text-[12px] leading-relaxed">
                      Part of this order is spoken for. The quantities below already have those
                      allocations taken off, so only what is genuinely left can be claimed.
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {spo!.linkedWorkOrders.map((w) => (
                        <span
                          key={w.alias}
                          className="border-line-subtle bg-surface-1 text-fg-secondary rounded-[6px] border px-1.5 py-[1px] font-mono text-[10.5px]"
                        >
                          {w.alias} · {w.customerPoNumber}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── Which customer orders ────────────────────────────────── */}
                <section className="min-w-0">
                  <SectionLabel>
                    Customer orders claiming this stock — {chosen.length} chosen
                  </SectionLabel>
                  <div className="border-line-subtle min-w-0 overflow-x-auto rounded-[9px] border">
                    <table className="w-full min-w-[880px] border-collapse text-left">
                      <thead className="bg-surface-inset">
                        <tr className="border-line-subtle border-b">
                          <Th width="52px" />
                          <Th>Their order</Th>
                          <Th>Customer</Th>
                          <Th width="104px">Ordered</Th>
                          <Th width="104px">Wanted by</Th>
                          <Th width="118px" align="right">
                            Matching parts
                          </Th>
                          <Th width="120px" align="right">
                            Still needs
                          </Th>
                          <Th width="164px">Their quote to use</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.candidates.slice(0, 40).map((c) => {
                          const on = chosen.includes(c.id);
                          const order = chosen.indexOf(c.id) + 1;
                          return (
                            <tr
                              key={c.id}
                              className={cn(
                                'border-line-subtle border-b last:border-0',
                                on && 'bg-accent-subtle/50',
                              )}
                            >
                              <td className="px-3 py-2">
                                <label className="flex cursor-pointer items-center gap-1.5">
                                  <input
                                    type="checkbox"
                                    checked={on}
                                    onChange={() => toggle(c.id)}
                                    className="accent-accent size-3.5"
                                    aria-label={`Include ${c.poNumber}`}
                                  />
                                  {on && (
                                    <span className="text-accent-text tnum text-[10.5px] font-semibold">
                                      {order}
                                    </span>
                                  )}
                                </label>
                              </td>
                              <td className="px-3 py-2">
                                <span className="text-fg font-mono text-[12px]">{c.poNumber}</span>
                                {c.workOrders.length > 0 && (
                                  <span className="text-fg-tertiary block text-[10.5px]">
                                    on {c.workOrders.join(', ')}
                                  </span>
                                )}
                              </td>
                              <td className="text-fg-secondary max-w-[190px] truncate px-3 py-2 text-[12px]">
                                {c.customer}
                              </td>
                              <td className="text-fg-secondary px-3 py-2 text-[11.5px] whitespace-nowrap">
                                {formatDate(c.poDate)}
                              </td>
                              <td className="text-fg-secondary px-3 py-2 text-[11.5px] whitespace-nowrap">
                                {c.requestedDate ? formatDate(c.requestedDate) : '—'}
                              </td>
                              <td className="px-3 py-2 text-right">
                                {c.matchingParts > 0 ? (
                                  <Chip tone={on ? 'accent' : 'success'} size="sm">
                                    {c.matchingParts} match{c.matchingParts === 1 ? '' : 'es'}
                                  </Chip>
                                ) : (
                                  <span className="text-fg-tertiary text-[11px]">none</span>
                                )}
                              </td>
                              <td className="tnum px-3 py-2 text-right text-[12px]">
                                {c.outstandingOnMatchingParts > 0 ? (
                                  <span className="text-fg">
                                    {c.outstandingOnMatchingParts.toLocaleString('en-IN')}
                                  </span>
                                ) : (
                                  <span className="text-fg-tertiary text-[11px]">nothing</span>
                                )}
                              </td>
                              <td className="px-3 py-2">
                                {c.customerPis.length === 0 ? (
                                  <span className="text-fg-tertiary text-[11px]">
                                    No quote yet — the name completes later
                                  </span>
                                ) : (
                                  <select
                                    value={piByPo[c.id] ?? c.customerPis[0].id}
                                    disabled={!on}
                                    aria-label={`Quote to use for ${c.poNumber}`}
                                    onChange={(e) =>
                                      setPiByPo((p) => ({ ...p, [c.id]: e.target.value }))
                                    }
                                    className={cn(input, 'font-mono text-[11px]')}
                                  >
                                    {c.customerPis.map((pi) => (
                                      <option key={pi.id} value={pi.id}>
                                        {pi.piNumber}
                                      </option>
                                    ))}
                                  </select>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-fg-tertiary mt-1.5 text-[11px] leading-relaxed">
                    Ranked by parts that overlap AND still need something — an order with a
                    matching part number but nothing outstanding is not a candidate. The number
                    beside a tick is allocation order: the first chosen order is filled first.
                  </p>
                </section>

                {/* ── The allocation matrix ────────────────────────────────── */}
                {chosen.length > 0 && (
                  <section className="min-w-0">
                    <SectionLabel>How the stock splits — every quantity is editable</SectionLabel>
                    <div className="border-line-subtle min-w-0 overflow-x-auto rounded-[9px] border">
                      <table className="w-full border-collapse text-left">
                        <thead className="bg-surface-inset">
                          <tr className="border-line-subtle border-b">
                            <Th width="196px">Part</Th>
                            <Th width="104px" align="right">
                              On this order
                            </Th>
                            {claiming.map((c) => (
                              <Th key={c.customerPoId} width="126px" align="right">
                                {c.poNumber}
                              </Th>
                            ))}
                            <Th width="104px" align="right">
                              Allocated
                            </Th>
                            <Th width="112px" align="right">
                              Left over
                            </Th>
                          </tr>
                        </thead>
                        <tbody>
                          {plan.rows.map((r) => (
                            <tr
                              key={r.supplierPoLineId}
                              className="border-line-subtle border-b last:border-0"
                            >
                              <td className="px-3 py-2 align-top">
                                <div className="text-fg font-mono text-[12px] font-medium">
                                  {r.mpn}
                                </div>
                                <div className="text-fg-tertiary truncate text-[10.5px]">
                                  {r.manufacturer}
                                </div>
                              </td>
                              <td className="tnum text-fg-secondary px-3 py-2 text-right align-top text-[12px]">
                                {r.supplierQty.toLocaleString('en-IN')}
                              </td>
                              {claiming.map((c) => {
                                const cell = r.cells.find((x) => x.customerPoId === c.customerPoId);
                                if (!cell) {
                                  return (
                                    <td
                                      key={c.customerPoId}
                                      className="text-fg-tertiary px-3 py-2 text-right align-top text-[11px]"
                                      title="This customer order does not include this part"
                                    >
                                      —
                                    </td>
                                  );
                                }
                                const key = `${c.customerPoId}:${r.supplierPoLineId}`;
                                return (
                                  <td key={c.customerPoId} className="px-3 py-2 align-top">
                                    <input
                                      type="number"
                                      min={0}
                                      value={cell.quantity || ''}
                                      placeholder="0"
                                      aria-label={`${r.mpn} allocated to ${c.poNumber}`}
                                      onChange={(e) =>
                                        setOverrides((o) => ({
                                          ...o,
                                          [key]: Number(e.target.value),
                                        }))
                                      }
                                      className={cn(
                                        input,
                                        'tnum text-right',
                                        r.overAllocatedQty > 0 && 'border-danger',
                                      )}
                                    />
                                    <span className="text-fg-tertiary mt-0.5 block text-right text-[10px]">
                                      up to {cell.maxQuantity.toLocaleString('en-IN')}
                                    </span>
                                  </td>
                                );
                              })}
                              <td
                                className={cn(
                                  'tnum px-3 py-2 text-right align-top text-[12px] font-medium',
                                  r.overAllocatedQty > 0 ? 'text-danger' : 'text-fg',
                                )}
                              >
                                {r.allocatedQty.toLocaleString('en-IN')}
                              </td>
                              <td className="tnum px-3 py-2 text-right align-top text-[12px]">
                                {r.overAllocatedQty > 0 ? (
                                  <span className="text-danger">
                                    +{r.overAllocatedQty.toLocaleString('en-IN')} over
                                  </span>
                                ) : r.unallocatedQty > 0 ? (
                                  <span className="text-warning">
                                    {r.unallocatedQty.toLocaleString('en-IN')}
                                  </span>
                                ) : (
                                  <span className="text-success">0</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="bg-surface-inset">
                          <tr className="border-line-subtle border-t">
                            <td className="text-fg px-3 py-2 text-[12px] font-semibold">Units</td>
                            <td className="tnum text-fg-tertiary px-3 py-2 text-right text-[12px]">
                              {supplierLines
                                .reduce((a, l) => a + l.availableQty, 0)
                                .toLocaleString('en-IN')}
                            </td>
                            {plan.perCustomer.map((c) => (
                              <td
                                key={c.customerPoId}
                                className="tnum text-fg px-3 py-2 text-right text-[12px] font-semibold"
                              >
                                {c.units.toLocaleString('en-IN')}
                              </td>
                            ))}
                            <td className="tnum text-fg px-3 py-2 text-right text-[12px] font-semibold">
                              {plan.totalUnits.toLocaleString('en-IN')}
                            </td>
                            <td className="tnum px-3 py-2 text-right text-[12px]">
                              {plan.unallocatedUnits.toLocaleString('en-IN')}
                            </td>
                          </tr>
                          <tr className="border-line-subtle border-t">
                            <td className="text-fg-secondary px-3 py-2 text-[12px]">
                              Value to the customer
                            </td>
                            <td className="tnum text-fg-tertiary px-3 py-2 text-right text-[12px]">
                              {spo ? formatMoney(spo.totalValue, spo.currency) : '—'}
                            </td>
                            {plan.perCustomer.map((c) => (
                              <td
                                key={c.customerPoId}
                                className="tnum px-3 py-2 text-right text-[12px]"
                              >
                                {formatMoney(c.sellValue, 'INR')}
                              </td>
                            ))}
                            <td className="tnum text-fg px-3 py-2 text-right text-[12px] font-semibold">
                              {formatMoney(plan.totalSellValue, 'INR')}
                            </td>
                            <td />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </section>
                )}

                {/* ── What each customer would still be short ──────────────── */}
                {plan.perCustomer.some((c) => c.stillShortLines.length > 0) && (
                  <section className="min-w-0">
                    <SectionLabel>Still short after this link</SectionLabel>
                    <div className="border-line-subtle min-w-0 overflow-x-auto rounded-[9px] border">
                      <table className="w-full min-w-[420px] border-collapse text-left">
                        <thead className="bg-surface-inset">
                          <tr className="border-line-subtle border-b">
                            <Th width="170px">Their order</Th>
                            <Th>Outstanding after this</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {plan.perCustomer
                            .filter((c) => c.stillShortLines.length > 0)
                            .map((c) => (
                              <tr
                                key={c.customerPoId}
                                className="border-line-subtle border-b last:border-0"
                              >
                                <td className="text-fg px-3 py-1.5 font-mono text-[11.5px]">
                                  {c.poNumber}
                                </td>
                                <td className="text-fg-secondary px-3 py-1.5 text-[11.5px]">
                                  {c.stillShortLines
                                    .map(
                                      (sh) =>
                                        `${sh.mpn} short ${sh.shortQty.toLocaleString('en-IN')}`,
                                    )
                                    .join(' · ')}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-fg-tertiary mt-1.5 text-[11px] leading-relaxed">
                      Normal — this order simply does not hold enough. The shortfall stays visible on
                      each customer order&rsquo;s sourcing view so it can be bought separately.
                    </p>
                  </section>
                )}

                {/* ── Problems ─────────────────────────────────────────────── */}
                {(blocking.length > 0 || warnings.length > 0) && (
                  <div className="grid gap-2">
                    {blocking.map((p, i) => (
                      <div
                        key={`b${i}`}
                        className="border-danger/40 bg-danger-subtle rounded-[8px] border px-3 py-2"
                      >
                        <div className="text-danger flex items-start gap-1.5 text-[12px] font-semibold">
                          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
                          {p.message}
                        </div>
                        {p.detail && (
                          <p className="text-fg-secondary mt-1 text-[11.5px] leading-relaxed">
                            {p.detail}
                          </p>
                        )}
                      </div>
                    ))}
                    {warnings.map((p, i) => (
                      <div
                        key={`w${i}`}
                        className="border-warning/40 bg-warning-subtle rounded-[8px] border px-3 py-2"
                      >
                        <div className="text-warning flex items-start gap-1.5 text-[12px] font-semibold">
                          <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
                          {p.message}
                        </div>
                        {p.detail && (
                          <p className="text-fg-secondary mt-1 text-[11.5px] leading-relaxed">
                            {p.detail}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <label className="block min-w-0">
                  <span className="text-fg-secondary mb-1 block text-[11.5px] font-medium">
                    Why this stock is going to these orders{' '}
                    <span className="text-fg-tertiary font-normal">(optional)</span>
                  </span>
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. Bought ahead on a price break; these three orders arrived for it in the same week."
                    className={cn(input, 'py-1.5 text-[13px]')}
                  />
                  <span className="text-fg-tertiary mt-1 block text-[11px] leading-relaxed">
                    Written to the audit log on every work order this creates. A default is used if
                    left blank.
                  </span>
                </label>
              </div>
            )}
          </div>

          <div className="border-line-subtle flex flex-wrap items-center gap-2 border-t px-5 py-3">
            <span className="text-fg-tertiary mr-auto text-[11.5px]">
              {chosen.length === 0
                ? 'Pick at least one customer order'
                : `${plan.totalUnits.toLocaleString('en-IN')} units → ${willCreate} work order${
                    willCreate === 1 ? '' : 's'
                  }`}
            </span>
            <Dialog.Close asChild>
              <Button variant="secondary" icon={X}>
                Cancel
              </Button>
            </Dialog.Close>
            <Button
              variant="primary"
              icon={Link2}
              wrap
              disabled={pending}
              disabledReason={
                chosen.length === 0
                  ? 'Pick at least one customer order.'
                  : !valid
                    ? blocking[0]?.message
                    : undefined
              }
              onClick={submit}
            >
              {pending
                ? 'Linking…'
                : `Create ${willCreate || ''} work order${willCreate === 1 ? '' : 's'}`.replace(
                    '  ',
                    ' ',
                  )}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * The register's trigger for the dialog.
 *
 * Three states, because "linked" is no longer binary now that a supplier order
 * can serve several customer orders: unclaimed, partly claimed (more can be
 * added), and opened as a job.
 */
export function SupplierPoLinkButton({
  supplierPoId,
  linked,
  workOrderHref,
  claimedBy = 0,
}: {
  supplierPoId: string;
  /** True once at least one customer order claims it. */
  linked: boolean;
  workOrderHref?: string;
  /** How many customer orders claim it — drives "link more". */
  claimedBy?: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="flex flex-wrap items-center justify-end gap-1.5">
      {linked && workOrderHref && (
        <Link
          href={workOrderHref}
          className="border-line-subtle text-fg-secondary hover:bg-surface-3 rounded-[7px] border px-2 py-1 text-[11.5px] whitespace-nowrap transition-colors"
        >
          {claimedBy > 1 ? 'Open the pool' : 'Open the job'}
        </Link>
      )}
      <Button
        variant={linked ? 'ghost' : 'primary'}
        size="sm"
        icon={Link2}
        onClick={() => setOpen(true)}
      >
        {linked ? 'Link more' : 'Link'}
      </Button>
      {open && (
        <LinkSupplierPoDialog supplierPoId={supplierPoId} onOpenChange={setOpen} />
      )}
    </span>
  );
}

/** One column header, matching the header style used across the app's tables. */
function Th({
  children,
  width,
  align = 'left',
}: {
  children?: React.ReactNode;
  width?: string;
  align?: 'left' | 'right';
}) {
  return (
    <th
      scope="col"
      style={width ? { width } : undefined}
      className={cn(
        'text-fg-tertiary px-3 py-2 text-[10.5px] font-semibold tracking-[0.04em] whitespace-nowrap uppercase',
        align === 'right' && 'text-right',
      )}
    >
      {children}
    </th>
  );
}
