import { Prisma } from '@/lib/generated/prisma';
import { db } from '@/lib/db';
import { assessSla, getStage, resolveRailAnchor, type StageContext } from '@/lib/domain/stages';
import { stageContextFrom } from '@/lib/domain/stage-context';
import { computeLandedCost, computeMargin } from '@/lib/tax/landed-cost';
import type { PaymentMethod, TestScope } from '@/lib/domain/enums';

/**
 * Flattened, fully serializable order row for the list and dashboard. Dates are
 * ISO strings so it can cross the server/client boundary untouched.
 */
export interface OrderRow {
  id: string;
  alias: string;
  canonicalName: string;
  provisionalName: string | null;
  nameLocked: boolean;
  stage: string;
  stageLabel: string;
  stageCode: string;
  phase: string;
  status: string;
  stageEnteredAt: string;
  createdAt: string;
  customerName: string;
  customerCode: string;
  supplierName: string;
  supplierCode: string;
  paymentMethod: PaymentMethod;
  testingRequired: boolean;
  testScope: TestScope | null;
  buyCurrency: string;
  sellValue: number;
  buyValue: number;
  landedCost: number;
  creditableTaxes: number;
  trueMargin: number;
  trueMarginPct: number;
  marginBeforeCredits: number;
  marginBeforeCreditsPct: number;
  belowFloor: boolean;
  slaStatus: 'ON_TRACK' | 'AT_RISK' | 'BREACHED';
  hoursInStage: number;
  expectedHours: number;
  isBlocked: boolean;
  blockReason: string | null;
  exceptionType: string | null;
  completedStageIds: string[];
  openTasks: number;
  unreadComms: number;
  lineCount: number;
  escrowHeld: number;
  ctx: StageContext;
  /** The four linked documents, so a row can be edited without another fetch. */
  customerPoId: string;
  customerPoNumber: string;
  customerPiId: string | null;
  customerPiNumber: string | null;
  supplierPoId: string;
  supplierPoNumber: string;
  supplierPiId: string | null;
  supplierPiNumber: string | null;
  incoterms: string;
  creditDays: number | null;
  escrowFundedBy: string | null;
  escrowBasis: string | null;
  termsLockedAt: string | null;
  /** RFQ / Sourcing ID from whichever document carries it. */
  sourcingRef: string | null;
  /**
   * How many work orders serve this row's customer order, and which one this is.
   * A customer order split across suppliers produces several rows that differ
   * only by supplier — without this they read as duplicated data.
   */
  splitOf: number;
  splitIndex: number;
  /**
   * How many work orders share this row's SUPPLIER order, and which one this is.
   * The mirror of splitOf: a bulk order raised from a demand aggregation produces
   * several rows differing only by customer, which read as duplicates without it.
   */
  bulkOf: number;
  bulkIndex: number;
}

const ORDER_INCLUDE = {
  customerPo: {
    select: {
      id: true,
      poNumber: true,
      sourcingRef: true,
      customer: { select: { name: true, code: true } },
      lines: { select: { id: true } },
    },
  },
  customerPi: { select: { id: true, piNumber: true } },
  supplierPo: {
    select: {
      id: true,
      poNumber: true,
      sourcingRef: true,
      supplier: { select: { name: true, code: true } },
    },
  },
  supplierPi: { select: { id: true, piNumber: true, externalRef: true } },
  transitions: { select: { toStage: true }, orderBy: { createdAt: 'asc' } },
  exceptions: {
    where: { status: { in: ['OPEN', 'IN_PROGRESS'] } },
    select: { type: true, reason: true },
    orderBy: { openedAt: 'desc' },
  },
  escrowAccount: { select: { fundedAmount: true, releasedAmount: true } },
  tasks: { where: { status: { in: ['OPEN', 'IN_PROGRESS'] } }, select: { id: true } },
  communications: { where: { isUnread: true }, select: { id: true } },
  // Carried so the list computes next-action and progress on the order's OWN
  // flow. Without it a re-planned order shows the standard ladder's next step.
  phasePlan: { orderBy: { position: 'asc' } },
} satisfies Prisma.WorkOrderInclude;

type RawOrder = Prisma.WorkOrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

