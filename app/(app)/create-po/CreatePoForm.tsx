'use client';

/**
 * CREATE PO — §3.1, §3.2, §3.4.
 *
 * One section, two document types, chosen by a segmented control. The
 * load-bearing requirement is the field at the BOTTOM of the supplier form,
 * immediately above Save: "Link this PO with Customer PO". Ticking it expands
 * (animated height, no layout jump) into a searchable customer-PO selector plus
 * a side-by-side line-mapping grid with live margin reconciliation.
 */

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Check,
  ChevronDown,
  FileSpreadsheet,
  Link2,
  Plus,
  Save,
  Search,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { BulkLineImportDialog } from './BulkLineImportDialog';
import type { ImportedLine } from '@/lib/domain/line-import';
import { FileAttachField, uploadChosenFiles } from '@/components/ui/FileAttachField';
import { PartCombobox } from '@/components/ui/PartCombobox';
import { uploadRecordDocument } from '@/lib/actions/upload';
import type {
  CustomerOption,
  LinkableCustomerPo,
  MpnOption,
  SupplierOption,
} from '@/lib/queries/masters';
import { createCustomerPo, createSupplierPo } from '@/lib/actions/po';
import {
  Button,
  EmptyState,
  Money,
  MonoId,
  PageHeader,
  PageShell,
  Panel,
  PanelHeader,
  Pct,
  SectionLabel,
} from '@/components/ui/Layout';
import { Chip, StatusChip } from '@/components/ui/Badges';
import { Hint, InfoTooltip } from '@/components/ui/InfoTooltip';
import { toMinor } from '@/lib/domain/money';
import { PAYMENT_METHODS, PAYMENT_METHOD_META, TEST_SCOPES, TEST_SCOPE_META } from '@/lib/domain/enums';
import { INCOTERMS, INCOTERM_DEFS } from '@/lib/domain/incoterms';
import { cn, formatDate } from '@/lib/utils';

type Mode = 'customer' | 'supplier';

interface DraftLine {
  key: string;
  mpn: string;
  manufacturer: string;
  description: string;
  hsnCode: string;
  quantity: number;
  uom: string;
  unitPrice: number;
  testingRequired: boolean;
  testScope: string;
  sampleSize: number | null;
  aql: string;
  leadTimeDays: number | null;
  countryOfOrigin: string;
  dateCodeLot: string;
  msl: string;
  packaging: string;
  remarks: string;
}

let keySeq = 0;
const newLine = (): DraftLine => ({
  key: `l${++keySeq}`,
  mpn: '',
  manufacturer: '',
  description: '',
  hsnCode: '',
  quantity: 0,
  uom: 'PCS',
  unitPrice: 0,
  testingRequired: false,
  testScope: '',
  sampleSize: null,
  aql: '',
  leadTimeDays: null,
  countryOfOrigin: '',
  dateCodeLot: '',
  msl: '',
  packaging: '',
  remarks: '',
});

const today = () => new Date().toISOString().slice(0, 10);

