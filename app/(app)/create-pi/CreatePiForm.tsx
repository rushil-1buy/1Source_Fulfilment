'use client';

/**
 * CREATE PI — §3.3.
 *
 *  * Customer PI: one click generates it from the customer's PO with every line
 *    pre-filled, then price / validity / freight / terms are editable, and it
 *    prints as a branded document.
 *  * Supplier PI capture: records what the supplier actually quoted and
 *    reconciles it three ways against our PO. Saving it completes the work order
 *    name — the SPI-PENDING segment resolves and the name locks (§3.4).
 */

import { useMemo, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  FileCheck2,
  Lock,
  Printer,
  Save,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import { FileAttachField, uploadChosenFiles } from '@/components/ui/FileAttachField';
import { uploadRecordDocument } from '@/lib/actions/upload';
import type { PiSourceCustomerPo, PiSourceSupplierPo } from '@/lib/queries/pi';
import { captureSupplierPi, createCustomerPi } from '@/lib/actions/pi';
import {
  Button,
  EmptyState,
  Money,
  MonoId,
  PageHeader,
  PageShell,
  Panel,
  PanelHeader,
  SectionLabel,
} from '@/components/ui/Layout';
import { Chip, StatusChip } from '@/components/ui/Badges';
import { Hint, InfoTooltip } from '@/components/ui/InfoTooltip';
import { reconcile, VARIANCE_FIELD_LABEL, worstSeverity } from '@/lib/domain/reconcile';
import { toMinor } from '@/lib/domain/money';
import { cn, formatDate } from '@/lib/utils';

type Mode = 'customer' | 'supplier';

const inputCls =
  'bg-surface-1 border-line-subtle focus:border-accent text-fg placeholder:text-fg-tertiary w-full rounded-[7px] border px-2 py-1.5 text-[12.5px] outline-none disabled:opacity-50';

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n: number) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);