function toRow(
  wo: RawOrder,
  now: Date,
  split?: { of: number; index: number },
  bulk?: { of: number; index: number },
): OrderRow {
  const ctx = stageContextFrom(wo);

  const landed = computeLandedCost({
    buyValue: wo.buyValue,
    dutyBcd: wo.dutyBcd,
    dutySws: wo.dutySws,
    dutyIgst: wo.dutyIgst,
    dutyCess: wo.dutyCess,
    creditableGstOther: wo.creditableGstOther,
    freightCost: wo.freightCost,
    insuranceCost: wo.insuranceCost,
    testingCost: wo.testingCost,
    repackCost: wo.repackCost,
    clearanceCost: wo.clearanceCost,
    escrowFee: wo.escrowFee,
  });
  const margin = computeMargin({ sellValue: wo.sellValue, landed, marginFloorPct: 8 });

  const anchor = resolveRailAnchor(wo.stage);
  const sla = assessSla(anchor.anchorStageId, wo.stageEnteredAt, now);
  const stage = getStage(wo.stage);
  const exception = wo.exceptions[0] ?? null;

  return {
    id: wo.id,
    alias: wo.alias,
    canonicalName: wo.canonicalName,
    provisionalName: wo.provisionalName,
    nameLocked: wo.nameLocked,
    stage: wo.stage,
    stageLabel: stage.label,
    stageCode: stage.code,
    phase: wo.phase,
    status: wo.status,
    stageEnteredAt: wo.stageEnteredAt.toISOString(),
    createdAt: wo.createdAt.toISOString(),
    customerName: wo.customerPo.customer.name,
    customerCode: wo.customerPo.customer.code,
    supplierName: wo.supplierPo.supplier.name,
    supplierCode: wo.supplierPo.supplier.code,
    paymentMethod: wo.paymentMethod as PaymentMethod,
    testingRequired: wo.testingRequired,
    testScope: (wo.testScope as TestScope | null) ?? null,
    buyCurrency: wo.buyCurrency,
    sellValue: wo.sellValue,
    buyValue: wo.buyValue,
    landedCost: landed.landedCost,
    creditableTaxes: landed.creditableTaxes,
    trueMargin: margin.trueMargin,
    trueMarginPct: margin.trueMarginPct,
    marginBeforeCredits: margin.marginBeforeCredits,
    marginBeforeCreditsPct: margin.marginBeforeCreditsPct,
    belowFloor: margin.belowFloor,
    slaStatus: sla.status,
    hoursInStage: sla.hoursInStage,
    expectedHours: sla.expectedHours,
    isBlocked: wo.status === 'BLOCKED' || Boolean(anchor.branch),
    blockReason: exception?.reason ?? null,
    exceptionType: exception?.type ?? null,
    completedStageIds: wo.transitions.map((t) => t.toStage).filter((s) => s !== wo.stage),
    openTasks: wo.tasks.length,
    unreadComms: wo.communications.length,
    lineCount: wo.customerPo.lines.length,
    escrowHeld: wo.escrowAccount
      ? Math.max(0, wo.escrowAccount.fundedAmount - wo.escrowAccount.releasedAmount)
      : 0,
    ctx,
    customerPoId: wo.customerPo.id,
    customerPoNumber: wo.customerPo.poNumber,
    customerPiId: wo.customerPi?.id ?? null,
    customerPiNumber: wo.customerPi?.piNumber ?? null,
    supplierPoId: wo.supplierPo.id,
    supplierPoNumber: wo.supplierPo.poNumber,
    supplierPiId: wo.supplierPi?.id ?? null,
    // The supplier's own number is what they quote back, so prefer it.
    supplierPiNumber: wo.supplierPi?.externalRef ?? wo.supplierPi?.piNumber ?? null,
    incoterms: wo.incoterms,
    creditDays: wo.creditDays,
    escrowFundedBy: wo.escrowFundedBy,
    escrowBasis: wo.escrowBasis,
    termsLockedAt: wo.termsLockedAt ? wo.termsLockedAt.toISOString() : null,
    // Either document may carry it; the customer's enquiry is the origin, so it
    // wins when both do.
    sourcingRef: wo.customerPo.sourcingRef ?? wo.supplierPo.sourcingRef ?? null,
    splitOf: split?.of ?? 1,
    splitIndex: split?.index ?? 1,
    bulkOf: bulk?.of ?? 1,
    bulkIndex: bulk?.index ?? 1,
  };
}

/**
 * How many legs each customer order is split across, and the position of each
 * work order within its own split. Computed in one pass over the whole set so
 * the list does not fire a query per row.
 */
