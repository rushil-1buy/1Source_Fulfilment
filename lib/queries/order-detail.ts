import { Prisma } from '@/lib/generated/prisma';
import { db } from '@/lib/db';
import { serialize, type Serialized } from '@/lib/serialize';
import { computeLandedCost, computeMargin } from '@/lib/tax/landed-cost';
import { assessSla, resolveRailAnchor } from '@/lib/domain/stages';

const DETAIL_INCLUDE = {
  customerPo: {
    include: { customer: true, lines: { orderBy: { lineNo: 'asc' } } },
  },
  customerPi: { include: { lines: { orderBy: { lineNo: 'asc' } } } },
  supplierPo: {
    include: { supplier: true, lines: { orderBy: { lineNo: 'asc' } } },
  },
  supplierPi: { include: { lines: { orderBy: { lineNo: 'asc' } } } },
  mappings: { include: { customerPoLine: true, supplierPoLine: true } },
  transitions: { orderBy: { createdAt: 'asc' }, include: { actor: { select: { name: true } } } },
  escrowAccount: {
    include: {
      transactions: {
        orderBy: { valueDate: 'asc' },
        include: {
          approvals: { include: { approver: { select: { name: true, role: true } } } },
          // The proof filed against this specific movement.
          documents: { select: { id: true, title: true, fileName: true, storagePath: true } },
        },
      },
      disputes: true,
    },
  },
  testRequests: {
    include: { result: { include: { lineResults: true } } },
    orderBy: { createdAt: 'asc' },
  },
  shipments: { include: { events: { orderBy: { occurredAt: 'asc' } } }, orderBy: { createdAt: 'asc' } },
  customsEntry: {
    include: {
      statusHistory: { orderBy: { occurredAt: 'asc' } },
      queries: { orderBy: { raisedAt: 'asc' } },
    },
  },
  grns: { include: { lines: true }, orderBy: { receivedAt: 'asc' } },
  inspections: {
    include: { checklist: { orderBy: { sequence: 'asc' } }, inspector: { select: { name: true } } },
    orderBy: { startedAt: 'asc' },
  },
  repackJobs: { orderBy: { startedAt: 'asc' } },
  pods: true,
  taxInvoices: {
    include: { lines: { orderBy: { lineNo: 'asc' } }, eWayBills: true, creditNotes: true },
    orderBy: { invoiceDate: 'asc' },
  },
  itcEntries: { orderBy: { documentDate: 'asc' } },
  rcSelfInvoices: true,
  documents: { orderBy: { createdAt: 'desc' } },
  communications: {
    orderBy: { occurredAt: 'desc' },
    include: {
      participants: true,
      contextChips: true,
      attachments: { select: { id: true, title: true, fileName: true, sizeBytes: true } },
      loggedBy: { select: { name: true } },
    },
  },
  tasks: { orderBy: { createdAt: 'desc' }, include: { owner: { select: { name: true } } } },
  exceptions: { orderBy: { openedAt: 'desc' } },
  auditEntries: {
    orderBy: { createdAt: 'desc' },
    include: { actor: { select: { name: true } } },
  },
  customStages: { orderBy: [{ afterStageId: 'asc' }, { sequence: 'asc' }] },
  phasePlan: { orderBy: { position: 'asc' } },
  stageEvidence: {
    include: {
      documents: { orderBy: { version: 'desc' } },
      revisions: { orderBy: { revision: 'asc' } },
    },
  },
} satisfies Prisma.WorkOrderInclude;

type RawDetail = Prisma.WorkOrderGetPayload<{ include: typeof DETAIL_INCLUDE }>;

export type OrderDetail = Serialized<RawDetail> & {
  computed: {
    landed: ReturnType<typeof computeLandedCost>;
    margin: ReturnType<typeof computeMargin>;
    sla: ReturnType<typeof assessSla>;
    anchorStageId: string;
    branchStageId: string | null;
    completedStageIds: string[];
    coveragePct: number;
  };
  org: {
    legalName: string;
    brandName: string;
    gstin: string;
    stateCode: string;
    stateName: string;
    addressLine1: string;
    addressLine2: string | null;
    city: string;
    pincode: string;
    country: string;
    shipAddressLine1: string | null;
    shipCity: string | null;
    shipPincode: string | null;
    cin: string | null;
    phone: string | null;
    email: string | null;
    contactAttn: string | null;
    jurisdiction: string | null;
    poVoucherPrefix: string | null;
    marginFloorPct: number;
  } | null;
  /**
   * Every work order raised against the same customer purchase order, this one
   * included. A customer order may be split across several suppliers, and the
   * people working it need to see who else is on the job.
   */
  /**
   * Per customer PO line id, the units allocated across EVERY work order — not
   * only this one. The client holds just its own mappings, so it cannot work out
   * whether the CUSTOMER's line is covered; only whether this leg covers it.
   */
  coverageByLine: Record<string, number>;
  /**
   * Other work orders sharing this order's SUPPLIER purchase order — the demand
   * aggregation case, and the mirror of `siblings`. Where siblings answer "who
   * else is supplying this customer", these answer "who else is on our order".
   */
  bulkPeers: {
    id: string;
    alias: string;
    isThisOrder: boolean;
    stage: string;
    status: string;
    customerPoNumber: string;
    customerName: string;
    /** Units of the shared order allocated to this peer. */
    allocatedQty: number;
    sellValue: number;
  }[];
  /** The pool that produced the shared order, when there was one. */
  aggregation: {
    id: string;
    reference: string;
    title: string;
    rationale: string;
    createdBy: string;
    floatedAt: string | null;
  } | null;
  siblings: {
    id: string;
    alias: string;
    isThisOrder: boolean;
    stage: string;
    status: string;
    incoterms: string;
    /** Our order number to that supplier. */
    supplierPoNumber: string;
    paymentMethod: string;
    /** Units of the customer order this leg is covering. */
    allocatedQty: number;
    /** Its share of the customer's money, at the customer's prices. */
    sellValue: number;
    createdAt: string;
    supplier: {
      name: string;
      contactName: string;
      contactEmail: string;
      city: string;
      country: string;
      gstin: string | null;
      isForeign: boolean;
    };
  }[];
};