export function CreatePiForm({
  customerPos,
  supplierPos,
  org,
}: {
  customerPos: PiSourceCustomerPo[];
  supplierPos: PiSourceSupplierPo[];
  org: { legalName: string; brandName: string; gstin: string; stateName: string } | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<Mode>(
    searchParams.get('mode') === 'supplier' ? 'supplier' : 'customer',
  );
  /** Held until the proforma invoice exists — see FileAttachField. */
  const [attachments, setAttachments] = useState<File[]>([]);
  /** RFQ / Sourcing ID carried over from the sourcing step. */
  const [sourcingRef, setSourcingRef] = useState('');

  /** Uploads whatever was chosen, once there is a record to hang it on. */
  const pushAttachments = async (piId: string | undefined, docType: string, title: string) => {
    if (!piId || attachments.length === 0) return;
    const { uploaded, failed } = await uploadChosenFiles(
      attachments,
      { piId },
      docType,
      title,
      uploadRecordDocument,
    );
    if (uploaded > 0) toast.success(`${uploaded} file${uploaded === 1 ? '' : 's'} attached.`);
    for (const f of failed) {
      toast.error(`${f.name} was not attached.`, { description: f.message, duration: 10000 });
    }
    setAttachments([]);
  };

  return (
    <PageShell width="full">
      <PageHeader
        title="Create PI"
        plainTitle="Create price quote"
        termKey="proformaInvoice"
        description="Issue our proforma invoice to a customer, or record the one a supplier sent us. A proforma is a formal quote — it is not a tax invoice and no tax is due on it."
      />

      <div className="border-line-subtle bg-surface-1 mb-4 inline-flex min-w-0 max-w-full overflow-x-auto rounded-[10px] border p-1">
        {[
          { id: 'customer' as Mode, label: 'Customer PI', hint: 'Our quote out to a customer, generated from their order.' },
          { id: 'supplier' as Mode, label: 'Supplier PI capture', hint: "Record the supplier's quote and check it against our PO." },
        ].map((t) => (
          <Hint key={t.id} content={<span>{t.hint}</span>}>
            <button
              type="button"
              onClick={() => setMode(t.id)}
              aria-pressed={mode === t.id}
              className={cn(
                'shrink-0 rounded-[7px] px-3 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors',
                mode === t.id
                  ? 'bg-accent text-accent-fg'
                  : 'text-fg-secondary hover:bg-surface-3 hover:text-fg',
              )}
            >
              {t.label}
            </button>
          </Hint>
        ))}
      </div>

      {/* Above the panels on purpose: whichever mode is selected, the file is
          attached to the proforma invoice the moment it is created. */}
      <Panel className="mb-4">
        <div className="mb-4 min-w-0">
          <span className="text-fg-secondary mb-1 flex items-center gap-1.5 text-[11.5px] font-medium">
            RFQ / Sourcing ID
            <InfoTooltip termKey="sourcingRef" />
          </span>
          <input
            value={sourcingRef}
            onChange={(e) => setSourcingRef(e.target.value)}
            placeholder="e.g. RFQBUNDLE_7741"
            className="bg-surface-1 border-line-subtle focus:border-accent text-fg placeholder:text-fg-tertiary w-full rounded-[8px] border px-2.5 py-1.5 text-[13px] outline-none sm:max-w-[320px]"
          />
          <p className="text-fg-tertiary mt-1 text-[11.5px] leading-relaxed">
            The enquiry this quote came out of, from the sourcing step. Sourcing is not part of this
            platform yet, so this is the handle that ties the two together. Leave blank and it is
            taken from the linked purchase order, if that carries one.
          </p>
        </div>

        <FileAttachField
          label={
            mode === 'customer'
              ? 'Attach our proforma invoice as sent'
              : 'Attach the supplier’s proforma invoice'
          }
          help={
            mode === 'customer'
              ? 'The copy the customer received, and their written acceptance once it arrives. Uploaded as soon as the proforma invoice is saved.'
              : 'Their document as received, including the bank details we will pay against. This is the file the three-way check is read from.'
          }
          files={attachments}
          onChange={setAttachments}
        />
      </Panel>

      {mode === 'customer' ? (
        <CustomerPiPanel
          pos={customerPos}
          org={org}
          pending={pending}
          onSubmit={(payload) =>
            startTransition(async () => {
              const res = await createCustomerPi({ ...payload, sourcingRef: sourcingRef || null });
              if (res.ok) {
                toast.success(res.message);
                if (res.newCanonicalName) {
                  toast.info(`Work order name updated to ${res.newCanonicalName}`);
                }
                await pushAttachments(res.id, 'CUSTOMER_PI', 'Proforma invoice as sent');
                router.refresh();
              } else {
                toast.error(res.error);
              }
            })
          }
        />
      ) : (
        <SupplierPiPanel
          pos={supplierPos}
          pending={pending}
          onSubmit={(payload) =>
            startTransition(async () => {
              const res = await captureSupplierPi({ ...payload, sourcingRef: sourcingRef || null });
              if (res.ok) {
                toast.success(res.message, { duration: 8000 });
                // Before navigating, or the chosen files are abandoned.
                await pushAttachments(res.id, 'SUPPLIER_PI', 'Supplier proforma invoice as received');
                if (res.workOrderId) router.push(`/orders/${res.workOrderId}`);
                else router.refresh();
              } else {
                toast.error(res.error);
              }
            })
          }
        />
      )}
    </PageShell>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Customer PI
// ═══════════════════════════════════════════════════════════════════════════

function CustomerPiPanel({
  pos,
  org,
  pending,
  onSubmit,
}: {
  pos: PiSourceCustomerPo[];
  org: { legalName: string; brandName: string; gstin: string; stateName: string } | null;
  pending: boolean;
  onSubmit: (payload: Record<string, unknown>) => void;
}) {
  const [poId, setPoId] = useState('');
  const [generated, setGenerated] = useState(false);
  const [piDate, setPiDate] = useState(today());
  const [validUntil, setValidUntil] = useState(plusDays(21));
  const [freight, setFreight] = useState(0);
  const [insurance, setInsurance] = useState(0);
  const [bankDetails, setBankDetails] = useState(
    'HDFC Bank, Okhla · A/C 50200012345678 · IFSC HDFC0000123',
  );
  const [terms, setTerms] = useState('');
  const [lines, setLines] = useState<{ id: string; quantity: number; unitPrice: number }[]>([]);

  const po = pos.find((p) => p.id === poId) ?? null;

  const generate = () => {
    if (!po) return;
    setLines(po.lines.map((l) => ({ id: l.id, quantity: l.quantity, unitPrice: l.unitPrice })));
    setTerms(
      `${po.paymentTerms} from invoice. Prices firm until the validity date above. Goods supplied by ${org?.legalName ?? '1BUY'} as Merchant of Record.`,
    );
    setGenerated(true);
  };

  const subtotal = useMemo(
    () =>
      lines.reduce(
        (a, l) => a + toMinor(l.quantity * l.unitPrice, po?.currency ?? 'INR'),
        0,
      ),
    [lines, po?.currency],
  );
  const total = subtotal + toMinor(freight) + toMinor(insurance);

  const priceChanged = useMemo(() => {
    if (!po) return false;
    return lines.some((l) => {
      const src = po.lines.find((x) => x.id === l.id);
      return src && (src.unitPrice !== l.unitPrice || src.quantity !== l.quantity);
    });
  }, [lines, po]);

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <Panel>
        <PanelHeader
          title="Which order is this quote for?"
          description="Pick the customer order and generate the proforma from it — every line comes across, so nothing gets retyped."
        />
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <label className="block min-w-0">
            <span className="text-fg-tertiary mb-1 block text-[10.5px] font-semibold tracking-[0.04em] uppercase">
              Customer order
            </span>
            <select
              value={poId}
              onChange={(e) => {
                setPoId(e.target.value);
                setGenerated(false);
                setLines([]);
              }}
              className={inputCls}
            >
              <option value="">Choose a customer order…</option>
              {pos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.poNumber} — {p.customerName} · {p.lines.length} line
                  {p.lines.length === 1 ? '' : 's'}
                  {p.hasPi ? ` · already quoted (${p.existingPiNumber})` : ''}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="primary"
            icon={Sparkles}
            onClick={generate}
            disabled={!po}
            disabledReason={!po ? 'Choose a customer order first.' : undefined}
          >
            Generate PI from Customer PO
          </Button>
        </div>

        {po?.hasPi && (
          <div className="border-warning-border bg-warning-subtle mt-3 flex items-start gap-2 rounded-[8px] border px-2.5 py-2">
            <TriangleAlert className="text-warning mt-0.5 size-4 shrink-0" aria-hidden />
            <span className="text-fg-secondary text-[12px]">
              This order already has proforma{' '}
              <span className="font-mono">{po.existingPiNumber}</span>. Issuing another will create a
              second quote — use it only if the first is being superseded.
            </span>
          </div>
        )}

        {po && po.pendingNameOnWorkOrders.length > 0 && (
          <div className="border-accent-border bg-accent-subtle mt-3 rounded-[8px] border px-2.5 py-2">
            <span className="text-fg-secondary text-[12px]">
              Issuing this proforma will also complete the quote segment in{' '}
              {po.pendingNameOnWorkOrders.map((w) => (
                <span key={w.alias} className="font-mono font-medium">
                  {w.alias}
                </span>
              ))}
              &apos;s work order name, which currently reads{' '}
              <span className="font-mono text-[11px]">PI-PENDING</span>.
            </span>
          </div>
        )}
      </Panel>

      <AnimatePresence initial={false}>
        {generated && po && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="grid min-w-0 grid-cols-1 gap-4"
          >
            <Panel>
              <PanelHeader title="Quote terms" />
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Field label="PI date">
                  <input
                    type="date"
                    value={piDate}
                    onChange={(e) => setPiDate(e.target.value)}
                    className={inputCls}
                  />
                </Field>
                <Field label="Valid until" termKey="piValidUntil">
                  <input
                    type="date"
                    value={validUntil}
                    onChange={(e) => setValidUntil(e.target.value)}
                    className={inputCls}
                  />
                </Field>
                <Field label={`Freight (${po.currency})`}>
                  <input
                    type="number"
                    min={0}
                    value={freight || ''}
                    onChange={(e) => setFreight(Number(e.target.value))}
                    className={cn(inputCls, 'tnum text-right')}
                  />
                </Field>
                <Field label={`Insurance (${po.currency})`}>
                  <input
                    type="number"
                    min={0}
                    value={insurance || ''}
                    onChange={(e) => setInsurance(Number(e.target.value))}
                    className={cn(inputCls, 'tnum text-right')}
                  />
                </Field>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Bank details">
                  <input
                    value={bankDetails}
                    onChange={(e) => setBankDetails(e.target.value)}
                    className={inputCls}
                  />
                </Field>
                <Field label="Terms">
                  <textarea
                    value={terms}
                    onChange={(e) => setTerms(e.target.value)}
                    rows={2}
                    className={inputCls}
                  />
                </Field>
              </div>
            </Panel>

            {/* Print-ready document */}
            <Panel padded={false} className="print:border-0">
              <div className="flex flex-wrap items-center justify-between gap-2 p-4 pb-2 no-print">
                <PanelHeader
                  title="Proforma preview"
                  description="This is what the customer receives. Adjust prices below if the quote differs from their order."
                  className="mb-0"
                />
                <Button variant="secondary" size="sm" icon={Printer} onClick={() => window.print()}>
                  Print / save PDF
                </Button>
              </div>

              <div className="border-line-subtle m-4 mt-0 rounded-[10px] border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-fg text-[14px] font-semibold">
                      {org?.legalName ?? '1BUY'}
                    </div>
                    <div className="text-fg-tertiary text-[11px]">
                      GSTIN {org?.gstin} · {org?.stateName}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-fg text-[13px] font-semibold tracking-[0.04em] uppercase">
                      Proforma Invoice
                    </div>
                    <div className="text-fg-tertiary text-[11px]">
                      Against {po.poNumber} · {formatDate(piDate)}
                    </div>
                    <div className="text-fg-tertiary text-[11px]">
                      Valid until {formatDate(validUntil)}
                    </div>
                  </div>
                </div>

                <div className="border-line-subtle mt-3 border-t pt-3">
                  <SectionLabel>Buyer</SectionLabel>
                  <div className="text-fg text-[12.5px] font-medium">{po.customerName}</div>
                </div>

                <div className="mt-3 overflow-x-auto">
                  <table className="w-full border-collapse text-left text-[12px]">
                    <thead className="bg-surface-inset">
                      <tr className="border-line-subtle border-y">
                        <Th termKey="mpn">Part</Th>
                        <Th termKey="hsnCode">HSN</Th>
                        <Th align="right" termKey="quantity">Qty</Th>
                        <Th align="right" termKey="unitPrice">Unit price</Th>
                        <Th align="right">Line total</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l) => {
                        const src = po.lines.find((x) => x.id === l.id)!;
                        const changed =
                          src.unitPrice !== l.unitPrice || src.quantity !== l.quantity;
                        return (
                          <tr key={l.id} className="border-line-subtle border-b last:border-0">
                            <td className="px-2 py-1.5">
                              <div className="font-mono text-[11.5px]">{src.mpn}</div>
                              <div className="text-fg-tertiary truncate text-[10.5px]">
                                {src.description}
                              </div>
                            </td>
                            <td className="px-2 py-1.5 font-mono text-[11px]">{src.hsnCode}</td>
                            <td className="px-2 py-1.5 text-right">
                              <input
                                type="number"
                                min={1}
                                value={l.quantity}
                                onChange={(e) =>
                                  setLines((prev) =>
                                    prev.map((x) =>
                                      x.id === l.id ? { ...x, quantity: Number(e.target.value) } : x,
                                    ),
                                  )
                                }
                                className={cn(inputCls, 'tnum max-w-[100px] text-right no-print')}
                              />
                              <span className="tnum print-only">{l.quantity}</span>
                            </td>
                            <td className="px-2 py-1.5 text-right">
                              <input
                                type="number"
                                step="0.0001"
                                min={0}
                                value={l.unitPrice}
                                onChange={(e) =>
                                  setLines((prev) =>
                                    prev.map((x) =>
                                      x.id === l.id
                                        ? { ...x, unitPrice: Number(e.target.value) }
                                        : x,
                                    ),
                                  )
                                }
                                className={cn(
                                  inputCls,
                                  'tnum max-w-[110px] text-right no-print',
                                  changed && 'border-warning',
                                )}
                              />
                              <span className="tnum print-only">{l.unitPrice}</span>
                            </td>
                            <td className="tnum px-2 py-1.5 text-right">
                              <Money
                                amount={toMinor(l.quantity * l.unitPrice, po.currency)}
                                currency={po.currency}
                                withCode={false}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-surface-inset">
                      <Row label="Subtotal" amount={subtotal} currency={po.currency} />
                      {freight > 0 && (
                        <Row label="Freight" amount={toMinor(freight)} currency={po.currency} />
                      )}
                      {insurance > 0 && (
                        <Row label="Insurance" amount={toMinor(insurance)} currency={po.currency} />
                      )}
                      <Row label="Total" amount={total} currency={po.currency} strong />
                    </tfoot>
                  </table>
                </div>

                {priceChanged && (
                  <p className="text-warning mt-2 text-[11px] no-print">
                    Some prices or quantities differ from the customer&apos;s order. That is allowed
                    — the proforma is our quote — but make sure it is deliberate.
                  </p>
                )}

                <div className="border-line-subtle mt-3 border-t pt-3 text-[11px] leading-relaxed">
                  <div className="text-fg-secondary">{terms}</div>
                  <div className="text-fg-tertiary mt-1">{bankDetails}</div>
                  <div className="text-fg-tertiary mt-2 italic">
                    This is a proforma invoice, not a tax invoice. No GST is charged on it.
                  </div>
                </div>
              </div>
            </Panel>

            <div className="flex flex-wrap items-center gap-2 pb-6 no-print">
              <Button
                variant="primary"
                icon={Save}
                disabled={pending || lines.length === 0}
                onClick={() =>
                  onSubmit({
                    customerPoId: po.id,
                    piDate,
                    validUntil,
                    freightAmount: freight,
                    insuranceAmount: insurance,
                    bankDetails,
                    terms,
                    issueNow: true,
                    lines: lines.map((l) => ({
                      customerPoLineId: l.id,
                      quantity: l.quantity,
                      unitPrice: l.unitPrice,
                    })),
                  })
                }
              >
                {pending ? 'Issuing…' : 'Issue proforma to customer'}
              </Button>
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() =>
                  onSubmit({
                    customerPoId: po.id,
                    piDate,
                    validUntil,
                    freightAmount: freight,
                    insuranceAmount: insurance,
                    bankDetails,
                    terms,
                    issueNow: false,
                    lines: lines.map((l) => ({
                      customerPoLineId: l.id,
                      quantity: l.quantity,
                      unitPrice: l.unitPrice,
                    })),
                  })
                }
              >
                Save as draft
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Supplier PI capture
// ═══════════════════════════════════════════════════════════════════════════

function SupplierPiPanel({
  pos,
  pending,
  onSubmit,
}: {
  pos: PiSourceSupplierPo[];
  pending: boolean;
  onSubmit: (payload: Record<string, unknown>) => void;
}) {
  const awaiting = pos.filter((p) => p.awaitingPi);
  const [poId, setPoId] = useState('');
  const [externalRef, setExternalRef] = useState('');
  const [piDate, setPiDate] = useState(today());
  const [terms, setTerms] = useState('');
  const [lines, setLines] = useState<
    { id: string; quantity: number; unitPrice: number; leadTimeDays: number | null }[]
  >([]);

  const po = awaiting.find((p) => p.id === poId) ?? null;

  const load = (id: string) => {
    setPoId(id);
    const p = awaiting.find((x) => x.id === id);
    setLines(
      p
        ? p.lines.map((l) => ({
            id: l.id,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            leadTimeDays: l.leadTimeDays,
          }))
        : [],
    );
    setExternalRef('');
    setTerms(p ? `Payment via ${p.paymentMethod.toLowerCase()}.` : '');
  };

  // Live three-way reconciliation, using the same pure function the server uses.
  const variances = useMemo(() => {
    if (!po) return [];
    return reconcile(
      po.lines.map((l) => ({
        id: l.id,
        mpn: l.mpn,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        leadTimeDays: l.leadTimeDays,
      })),
      lines.map((l) => ({
        supplierPoLineId: l.id,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        leadTimeDays: l.leadTimeDays,
      })),
    );
  }, [po, lines]);

  const worst = worstSeverity(variances);
  const quotedTotal = useMemo(
    () => lines.reduce((a, l) => a + toMinor(l.quantity * l.unitPrice, po?.currency ?? 'USD'), 0),
    [lines, po?.currency],
  );

  const namePreview = useMemo(() => {
    if (!po?.workOrder) return null;
    return po.workOrder.canonicalName.replace('_SPI-PENDING', '_SPI-«new»');
  }, [po]);

  if (awaiting.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon={FileCheck2}
          title="No supplier orders awaiting a proforma"
          description="Every issued supplier PO already has its proforma recorded. Raise a new supplier PO in Create PO first."
        />
      </Panel>
    );
  }

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <Panel>
        <PanelHeader
          title="Which of our orders is the supplier quoting?"
          description="Only POs still waiting on a proforma are listed. Recording it completes the work order name."
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block min-w-0 sm:col-span-2">
            <span className="text-fg-tertiary mb-1 block text-[10.5px] font-semibold tracking-[0.04em] uppercase">
              Our purchase order
            </span>
            <select value={poId} onChange={(e) => load(e.target.value)} className={inputCls}>
              <option value="">Choose one of our POs…</option>
              {awaiting.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.poNumber} — {p.supplierName} · {p.currency}{' '}
                  {(p.totalValue / 100).toLocaleString('en-IN')}
                  {p.workOrder ? ` · ${p.workOrder.alias}` : ' · no work order'}
                </option>
              ))}
            </select>
          </label>
          <Field label="Supplier's own PI number" required>
            <input
              value={externalRef}
              onChange={(e) => setExternalRef(e.target.value)}
              placeholder="e.g. NEXUS/PI/2026/0241"
              className={cn(inputCls, 'font-mono')}
            />
          </Field>
        </div>

        {po?.workOrder && (
          <div className="border-accent-border bg-accent-subtle mt-3 rounded-[9px] border p-3">
            <div className="flex items-center gap-1.5">
              <SectionLabel>What happens to the work order name</SectionLabel>
              <InfoTooltip termKey="canonicalName" />
            </div>
            <div className="grid gap-1.5">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Chip tone="warning" size="sm">
                  Now
                </Chip>
                <span className="text-fg-tertiary min-w-0 truncate font-mono text-[11px]">
                  {po.workOrder.canonicalName}
                </span>
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <ArrowRight className="text-fg-tertiary size-3 shrink-0" aria-hidden />
                <Chip tone="success" icon={Lock} size="sm">
                  After
                </Chip>
                <span className="text-fg min-w-0 truncate font-mono text-[11px] font-medium">
                  {namePreview}
                </span>
              </div>
            </div>
            <p className="text-fg-tertiary mt-1.5 text-[11px]">
              The name then locks. The old provisional form stays searchable.
            </p>
          </div>
        )}
      </Panel>

      {po && (
        <>
          <Panel padded={false}>
            <div className="p-4 pb-0">
              <PanelHeader
                title="What the supplier quoted"
                description="Pre-filled from our PO. Change anything the supplier came back with differently — every difference is flagged below."
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-[12px]">
                <thead className="bg-surface-inset">
                  <tr className="border-line-subtle border-y">
                    <Th termKey="mpn">Part</Th>
                    <Th align="right">We ordered</Th>
                    <Th align="right">They quote (qty)</Th>
                    <Th align="right">Our price</Th>
                    <Th align="right">Their price</Th>
                    <Th align="right" termKey="leadTimeDays">Lead time</Th>
                    <Th align="right">Line total</Th>
                  </tr>
                </thead>
                <tbody>
                  {po.lines.map((src) => {
                    const l = lines.find((x) => x.id === src.id);
                    if (!l) return null;
                    const priceDiff = Math.abs(src.unitPrice - l.unitPrice) > 1e-9;
                    const qtyDiff = src.quantity !== l.quantity;
                    return (
                      <tr key={src.id} className="border-line-subtle border-b last:border-0">
                        <td className="px-2 py-1.5">
                          <div className="font-mono text-[11.5px]">{src.mpn}</div>
                          <div className="text-fg-tertiary truncate text-[10.5px]">
                            {src.description}
                          </div>
                        </td>
                        <td className="tnum text-fg-tertiary px-2 py-1.5 text-right">
                          {src.quantity.toLocaleString('en-IN')}
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <input
                            type="number"
                            min={1}
                            value={l.quantity}
                            onChange={(e) =>
                              setLines((prev) =>
                                prev.map((x) =>
                                  x.id === src.id ? { ...x, quantity: Number(e.target.value) } : x,
                                ),
                              )
                            }
                            className={cn(
                              inputCls,
                              'tnum max-w-[110px] text-right',
                              qtyDiff && 'border-warning',
                            )}
                          />
                        </td>
                        <td className="tnum text-fg-tertiary px-2 py-1.5 text-right">
                          {src.unitPrice}
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <input
                            type="number"
                            step="0.0001"
                            min={0}
                            value={l.unitPrice}
                            onChange={(e) =>
                              setLines((prev) =>
                                prev.map((x) =>
                                  x.id === src.id ? { ...x, unitPrice: Number(e.target.value) } : x,
                                ),
                              )
                            }
                            className={cn(
                              inputCls,
                              'tnum max-w-[110px] text-right',
                              priceDiff && 'border-warning',
                            )}
                          />
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <input
                            type="number"
                            min={0}
                            value={l.leadTimeDays ?? ''}
                            onChange={(e) =>
                              setLines((prev) =>
                                prev.map((x) =>
                                  x.id === src.id
                                    ? {
                                        ...x,
                                        leadTimeDays:
                                          e.target.value === '' ? null : Number(e.target.value),
                                      }
                                    : x,
                                ),
                              )
                            }
                            className={cn(inputCls, 'tnum max-w-[90px] text-right')}
                          />
                        </td>
                        <td className="tnum px-2 py-1.5 text-right">
                          <Money
                            amount={toMinor(l.quantity * l.unitPrice, po.currency)}
                            currency={po.currency}
                            withCode={false}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-surface-inset font-semibold">
                  <tr className="border-line-subtle border-t">
                    <td className="px-2 py-2" colSpan={6}>
                      Quoted total{' '}
                      {quotedTotal !== po.totalValue && (
                        <span className="text-warning ml-1 font-normal">
                          (our PO was {po.currency} {(po.totalValue / 100).toLocaleString('en-IN')})
                        </span>
                      )}
                    </td>
                    <td className="tnum px-2 py-2 text-right">
                      <Money amount={quotedTotal} currency={po.currency} />
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Panel>

          {/* Variance report */}
          <Panel
            className={cn(
              worst === 'CRITICAL' && 'border-danger-border',
              worst === 'WARNING' && 'border-warning-border',
              worst === null && 'border-success-border',
            )}
          >
            <PanelHeader
              title="Three-way reconciliation"
              description="Price, quantity and lead time, each checked against our purchase order."
              actions={
                worst === null ? (
                  <Chip tone="success" icon={Check}>
                    Matches our PO exactly
                  </Chip>
                ) : (
                  <Chip
                    tone={worst === 'CRITICAL' ? 'danger' : 'warning'}
                    icon={AlertTriangle}
                  >
                    {variances.length} variance{variances.length === 1 ? '' : 's'}
                  </Chip>
                )
              }
            />
            {variances.length === 0 ? (
              <p className="text-fg-secondary text-[12.5px]">
                Everything the supplier quoted matches what we ordered. Nothing needs approval.
              </p>
            ) : (
              <ul className="grid gap-1.5">
                {variances.map((v, i) => (
                  <li
                    key={`${v.mpn}-${v.field}-${i}`}
                    className={cn(
                      'flex min-w-0 flex-wrap items-start gap-x-2.5 gap-y-1 rounded-[8px] border px-2.5 py-2',
                      v.severity === 'CRITICAL'
                        ? 'border-danger-border bg-danger-subtle'
                        : v.severity === 'WARNING'
                          ? 'border-warning-border bg-warning-subtle'
                          : 'border-line-subtle',
                    )}
                  >
                    <span className="font-mono text-[11.5px] font-medium">{v.mpn}</span>
                    <Chip size="sm">{VARIANCE_FIELD_LABEL[v.field]}</Chip>
                    <span className="text-fg-tertiary tnum text-[11.5px]">
                      {v.ordered} → <span className="text-fg font-medium">{v.quoted}</span>
                      {v.field !== 'leadTimeDays' && (
                        <span
                          className={cn(
                            'ml-1',
                            v.deltaPct > 0 ? 'text-danger' : 'text-success',
                          )}
                        >
                          ({v.deltaPct > 0 ? '+' : ''}
                          {v.deltaPct.toFixed(1)}%)
                        </span>
                      )}
                    </span>
                    <StatusChip
                      status={v.severity === 'CRITICAL' ? 'ACTION_REQUIRED' : 'PENDING'}
                      size="sm"
                    />
                    <span className="text-fg-secondary min-w-0 flex-1 basis-full text-[12px]">
                      {v.note}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel>
            <Field label="Supplier's terms">
              <textarea
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
                rows={2}
                className={inputCls}
              />
            </Field>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="PI date">
                <input
                  type="date"
                  value={piDate}
                  onChange={(e) => setPiDate(e.target.value)}
                  className={inputCls}
                />
              </Field>
            </div>
          </Panel>

          <div className="flex flex-wrap items-center gap-2 pb-6">
            <Button
              variant="primary"
              icon={Lock}
              disabled={pending || !externalRef.trim()}
              disabledReason={
                !externalRef.trim() ? "Enter the supplier's own PI number first." : undefined
              }
              onClick={() =>
                onSubmit({
                  supplierPoId: po.id,
                  externalRef,
                  piDate,
                  terms,
                  leadTimeDays: lines.find((l) => l.leadTimeDays != null)?.leadTimeDays ?? null,
                  lines: lines.map((l) => ({
                    supplierPoLineId: l.id,
                    quantity: l.quantity,
                    unitPrice: l.unitPrice,
                    leadTimeDays: l.leadTimeDays,
                  })),
                })
              }
            >
              {pending ? 'Recording…' : 'Record PI & complete work order name'}
            </Button>
            {worst === 'CRITICAL' && (
              <span className="text-danger text-[12px]">
                There are critical variances — recording is still allowed, but they will be flagged
                for approval on the order.
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Shared bits ─────────────────────────────────────────────────────────────

function Field({
  label,
  children,
  required,
  termKey,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
  termKey?: string;
}) {
  return (
    <label className="block min-w-0">
      <span className="text-fg-tertiary mb-1 flex items-center gap-1 text-[10.5px] font-semibold tracking-[0.04em] uppercase">
        <span className="truncate">{label}</span>
        {required && <span className="text-danger">*</span>}
        {termKey && <InfoTooltip termKey={termKey} />}
      </span>
      {children}
    </label>
  );
}

function Th({
  children,
  termKey,
  align = 'left',
}: {
  children: React.ReactNode;
  termKey?: string;
  align?: 'left' | 'right';
}) {
  return (
    <th
      scope="col"
      className={cn(
        'text-fg-tertiary px-2 py-2 text-[10px] font-semibold tracking-[0.04em] whitespace-nowrap uppercase',
        align === 'right' && 'text-right',
      )}
    >
      <span className={cn('inline-flex items-center gap-1', align === 'right' && 'flex-row-reverse')}>
        {children}
        {termKey && <InfoTooltip termKey={termKey} />}
      </span>
    </th>
  );
}

function Row({
  label,
  amount,
  currency,
  strong,
}: {
  label: string;
  amount: number;
  currency: string;
  strong?: boolean;
}) {
  return (
    <tr className={cn('border-line-subtle border-t', strong && 'font-semibold')}>
      <td className="px-2 py-1.5" colSpan={4}>
        {label}
      </td>
      <td className="tnum px-2 py-1.5 text-right">
        <Money amount={amount} currency={currency} withCode={strong} />
      </td>
    </tr>
  );
}
