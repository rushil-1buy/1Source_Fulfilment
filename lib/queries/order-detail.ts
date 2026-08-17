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
      /* Enough for the attachment to OPEN, not merely to be listed. A paperclip
         that cannot be clicked sends the reader to the register to find the
         thing they are already looking at. */
      attachments: {
        select: {
          id: true,
          docType: true,
          title: true,
          fileName: true,
          sizeBytes: true,
          uploadedBy: true,
          version: true,
          createdAt: true,
          stageId: true,
          bodyText: true,
        },
      },
      loggedBy: { select: { name: true } },
    },
  },
  tasks: { orderBy: { createdAt: 'desc' }, include: { owner: { select: { name: true } } } },
  exceptions: { orderBy: { openedAt: 'desc' } },
  /* The events between the steps — a rolled flight, an appraiser's query,
     demurrage running. Open ones can hold the order, so they travel with it. */
  inboundEvents: { orderBy: { openedAt: 'desc' } },
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
  } as OrderDetail;
}

export async function listOrderIds(): Promise<string[]> {
  const rows = await db.workOrder.findMany({ select: { id: true } });
  return rows.map((r) => r.id);
}
