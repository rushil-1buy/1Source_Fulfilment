import { db } from '@/lib/db';

export interface CustomerOption {
  id: string;
  code: string;
  name: string;
  gstin: string | null;
  stateCode: string;
  stateName: string;
  city: string;
  isSez: boolean;
  isExport: boolean;
  paymentTerms: string;
  contactName: string;
  /**
   * The address on file, pre-formatted. Carried into Create PO so ship-to and
   * bill-to arrive filled in rather than typed again — and so a one-off delivery
   * address can be corrected on the order without editing the master record.
   */
  addressBlock: string;
  addressLine1: string;
  pincode: string;
  country: string;
  contactEmail: string;
  contactPhone: string | null;
}

export interface SupplierOption {
  id: string;
  code: string;
  name: string;
  country: string;
  city: string;
  currency: string;
  incoterms: string;
  isForeign: boolean;
  gstin: string | null;
  /** AVL gate — the form must refuse anything not APPROVED and unexpired. */
  avlStatus: string;
  approvedUpto: string | null;
  expired: boolean;
  selectable: boolean;
  blockedReason: string | null;
  qualityRating: number;
  deliveryRating: number;
  riskScore: number;
  categories: string[];
}

export interface MpnOption {
  mpn: string;
  manufacturer: string;
  description: string;
  hsnCode: string;
  defaultGstRate: number;
  uom: string;
  msl: string | null;
  packaging: string | null;
  countryOfOrigin: string | null;
}

export interface LinkableCustomerPo {
  id: string;
  poNumber: string;
  customerId: string;
  customerName: string;
  customerCode: string;
  poDate: string;
  currency: string;
  totalValue: number;
  status: string;
  requestedDeliveryDate: string | null;
  coveragePct: number;
  piId: string | null;
  piNumber: string | null;
  lines: {
    id: string;
    lineNo: number;
    mpn: string;
    manufacturer: string;
    description: string;
    hsnCode: string;
    quantity: number;
    allocatedQty: number;
    remainingQty: number;
    unitPrice: number;
    lineTotal: number;
    testingRequired: boolean;
  }[];
}

export async function getCustomerOptions(): Promise<CustomerOption[]> {
  const rows = await db.customer.findMany({ orderBy: { name: 'asc' } });
  return rows.map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    gstin: c.gstin,
    stateCode: c.stateCode,
    stateName: c.stateName,
    city: c.city,
    isSez: c.isSez,
    isExport: c.isExport,
    paymentTerms: c.paymentTerms,
    contactName: c.contactName,
    addressBlock: [
      c.name,
      c.addressLine1,
      `${c.city} ${c.pincode}, ${c.stateName}`,
      c.country,
      c.gstin ? `GSTIN ${c.gstin}` : 'No GSTIN on file',
    ]
      .filter(Boolean)
      .join('\n'),
    addressLine1: c.addressLine1,
    pincode: c.pincode,
    country: c.country,
    contactEmail: c.contactEmail,
    contactPhone: c.contactPhone ?? null,
  }));
}

export async function getSupplierOptions(): Promise<SupplierOption[]> {
  const rows = await db.supplier.findMany({ include: { avl: true }, orderBy: { name: 'asc' } });
  const now = new Date();
  return rows.map((s) => {
    const status = s.avl?.status ?? 'NOT_ON_AVL';
    const expired = s.avl ? s.avl.approvedUpto < now : false;
    const selectable = status === 'APPROVED' && !expired;
    let blockedReason: string | null = null;
    if (!s.avl) blockedReason = 'This supplier is not on the Approved Vendor List.';
    else if (status !== 'APPROVED')
      blockedReason = `AVL status is ${status.toLowerCase()} — a purchase order cannot be raised.`;
    else if (expired)
      blockedReason = `AVL approval expired on ${s.avl.approvedUpto.toLocaleDateString('en-IN')}. Re-audit is pending.`;

    return {
      id: s.id,
      code: s.code,
      name: s.name,
      country: s.country,
      city: s.city,
      currency: s.currency,
      incoterms: s.incoterms,
      isForeign: s.isForeign,
      gstin: s.gstin,
      avlStatus: expired ? 'EXPIRED' : status,
      approvedUpto: s.avl ? s.avl.approvedUpto.toISOString() : null,
      expired,
      selectable,
      blockedReason,
      qualityRating: s.avl?.qualityRating ?? 0,
      deliveryRating: s.avl?.deliveryRating ?? 0,
      riskScore: s.avl?.riskScore ?? 0,
      categories: s.avl ? (JSON.parse(s.avl.categories) as string[]) : [],
    };
  });
}

