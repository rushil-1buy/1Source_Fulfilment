import { db } from '@/lib/db';
import { poolDemand, type DemandCandidate, type PoolInput, type PoolSummary } from '@/lib/domain/aggregation';

/**
 * Reading demand and pools.
 *
 * The figure that matters here is `availableQty`. A customer line's ordered
 * quantity is not what can be pooled: some of it may already be committed to a
 * supplier order, and some may be sitting in another draft pool waiting to be
 * floated. Both have to come off, or two people building two pools on the same
 * afternoon each promise the same pieces and we buy them twice.
 */

export interface AggregationRow {
  id: string;
  reference: string;
  title: string;
  status: string;
  supplierName: string | null;
  supplierPoNumber: string | null;
  customerPoCount: number;
  customerCount: number;
  partCount: number;
  totalUnits: number;
  currency: string;
  pooledSpend: number;
  saving: number;
  savingPct: number;
  requiredBy: string | null;
  createdAt: string;
  floatedAt: string | null;
  /** Work orders the float produced, one per contributing customer order. */
  workOrderAliases: string[];
}

export interface AggregationDetail {
  id: string;
  reference: string;
  title: string;
  rationale: string;
  status: string;
  supplierId: string | null;
  supplierName: string | null;
  supplierCurrency: string | null;
  supplierPoId: string | null;
  supplierPoNumber: string | null;
  sourcingRef: string | null;
  requiredBy: string | null;
  currency: string;
  incoterms: string;
  paymentMethod: string;
  notes: string | null;
  createdBy: string;
  createdAt: string;
  floatedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  /** The pool, rolled up by MPN. */
  summary: PoolSummary;
  /** Raw contributions, so the builder can edit quantities. */
  lines: {
    id: string;
    customerPoLineId: string;
    quantity: number;
    candidate: DemandCandidate;
  }[];
  parts: {
    mpn: string;
    buyUnitPrice: number;
    baselineUnitPrice: number | null;
    leadTimeDays: number | null;
  }[];
  workOrders: { id: string; alias: string; customerPoNumber: string; customerName: string; stage: string }[];
}

/**
 * Every customer PO line with demand still to source.
 *
 * `excludeAggregationId` keeps the pool being edited out of its own availability
 * maths — otherwise a line already in this draft would look unavailable to the
 * draft that put it there.
 */
export async function listDemandCandidates(opts: {
  excludeAggregationId?: string;
} = {}): Promise<DemandCandidate[]> {
  const lines = await db.customerPOLine.findMany({
    where: { customerPo: { status: { notIn: ['CANCELLED'] } } },
    include: {
      customerPo: { select: { id: true, poNumber: true, poDate: true, customer: { select: { name: true } } } },
    },
    orderBy: [{ customerPo: { poDate: 'desc' } }, { lineNo: 'asc' }],
  });

  const lineIds = lines.map((l) => l.id);

  // Already committed to a supplier order.
  const allocated = await db.pOLinkMapping.groupBy({
    by: ['customerPoLineId'],
    where: { customerPoLineId: { in: lineIds } },
    _sum: { allocatedQty: true },
  });
  const allocatedBy = new Map(allocated.map((a) => [a.customerPoLineId, a._sum.allocatedQty ?? 0]));

  // Sitting in a draft pool that has not floated yet. A floated pool already
  // shows up as an allocation, so counting it here too would double-subtract.
  const pooled = await db.demandAggregationLine.groupBy({
    by: ['customerPoLineId'],
    where: {
      customerPoLineId: { in: lineIds },
      aggregation: {
        status: 'DRAFT',
        ...(opts.excludeAggregationId ? { id: { not: opts.excludeAggregationId } } : {}),
      },
    },
    _sum: { quantity: true },
  });
  const pooledBy = new Map(pooled.map((p) => [p.customerPoLineId, p._sum.quantity ?? 0]));

  // The best price we have actually paid for each part, as the saving baseline.
  const priorLines = await db.supplierPOLine.findMany({
    where: { mpn: { in: [...new Set(lines.map((l) => l.mpn))] } },
    select: { mpn: true, unitPrice: true, supplierPo: { select: { poDate: true } } },
    orderBy: { supplierPo: { poDate: 'desc' } },
  });
  const lastPrice = new Map<string, number>();
  for (const p of priorLines) if (!lastPrice.has(p.mpn)) lastPrice.set(p.mpn, p.unitPrice);

  return lines.map((l) => {
    const allocatedQty = allocatedBy.get(l.id) ?? 0;
    const pooledElsewhere = pooledBy.get(l.id) ?? 0;
    return {
      customerPoLineId: l.id,
      customerPoId: l.customerPo.id,
      customerPoNumber: l.customerPo.poNumber,
      customerName: l.customerPo.customer.name,
      requestedDate: l.requestedDate ? l.requestedDate.toISOString() : null,
      lineNo: l.lineNo,
      mpn: l.mpn,
      manufacturer: l.manufacturer,
      description: l.description,
      hsnCode: l.hsnCode,
      orderedQty: l.quantity,
      allocatedQty,
      availableQty: Math.max(0, l.quantity - allocatedQty - pooledElsewhere),
      sellUnitPrice: l.unitPrice,
      lastBuyUnitPrice: lastPrice.get(l.mpn) ?? null,
      testingRequired: l.testingRequired,
      uom: l.uom,
    };
  });
}