export function CreatePoForm({
  customers,
  suppliers,
  mpns,
  linkablePos,
  marginFloorPct,
}: {
  customers: CustomerOption[];
  suppliers: SupplierOption[];
  mpns: MpnOption[];
  linkablePos: LinkableCustomerPo[];
  marginFloorPct: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const initialMode: Mode = searchParams.get('mode') === 'supplier' ? 'supplier' : 'customer';
  const [mode, setMode] = useState<Mode>(initialMode);

  // ── Shared header state ─────────────────────────────────────────────────
  const [customerId, setCustomerId] = useState('');
  const [poNumber, setPoNumber] = useState('');
  const [poDate, setPoDate] = useState(today());
  const [incoterms, setIncoterms] = useState('DDP');
  const [paymentTerms, setPaymentTerms] = useState('30 days');
  /**
   * Not typed any more — derived.
   *
   * "Customer wants it by" was one date for a whole order, but a mixed order
   * routinely has one part on the shelf and another on a twelve-week lead. The
   * order-level date silently flattened that. The lines carry their own lead
   * times, so the order date is now the longest of them, and it moves when a
   * line does instead of going stale.
   */
  const [requestedDateOverride, setRequestedDateOverride] = useState('');
  /**
   * Ship-to and bill-to for this order.
   *
   * Seeded from the customer master when one is chosen, then editable: a delivery
   * can go to a site that is not the registered address, and correcting it here
   * must not rewrite the master record. Bill-to follows ship-to until it is
   * changed, because they are the same address on most orders and typing it twice
   * is how they end up disagreeing.
   */
  const [importOpen, setImportOpen] = useState(false);
  const [shipTo, setShipTo] = useState('');
  const [billTo, setBillTo] = useState('');
  const [billToDiffers, setBillToDiffers] = useState(false);
  const [notes, setNotes] = useState('');
  /** Held until the record exists — see FileAttachField for why. */
  const [attachments, setAttachments] = useState<File[]>([]);
  /** RFQ / Sourcing ID carried over from the sourcing step. */
  const [sourcingRef, setSourcingRef] = useState('');

  const [supplierId, setSupplierId] = useState('');
  const [supplierPoNumber, setSupplierPoNumber] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [fxRate, setFxRate] = useState(83.2);
  const [paymentMethod, setPaymentMethod] = useState<(typeof PAYMENT_METHODS)[number]>('ESCROW');
  const [creditDays, setCreditDays] = useState(45);

  const [lines, setLines] = useState<DraftLine[]>([newLine()]);

  // ── Linking state ───────────────────────────────────────────────────────
  const [linkEnabled, setLinkEnabled] = useState(false);
  const [linkSearch, setLinkSearch] = useState('');
  const [linkedPoId, setLinkedPoId] = useState<string | null>(null);
  /** customerPoLineId → { supplierLineIndex, qty } */
  const [mappings, setMappings] = useState<Record<string, { idx: number; qty: number }>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);

  /**
   * Arriving from a customer order's coverage view with ?forCustomerPo=… .
   *
   * The operator has already decided what they are buying and why, so the form
   * opens with the link on, that order selected, and one line per SHORT line at
   * the outstanding quantity — retyping what the previous screen already knew is
   * how quantities get mistyped.
   */
  const prefillFor = searchParams.get('forCustomerPo');
  const [prefilled, setPrefilled] = useState(false);
  useEffect(() => {
    if (prefilled || !prefillFor) return;
    const po = linkablePos.find((p) => p.id === prefillFor);
    if (!po) return;
    const short = po.lines.filter((l) => l.remainingQty > 0);
    if (short.length === 0) return;

    setMode('supplier');
    setLinkEnabled(true);
    setLinkedPoId(po.id);
    setLines(
      short.map((l) => ({
        ...newLine(),
        mpn: l.mpn,
        manufacturer: l.manufacturer,
        description: l.description,
        hsnCode: l.hsnCode,
        quantity: l.remainingQty,
        // Their price is a starting point, not the buy price — that is negotiated,
        // so it is left at zero to be entered deliberately.
        unitPrice: 0,
        testingRequired: l.testingRequired,
      })),
    );
    setPrefilled(true);
    toast.info(`Prefilled from ${po.poNumber}`, {
      description: `${short.length} short line${short.length === 1 ? '' : 's'} at the outstanding quantities. Enter the supplier and the prices you have agreed.`,
      duration: 10000,
    });
  }, [prefillFor, prefilled, linkablePos]);

  const supplier = suppliers.find((s) => s.id === supplierId);
  const customer = customers.find((c) => c.id === customerId);

  /** PO date plus the longest lead time on any line, unless overridden by hand. */
  const derivedRequestedDate = useMemo(() => {
    if (requestedDateOverride) return requestedDateOverride;
    const leads = lines.map((l) => l.leadTimeDays).filter((n): n is number => n != null && n > 0);
    if (!leads.length || !poDate) return '';
    const d = new Date(poDate);
    d.setDate(d.getDate() + Math.max(...leads));
    return d.toISOString().slice(0, 10);
  }, [requestedDateOverride, lines, poDate]);
  const longestLead = useMemo(() => {
    const leads = lines.map((l) => l.leadTimeDays).filter((n): n is number => n != null && n > 0);
    return leads.length ? Math.max(...leads) : null;
  }, [lines]);
  const linkedPo = linkablePos.find((p) => p.id === linkedPoId) ?? null;

  const setLine = (key: string, patch: Partial<DraftLine>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  /** Choosing a known part fills the fields nobody wants to retype. */
  const applyMpn = (key: string, mpn: string) => {
    const meta = mpns.find((m) => m.mpn.toLowerCase() === mpn.trim().toLowerCase());
    if (!meta) {
      setLine(key, { mpn });
      return;
    }
    setLine(key, {
      mpn: meta.mpn,
      manufacturer: meta.manufacturer,
      description: meta.description,
      hsnCode: meta.hsnCode,
      uom: meta.uom,
      msl: meta.msl ?? '',
      packaging: meta.packaging ?? '',
      countryOfOrigin: meta.countryOfOrigin ?? '',
    });
  };

  /**
   * Turns imported rows into draft lines.
   *
   * The catalogue fills the blanks: an imported row need only carry the part
   * number and quantity, and anything the catalogue knows (maker, description,
   * HSN, packaging, country of origin) comes from there. What the file DID say
   * wins over the catalogue, because the buyer typed it for a reason — a
   * manufacturer override on a second-source part is a deliberate act.
   */
  const applyImport = (imported: ImportedLine[], mode: 'replace' | 'append') => {
    const drafted: DraftLine[] = imported.map((row) => {
      const meta = mpns.find((m) => m.mpn.toLowerCase() === row.mpn.toLowerCase());
      const base = newLine();
      return {
        ...base,
        mpn: meta?.mpn ?? row.mpn,
        manufacturer: row.manufacturer ?? meta?.manufacturer ?? '',
        description: row.description ?? meta?.description ?? '',
        hsnCode: row.hsnCode ?? meta?.hsnCode ?? '',
        uom: meta?.uom ?? base.uom,
        msl: meta?.msl ?? '',
        packaging: meta?.packaging ?? '',
        countryOfOrigin: meta?.countryOfOrigin ?? '',
        quantity: row.quantity,
        unitPrice: row.unitPrice ?? 0,
        leadTimeDays: row.leadTimeDays,
        dateCodeLot: row.dateCodeLot ?? '',
        testingRequired: row.testingRequired,
        remarks: row.remarks ?? '',
      };
    });
    setLines((prev) => {
      if (mode === 'replace') return drafted;
      // Drop the blank starter row rather than leaving it above the import.
      const kept = prev.filter((l) => l.mpn.trim() || l.quantity > 0);
      return [...kept, ...drafted];
    });
  };

  /** Paste a block from Excel: MPN, qty, price per row. */
  const handlePaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text/plain');
    if (!text.includes('\t') && !text.includes('\n')) return;
    e.preventDefault();
    const rows = text
      .split(/\r?\n/)
      .map((r) => r.split('\t'))
      .filter((r) => r.some((c) => c.trim().length > 0));
    if (rows.length === 0) return;

    const parsed: DraftLine[] = rows.map((cols) => {
      const base = newLine();
      const mpn = (cols[0] ?? '').trim();
      const meta = mpns.find((m) => m.mpn.toLowerCase() === mpn.toLowerCase());
      return {
        ...base,
        mpn,
        manufacturer: meta?.manufacturer ?? (cols[1] ?? '').trim(),
        description: meta?.description ?? '',
        hsnCode: meta?.hsnCode ?? '',
        uom: meta?.uom ?? 'PCS',
        quantity: Number((cols[2] ?? cols[1] ?? '0').replace(/[^\d.-]/g, '')) || 0,
        unitPrice: Number((cols[3] ?? '0').replace(/[^\d.-]/g, '')) || 0,
      };
    });
    setLines((prev) => {
      const kept = prev.filter((l) => l.mpn.trim().length > 0);
      return [...kept, ...parsed];
    });
    toast.success(`${parsed.length} line${parsed.length === 1 ? '' : 's'} pasted`);
  };

  // ── Live reconciliation (§3.2 point 3) ──────────────────────────────────
  const reconciliation = useMemo(() => {
    if (!linkedPo) return null;
    const rows = Object.entries(mappings)
      .map(([clId, m]) => {
        const cl = linkedPo.lines.find((l) => l.id === clId);
        const sl = lines[m.idx];
        if (!cl || !sl) return null;
        const sellMinor = toMinor(m.qty * cl.unitPrice, linkedPo.currency);
        const buyMinorInr = toMinor(m.qty * sl.unitPrice * fxRate, 'INR');
        const margin = sellMinor - buyMinorInr;
        return {
          clId,
          mpn: cl.mpn,
          required: cl.remainingQty,
          covered: m.qty,
          sellMinor,
          buyMinorInr,
          margin,
          marginPct: sellMinor > 0 ? (margin / sellMinor) * 100 : 0,
          mpnMismatch: sl.mpn.trim().toLowerCase() !== cl.mpn.trim().toLowerCase(),
          over: m.qty > cl.remainingQty,
        };
      })
      .filter(Boolean) as NonNullable<ReturnType<() => never>>[] as {
      clId: string;
      mpn: string;
      required: number;
      covered: number;
      sellMinor: number;
      buyMinorInr: number;
      margin: number;
      marginPct: number;
      mpnMismatch: boolean;
      over: boolean;
    }[];

    const sell = rows.reduce((a, r) => a + r.sellMinor, 0);
    const buy = rows.reduce((a, r) => a + r.buyMinorInr, 0);
    const margin = sell - buy;
    const orderedRemaining = linkedPo.lines.reduce((a, l) => a + l.remainingQty, 0);
    const covered = rows.reduce((a, r) => a + r.covered, 0);
    return {
      rows,
      sell,
      buy,
      margin,
      marginPct: sell > 0 ? (margin / sell) * 100 : 0,
      coveragePct: orderedRemaining > 0 ? (covered / orderedRemaining) * 100 : 0,
    };
  }, [linkedPo, mappings, lines, fxRate]);

  // ── Warnings, never blockers (§3.2 point 4) ─────────────────────────────
  const warnings = useMemo(() => {
    const out: string[] = [];
    if (!linkedPo || !reconciliation) return out;
    if (linkedPo.currency !== 'INR' && currency !== linkedPo.currency) {
      out.push(
        `The customer PO is in ${linkedPo.currency} and this supplier PO is in ${currency}. Check the exchange rate before issuing.`,
      );
    }
    if (derivedRequestedDate && linkedPo.requestedDeliveryDate) {
      if (new Date(derivedRequestedDate) > new Date(linkedPo.requestedDeliveryDate)) {
        out.push(
          `Your required delivery date is later than the date the customer asked for (${formatDate(linkedPo.requestedDeliveryDate)}).`,
        );
      }
    }
    if (reconciliation.marginPct < 0) {
      out.push('This mapping loses money — the buy price is above the sell price.');
    } else if (reconciliation.marginPct < marginFloorPct) {
      out.push(
        `Margin of ${reconciliation.marginPct.toFixed(1)}% is below the ${marginFloorPct}% floor.`,
      );
    }
    for (const r of reconciliation.rows) {
      if (r.mpnMismatch)
        out.push(`Line ${r.mpn}: the supplier line is a different part number to the customer line.`);
      if (r.over)
        out.push(`Line ${r.mpn}: allocating ${r.covered} exceeds the ${r.required} still needed.`);
    }
    // Testing flag mismatch between the two POs.
    for (const [clId, m] of Object.entries(mappings)) {
      const cl = linkedPo.lines.find((l) => l.id === clId);
      const sl = lines[m.idx];
      if (cl && sl && cl.testingRequired !== sl.testingRequired) {
        out.push(
          `Line ${cl.mpn}: the customer ${cl.testingRequired ? 'requires' : 'does not require'} testing but the supplier line says ${sl.testingRequired ? 'it does' : 'it does not'}.`,
        );
      }
    }
    return out;
  }, [linkedPo, reconciliation, currency, derivedRequestedDate, marginFloorPct, mappings, lines]);

  // ── Work order name preview ─────────────────────────────────────────────
  const namePreview = useMemo(() => {
    if (!linkedPo) return null;
    const pi = linkedPo.piNumber ?? 'PI-PENDING';
    const po = supplierPoNumber.trim() || 'PO-1B-####';
    return `${linkedPo.poNumber}_${pi}_${po}_SPI-PENDING`;
  }, [linkedPo, supplierPoNumber]);

  // ── Submit ──────────────────────────────────────────────────────────────
  const validLines = lines.filter((l) => l.mpn.trim() && l.quantity > 0);

  const submitCustomer = () => {
    startTransition(async () => {
      const res = await createCustomerPo({
        customerId,
        poNumber,
        poDate,
        currency: 'INR',
        incoterms,
        paymentTerms,
        requestedDeliveryDate: derivedRequestedDate || null,
        shipToAddress: shipTo.trim() || null,
        billToAddress: (billToDiffers ? billTo : shipTo).trim() || null,
        notes: notes || null,
        sourcingRef: sourcingRef || null,
        lines: validLines.map((l) => ({
          mpn: l.mpn,
          manufacturer: l.manufacturer || 'Unknown',
          description: l.description || l.mpn,
          hsnCode: l.hsnCode,
          quantity: l.quantity,
          uom: l.uom,
          unitPrice: l.unitPrice,
          leadTimeDays: l.leadTimeDays,
          dateCodeLot: l.dateCodeLot || null,
          testingRequired: l.testingRequired,
          remarks: l.remarks || null,
        })),
      });
      if (res.ok) {
        toast.success(res.message);
        await pushAttachments(
          { customerPoId: res.customerPoId },
          'CUSTOMER_PO',
          'Customer purchase order as received',
        );
        setLines([newLine()]);
        setPoNumber('');
        setAttachments([]);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  /** Uploads whatever was chosen, once there is a record to hang it on. */
  const pushAttachments = async (
    target: { customerPoId?: string; supplierPoId?: string },
    docType: string,
    title: string,
  ) => {
    if (attachments.length === 0) return;
    const { uploaded, failed } = await uploadChosenFiles(
      attachments,
      target,
      docType,
      title,
      uploadRecordDocument,
    );
    if (uploaded > 0) {
      toast.success(`${uploaded} file${uploaded === 1 ? '' : 's'} attached.`);
    }
    for (const f of failed) {
      toast.error(`${f.name} was not attached.`, { description: f.message, duration: 10000 });
    }
  };

  const submitSupplier = () => {
    startTransition(async () => {
      const res = await createSupplierPo({
        supplierId,
        poNumber: supplierPoNumber || null,
        poDate,
        currency,
        fxRate,
        incoterms,
        paymentMethod,
        creditDays: paymentMethod === 'CREDIT' ? creditDays : null,
        requiredDeliveryDate: derivedRequestedDate || null,
        notes: notes || null,
        sourcingRef: sourcingRef || null,
        lines: validLines.map((l) => ({
          mpn: l.mpn,
          manufacturer: l.manufacturer || 'Unknown',
          description: l.description || l.mpn,
          hsnCode: l.hsnCode,
          quantity: l.quantity,
          uom: l.uom,
          unitPrice: l.unitPrice,
          testingRequired: l.testingRequired,
          testScope: l.testingRequired ? (l.testScope || 'LOT_SAMPLE') : null,
          sampleSize: l.testingRequired && l.testScope === 'LOT_SAMPLE' ? (l.sampleSize ?? 50) : null,
          aql: l.testingRequired && l.testScope === 'LOT_SAMPLE' ? (l.aql || 'AQL 1.0') : null,
          leadTimeDays: l.leadTimeDays,
          countryOfOrigin: l.countryOfOrigin || null,
          dateCodeLot: l.dateCodeLot || null,
          msl: l.msl || null,
          packaging: l.packaging || null,
          remarks: l.remarks || null,
        })),
        link:
          linkEnabled && linkedPo
            ? {
                customerPoId: linkedPo.id,
                customerPiId: linkedPo.piId,
                mappings: Object.entries(mappings).map(([clId, m]) => ({
                  customerPoLineId: clId,
                  supplierLineIndex: m.idx,
                  allocatedQty: m.qty,
                })),
              }
            : null,
      });
      setConfirmOpen(false);
      if (res.ok) {
        toast.success(res.message);
        // Uploaded before navigating: leaving the page first would abandon the
        // files the operator just chose.
        await pushAttachments(
          { supplierPoId: res.supplierPoId },
          'SUPPLIER_PO',
          'Supplier purchase order as issued',
        );
        setAttachments([]);
        if (res.id && res.alias) router.push(`/orders/${res.id}`);
        else router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  const canSubmit =
    mode === 'customer'
      ? Boolean(customerId && poNumber.trim() && validLines.length > 0)
      : Boolean(supplierId && supplier?.selectable && validLines.length > 0);

  const mappedCount = Object.keys(mappings).length;

  return (
    <PageShell width="full">
      <PageHeader
        title="Create PO"
        plainTitle="Create purchase order"
        description="Record the order a customer sent us, or raise our own order to an approved supplier. Linking the two creates the internal work order."
      />

      {/* ── Segmented control ─────────────────────────────────────────────── */}
      <div className="border-line-subtle bg-surface-1 mb-4 inline-flex min-w-0 max-w-full overflow-x-auto rounded-[10px] border p-1">
        {(
          [
            { id: 'customer' as Mode, label: 'Customer PO', plain: "Customer's order", hint: 'The order a customer sent us. This is where every job starts.' },
            { id: 'supplier' as Mode, label: 'Supplier PO', plain: 'Our order to a supplier', hint: 'Our order to an approved vendor. Link it to a customer PO to create a work order.' },
          ]
        ).map((t) => (
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

      <div className="grid min-w-0 grid-cols-1 gap-4">
        {/* ── Where this order came from ───────────────────────────────────
            First, deliberately. The enquiry precedes the order in real life, so
            it precedes it on the form — and it is the one field that reaches back
            to work already done outside this platform. */}
        <Panel>
          <Field label="RFQ / Sourcing ID" termKey="sourcingRef">
            <input
              value={sourcingRef}
              onChange={(e) => setSourcingRef(e.target.value)}
              placeholder="e.g. RFQBUNDLE_7741"
              className={cn(inputCls, 'sm:max-w-[340px]')}
            />
            <p className="text-fg-tertiary mt-1 max-w-[min(80ch,100%)] text-[11.5px] leading-relaxed">
              The enquiry this order came out of, from the sourcing step. Sourcing is not part of
              this platform yet, so this is the handle that ties the two together — it carries onto
              the linked documents and prints on the purchase order as the supplier&rsquo;s
              reference. Leave blank if the order did not come from an enquiry.
            </p>
          </Field>
        </Panel>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <Panel>
          <PanelHeader
            title={mode === 'customer' ? "Customer's order details" : 'Our order to the supplier'}
            description={
              mode === 'customer'
                ? 'Enter it exactly as the customer sent it — their PO number is how they will refer to it.'
                : 'Only suppliers approved on the AVL can be chosen. Expired approvals are blocked.'
            }
          />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {mode === 'customer' ? (
              <>
                <Field label="Customer" required>
                  <select
                    value={customerId}
                    onChange={(e) => {
                      setCustomerId(e.target.value);
                      const c = customers.find((x) => x.id === e.target.value);
                      if (c) {
                        setPaymentTerms(c.paymentTerms);
                        setShipTo(c.addressBlock);
                        if (!billToDiffers) setBillTo(c.addressBlock);
                      }
                    }}
                    className={inputCls}
                  >
                    <option value="">Choose a customer…</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} — {c.stateName}
                        {c.isSez ? ' (SEZ)' : ''}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Their PO number" required termKey="canonicalName">
                  <input
                    value={poNumber}
                    onChange={(e) => setPoNumber(e.target.value)}
                    placeholder="e.g. CPO-ACME-0051"
                    className={inputCls}
                  />
                </Field>
              </>
            ) : (
              <>
                <Field label="Supplier (AVL only)" required termKey="avlStatus">
                  <select
                    value={supplierId}
                    onChange={(e) => {
                      setSupplierId(e.target.value);
                      const s = suppliers.find((x) => x.id === e.target.value);
                      if (s) {
                        setCurrency(s.currency);
                        setIncoterms(s.incoterms);
                        setFxRate(s.currency === 'INR' ? 1 : 83.2);
                      }
                    }}
                    className={inputCls}
                  >
                    <option value="">Choose an approved supplier…</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id} disabled={!s.selectable}>
                        {s.name} — {s.country}
                        {s.selectable ? '' : ` · ${s.avlStatus} — cannot be used`}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Our PO number" hint="Left blank, we generate the next one.">
                  <input
                    value={supplierPoNumber}
                    onChange={(e) => setSupplierPoNumber(e.target.value)}
                    placeholder="Auto-generated"
                    className={inputCls}
                  />
                </Field>
              </>
            )}

            <Field label="PO date" required>
              <input
                type="date"
                value={poDate}
                onChange={(e) => setPoDate(e.target.value)}
                className={inputCls}
              />
            </Field>
            {/* Derived, not typed. Shown rather than hidden, and overridable —
                a customer can always name a date the lead times do not imply. */}
            <Field
              label={mode === 'customer' ? 'Delivery date' : 'Required by'}
              hint={
                longestLead
                  ? `PO date plus the longest lead time on any line (${longestLead} days). Type over it if the ${mode === 'customer' ? 'customer named' : 'supplier committed to'} a different date.`
                  : 'Set a lead time on a line below and this fills itself in, or type a date.'
              }
            >
              <input
                type="date"
                value={derivedRequestedDate}
                onChange={(e) => setRequestedDateOverride(e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Incoterms" termKey="incoterms">
              <select
                value={incoterms}
                onChange={(e) => setIncoterms(e.target.value)}
                className={inputCls}
              >
                {INCOTERMS.map((i) => (
                  <option key={i} value={i}>
                    {i} — {INCOTERM_DEFS[i].name}
                  </option>
                ))}
              </select>
            </Field>

            {mode === 'customer' ? (
              <Field label="Payment terms" termKey="paymentTerms">
                <input
                  value={paymentTerms}
                  onChange={(e) => setPaymentTerms(e.target.value)}
                  className={inputCls}
                />
              </Field>
            ) : (
              <>
                <Field label="Currency">
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className={inputCls}
                  >
                    {['USD', 'INR', 'EUR', 'SGD'].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Exchange rate (locked)" termKey="fxRate">
                  <input
                    type="number"
                    step="0.01"
                    value={fxRate}
                    onChange={(e) => setFxRate(Number(e.target.value))}
                    disabled={currency === 'INR'}
                    className={inputCls}
                  />
                </Field>
                <Field label="Payment method" required termKey="paymentMethod">
                  <select
                    value={paymentMethod}
                    onChange={(e) =>
                      setPaymentMethod(e.target.value as (typeof PAYMENT_METHODS)[number])
                    }
                    className={inputCls}
                  >
                    {PAYMENT_METHODS.map((p) => (
                      <option key={p} value={p}>
                        {PAYMENT_METHOD_META[p].label} — {PAYMENT_METHOD_META[p].plainLabel}
                      </option>
                    ))}
                  </select>
                </Field>
                {paymentMethod === 'CREDIT' && (
                  <Field label="Credit days">
                    <input
                      type="number"
                      value={creditDays}
                      onChange={(e) => setCreditDays(Number(e.target.value))}
                      className={inputCls}
                    />
                  </Field>
                )}
              </>
            )}
          </div>

          {/* Contextual detail about the chosen party */}
          {mode === 'customer' && customer && (
            <>
              <div className="border-line-subtle mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
                <Chip size="sm">{customer.stateName}</Chip>
                {customer.gstin && <MonoId value={customer.gstin} copyable={false} />}
                {customer.isSez && (
                  <Chip tone="info" size="sm">
                    SEZ — supply will be zero-rated
                  </Chip>
                )}
                <span className="text-fg-tertiary text-[11.5px]">
                  {customer.contactName} · {customer.contactEmail}
                  {customer.contactPhone ? ` · ${customer.contactPhone}` : ''}
                </span>
              </div>

              {/* ── Addresses ──────────────────────────────────────────────
                  Filled from the customer record, editable for this order only.
                  A delivery frequently goes somewhere other than the registered
                  address, and fixing that here must not rewrite the master. */}
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                <Field
                  label="Deliver to"
                  hint="From the customer's record. Change it for a one-off delivery address — the master record is untouched."
                >
                  <textarea
                    value={shipTo}
                    onChange={(e) => {
                      setShipTo(e.target.value);
                      if (!billToDiffers) setBillTo(e.target.value);
                    }}
                    rows={5}
                    placeholder="Name, street, city, pincode, state, country, GSTIN"
                    className={cn(inputCls, 'resize-y leading-relaxed')}
                  />
                </Field>
                <Field
                  label="Invoice to"
                  hint={
                    billToDiffers
                      ? 'Kept separate from the delivery address.'
                      : 'Follows the delivery address. Tick below if the invoice goes elsewhere.'
                  }
                >
                  <textarea
                    value={billTo}
                    onChange={(e) => {
                      setBillTo(e.target.value);
                      setBillToDiffers(true);
                    }}
                    rows={5}
                    disabled={!billToDiffers}
                    placeholder="Name, street, city, pincode, state, country, GSTIN"
                    className={cn(
                      inputCls,
                      'resize-y leading-relaxed',
                      !billToDiffers && 'opacity-70',
                    )}
                  />
                  <label className="text-fg-secondary mt-1.5 flex cursor-pointer items-start gap-2 text-[11.5px]">
                    <input
                      type="checkbox"
                      checked={billToDiffers}
                      onChange={(e) => {
                        setBillToDiffers(e.target.checked);
                        if (!e.target.checked) setBillTo(shipTo);
                      }}
                      className="accent-accent mt-0.5 size-3.5 shrink-0"
                    />
                    <span>
                      The invoice goes to a different address
                      <span className="text-fg-tertiary block text-[11px] leading-relaxed">
                        Common where a head office pays for deliveries to a plant. Leave unticked and
                        it mirrors the delivery address.
                      </span>
                    </span>
                  </label>
                </Field>
              </div>
            </>
          )}
          {mode === 'supplier' && supplier && (
            <div className="border-line-subtle mt-3 border-t pt-3">
              {supplier.selectable ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone="success" icon={BadgeCheck} size="sm">
                    Approved to {formatDate(supplier.approvedUpto)}
                  </Chip>
                  <Chip size="sm">
                    {supplier.city}, {supplier.country}
                  </Chip>
                  <Chip size="sm">Quality {supplier.qualityRating.toFixed(1)}/5</Chip>
                  <Chip size="sm">Delivery {supplier.deliveryRating.toFixed(1)}/5</Chip>
                  <Chip
                    tone={supplier.riskScore > 45 ? 'warning' : 'neutral'}
                    size="sm"
                  >
                    Risk {supplier.riskScore}/100
                  </Chip>
                  {supplier.isForeign && (
                    <Chip tone="info" size="sm">
                      Import — customs will apply
                    </Chip>
                  )}
                </div>
              ) : (
                <div className="border-danger-border bg-danger-subtle flex items-start gap-2 rounded-[8px] border px-2.5 py-2">
                  <AlertTriangle className="text-danger mt-0.5 size-4 shrink-0" aria-hidden />
                  <span className="text-danger text-[12px]">{supplier.blockedReason}</span>
                </div>
              )}
            </div>
          )}
        </Panel>

        {importOpen && (
          <BulkLineImportDialog
            onOpenChange={setImportOpen}
            onImport={applyImport}
            existingLineCount={lines.filter((l) => l.mpn.trim() || l.quantity > 0).length}
          />
        )}

        {/* ── Line items ─────────────────────────────────────────────────── */}
        <Panel padded={false}>
          <div className="p-4 pb-0">
            <PanelHeader
              title="Parts"
              description="Type a part number and the rest fills in from the catalogue, or bring a whole list in from a CSV or Excel sheet."
              actions={
                <span className="flex flex-wrap items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={FileSpreadsheet}
                    onClick={() => setImportOpen(true)}
                  >
                    Import from a sheet
                  </Button>
                  <Button size="sm" icon={Plus} onClick={() => setLines((p) => [...p, newLine()])}>
                    Add line
                  </Button>
                </span>
              }
            />
          </div>
          <div className="overflow-x-auto" onPaste={handlePaste}>
            <table className="w-full border-collapse text-left text-[12.5px]">
              <thead className="bg-surface-inset">
                <tr className="border-line-subtle border-y">
                  <ThMini termKey="mpn" width="180px">Part number</ThMini>
                  <ThMini width="150px">Manufacturer</ThMini>
                  <ThMini termKey="hsnCode" width="110px">HSN</ThMini>
                  <ThMini termKey="quantity" align="right" width="110px">Qty</ThMini>
                  <ThMini termKey="unitPrice" align="right" width="120px">Unit price</ThMini>
                  <ThMini align="right" width="130px">Line total</ThMini>
                  <ThMini termKey="testingRequired" width="150px">Testing</ThMini>
                  <ThMini termKey="leadTimeDays" align="right" width="110px">
                    Lead time
                  </ThMini>
                  {/* Both modes: the customer states the date code they will
                      accept, and the supplier states what they are shipping. Being
                      able to compare the two is the point. */}
                  <ThMini termKey="dateCodeLot" width="130px">Date code</ThMini>
                  <ThMini width="40px"> </ThMini>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.key} className="border-line-subtle border-b last:border-0">
                    <td className="px-2 py-1.5">
                      <PartCombobox
                        value={l.mpn}
                        options={mpns}
                        onChange={(v) => setLine(l.key, { mpn: v })}
                        onPick={(o) => applyMpn(l.key, o.mpn)}
                        placeholder="STM32F407VGT6"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        value={l.manufacturer}
                        onChange={(e) => setLine(l.key, { manufacturer: e.target.value })}
                        className={inputCls}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        value={l.hsnCode}
                        onChange={(e) => setLine(l.key, { hsnCode: e.target.value })}
                        placeholder="85423100"
                        className={cn(inputCls, 'font-mono')}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        min={0}
                        value={l.quantity || ''}
                        onChange={(e) => setLine(l.key, { quantity: Number(e.target.value) })}
                        className={cn(inputCls, 'tnum text-right')}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        step="0.0001"
                        min={0}
                        value={l.unitPrice || ''}
                        onChange={(e) => setLine(l.key, { unitPrice: Number(e.target.value) })}
                        className={cn(inputCls, 'tnum text-right')}
                      />
                    </td>
                    <td className="tnum px-2 py-1.5 text-right">
                      <Money
                        amount={toMinor(l.quantity * l.unitPrice, mode === 'customer' ? 'INR' : currency)}
                        currency={mode === 'customer' ? 'INR' : currency}
                        withCode={false}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={l.testingRequired}
                          onChange={(e) => setLine(l.key, { testingRequired: e.target.checked })}
                          aria-label="Testing required"
                          className="accent-accent size-3.5"
                        />
                        {mode === 'supplier' && l.testingRequired && (
                          <select
                            value={l.testScope}
                            onChange={(e) => setLine(l.key, { testScope: e.target.value })}
                            className={cn(inputCls, 'py-0.5 text-[11px]')}
                          >
                            <option value="">Scope…</option>
                            {TEST_SCOPES.map((s) => (
                              <option key={s} value={s}>
                                {TEST_SCOPE_META[s].label}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        min={0}
                        max={999}
                        value={l.leadTimeDays ?? ''}
                        onChange={(e) =>
                          setLine(l.key, {
                            leadTimeDays: e.target.value === '' ? null : Number(e.target.value),
                          })
                        }
                        placeholder={mode === 'customer' ? 'promised' : 'quoted'}
                        aria-label="Lead time in days"
                        className={cn(inputCls, 'text-right')}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        value={l.dateCodeLot}
                        onChange={(e) => setLine(l.key, { dateCodeLot: e.target.value })}
                        placeholder={mode === 'customer' ? '2419+ required' : '2438 / LOT-A1'}
                        aria-label="Date code or lot"
                        className={cn(inputCls, 'font-mono text-[11px]')}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <button
                        type="button"
                        onClick={() => setLines((p) => (p.length > 1 ? p.filter((x) => x.key !== l.key) : p))}
                        disabled={lines.length === 1}
                        aria-label="Remove line"
                        className="text-fg-tertiary hover:text-danger disabled:opacity-30"
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-surface-inset">
                <tr className="border-line-subtle border-t font-semibold">
                  <td className="px-2 py-2" colSpan={3}>
                    {validLines.length} valid line{validLines.length === 1 ? '' : 's'}
                  </td>
                  <td className="tnum px-2 py-2 text-right">
                    {validLines.reduce((a, l) => a + l.quantity, 0).toLocaleString('en-IN')}
                  </td>
                  <td />
                  <td className="tnum px-2 py-2 text-right">
                    <Money
                      amount={validLines.reduce(
                        (a, l) => a + toMinor(l.quantity * l.unitPrice, mode === 'customer' ? 'INR' : currency),
                        0,
                      )}
                      currency={mode === 'customer' ? 'INR' : currency}
                    />
                  </td>
                  <td colSpan={mode === 'supplier' ? 3 : 2} />
                </tr>
              </tfoot>
            </table>
          </div>
        </Panel>

        <Panel>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <Field label="Notes">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Anything worth recording about this order…"
                className={inputCls}
              />
            </Field>
            <FileAttachField
              label={mode === 'customer' ? 'Attach the customer’s order' : 'Attach the order as sent'}
              help={
                mode === 'customer'
                  ? 'Their purchase order as you received it — the document we are acting on. Uploaded once the order is saved.'
                  : 'The signed or sent copy of this purchase order, plus anything the supplier quoted against.'
              }
              files={attachments}
              onChange={setAttachments}
            />
          </div>
        </Panel>

        {/* ══════════════════════════════════════════════════════════════════
            THE LINKING FIELD — at the bottom, immediately above Save (§3.2)
            ══════════════════════════════════════════════════════════════════ */}
        {mode === 'supplier' && (
          <Panel className="border-accent-border">
            <label className="flex min-w-0 cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                checked={linkEnabled}
                onChange={(e) => {
                  setLinkEnabled(e.target.checked);
                  if (!e.target.checked) {
                    setLinkedPoId(null);
                    setMappings({});
                  }
                }}
                className="accent-accent mt-0.5 size-4 shrink-0"
              />
              <span className="min-w-0">
                <span className="text-fg flex items-center gap-1.5 text-[13.5px] font-semibold">
                  <Link2 className="text-accent size-4 shrink-0" aria-hidden />
                  Link this PO with Customer PO
                  <ChevronDown
                    className={cn(
                      'text-fg-tertiary size-3.5 transition-transform',
                      linkEnabled && 'rotate-180',
                    )}
                    aria-hidden
                  />
                </span>
                <span className="text-fg-tertiary mt-0.5 block text-[12px] leading-relaxed">
                  Tick this to tie our order to the customer&apos;s order. Doing so creates the
                  internal work order that tracks the job end to end.
                </span>
              </span>
            </label>

            <AnimatePresence initial={false}>
              {linkEnabled && (
                <motion.div
                  key="link-panel"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.24, ease: [0.32, 0.72, 0, 1] }}
                  className="overflow-hidden"
                >
                  <div className="border-line-subtle mt-3 border-t pt-3">
                    {/* Searchable selector */}
                    <SectionLabel>Which customer order does this cover?</SectionLabel>
                    <div className="relative mb-2 max-w-[420px]">
                      <Search
                        className="text-fg-tertiary pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
                        aria-hidden
                      />
                      <input
                        value={linkSearch}
                        onChange={(e) => setLinkSearch(e.target.value)}
                        placeholder="Search by customer, PO number or part…"
                        className={cn(inputCls, 'pl-8')}
                      />
                    </div>

                    {linkablePos.length === 0 ? (
                      <EmptyState
                        compact
                        title="No customer orders waiting to be sourced"
                        description="Every customer PO is already fully covered by a supplier order."
                      />
                    ) : (
                      <ul className="mb-3 grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
                        {linkablePos
                          .filter((p) => {
                            const q = linkSearch.trim().toLowerCase();
                            if (!q) return true;
                            return (
                              p.poNumber.toLowerCase().includes(q) ||
                              p.customerName.toLowerCase().includes(q) ||
                              p.lines.some((l) => l.mpn.toLowerCase().includes(q))
                            );
                          })
                          .map((p) => {
                            const selected = linkedPoId === p.id;
                            return (
                              <li key={p.id} className="min-w-0">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setLinkedPoId(p.id);
                                    // Pre-map by matching part number where we can.
                                    const auto: Record<string, { idx: number; qty: number }> = {};
                                    p.lines.forEach((cl) => {
                                      const idx = lines.findIndex(
                                        (sl) => sl.mpn.trim().toLowerCase() === cl.mpn.toLowerCase(),
                                      );
                                      if (idx >= 0 && cl.remainingQty > 0)
                                        auto[cl.id] = { idx, qty: cl.remainingQty };
                                    });
                                    setMappings(auto);
                                  }}
                                  className={cn(
                                    'w-full rounded-[9px] border p-2.5 text-left transition-colors',
                                    selected
                                      ? 'border-accent bg-accent-subtle'
                                      : 'border-line-subtle hover:bg-surface-3',
                                  )}
                                >
                                  <div className="flex min-w-0 items-center justify-between gap-2">
                                    <MonoId value={p.poNumber} copyable={false} />
                                    {selected && <Check className="text-accent size-3.5 shrink-0" aria-hidden />}
                                  </div>
                                  <div className="text-fg-secondary mt-0.5 truncate text-[12px]">
                                    {p.customerName}
                                  </div>
                                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                    <Chip
                                      tone={
                                        p.coveragePct === 0
                                          ? 'neutral'
                                          : p.coveragePct >= 100
                                            ? 'success'
                                            : 'warning'
                                      }
                                      size="sm"
                                    >
                                      {p.coveragePct === 0
                                        ? 'Unlinked'
                                        : `${p.coveragePct.toFixed(0)}% linked`}
                                    </Chip>
                                    <span className="text-fg-tertiary text-[10.5px]">
                                      {p.lines.length} line{p.lines.length === 1 ? '' : 's'}
                                    </span>
                                    <span className="text-fg-tertiary text-[10.5px]">
                                      {formatDate(p.poDate)}
                                    </span>
                                  </div>
                                  <div className="text-fg mt-1 text-[12.5px] font-semibold">
                                    <Money amount={p.totalValue} currency={p.currency} />
                                  </div>
                                </button>
                              </li>
                            );
                          })}
                      </ul>
                    )}

                    {/* Side-by-side mapping grid */}
                    {linkedPo && (
                      <>
                        <SectionLabel>Map each customer line to one of our supplier lines</SectionLabel>
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[760px] border-collapse text-left text-[12px]">
                            <thead className="bg-surface-inset">
                              <tr className="border-line-subtle border-y">
                                <ThMini width="230px">Customer line</ThMini>
                                <ThMini align="right" width="90px">Still needed</ThMini>
                                <ThMini width="30px"> </ThMini>
                                <ThMini width="230px">Our supplier line</ThMini>
                                <ThMini align="right" width="110px">Allocate qty</ThMini>
                                <ThMini align="right" width="110px">Margin</ThMini>
                              </tr>
                            </thead>
                            <tbody>
                              {linkedPo.lines.map((cl) => {
                                const m = mappings[cl.id];
                                const recon = reconciliation?.rows.find((r) => r.clId === cl.id);
                                return (
                                  <tr key={cl.id} className="border-line-subtle border-b last:border-0">
                                    <td className="px-2 py-2">
                                      <div className="font-mono text-[11.5px] font-medium">{cl.mpn}</div>
                                      <div className="text-fg-tertiary truncate text-[10.5px]">
                                        {cl.quantity.toLocaleString('en-IN')} @ {cl.unitPrice}
                                        {cl.testingRequired && ' · testing required'}
                                      </div>
                                    </td>
                                    <td className="tnum px-2 py-2 text-right">
                                      {cl.remainingQty.toLocaleString('en-IN')}
                                      {cl.allocatedQty > 0 && (
                                        <div className="text-fg-tertiary text-[10px]">
                                          {cl.allocatedQty} already sourced
                                        </div>
                                      )}
                                    </td>
                                    <td className="px-1 py-2 text-center">
                                      <ArrowRight className="text-fg-tertiary size-3" aria-hidden />
                                    </td>
                                    <td className="px-2 py-2">
                                      <select
                                        value={m ? String(m.idx) : ''}
                                        onChange={(e) => {
                                          const v = e.target.value;
                                          setMappings((prev) => {
                                            const next = { ...prev };
                                            if (v === '') delete next[cl.id];
                                            else
                                              next[cl.id] = {
                                                idx: Number(v),
                                                qty: prev[cl.id]?.qty ?? cl.remainingQty,
                                              };
                                            return next;
                                          });
                                        }}
                                        className={cn(inputCls, 'text-[11.5px]')}
                                      >
                                        <option value="">Not sourced on this PO</option>
                                        {lines.map((sl, i) =>
                                          sl.mpn.trim() ? (
                                            <option key={sl.key} value={i}>
                                              {sl.mpn} @ {sl.unitPrice} {currency}
                                            </option>
                                          ) : null,
                                        )}
                                      </select>
                                    </td>
                                    <td className="px-2 py-2 text-right">
                                      {m ? (
                                        <input
                                          type="number"
                                          min={1}
                                          value={m.qty}
                                          onChange={(e) =>
                                            setMappings((prev) => ({
                                              ...prev,
                                              [cl.id]: { ...prev[cl.id], qty: Number(e.target.value) },
                                            }))
                                          }
                                          className={cn(
                                            inputCls,
                                            'tnum text-right',
                                            recon?.over && 'border-warning',
                                          )}
                                        />
                                      ) : (
                                        <span className="text-fg-tertiary">—</span>
                                      )}
                                    </td>
                                    <td className="tnum px-2 py-2 text-right">
                                      {recon ? (
                                        <span
                                          className={cn(
                                            recon.marginPct < 0
                                              ? 'text-danger'
                                              : recon.marginPct < marginFloorPct
                                                ? 'text-warning'
                                                : 'text-success',
                                          )}
                                        >
                                          {recon.marginPct.toFixed(1)}%
                                        </span>
                                      ) : (
                                        <span className="text-fg-tertiary">—</span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>

                        {/* Live reconciliation strip */}
                        {reconciliation && mappedCount > 0 && (
                          <div className="border-accent-border bg-accent-subtle mt-3 rounded-[10px] border p-3">
                            <SectionLabel>Live reconciliation</SectionLabel>
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                              <Stat label="Lines mapped">
                                {mappedCount} of {linkedPo.lines.length}
                              </Stat>
                              <Stat label="Coverage">
                                <Pct value={reconciliation.coveragePct} />
                              </Stat>
                              <Stat label="Sell value">
                                <Money amount={reconciliation.sell} />
                              </Stat>
                              <Stat label="Buy value (INR)">
                                <Money amount={reconciliation.buy} />
                              </Stat>
                              <Stat label="Gross margin">
                                <span className="flex flex-wrap items-baseline gap-1.5">
                                  <Money amount={reconciliation.margin} tone="auto" />
                                  <Pct
                                    value={reconciliation.marginPct}
                                    tone="auto"
                                    className="text-[11px]"
                                  />
                                </span>
                              </Stat>
                            </div>
                          </div>
                        )}

                        {/* Warnings, never blockers */}
                        {warnings.length > 0 && (
                          <ul className="border-warning-border bg-warning-subtle mt-3 grid gap-1.5 rounded-[10px] border p-3">
                            <li className="text-warning flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.04em] uppercase">
                              <TriangleAlert className="size-3.5" aria-hidden />
                              {warnings.length} thing{warnings.length === 1 ? '' : 's'} to check — you
                              can still proceed
                            </li>
                            {warnings.map((w) => (
                              <li key={w} className="text-fg-secondary pl-5 text-[12px]">
                                {w}
                              </li>
                            ))}
                          </ul>
                        )}

                        {/* Work order name preview */}
                        {namePreview && (
                          <div className="border-line-subtle bg-surface-inset mt-3 rounded-[10px] border p-3">
                            <div className="flex items-center gap-1.5">
                              <SectionLabel>Work order name that will be created</SectionLabel>
                              <InfoTooltip termKey="canonicalName" />
                            </div>
                            <MonoId value={namePreview} />
                            <p className="text-fg-tertiary mt-1.5 text-[11px] leading-relaxed">
                              The last part stays <span className="font-mono">SPI-PENDING</span> until
                              the supplier&apos;s proforma invoice is recorded, then it completes
                              automatically.
                            </p>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </Panel>
        )}

        {/* ── Save ───────────────────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-wrap items-center gap-2 pb-6">
          <Button
            variant="primary"
            icon={Save}
            disabled={!canSubmit || pending}
            disabledReason={
              !canSubmit
                ? mode === 'customer'
                  ? 'Choose a customer, enter their PO number, and add at least one part.'
                  : supplier && !supplier.selectable
                    ? 'This supplier is not approved on the AVL.'
                    : 'Choose an approved supplier and add at least one part.'
                : undefined
            }
            onClick={() => {
              if (mode === 'customer') submitCustomer();
              else if (linkEnabled && linkedPo) setConfirmOpen(true);
              else submitSupplier();
            }}
          >
            {pending
              ? 'Saving…'
              : mode === 'customer'
                ? 'Save customer PO'
                : linkEnabled && linkedPo
                  ? 'Issue PO & create work order'
                  : 'Issue supplier PO'}
          </Button>
          {mode === 'supplier' && linkEnabled && !linkedPo && (
            <span className="text-fg-tertiary text-[12px]">
              Choose a customer PO above, or untick linking to issue this PO on its own.
            </span>
          )}
        </div>
      </div>

      {/* ── Confirmation dialog (§3.2) ─────────────────────────────────────── */}
      <Dialog.Root open={confirmOpen} onOpenChange={setConfirmOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px]" />
          <Dialog.Content className="bg-surface-1 border-line shadow-e4 fixed top-1/2 left-1/2 z-50 w-[min(92vw,560px)] -translate-x-1/2 -translate-y-1/2 rounded-[14px] border p-5">
            <Dialog.Title className="text-fg text-[15px] font-semibold">
              Create this work order?
            </Dialog.Title>
            <Dialog.Description className="text-fg-secondary mt-1.5 text-[12.5px] leading-relaxed">
              You are about to create work order{' '}
              <span className="text-fg font-mono text-[11.5px]">{namePreview}</span>. This links
              customer PO{' '}
              <span className="text-fg font-medium">{linkedPo?.poNumber}</span> to supplier PO{' '}
              <span className="text-fg font-medium">
                {supplierPoNumber.trim() || 'the next generated number'}
              </span>
              , covering {mappedCount} line{mappedCount === 1 ? '' : 's'} and{' '}
              <span className="text-fg font-medium">
                <Money amount={reconciliation?.sell ?? 0} />
              </span>{' '}
              of value.
            </Dialog.Description>

            {reconciliation && (
              <div className="border-line-subtle bg-surface-inset mt-3 grid grid-cols-3 gap-3 rounded-[10px] border p-3">
                <Stat label="Coverage">
                  <Pct value={reconciliation.coveragePct} />
                </Stat>
                <Stat label="Margin">
                  <Pct value={reconciliation.marginPct} tone="auto" />
                </Stat>
                <Stat label="Payment">{PAYMENT_METHOD_META[paymentMethod].label}</Stat>
              </div>
            )}

            {warnings.length > 0 && (
              <div className="border-warning-border bg-warning-subtle mt-3 rounded-[10px] border p-2.5">
                <span className="text-warning text-[11px] font-semibold">
                  {warnings.length} warning{warnings.length === 1 ? '' : 's'} — proceeding anyway is
                  allowed
                </span>
              </div>
            )}

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Dialog.Close asChild>
                <Button variant="secondary" icon={X}>
                  Go back
                </Button>
              </Dialog.Close>
              <Button variant="primary" icon={Check} onClick={submitSupplier} disabled={pending}>
                {pending ? 'Creating…' : 'Confirm & create'}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </PageShell>
  );
}

// ── Small building blocks ───────────────────────────────────────────────────

const inputCls =
  'bg-surface-1 border-line-subtle focus:border-accent text-fg placeholder:text-fg-tertiary w-full rounded-[7px] border px-2 py-1.5 text-[12.5px] outline-none disabled:opacity-50';

function Field({
  label,
  children,
  required,
  hint,
  termKey,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
  hint?: string;
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
      {hint && <span className="text-fg-tertiary mt-1 block text-[10.5px]">{hint}</span>}
    </label>
  );
}

function ThMini({
  children,
  termKey,
  align = 'left',
  width,
}: {
  children: React.ReactNode;
  termKey?: string;
  align?: 'left' | 'right';
  width?: string;
}) {
  return (
    <th
      scope="col"
      style={width ? { width } : undefined}
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

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-fg-tertiary text-[9.5px] font-semibold tracking-[0.05em] uppercase">
        {label}
      </div>
      <div className="text-fg mt-0.5 text-[12.5px] font-semibold">{children}</div>
    </div>
  );
}

export { StatusChip };
