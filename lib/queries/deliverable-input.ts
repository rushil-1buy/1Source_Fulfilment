/**
 * Assembles what the deliverable generators are allowed to read.
 *
 * Lives here rather than beside the actions because BOTH sides need it: the
 * server to draft and to run the checks that actually gate approval, and the
 * team screen to re-run those checks live as somebody edits a draft. Without a
 * shared builder the browser would be checking edited values against the wrong
 * thing, and a check preview that disagrees with the real gate is worse than
 * no preview — it tells the reviewer they are fine right up until they are not.
 *
 * Narrowed deliberately: a generator that can reach the whole Prisma client
 * will eventually query in a loop.
 */

import { db } from '@/lib/db';
import { getStage } from '@/lib/domain/stages';
import { computeLandedCost, computeMargin } from '@/lib/tax/landed-cost';
import type { DeliverableInput } from '@/lib/domain/deliverables/types';

/** Built once and passed in — eight generators each querying is eight chances to N+1. */
export async function buildDeliverableInput(orderId: string): Promise<DeliverableInput | null> {
  const wo = await db.workOrder.findUnique({
    where: { id: orderId },
    include: {
      // Lines hang off the two purchase orders, not the work order. The
      // customer's are the ones that ship, so they drive quantities on the
      // outbound documents; the supplier's carry what we paid.
      customerPo: { include: { customer: true, lines: { orderBy: { lineNo: 'asc' } } } },
      supplierPo: { include: { supplier: true, lines: { orderBy: { lineNo: 'asc' } } } },
      customerPi: true,
      supplierPi: true,
      escrowAccount: true,
      inspections: { orderBy: { createdAt: 'desc' }, take: 1 },
      shipments: { orderBy: { createdAt: 'desc' }, take: 1 },
      customsEntry: true,
      grns: { orderBy: { createdAt: 'desc' }, take: 1 },
      transitions: { select: { toStage: true } },
    },
  });
  if (!wo) return null;

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
  const margin = computeMargin({ sellValue: wo.sellValue, landed });

  const cust = wo.customerPo.customer;
  const insp = wo.inspections[0] ?? null;
  const ship = wo.shipments[0] ?? null;
  // Funded less released is what is actually still sitting there — the agreed
  // amount is a promise, not a balance, and releasing against it would overdraw.
  const escrowHeld = wo.escrowAccount?.fundedAmount ?? 0;
  const escrowReleased = wo.escrowAccount?.releasedAmount ?? 0;

  return {
    orderId: wo.id,
    alias: wo.alias,
    soNumber: wo.soNumber,
    stage: wo.stage,
    stageLabel: getStage(wo.stage).label,
    incoterms: wo.incoterms,
    sellIncoterms: wo.customerPo.incoterms,
    paymentMethod: wo.paymentMethod,
    buyCurrency: wo.buyCurrency,
    fxRate: wo.fxRate,

    customerName: cust.name,
    customerGstin: cust.gstin,
    customerAddress: [cust.addressLine1, cust.city, cust.pincode].filter(Boolean).join(', '),
    supplierName: wo.supplierPo.supplier.name,
    supplierCountry: wo.supplierPo.supplier.country,

    customerPoNumber: wo.customerPo.poNumber,
    supplierPoNumber: wo.supplierPo.poNumber,
    customerPiNumber: wo.customerPi?.piNumber ?? null,
    supplierPiNumber: wo.supplierPi?.piNumber ?? null,

    sellValue: wo.sellValue,
    buyValue: wo.buyValue,
    landedCost: landed.landedCost,
    creditableTaxes: landed.creditableTaxes,
    nonCreditableLevies: landed.nonCreditableLevies,
    trueMargin: margin.trueMargin,
    trueMarginPct: margin.trueMarginPct,
    marginBeforeCredits: margin.marginBeforeCredits,
    creditBenefit: margin.creditBenefit,
    belowFloor: margin.belowFloor,
    costComponents: landed.components.map((c) => ({
      key: c.key,
      label: c.label,
      amount: c.amount,
      included: c.included,
    })),

    lines: wo.customerPo.lines.map((l) => ({
      mpn: l.mpn,
      description: l.description,
      qty: l.quantity,
      uom: l.uom,
      hsnCode: l.hsnCode,
      unitSell: l.unitPrice,
      // Matched by part number rather than line order: the two orders are
      // written by different parties and their line numbering need not agree.
      unitBuy: wo.supplierPo.lines.find((sl) => sl.mpn === l.mpn)?.unitPrice ?? 0,
    })),
    totalQty: wo.customerPo.lines.reduce((a, l) => a + l.quantity, 0),
    lineCount: wo.customerPo.lines.length,

    escrowHeld,
    escrowReleased,

    /*
     * Sample size and defect count are not columns on the report — they live on
     * the per-line results. Left null rather than guessed: the inspection
     * generator marks them required, so the inspector fills them in from what
     * they actually counted, which is the only place that number can come from.
     */
    inspection: insp
      ? {
          verdict: insp.verdict,
          sampleSize: null,
          defectsFound: null,
          inspectedAt: (insp.completedAt ?? insp.startedAt).toISOString().slice(0, 10),
        }
      : null,
    shipment: ship
      ? {
          carrier: ship.carrierCode,
          trackingRef: ship.awb,
          grossWeightKg: ship.grossWeightKg,
          packageCount: ship.pieces,
          dispatchedAt: ship.dispatchedAt?.toISOString().slice(0, 10) ?? null,
        }
      : null,
    customs: wo.customsEntry
      ? {
          beNumber: wo.customsEntry.boeNumber,
          beDate: wo.customsEntry.filedAt?.toISOString().slice(0, 10) ?? null,
          portCode: wo.customsEntry.portCode,
          assessedValue: wo.customsEntry.assessableValue,
        }
      : null,

    warehouseLocation: wo.grns[0]?.storageLocation ?? null,
    completedStageIds: [...new Set(wo.transitions.map((t) => t.toStage))],
    today: new Date().toISOString().slice(0, 10),
  };
}