/**
 * Accepts either the internal id or the human alias (WO-2026-0106), so order
 * URLs read as something a person can recognise and share.
 */
export async function getOrderDetail(idOrAlias: string): Promise<OrderDetail | null> {
  const [wo, org] = await Promise.all([
    db.workOrder.findFirst({
      where: { OR: [{ id: idOrAlias }, { alias: idOrAlias }] },
      include: DETAIL_INCLUDE,
    }),
    db.orgSetting.findFirst(),
  ]);
  if (!wo) return null;

  // Split sourcing: one customer order can be served by several work orders,
  // each with its own supplier. Fetched separately rather than as a nested
  // include so the detail payload does not carry every sibling's full graph.
  const siblingRows = await db.workOrder.findMany({
    where: { customerPoId: wo.customerPoId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      alias: true,
      stage: true,
      status: true,
      incoterms: true,
      paymentMethod: true,
      sellValue: true,
      createdAt: true,
      // Summed rather than listed: the panel needs the size of each leg's share,
      // and the line-by-line breakdown already lives on the coverage view.
      mappings: { select: { allocatedQty: true } },
      supplierPo: {
        select: {
          poNumber: true,
          supplier: {
            select: {
              name: true,
              contactName: true,
              contactEmail: true,
              city: true,
              country: true,
              gstin: true,
              isForeign: true,
            },
          },
        },
      },
    },
  });

  /**
   * Everyone else on our supplier order. Fetched separately for the same reason
   * as siblings: the detail payload should not carry every peer's full graph.
   */
  const bulkPeerRows = await db.workOrder.findMany({
    where: { supplierPoId: wo.supplierPoId },
    orderBy: { alias: 'asc' },
    select: {
      id: true,
      alias: true,
      stage: true,
      status: true,
      sellValue: true,
      mappings: { select: { allocatedQty: true } },
      customerPo: { select: { poNumber: true, customer: { select: { name: true } } } },
    },
  });

  const aggregationRow = await db.demandAggregation.findUnique({
    where: { supplierPoId: wo.supplierPoId },
    select: { id: true, reference: true, title: true, rationale: true, createdBy: true, floatedAt: true },
  });

  // Coverage of the customer's lines by all legs together.
  const allAllocations = await db.pOLinkMapping.groupBy({
    by: ['customerPoLineId'],
    where: { customerPoLine: { customerPoId: wo.customerPoId } },
    _sum: { allocatedQty: true },
  });
  const coverageByLine: Record<string, number> = {};
  for (const a of allAllocations) {
    coverageByLine[a.customerPoLineId] = a._sum.allocatedQty ?? 0;
  }

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
  const margin = computeMargin({
    sellValue: wo.sellValue,
    landed,
    marginFloorPct: org?.marginFloorPct ?? 8,
  });
  const anchor = resolveRailAnchor(wo.stage);
  const sla = assessSla(anchor.anchorStageId, wo.stageEnteredAt);

  // Coverage: allocated quantity vs what the customer actually ordered.
  const orderedQty = wo.customerPo.lines.reduce((a, l) => a + l.quantity, 0);
  const allocatedQty = wo.mappings.reduce((a, m) => a + m.allocatedQty, 0);
  const coveragePct = orderedQty > 0 ? (allocatedQty / orderedQty) * 100 : 0;

  return {
    ...serialize(wo),
    computed: {
      landed,
      margin,
      sla,
      anchorStageId: anchor.anchorStageId,
      branchStageId: anchor.branch?.id ?? null,
      completedStageIds: wo.transitions.map((t) => t.toStage).filter((s) => s !== wo.stage),
      coveragePct,
    },
    org: org ? serialize(org) : null,
    coverageByLine,
    bulkPeers: bulkPeerRows.map((p) => ({
      id: p.id,
      alias: p.alias,
      isThisOrder: p.id === wo.id,
      stage: p.stage,
      status: p.status,
      customerPoNumber: p.customerPo.poNumber,
      customerName: p.customerPo.customer.name,
      allocatedQty: p.mappings.reduce((a, m) => a + m.allocatedQty, 0),
      sellValue: p.sellValue,
    })),
    aggregation: aggregationRow
      ? {
          id: aggregationRow.id,
          reference: aggregationRow.reference,
          title: aggregationRow.title,
          rationale: aggregationRow.rationale,
          createdBy: aggregationRow.createdBy,
          floatedAt: aggregationRow.floatedAt?.toISOString() ?? null,
        }
      : null,
    siblings: siblingRows.map((s) => ({
      id: s.id,
      alias: s.alias,
      isThisOrder: s.id === wo.id,
      stage: s.stage,
      status: s.status,
      incoterms: s.incoterms,
      supplierPoNumber: s.supplierPo.poNumber,
      paymentMethod: s.paymentMethod,
      allocatedQty: s.mappings.reduce((a, m) => a + m.allocatedQty, 0),
      sellValue: s.sellValue,
      createdAt: s.createdAt.toISOString(),
      supplier: s.supplierPo.supplier,
    })),
  } as OrderDetail;
}

export async function listOrderIds(): Promise<string[]> {
  const rows = await db.workOrder.findMany({ select: { id: true } });
  return rows.map((r) => r.id);
}