const AGG_INCLUDE = {
  supplier: { select: { id: true, name: true, currency: true } },
  supplierPo: { select: { id: true, poNumber: true, workOrders: { select: { id: true, alias: true, stage: true, customerPo: { select: { poNumber: true, customer: { select: { name: true } } } } } } } },
  parts: true,
  lines: {
    include: {
      customerPoLine: {
        include: {
          customerPo: { select: { id: true, poNumber: true, customer: { select: { name: true } } } },
        },
      },
    },
  },
} as const;

export async function listAggregations(): Promise<AggregationRow[]> {
  const rows = await db.demandAggregation.findMany({
    include: AGG_INCLUDE,
    orderBy: { createdAt: 'desc' },
  });

  return rows.map((a) => {
    const prices: Record<string, { buyUnitPrice: number; baselineUnitPrice: number | null }> = {};
    for (const p of a.parts) {
      prices[p.mpn] = { buyUnitPrice: p.buyUnitPrice, baselineUnitPrice: p.baselineUnitPrice };
    }
    const inputs: PoolInput[] = a.lines.map((l) => ({
      quantity: l.quantity,
      candidate: {
        customerPoLineId: l.customerPoLineId,
        customerPoId: l.customerPoLine.customerPo.id,
        customerPoNumber: l.customerPoLine.customerPo.poNumber,
        customerName: l.customerPoLine.customerPo.customer.name,
        requestedDate: l.customerPoLine.requestedDate?.toISOString() ?? null,
        lineNo: l.customerPoLine.lineNo,
        mpn: l.customerPoLine.mpn,
        manufacturer: l.customerPoLine.manufacturer,
        description: l.customerPoLine.description,
        hsnCode: l.customerPoLine.hsnCode,
        orderedQty: l.customerPoLine.quantity,
        allocatedQty: 0,
        availableQty: l.customerPoLine.quantity,
        sellUnitPrice: l.customerPoLine.unitPrice,
        lastBuyUnitPrice: null,
        testingRequired: l.customerPoLine.testingRequired,
        uom: l.customerPoLine.uom,
      },
    }));
    const summary = poolDemand(inputs, prices);

    return {
      id: a.id,
      reference: a.reference,
      title: a.title,
      status: a.status,
      supplierName: a.supplier?.name ?? null,
      supplierPoNumber: a.supplierPo?.poNumber ?? null,
      customerPoCount: summary.customerPoCount,
      customerCount: summary.customerCount,
      partCount: summary.parts.length,
      totalUnits: summary.totalUnits,
      currency: a.currency,
      pooledSpend: summary.pooledSpend,
      saving: summary.saving,
      savingPct: summary.savingPct,
      requiredBy: a.requiredBy?.toISOString() ?? null,
      createdAt: a.createdAt.toISOString(),
      floatedAt: a.floatedAt?.toISOString() ?? null,
      workOrderAliases: (a.supplierPo?.workOrders ?? []).map((w) => w.alias).sort(),
    };
  });
}

