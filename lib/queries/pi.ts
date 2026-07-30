import { db } from '@/lib/db';

export interface PiSourceCustomerPo {
  id: string;
  poNumber: string;
  customerName: string;
  customerCode: string;
  poDate: string;
  currency: string;
  totalValue: number;
  paymentTerms: string;
  hasPi: boolean;
  existingPiNumber: string | null;
  /** Work order names still carrying a PI-PENDING segment. */
  pendingNameOnWorkOrders: { alias: string; canonicalName: string }[];
  lines: {
    id: string;
    lineNo: number;
    mpn: string;
    description: string;
    hsnCode: string;
    quantity: number;
    uom: string;
    unitPrice: number;
    lineTotal: number;
  }[];
}

export interface PiSourceSupplierPo {
  id: string;
  poNumber: string;
  supplierName: string;
  supplierCode: string;
  poDate: string;
  currency: string;
  totalValue: number;
  paymentMethod: string;
  awaitingPi: boolean;
  /** The work order whose name completes when this PI is captured. */
  workOrder: { id: string; alias: string; canonicalName: string; nameLocked: boolean } | null;
  lines: {
    id: string;
    lineNo: number;
    mpn: string;
    description: string;
    hsnCode: string;
    quantity: number;
    uom: string;
    unitPrice: number;
    leadTimeDays: number | null;
  }[];
}

export async function getCustomerPosForPi(): Promise<PiSourceCustomerPo[]> {
  const rows = await db.customerPO.findMany({
    where: { status: { not: 'CANCELLED' } },
    include: {
      customer: { select: { name: true, code: true, paymentTerms: true } },
      lines: { orderBy: { lineNo: 'asc' } },
      proformas: {
        where: { direction: 'CUSTOMER_PI' },
        orderBy: { piDate: 'desc' },
        select: { piNumber: true },
      },
      workOrders: { select: { alias: true, canonicalName: true } },
    },
    orderBy: { poDate: 'desc' },
    take: 40,
  });

  return rows.map((po) => ({
    id: po.id,
    poNumber: po.poNumber,
    customerName: po.customer.name,
    customerCode: po.customer.code,
    poDate: po.poDate.toISOString(),
    currency: po.currency,
    totalValue: po.totalValue,
    paymentTerms: po.customer.paymentTerms,
    hasPi: po.proformas.length > 0,
    existingPiNumber: po.proformas[0]?.piNumber ?? null,
    pendingNameOnWorkOrders: po.workOrders
      .filter((w) => w.canonicalName.includes('_PI-PENDING_'))
      .map((w) => ({ alias: w.alias, canonicalName: w.canonicalName })),
    lines: po.lines.map((l) => ({
      id: l.id,
      lineNo: l.lineNo,
      mpn: l.mpn,
      description: l.description,
      hsnCode: l.hsnCode,
      quantity: l.quantity,
      uom: l.uom,
      unitPrice: l.unitPrice,
      lineTotal: l.lineTotal,
    })),
  }));
}

export async function getSupplierPosForPi(): Promise<PiSourceSupplierPo[]> {
  const rows = await db.supplierPO.findMany({
    where: { status: { in: ['ISSUED', 'ACKNOWLEDGED'] } },
    include: {
      supplier: { select: { name: true, code: true } },
      lines: { orderBy: { lineNo: 'asc' } },
      proformas: { where: { direction: 'SUPPLIER_PI' }, select: { id: true } },
      workOrders: {
        select: { id: true, alias: true, canonicalName: true, nameLocked: true },
      },
    },
    orderBy: { poDate: 'desc' },
    take: 40,
  });

  return rows.map((po) => ({
    id: po.id,
    poNumber: po.poNumber,
    supplierName: po.supplier.name,
    supplierCode: po.supplier.code,
    poDate: po.poDate.toISOString(),
    currency: po.currency,
    totalValue: po.totalValue,
    paymentMethod: po.paymentMethod,
    awaitingPi: po.proformas.length === 0,
    workOrder: po.workOrders[0] ?? null,
    lines: po.lines.map((l) => ({
      id: l.id,
      lineNo: l.lineNo,
      mpn: l.mpn,
      description: l.description,
      hsnCode: l.hsnCode,
      quantity: l.quantity,
      uom: l.uom,
      unitPrice: l.unitPrice,
      leadTimeDays: l.leadTimeDays,
    })),
  }));
}
