/**
 * Data for the printed documents — Purchase Order, Proforma Invoice, Work Order.
 *
 * These are the artefacts that leave the building: a supplier acts on the
 * purchase order, a customer pays against the proforma invoice. So the shape
 * here is deliberately flat and fully resolved — a print page must never fall
 * back to "—" because a relation was not included.
 *
 * Anything the operator has not filled in yet gets a sensible standing default
 * rather than a blank, and every default is a documented commercial norm, not a
 * guess dressed up as data.
 */

import { db } from '@/lib/db';
import { amountInWordsAuto } from '@/lib/domain/money';

/** A party as it prints: name on top, then address lines, then identifiers. */
export interface PrintParty {
  name: string;
  lines: string[];
  gstin?: string | null;
  stateName?: string | null;
  cin?: string | null;
  phone?: string | null;
  email?: string | null;
  fax?: string | null;
}

export interface PrintLine {
  lineNo: number;
  mpn: string;
  description: string;
  hsnCode: string;
  quantity: number;
  uom: string;
  unitPrice: number;
  lineTotal: number;
  manufacturer?: string | null;
  extras?: string[];
}

export interface PurchaseOrderDocument {
  kind: 'purchase-order';
  id: string;
  poNumber: string;
  voucherNo: string;
  poDate: Date;
  referenceNo: string | null;
  referenceDate: Date | null;
  paymentTerms: string;
  dispatchedThrough: string;
  destination: string;
  termsOfDelivery: string;
  currency: string;
  invoiceTo: PrintParty;
  consignee: PrintParty;
  supplier: PrintParty;
  lines: PrintLine[];
  totalQuantity: number;
  totalUom: string;
  totalValue: number;
  amountInWords: string;
  terms: string[];
  signatoryFor: string;
  jurisdiction: string | null;
  status: string;
  workOrderAlias: string | null;
  workOrderId: string | null;
}

export interface ProformaInvoiceDocument {
  kind: 'proforma-invoice';
  id: string;
  piNumber: string;
  externalRef: string | null;
  sourcingRef: string | null;
  direction: 'CUSTOMER_PI' | 'SUPPLIER_PI';
  piDate: Date;
  validUntil: Date | null;
  currency: string;
  /** Whoever is issuing — the supplier on a supplier PI, 1BUY on a customer PI. */
  seller: PrintParty;
  buyer: PrintParty;
  attention: string | null;
  shipmentMethod: string;
  originLocation: string;
  destination: string;
  deliveryTime: string;
  paymentTerm: string;
  lines: PrintLine[];
  totalQuantity: number;
  totalUom: string;
  subtotal: number;
  freightAmount: number;
  insuranceAmount: number;
  taxAmount: number;
  totalValue: number;
  amountInWords: string;
  remarks: string[];
  bank: {
    bankName: string | null;
    bankAddress: string | null;
    beneficiary: string | null;
    beneficiaryAddress: string | null;
    account: string | null;
    swift: string | null;
    feeNote: string | null;
  } | null;
  status: string;
  workOrderAlias: string | null;
  workOrderId: string | null;
}

export interface WorkOrderDocument {
  kind: 'work-order';
  id: string;
  alias: string;
  canonicalName: string;
  createdAt: Date;
  stageLabel: string;
  phase: string;
  status: string;
  oneBuy: PrintParty;
  customer: PrintParty;
  supplier: PrintParty;
  customerPoNumber: string;
  customerPoDate: Date;
  customerPiNumber: string | null;
  supplierPoNumber: string;
  supplierPoDate: Date;
  supplierPiNumber: string | null;
  paymentMethod: string;
  escrowFundedBy: string | null;
  escrowBasis: string | null;
  incoterms: string;
  testingRequired: boolean;
  testScope: string | null;
  buyCurrency: string;
  sellCurrency: string;
  fxRate: number;
  sellValue: number;
  /**
   * The buy side converted into the reporting currency — that is how it is
   * stored, and how every screen shows it. The supplier's own figure in their
   * own currency is `buyValueNative` / `buyNativeCurrency`, and the document
   * prints both so neither party has to trust a conversion they cannot see.
   */
  buyValue: number;
  buyValueNative: number;
  buyNativeCurrency: string;
  reportingCurrency: string;
  lines: PrintLine[];
  totalQuantity: number;
  totalUom: string;
  sellValueInWords: string;
  preparedBy: string;
  approvedBy: string;
  jurisdiction: string | null;
}