function splitPositions(
  orders: { id: string; customerPoId: string; createdAt: Date }[],
): Map<string, { of: number; index: number }> {
  return positionsBy(orders, (o) => o.customerPoId);
}

/** The same counting, grouped by supplier order instead. */
function bulkPositions(
  orders: { id: string; supplierPoId: string; createdAt: Date }[],
): Map<string, { of: number; index: number }> {
  return positionsBy(orders, (o) => o.supplierPoId);
}

function positionsBy<T extends { id: string; createdAt: Date }>(
  orders: T[],
  key: (o: T) => string,
): Map<string, { of: number; index: number }> {
  const byPo = new Map<string, T[]>();
  for (const o of orders) {
    const list = byPo.get(key(o)) ?? [];
    list.push(o);
    byPo.set(key(o), list);
  }
  const out = new Map<string, { of: number; index: number }>();
  for (const list of byPo.values()) {
    // Oldest first, so "1 of 3" is the leg that was raised first and the numbers
    // stay put as the list is re-sorted.
    const ordered = [...list].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    ordered.forEach((o, i) => out.set(o.id, { of: ordered.length, index: i + 1 }));
  }
  return out;
}

export async function listOrders(): Promise<OrderRow[]> {
  const now = new Date();
  const orders = await db.workOrder.findMany({
    include: ORDER_INCLUDE,
    orderBy: { createdAt: 'desc' },
  });
  const splits = splitPositions(orders);
  const bulks = bulkPositions(orders);
  return orders.map((wo) => toRow(wo, now, splits.get(wo.id), bulks.get(wo.id)));
}

export async function getOrderRow(id: string): Promise<OrderRow | null> {
  const wo = await db.workOrder.findUnique({ where: { id }, include: ORDER_INCLUDE });
  if (!wo) return null;
  const [siblings, peers] = await Promise.all([
    db.workOrder.findMany({
      where: { customerPoId: wo.customerPoId },
      select: { id: true, customerPoId: true, createdAt: true },
    }),
    db.workOrder.findMany({
      where: { supplierPoId: wo.supplierPoId },
      select: { id: true, supplierPoId: true, createdAt: true },
    }),
  ]);
  return toRow(
    wo,
    new Date(),
    splitPositions(siblings).get(wo.id),
    bulkPositions(peers).get(wo.id),
  );
}

/** Aggregates for the Control Tower (§6.1). */
export async function dashboardSummary() {
  const rows = await listOrders();
  const active = rows.filter((r) => r.status === 'ACTIVE' || r.status === 'BLOCKED');

  const [escrow, invoices, credits, openExceptions] = await Promise.all([
    db.escrowAccount.aggregate({ _sum: { fundedAmount: true, releasedAmount: true } }),
    db.taxInvoice.aggregate({ _sum: { totalAmount: true }, where: { status: { not: 'PAID' } } }),
    db.inputTaxCredit.aggregate({ _sum: { totalCredit: true }, where: { eligible: true } }),
    db.exceptionRecord.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
  ]);

  const closed = rows.filter((r) => r.status === 'CLOSED');
  const avgCycleDays =
    closed.length === 0
      ? 0
      : closed.reduce(
          (a, r) =>
            a + (new Date(r.stageEnteredAt).getTime() - new Date(r.createdAt).getTime()) / 86_400_000,
          0,
        ) / closed.length;

  const dutyPayable = await db.customsEntry.aggregate({
    _sum: { totalDuty: true },
    where: { dutyPaidAt: null },
  });

  return {
    rows,
    kpis: {
      activeOrders: active.length,
      valueInFlight: active.reduce((a, r) => a + r.sellValue, 0),
      escrowHeld: Math.max(
        0,
        (escrow._sum.fundedAmount ?? 0) - (escrow._sum.releasedAmount ?? 0),
      ),
      openExceptions,
      slaBreaches: active.filter((r) => r.slaStatus === 'BREACHED').length,
      atRisk: active.filter((r) => r.slaStatus === 'AT_RISK').length,
      avgCycleDays,
      realisedMargin: closed.reduce((a, r) => a + r.trueMargin, 0),
      receivables: invoices._sum.totalAmount ?? 0,
      itcAvailable: credits._sum.totalCredit ?? 0,
      dutyPayable: dutyPayable._sum.totalDuty ?? 0,
      openTasks: rows.reduce((a, r) => a + r.openTasks, 0),
    },
  };
}