export async function getMpnOptions(): Promise<MpnOption[]> {
  const rows = await db.mpnCatalogueItem.findMany({ orderBy: { mpn: 'asc' } });
  return rows.map((m) => ({
    mpn: m.mpn,
    manufacturer: m.manufacturer,
    description: m.description,
    hsnCode: m.hsnCode,
    defaultGstRate: m.defaultGstRate,
    uom: m.uom,
    msl: m.msl,
    packaging: m.packaging,
    countryOfOrigin: m.countryOfOrigin,
  }));
}

/**
 * Customer POs available to link. Anything not fully covered is offered, with a
 * coverage percentage so the operator can see what is already sourced (§3.2).
 */
export async function getLinkableCustomerPos(): Promise<LinkableCustomerPo[]> {
  const rows = await db.customerPO.findMany({
    where: { status: { in: ['RECEIVED', 'PARTIALLY_LINKED'] } },
    include: {
      customer: { select: { name: true, code: true } },
      lines: {
        orderBy: { lineNo: 'asc' },
        include: { mappings: { select: { allocatedQty: true } } },
      },
      proformas: {
        where: { direction: 'CUSTOMER_PI' },
        orderBy: { piDate: 'desc' },
        select: { id: true, piNumber: true },
      },
    },
    orderBy: { poDate: 'desc' },
  });

  return rows.map((po) => {
    const lines = po.lines.map((l) => {
      const allocatedQty = l.mappings.reduce((a, m) => a + m.allocatedQty, 0);
      return {
        id: l.id,
        lineNo: l.lineNo,
        mpn: l.mpn,
        manufacturer: l.manufacturer,
        description: l.description,
        hsnCode: l.hsnCode,
        quantity: l.quantity,
        allocatedQty,
        remainingQty: Math.max(0, l.quantity - allocatedQty),
        unitPrice: l.unitPrice,
        lineTotal: l.lineTotal,
        testingRequired: l.testingRequired,
      };
    });
    const ordered = lines.reduce((a, l) => a + l.quantity, 0);
    const allocated = lines.reduce((a, l) => a + l.allocatedQty, 0);
    return {
      id: po.id,
      poNumber: po.poNumber,
      customerId: po.customerId,
      customerName: po.customer.name,
      customerCode: po.customer.code,
      poDate: po.poDate.toISOString(),
      currency: po.currency,
      totalValue: po.totalValue,
      status: po.status,
      requestedDeliveryDate: po.requestedDeliveryDate
        ? po.requestedDeliveryDate.toISOString()
        : null,
      coveragePct: ordered > 0 ? (allocated / ordered) * 100 : 0,
      piId: po.proformas[0]?.id ?? null,
      piNumber: po.proformas[0]?.piNumber ?? null,
      lines,
    };
  });
}

export async function getOrgSetting() {
  const org = await db.orgSetting.findFirst();
  if (!org) return null;
  return {
    legalName: org.legalName,
    brandName: org.brandName,
    gstin: org.gstin,
    stateCode: org.stateCode,
    stateName: org.stateName,
    marginFloorPct: org.marginFloorPct,
    poVoucherPrefix: org.poVoucherPrefix,
  };
}
