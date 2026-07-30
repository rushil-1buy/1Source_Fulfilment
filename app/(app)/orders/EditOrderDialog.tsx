'use client';

/**
 * Editing a work order from the list.
 *
 * The case this exists for: an order placed ahead of demand. The supplier order
 * goes out first, and the customer order it will serve arrives later — so the
 * links have to be changeable after the fact, and the work order name (which is
 * built from those four document numbers) has to follow.
 *
 * Locked terms can still be changed, but only with a reason. That is the honest
 * arrangement: locking is when the exchange rate and prices stopped moving, so
 * changing them afterwards re-prices the job and somebody will need to know why.
 */

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { Link2, Lock, PenLine, Save, X } from 'lucide-react';
import { toast } from 'sonner';
import { ESCROW_FUNDERS, ESCROW_FUNDER_META } from '@/lib/domain/enums';
import { INCOTERMS, INCOTERM_DEFS } from '@/lib/domain/incoterms';
import { getLinkOptions, updateWorkOrder, type WorkOrderPatch } from '@/lib/actions/work-order';
import { Button, SectionLabel } from '@/components/ui/Layout';
import { Chip } from '@/components/ui/Badges';
import { cn } from '@/lib/utils';
import type { OrderRow } from '@/lib/queries/orders';

const input =
  'bg-surface-1 border-line-subtle focus:border-accent text-fg placeholder:text-fg-tertiary w-full rounded-[8px] border px-2.5 py-1.5 text-[13px] outline-none';

type Options = Awaited<ReturnType<typeof getLinkOptions>>;