/** Splits a stored multi-line block into printable numbered items. */
function toList(v: string | null | undefined, fallback: string[]): string[] {
  const items = (v ?? '')
    .split('\n')
    .map((s) => s.replace(/^\s*\d+[.)]\s*/, '').trim())
    .filter(Boolean);
  return items.length ? items : fallback;
}

/** A trailing "Total" needs one unit; mixed units print as "units". */
function commonUom(lines: { uom: string }[]): string {
  const set = new Set(lines.map((l) => l.uom));
  return set.size === 1 ? [...set][0] : 'units';
}

function orgParty(
  org: NonNullable<Awaited<ReturnType<typeof db.orgSetting.findFirst>>>,
  which: 'bill' | 'ship',
): PrintParty {
  const line1 = which === 'ship' ? (org.shipAddressLine1 ?? org.addressLine1) : org.addressLine1;
  const line2 = which === 'ship' ? (org.shipAddressLine2 ?? org.addressLine2) : org.addressLine2;
  const city = which === 'ship' ? (org.shipCity ?? org.city) : org.city;
  const pin = which === 'ship' ? (org.shipPincode ?? org.pincode) : org.pincode;
  return {
    name: org.legalName,
    lines: [line1, line2, `${city} ${pin}`, org.country].filter(Boolean) as string[],
    gstin: org.gstin,
    stateName: org.stateName,
    cin: org.cin,
    phone: org.phone,
    email: org.email,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Purchase Order
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_PO_TERMS = [
  'Date code and warranty as per the agreed specification on the linked enquiry.',
  'Payment strictly as per the mode stated above.',
  'In case of test failure all charges — testing, material handling and logistics — are payable by the supplier.',
  'Lead time as quoted. Any slippage must be advised in writing on the day it is known.',
  'Every delivery must carry a packing list and commercial invoice, with the work order reference marked on the outer carton. Shipments without it will be rejected.',
];

const PAYMENT_MODE_LABEL: Record<string, string> = {
  ADVANCE: 'Advance Payment',
  ESCROW: 'Payment through Escrow',
  CREDIT: 'Credit',
};

export async function getPurchaseOrderDocument(
  id: string,
): Promise<PurchaseOrderDocument | null> {
  const [po, org] = await Promise.all([
    db.supplierPO.findFirst({
      where: { OR: [{ id }, { poNumber: id }] },
      include: {
        supplier: true,
        lines: { orderBy: { lineNo: 'asc' } },
        workOrders: { select: { id: true, alias: true }, take: 1 },
      },
    }),
    db.orgSetting.findFirst(),
  ]);
  if (!po || !org) return null;

  const wo = po.workOrders[0] ?? null;
  const lines: PrintLine[] = po.lines.map((l) => ({
    lineNo: l.lineNo,
    mpn: l.mpn,
    description: l.description,
    hsnCode: l.hsnCode,
    quantity: l.quantity,
    uom: l.uom,
    unitPrice: l.unitPrice,
    lineTotal: l.lineTotal,
    manufacturer: l.manufacturer,
    extras: [
      l.countryOfOrigin ? `Country of origin: ${l.countryOfOrigin}` : null,
      l.dateCodeLot ? `Date code / lot: ${l.dateCodeLot}` : null,
      l.msl ? `Moisture sensitivity level: ${l.msl}` : null,
      l.packaging ? `Packaging: ${l.packaging}` : null,
      l.testingRequired ? 'Testing required before payment release' : null,
    ].filter(Boolean) as string[],
  }));

  const creditNote =
    po.paymentMethod === 'CREDIT' && po.creditDays ? ` — ${po.creditDays} days` : '';

  return {
    kind: 'purchase-order',
    id: po.id,
    poNumber: po.poNumber,
    // The voucher number is what finance quotes. If none was captured, derive a
    // stable one from the configured prefix (which already carries the fiscal
    // year) and this order's own serial.
    voucherNo:
      po.voucherNo ?? `${org.poVoucherPrefix ?? 'PO/'}${po.poNumber.replace(/\D/g, '').slice(-4)}`,
    poDate: po.poDate,
    // The RFQ the supplier quoted against is the reference they will recognise,
    // so it leads; the derived enquiry reference is only a fallback.
    referenceNo: po.sourcingRef ?? po.referenceNo,
    referenceDate: po.referenceDate,
    paymentTerms: (PAYMENT_MODE_LABEL[po.paymentMethod] ?? po.paymentMethod) + creditNote,
    dispatchedThrough: po.dispatchedThrough ?? '—',
    destination: po.destination ?? `${org.shipCity ?? org.city} · ${po.incoterms}`,
    termsOfDelivery: po.termsOfDelivery ?? po.incoterms,
    currency: po.currency,
    invoiceTo: orgParty(org, 'bill'),
    consignee: orgParty(org, 'ship'),
    supplier: {
      name: po.supplier.name,
      lines: [
        po.supplier.addressLine1,
        po.supplier.addressLine2,
        [po.supplier.city, po.supplier.postcode].filter(Boolean).join(' '),
        po.supplier.country,
      ].filter(Boolean) as string[],
      gstin: po.supplier.gstin,
      stateName: po.supplier.stateName ?? po.supplier.country,
      phone: po.supplier.contactPhone,
      email: po.supplier.contactEmail,
      fax: po.supplier.contactFax,
    },
    lines,
    totalQuantity: lines.reduce((s, l) => s + l.quantity, 0),
    totalUom: commonUom(lines),
    totalValue: po.totalValue,
    amountInWords: amountInWordsAuto(
      po.totalValue,
      po.currency,
      po.currency === 'USD' ? 'US Dollar' : undefined,
    ),
    terms: toList(po.termsAndConditions, DEFAULT_PO_TERMS),
    signatoryFor: org.legalName,
    jurisdiction: org.jurisdiction,
    status: po.status,
    workOrderAlias: wo?.alias ?? null,
    workOrderId: wo?.id ?? null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Proforma Invoice
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_PI_REMARKS = [
  'Label complete in reel / tray / box as original packing, as shown in the photographs supplied.',
  'Quality report provided by the distributor after its own laboratory testing. A third-party test may be arranged at the buyer’s cost on request.',
  'Production / shipping lot barcode may be hidden.',
  'Stock offer validity is limited. The buyer must issue the purchase order within the validity window to lock the stock, and remit payment within one working day thereafter.',
];

export async function getProformaInvoiceDocument(
  id: string,
): Promise<ProformaInvoiceDocument | null> {
  const [pi, org] = await Promise.all([
    db.proformaInvoice.findFirst({
      where: { OR: [{ id }, { piNumber: id }] },
      include: {
        lines: { orderBy: { lineNo: 'asc' } },
        customerPo: { include: { customer: true } },
        supplierPo: { include: { supplier: true } },
        woAsCustomerPi: { select: { id: true, alias: true }, take: 1 },
        woAsSupplierPi: { select: { id: true, alias: true }, take: 1 },
      },
    }),
    db.orgSetting.findFirst(),
  ]);
  if (!pi || !org) return null;

  const isSupplierPi = pi.direction === 'SUPPLIER_PI';
  const supplier = pi.supplierPo?.supplier ?? null;
  const customer = pi.customerPo?.customer ?? null;
  const wo = pi.woAsSupplierPi[0] ?? pi.woAsCustomerPi[0] ?? null;

  const oneBuyParty = orgParty(org, 'bill');

  // On a supplier proforma the supplier sells to us; on a customer proforma we
  // sell to the customer. Same document, mirrored parties.
  const seller: PrintParty = isSupplierPi && supplier
    ? {
        name: supplier.name,
        lines: [
          supplier.addressLine1,
          supplier.addressLine2,
          [supplier.city, supplier.postcode].filter(Boolean).join(' '),
          supplier.country,
        ].filter(Boolean) as string[],
        gstin: supplier.gstin,
        stateName: supplier.stateName ?? supplier.country,
        phone: supplier.contactPhone,
        email: supplier.contactEmail,
        fax: supplier.contactFax,
      }
    : oneBuyParty;

  const buyer: PrintParty = isSupplierPi
    ? oneBuyParty
    : customer
      ? {
          name: customer.name,
          lines: [
            customer.addressLine1,
            customer.city,
            `${customer.city} ${customer.pincode}`,
            customer.country,
          ].filter(Boolean) as string[],
          gstin: customer.gstin,
          stateName: customer.stateName,
          phone: customer.contactPhone,
          email: customer.contactEmail,
        }
      : oneBuyParty;

  const lines: PrintLine[] = pi.lines.map((l) => ({
    lineNo: l.lineNo,
    mpn: l.mpn,
    description: l.description,
    hsnCode: l.hsnCode,
    quantity: l.quantity,
    uom: l.uom,
    unitPrice: l.unitPrice,
    lineTotal: l.lineTotal,
    extras: l.leadTimeDays ? [`Lead time: ${l.leadTimeDays} days`] : [],
  }));

  const destinationDefault = isSupplierPi
    ? `India — ${org.shipCity ?? org.city}, ${org.stateName} · ${pi.supplierPo?.incoterms ?? 'DAP'}`
    : `${customer?.city ?? ''}, ${customer?.stateName ?? ''} · ${pi.customerPo?.incoterms ?? 'DDP'}`;

  return {
    kind: 'proforma-invoice',
    id: pi.id,
    piNumber: pi.piNumber,
    externalRef: pi.externalRef,
    sourcingRef: pi.sourcingRef,
    direction: pi.direction as 'CUSTOMER_PI' | 'SUPPLIER_PI',
    piDate: pi.piDate,
    validUntil: pi.validUntil,
    currency: pi.currency,
    seller,
    buyer,
    attention: pi.attention ?? (isSupplierPi ? org.contactAttn : null),
    shipmentMethod: pi.shipmentMethod ?? 'By air or courier nominated and paid by the buyer',
    originLocation: pi.originLocation ?? (isSupplierPi ? (supplier?.country ?? '—') : org.city),
    destination: pi.destination ?? destinationDefault,
    deliveryTime:
      pi.deliveryTime ??
      (pi.leadTimeDays
        ? `Within ${pi.leadTimeDays} days after the seller’s receipt of payment.`
        : 'As agreed after the seller’s receipt of payment.'),
    paymentTerm:
      pi.paymentTerm ??
      (isSupplierPi
        ? '100% telegraphic transfer in advance from the buyer to the seller before shipping.'
        : (pi.customerPo?.paymentTerms ?? '—')),
    lines,
    totalQuantity: lines.reduce((s, l) => s + l.quantity, 0),
    totalUom: commonUom(lines),
    subtotal: pi.subtotal,
    freightAmount: pi.freightAmount,
    insuranceAmount: pi.insuranceAmount,
    taxAmount: pi.taxAmount,
    totalValue: pi.totalValue,
    amountInWords: amountInWordsAuto(
      pi.totalValue,
      pi.currency,
      pi.currency === 'USD' ? 'US Dollar' : undefined,
    ),
    remarks: toList(pi.remarks ?? pi.terms, DEFAULT_PI_REMARKS),
    bank:
      isSupplierPi && supplier
        ? {
            bankName: supplier.bankName,
            bankAddress: supplier.bankAddress,
            beneficiary: supplier.beneficiaryName ?? supplier.name,
            beneficiaryAddress: [
              supplier.addressLine1,
              supplier.city,
              supplier.postcode,
              supplier.country,
            ]
              .filter(Boolean)
              .join(', '),
            account: supplier.bankAccount,
            swift: supplier.swiftCode,
            feeNote:
              supplier.bankFeeNote ??
              'Sender pays local bank fees; beneficiary pays overseas bank fees.',
          }
        : null,
    status: pi.status,
    workOrderAlias: wo?.alias ?? null,
    workOrderId: wo?.id ?? null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Work Order
// ═══════════════════════════════════════════════════════════════════════════

export async function getWorkOrderDocument(id: string): Promise<WorkOrderDocument | null> {
  const [wo, org] = await Promise.all([
    db.workOrder.findFirst({
      where: { OR: [{ id }, { alias: id }] },
      include: {
        customerPo: { include: { customer: true, lines: { orderBy: { lineNo: 'asc' } } } },
        supplierPo: { include: { supplier: true, lines: { orderBy: { lineNo: 'asc' } } } },
        customerPi: { select: { piNumber: true } },
        supplierPi: { select: { piNumber: true, externalRef: true } },
        // What this work order actually covers. A customer order may be split
        // across several suppliers, so the allocations — not the whole customer
        // order — are this document's subject.
        mappings: { include: { customerPoLine: true }, orderBy: { createdAt: 'asc' } },
      },
    }),
    db.orgSetting.findFirst(),
  ]);
  if (!wo || !org) return null;

  const { getStage } = await import('@/lib/domain/stages');

  // Only what this work order covers. A customer order split across two
  // suppliers produces two work orders, and each must state its own scope —
  // printing the whole customer order on both would double-count the job and
  // contradict the sale value printed underneath it.
  const lines: PrintLine[] = wo.mappings.length
    ? wo.mappings.map((m, i) => ({
        lineNo: i + 1,
        mpn: m.customerPoLine.mpn,
        description: m.customerPoLine.description,
        hsnCode: m.customerPoLine.hsnCode,
        quantity: m.allocatedQty,
        uom: m.customerPoLine.uom,
        unitPrice: m.sellUnitPrice,
        lineTotal: Math.round(m.allocatedQty * m.sellUnitPrice * 100),
        manufacturer: m.customerPoLine.manufacturer,
        extras: [
          m.allocatedQty < m.customerPoLine.quantity
            ? `Part allocation — ${m.allocatedQty.toLocaleString('en-IN')} of ${m.customerPoLine.quantity.toLocaleString('en-IN')} ${m.customerPoLine.uom} on the customer's order line ${m.customerPoLine.lineNo}`
            : null,
          m.customerPoLine.testingRequired ? 'Testing required before dispatch' : null,
        ].filter(Boolean) as string[],
      }))
    : // No allocation recorded yet — fall back to the customer's own lines so the
      // sheet is never blank, and say so on the line.
      wo.customerPo.lines.map((l) => ({
        lineNo: l.lineNo,
        mpn: l.mpn,
        description: l.description,
        hsnCode: l.hsnCode,
        quantity: l.quantity,
        uom: l.uom,
        unitPrice: l.unitPrice,
        lineTotal: l.lineTotal,
        manufacturer: l.manufacturer,
        extras: [
          'Allocation to this work order not yet recorded',
          l.testingRequired ? 'Testing required before dispatch' : null,
        ].filter(Boolean) as string[],
      }));

  const c = wo.customerPo.customer;
  const s = wo.supplierPo.supplier;

  return {
    kind: 'work-order',
    id: wo.id,
    alias: wo.alias,
    canonicalName: wo.canonicalName,
    createdAt: wo.createdAt,
    stageLabel: getStage(wo.stage)?.label ?? wo.stage,
    phase: wo.phase,
    status: wo.status,
    oneBuy: orgParty(org, 'bill'),
    customer: {
      name: c.name,
      lines: [c.addressLine1, `${c.city} ${c.pincode}`, c.country].filter(Boolean) as string[],
      gstin: c.gstin,
      stateName: c.stateName,
      phone: c.contactPhone,
      email: c.contactEmail,
    },
    supplier: {
      name: s.name,
      lines: [
        s.addressLine1,
        [s.city, s.postcode].filter(Boolean).join(' '),
        s.country,
      ].filter(Boolean) as string[],
      gstin: s.gstin,
      stateName: s.stateName ?? s.country,
      phone: s.contactPhone,
      email: s.contactEmail,
    },
    customerPoNumber: wo.customerPo.poNumber,
    customerPoDate: wo.customerPo.poDate,
    customerPiNumber: wo.customerPi?.piNumber ?? null,
    supplierPoNumber: wo.supplierPo.poNumber,
    supplierPoDate: wo.supplierPo.poDate,
    supplierPiNumber: wo.supplierPi?.externalRef ?? wo.supplierPi?.piNumber ?? null,
    paymentMethod: PAYMENT_MODE_LABEL[wo.paymentMethod] ?? wo.paymentMethod,
    escrowFundedBy: wo.escrowFundedBy,
    escrowBasis: wo.escrowBasis,
    incoterms: wo.incoterms,
    testingRequired: wo.testingRequired,
    testScope: wo.testScope,
    buyCurrency: wo.buyCurrency,
    sellCurrency: wo.sellCurrency,
    fxRate: wo.fxRate,
    sellValue: wo.sellValue,
    buyValue: wo.buyValue,
    buyValueNative: wo.supplierPo.totalValue,
    buyNativeCurrency: wo.supplierPo.currency,
    reportingCurrency: org.reportingCurrency,
    lines,
    totalQuantity: lines.reduce((sum, l) => sum + l.quantity, 0),
    totalUom: commonUom(lines),
    sellValueInWords: amountInWordsAuto(
      wo.sellValue,
      wo.sellCurrency,
      wo.sellCurrency === 'USD' ? 'US Dollar' : undefined,
    ),
    // Both named representatives sign: one prepares, the other approves. That is
    // the same separation the escrow release enforces.
    preparedBy: 'Akash Dwivedi — Manager',
    approvedBy: 'Ankit Sharma — Vice President',
    jurisdiction: org.jurisdiction,
  };
}