export async function getAggregation(id: string): Promise<AggregationDetail | null> {
  const a = await db.demandAggregation.findUnique({ where: { id }, include: AGG_INCLUDE });
  if (!a) return null;

  // Availability is recomputed live, so a draft opened tomorrow reflects what has
  // been committed since — a stale figure here is what lets a pool over-commit.
  const candidates = await listDemandCandidates({ excludeAggregationId: id });
  const byLine = new Map(candidates.map((c) => [c.customerPoLineId, c]));

  const prices: Record<string, { buyUnitPrice: number; baselineUnitPrice: number | null }> = {};
  for (const p of a.parts) {
    prices[p.mpn] = { buyUnitPrice: p.buyUnitPrice, baselineUnitPrice: p.baselineUnitPrice };
  }

  const lines = a.lines.map((l) => {
    const live = byLine.get(l.customerPoLineId);
    const candidate: DemandCandidate = live ?? {
      customerPoLineId: l.customerPoLineId,
      customerPoId: l.customerPoLine.customerPo.id,
      customerPoNumber: l.customerPoLine.customerPo.poNumber,
      customerName: l.customerPoLine.customerPo.customer.name,
      requestedDate: l.customerPoLine.requestedDate?.toISOString() ?? null,
      lineNo: l.customerPoLine.lineNo,
      mpn: l.customerPoLine.mpn,
      manufacturer: l.customerPoLine.manufacturer,
      description: l.customerPoLine.description,
      hsnCode: l.customerPoLine.hsnCode,
      orderedQty: l.customerPoLine.quantity,
      allocatedQty: 0,
      availableQty: l.customerPoLine.quantity,
      sellUnitPrice: l.customerPoLine.unitPrice,
      lastBuyUnitPrice: null,
      testingRequired: l.customerPoLine.testingRequired,
      uom: l.customerPoLine.uom,
    };
    return { id: l.id, customerPoLineId: l.customerPoLineId, quantity: l.quantity, candidate };
  });

  return {
    id: a.id,
    reference: a.reference,
    title: a.title,
    rationale: a.rationale,
    status: a.status,
    supplierId: a.supplierId,
    supplierName: a.supplier?.name ?? null,
    supplierCurrency: a.supplier?.currency ?? null,
    supplierPoId: a.supplierPoId,
    supplierPoNumber: a.supplierPo?.poNumber ?? null,
    sourcingRef: a.sourcingRef,
    requiredBy: a.requiredBy?.toISOString() ?? null,
    currency: a.currency,
    incoterms: a.incoterms,
    paymentMethod: a.paymentMethod,
    notes: a.notes,
    createdBy: a.createdBy,
    createdAt: a.createdAt.toISOString(),
    floatedAt: a.floatedAt?.toISOString() ?? null,
    cancelledAt: a.cancelledAt?.toISOString() ?? null,
    cancelReason: a.cancelReason,
    summary: poolDemand(
      lines.map((l) => ({ candidate: l.candidate, quantity: l.quantity })),
      prices,
    ),
    lines,
    parts: a.parts.map((p) => ({
      mpn: p.mpn,
      buyUnitPrice: p.buyUnitPrice,
      baselineUnitPrice: p.baselineUnitPrice,
      leadTimeDays: p.leadTimeDays,
    })),
    workOrders: (a.supplierPo?.workOrders ?? []).map((w) => ({
      id: w.id,
      alias: w.alias,
      customerPoNumber: w.customerPo.poNumber,
      customerName: w.customerPo.customer.name,
      stage: w.stage,
    })),
  };
}

/** Approved suppliers, for the bulk-order supplier picker. */
export async function listApprovedSuppliers() {
  // Approval is a fact about the Approved Vendor List, not the supplier row — a
  // supplier can exist on file without being approved to buy from.
  const approved = await db.aVLRecord.findMany({
    where: { status: 'APPROVED' },
    select: { supplierId: true },
  });
  const ids = [...new Set(approved.map((a) => a.supplierId))];
  return db.supplier.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, code: true, currency: true, incoterms: true, country: true },
    orderBy: { name: 'asc' },
  });
}