export function EditOrderDialog({
  order,
  open,
  onOpenChange,
}: {
  order: OrderRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [options, setOptions] = useState<Options | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [customerPoId, setCustomerPoId] = useState(order.customerPoId);
  const [customerPiId, setCustomerPiId] = useState(order.customerPiId ?? '');
  const [supplierPiId, setSupplierPiId] = useState(order.supplierPiId ?? '');
  const [paymentMethod, setPaymentMethod] = useState(order.paymentMethod as string);
  const [creditDays, setCreditDays] = useState(order.creditDays?.toString() ?? '');
  const [escrowFundedBy, setEscrowFundedBy] = useState(order.escrowFundedBy ?? '');
  const [escrowBasis, setEscrowBasis] = useState(order.escrowBasis ?? '');
  const [incoterms, setIncoterms] = useState(order.incoterms);
  const [testingRequired, setTestingRequired] = useState(order.testingRequired);
  const [testScope, setTestScope] = useState(order.testScope ?? '');
  const [reason, setReason] = useState('');

  const locked = Boolean(order.termsLockedAt);

  // Loaded on open rather than with the page: the list has many rows and none of
  // them need these options until one is actually being edited.
  useEffect(() => {
    if (!open || options) return;
    let live = true;
    getLinkOptions(order.id).then((o) => live && setOptions(o));
    return () => {
      live = false;
    };
  }, [open, options, order.id]);

  /** The name as it will read once saved — derived, never typed. */
  const previewName = [
    options?.customerPos.find((p) => p.id === customerPoId)?.label.split(' · ')[0] ??
      order.customerPoNumber,
    options?.customerPis.find((p) => p.id === customerPiId)?.label.split(' · ')[0] ?? 'PI-PENDING',
    order.supplierPoNumber,
    options?.supplierPis.find((p) => p.id === supplierPiId)?.label.split(' · ')[0] ?? 'SPI-PENDING',
  ].join('_');

  const save = () => {
    setErrors({});
    const patch: WorkOrderPatch = {
      customerPoId,
      customerPiId,
      supplierPiId,
      paymentMethod: paymentMethod as 'ESCROW',
      creditDays: paymentMethod === 'CREDIT' ? Number(creditDays || 0) : null,
      escrowFundedBy: (escrowFundedBy || null) as 'ONE_BUY' | null,
      escrowBasis: (escrowBasis || null) as 'BUY_VALUE' | null,
      incoterms,
      testingRequired,
      testScope: testingRequired ? ((testScope || 'LOT_SAMPLE') as 'LOT_SAMPLE') : null,
      reason: reason.trim() || undefined,
    };
    startTransition(async () => {
      const res = await updateWorkOrder(order.id, patch);
      if (res.ok) {
        toast.success(res.message, { description: res.detail, duration: 9000 });
        onOpenChange(false);
        router.refresh();
      } else {
        setErrors(res.errors ?? {});
        toast.error(res.message, { description: res.detail, duration: 12000 });
      }
    });
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px]" />
        <Dialog.Content className="bg-surface-1 border-line shadow-e4 fixed top-1/2 left-1/2 z-50 flex max-h-[92vh] w-[min(95vw,700px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[14px] border">
          <div className="border-line-subtle border-b px-5 py-3.5">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Dialog.Title className="text-fg min-w-0 text-[15px] font-semibold">
                <PenLine className="mr-1.5 inline size-4 align-[-2px]" aria-hidden />
                Edit {order.alias}
              </Dialog.Title>
              {locked && (
                <Chip tone="warning" size="sm">
                  Terms locked
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
              Link or re-point the documents behind this job. An order placed ahead of demand starts
              with no customer order against it — attach one here when it arrives.
            </Dialog.Description>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="grid gap-4">
              {/* ── Linked documents ─────────────────────────────────────── */}
              <section>
                <SectionLabel>
                  <Link2 className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />
                  The four linked documents
                </SectionLabel>

                <div className="grid gap-3">
                  <label className="block min-w-0">
                    <span className="text-fg-secondary mb-1 block text-[11.5px] font-medium">
                      Customer order
                    </span>
                    <select
                      value={customerPoId}
                      onChange={(e) => setCustomerPoId(e.target.value)}
                      disabled={!options}
                      className={cn(input, errors.customerPoId && 'border-danger')}
                    >
                      {!options && <option value={customerPoId}>{order.customerPoNumber}</option>}
                      {options?.customerPos.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                          {p.linkedTo && p.id !== order.customerPoId
                            ? ` — already on ${p.linkedTo}`
                            : ''}
                        </option>
                      ))}
                    </select>
                    {errors.customerPoId ? (
                      <span className="text-danger mt-1 block text-[11.5px]">
                        {errors.customerPoId}
                      </span>
                    ) : (
                      <span className="text-fg-tertiary mt-1 block text-[11.5px] leading-relaxed">
                        The demand this job serves. It can be re-pointed only while no line
                        allocations have been made against the current one.
                      </span>
                    )}
                  </label>

                  <label className="block min-w-0">
                    <span className="text-fg-secondary mb-1 block text-[11.5px] font-medium">
                      Our proforma invoice to the customer
                    </span>
                    <select
                      value={customerPiId}
                      onChange={(e) => setCustomerPiId(e.target.value)}
                      disabled={!options}
                      className={cn(input, errors.customerPiId && 'border-danger')}
                    >
                      <option value="">Not issued yet</option>
                      {options?.customerPis.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                    {errors.customerPiId ? (
                      <span className="text-danger mt-1 block text-[11.5px]">
                        {errors.customerPiId}
                      </span>
                    ) : (
                      options &&
                      options.customerPis.length === 0 && (
                        <span className="text-fg-tertiary mt-1 block text-[11.5px] leading-relaxed">
                          Nothing to link — no proforma invoice has been raised against{' '}
                          {order.customerPoNumber} yet. Raise one under Create Proforma Invoice and it
                          will appear here.
                        </span>
                      )
                    )}
                  </label>

                  <label className="block min-w-0">
                    <span className="text-fg-secondary mb-1 block text-[11.5px] font-medium">
                      The supplier’s proforma invoice
                    </span>
                    <select
                      value={supplierPiId}
                      onChange={(e) => setSupplierPiId(e.target.value)}
                      disabled={!options}
                      className={cn(input, errors.supplierPiId && 'border-danger')}
                    >
                      <option value="">Not received yet</option>
                      {options?.supplierPis.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                    {errors.supplierPiId ? (
                      <span className="text-danger mt-1 block text-[11.5px]">
                        {errors.supplierPiId}
                      </span>
                    ) : (
                      options &&
                      options.supplierPis.length === 0 && (
                        <span className="text-fg-tertiary mt-1 block text-[11.5px] leading-relaxed">
                          Nothing to link — no supplier quote has been recorded against{' '}
                          {order.supplierPoNumber} yet. Capture it under Create Proforma Invoice →
                          Supplier PI capture, and it will appear here.
                        </span>
                      )
                    )}
                  </label>

                  <div className="border-line-subtle bg-surface-inset rounded-[9px] border px-3 py-2.5">
                    <span className="text-fg-tertiary block text-[10.5px] font-semibold tracking-[0.04em] uppercase">
                      Work order name once saved
                    </span>
                    <span className="text-fg mt-1 block font-mono text-[11.5px] break-all">
                      {previewName}
                    </span>
                    <span className="text-fg-tertiary mt-1 block text-[11px] leading-relaxed">
                      Built from the four numbers, never typed. If it changes, the old name stays
                      searchable — people will have quoted it in emails.
                    </span>
                  </div>
                </div>
              </section>

              {/* ── Terms ────────────────────────────────────────────────── */}
              <section>
                <SectionLabel>
                  {locked && <Lock className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />}
                  Commercial terms
                </SectionLabel>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block min-w-0">
                    <span className="text-fg-secondary mb-1 block text-[11.5px] font-medium">
                      Payment method
                    </span>
                    <select
                      value={paymentMethod}
                      onChange={(e) => setPaymentMethod(e.target.value)}
                      className={input}
                    >
                      <option value="ADVANCE">Advance payment</option>
                      <option value="ESCROW">Through escrow</option>
                      <option value="CREDIT">On credit</option>
                    </select>
                  </label>

                  {paymentMethod === 'CREDIT' && (
                    <label className="block min-w-0">
                      <span className="text-fg-secondary mb-1 block text-[11.5px] font-medium">
                        Credit days
                      </span>
                      <input
                        type="number"
                        value={creditDays}
                        onChange={(e) => setCreditDays(e.target.value)}
                        className={input}
                      />
                    </label>
                  )}

                  {paymentMethod === 'ESCROW' && (
                    <>
                      <label className="block min-w-0">
                        <span className="text-fg-secondary mb-1 block text-[11.5px] font-medium">
                          Escrow funded by
                        </span>
                        <select
                          value={escrowFundedBy}
                          onChange={(e) => setEscrowFundedBy(e.target.value)}
                          className={input}
                        >
                          <option value="">Not agreed yet</option>
                          {ESCROW_FUNDERS.map((f) => (
                            <option key={f} value={f}>
                              {ESCROW_FUNDER_META[f].label}
                            </option>
                          ))}
                        </select>
                        <span className="text-fg-tertiary mt-1 block text-[11px] leading-relaxed">
                          A negotiated term, not a platform rule — take it from the signed terms.
                        </span>
                      </label>
                      <label className="block min-w-0">
                        <span className="text-fg-secondary mb-1 block text-[11.5px] font-medium">
                          Amount based on
                        </span>
                        <select
                          value={escrowBasis}
                          onChange={(e) => setEscrowBasis(e.target.value)}
                          className={input}
                        >
                          <option value="">Not agreed yet</option>
                          <option value="BUY_VALUE">What we pay the supplier</option>
                          <option value="SELL_VALUE">What the customer pays us</option>
                          <option value="CUSTOM">A separately agreed figure</option>
                        </select>
                      </label>
                    </>
                  )}

                  <label className="block min-w-0">
                    <span className="text-fg-secondary mb-1 block text-[11.5px] font-medium">
                      Delivery terms
                    </span>
                    <select
                      value={incoterms}
                      onChange={(e) => setIncoterms(e.target.value)}
                      className={input}
                    >
                      {INCOTERMS.map((t) => (
                        <option key={t} value={t}>
                          {t} — {INCOTERM_DEFS[t].name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="min-w-0">
                    <label className="flex cursor-pointer items-start gap-2.5">
                      <input
                        type="checkbox"
                        checked={testingRequired}
                        onChange={(e) => setTestingRequired(e.target.checked)}
                        className="accent-accent mt-0.5 size-3.5 shrink-0"
                      />
                      <span className="min-w-0">
                        <span className="text-fg block text-[12.5px] font-medium">
                          Testing required
                        </span>
                        <span className="text-fg-tertiary block text-[11px] leading-relaxed">
                          Turning this on adds the whole quality-assurance phase to this job.
                        </span>
                      </span>
                    </label>
                    {testingRequired && (
                      <select
                        value={testScope}
                        onChange={(e) => setTestScope(e.target.value)}
                        className={cn(input, 'mt-2')}
                      >
                        <option value="LOT_SAMPLE">Lot sample</option>
                        <option value="FULL_BATCH">Full batch</option>
                      </select>
                    )}
                  </div>
                </div>

                {locked && (
                  <label className="mt-3 block min-w-0">
                    <span className="text-fg-secondary mb-1 block text-[11.5px] font-medium">
                      Reason for changing locked terms
                    </span>
                    <input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="What was renegotiated, and with whom"
                      className={cn(input, errors.reason && 'border-danger')}
                    />
                    <span
                      className={cn(
                        'mt-1 block text-[11.5px] leading-relaxed',
                        errors.reason ? 'text-danger' : 'text-fg-tertiary',
                      )}
                    >
                      {errors.reason ??
                        `Locked on ${new Date(order.termsLockedAt!).toDateString()}. Only needed if you change a term above — it is kept with the change and posted to the thread.`}
                    </span>
                  </label>
                )}
              </section>
            </div>
          </div>

          <div className="border-line-subtle flex flex-wrap justify-end gap-2 border-t px-5 py-3">
            <Dialog.Close asChild>
              <Button variant="secondary" icon={X}>
                Cancel
              </Button>
            </Dialog.Close>
            <Button variant="primary" icon={Save} disabled={pending} onClick={save}>
              {pending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
