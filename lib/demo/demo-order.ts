/**
 * SCENARIO — a clean one-to-one order parked at "PO + PI received", for demos.
 *
 * One customer order, one supplier order, nothing split and nothing pooled. It
 * sits at B3: our PO is out with the supplier and their PI has come back, so all
 * four documents in the work order name exist and the name has locked. Every one
 * of the 30 stages after that is untouched — no terms locked, no escrow account,
 * no shipment, no testing, no customs entry, no invoice.
 *
 * That stage is chosen deliberately. It is the last point at which the order is
 * purely paperwork: the commercial picture is complete enough to show margin,
 * currency and duty exposure, but nothing physical or financial has happened yet,
 * so a demo can walk the whole ladder forward from here without having to undo
 * anything first.
 *
 * Idempotent — it clears its own rows before writing, so it can be re-run against
 * a live database as often as a demo needs a reset, without touching other data.
 */

import { PrismaClient } from '@/lib/generated/prisma';
import { applicableStages, getStage, stageIndex, type StageContext } from '@/lib/domain/stages';
import { convertMinor, toMinor } from '@/lib/domain/money';
import { CUSTOMERS, MPNS, ORG, SUPPLIERS } from '@/prisma/seed-masters';
import { DEMO_ORDER_ALIAS } from './constants';

const HOUR = 3600_000;
const DAY = 24 * HOUR;

/** Everything this scenario owns, so a re-run clears exactly its own rows. */
const CPO_ID = 'demo-cpo';
const CPI_ID = 'demo-cpi';
const SPO_ID = 'demo-spo';
const SPI_ID = 'demo-spi';
export const WO_ID = 'demo-wo';

/**
 * The alias is what the orders list shows and what the URL carries, so it is
 * spelled without a space: /orders/DEMO-ORDER stays readable and shareable,
 * where "Demo Order" would arrive as Demo%20Order.
 *
 * Declared in ./constants so client components can test for the demo order
 * without importing this module, which would drag PrismaClient into the browser.
 */
export const ALIAS = DEMO_ORDER_ALIAS;

const CPO_NO = 'CPO-ACME-DEMO';
const CPI_NO = 'PI-1B-DEMO';
const SPO_NO = 'PO-1B-DEMO';
const SPI_NO = 'SPI-GCSF-DEMO';

/** Where the order is parked. Phase B, the fourth of B's five steps still to do. */
const TARGET_STAGE = 'SUPPLIER_PI_RECEIVED';

const CUSTOMER = CUSTOMERS.find((c) => c.id === 'c-acme')!;
/**
 * A foreign supplier on CIF, priced in USD. A domestic supplier would render the
 * customs and duty phases moot, and those are a large part of what there is to
 * demonstrate downstream.
 */
const SUPPLIER = SUPPLIERS.find((s) => s.id === 's-global')!;
const FX = 83.2;

/**
 * Three lines: one high-value MCU, one memory part, one commodity op-amp. Enough
 * spread that the line table, the HSN mix and the margin per line all have
 * something to show, without a wall of rows to read past.
 */
const LINES = [
  { no: 1, mpn: 'STM32F407VGT6', qty: 2000, sell: 985, buy: 9.15, leadTimeDays: 28 },
  { no: 2, mpn: 'W25Q128JVSIQ', qty: 1500, sell: 168, buy: 1.42, leadTimeDays: 21 },
  { no: 3, mpn: 'LM358N', qty: 5000, sell: 28, buy: 0.24, leadTimeDays: 14 },
] as const;

export async function seedDemoOrder(db: PrismaClient, now = Date.now()) {
  // ── Clear a previous run ──────────────────────────────────────────────────
  await db.pOLinkMapping.deleteMany({ where: { workOrderId: WO_ID } });
  await db.auditLogEntry.deleteMany({ where: { workOrderId: WO_ID } });
  await db.communicationParticipant.deleteMany({
    where: { communication: { workOrderId: WO_ID } },
  });
  await db.communicationContext.deleteMany({ where: { communication: { workOrderId: WO_ID } } });
  await db.communication.deleteMany({ where: { workOrderId: WO_ID } });
  await db.stageTransition.deleteMany({ where: { workOrderId: WO_ID } });
  await db.customStage.deleteMany({ where: { workOrderId: WO_ID } });
  // Any re-planned flow goes too, so a reset always hands back the standard ladder.
  await db.orderPhasePlan.deleteMany({ where: { workOrderId: WO_ID } });
  await db.stageEvidence.deleteMany({ where: { workOrderId: WO_ID } });
  await db.document.deleteMany({ where: { workOrderId: WO_ID } });
  await db.task.deleteMany({ where: { workOrderId: WO_ID } });
  await db.exceptionRecord.deleteMany({ where: { workOrderId: WO_ID } });

  /**
   * These three do NOT cascade from the work order.
   *
   * Their workOrderId is optional, so deleting the order sets it to null rather
   * than removing the row — which would leave input tax credits and reverse-charge
   * self-invoices sitting in the GST registers, claimed against an order that no
   * longer exists. A reset that quietly corrupts the tax registers is worse than
   * no reset at all, so they go explicitly and before the order does.
   */
  await db.inputTaxCredit.deleteMany({ where: { workOrderId: WO_ID } });
  await db.reverseChargeSelfInvoice.deleteMany({ where: { workOrderId: WO_ID } });
  await db.integrationCallLog.deleteMany({ where: { workOrderId: WO_ID } });

  // Everything else hanging off the order — escrow, shipments, test requests,
  // customs, GRNs, inspections, repacks, PODs, tax invoices — cascades on this
  // delete, along with their own children.
  await db.workOrder.deleteMany({ where: { id: WO_ID } });
  await db.pILine.deleteMany({ where: { piId: { in: [CPI_ID, SPI_ID] } } });
  await db.proformaInvoice.deleteMany({ where: { id: { in: [CPI_ID, SPI_ID] } } });
  await db.supplierPOLine.deleteMany({ where: { supplierPoId: SPO_ID } });
  await db.supplierPO.deleteMany({ where: { id: SPO_ID } });
  await db.customerPOLine.deleteMany({ where: { customerPoId: CPO_ID } });
  await db.customerPO.deleteMany({ where: { id: CPO_ID } });

  // ── Timeline ──────────────────────────────────────────────────────────────
  // Recent, so the order reads as live work rather than something stale that has
  // been sitting untouched: opened five days ago, arrived at B3 six hours ago.
  const orderedAt = now - 5 * DAY;
  const stageEnteredAt = now - 6 * HOUR;
  const longestLead = Math.max(...LINES.map((l) => l.leadTimeDays));
  const wantedBy = new Date(orderedAt + (longestLead + 14) * DAY);

  const ctx: StageContext = {
    paymentMethod: 'ESCROW',
    testingRequired: true,
    testScope: 'LOT_SAMPLE',
  };
  const ladder = applicableStages(ctx);
  const targetIdx = stageIndex(TARGET_STAGE);
  const passed = ladder.filter((s) => stageIndex(s.id) < targetIdx);
  const target = getStage(TARGET_STAGE);

  // Spread the five completed stages across the elapsed window, weighted by how
  // long each is expected to take, so the stage log reads plausibly.
  const window = stageEnteredAt - orderedAt;
  const weight = passed.reduce((a, s) => a + Math.max(1, s.expectedHours), 0) || 1;
  let acc = 0;
  const enteredAt = new Map<string, Date>();
  for (const s of passed) {
    enteredAt.set(s.id, new Date(orderedAt + (acc / weight) * window));
    acc += Math.max(1, s.expectedHours);
  }
  enteredAt.set(TARGET_STAGE, new Date(stageEnteredAt));
  const at = (id: string) => enteredAt.get(id) ?? new Date(orderedAt);

  // ── Money ─────────────────────────────────────────────────────────────────
  const lines = LINES.map((l) => {
    const meta = MPNS.find((m) => m.mpn === l.mpn)!;
    return {
      ...l,
      meta,
      cpoLineId: `${CPO_ID}-l${l.no}`,
      spoLineId: `${SPO_ID}-l${l.no}`,
      sellTotal: toMinor(l.qty * l.sell),
      buyTotal: toMinor(l.qty * l.buy, SUPPLIER.currency),
    };
  });
  const sellValue = lines.reduce((a, l) => a + l.sellTotal, 0);
  const buyValueForeign = lines.reduce((a, l) => a + l.buyTotal, 0);
  const buyValue = convertMinor(buyValueForeign, FX, SUPPLIER.currency, 'INR');

  const custAddress = `${CUSTOMER.name}\n${CUSTOMER.addressLine1}\n${CUSTOMER.city} ${CUSTOMER.pincode}, ${CUSTOMER.country}\nGSTIN ${CUSTOMER.gstin ?? '—'}`;
  const shipTo = `${ORG.legalName}\n${ORG.addressLine1}, ${ORG.addressLine2}\n${ORG.city} ${ORG.pincode}, ${ORG.country}\nGSTIN ${ORG.gstin}`;

  // ── The customer's order ──────────────────────────────────────────────────
  await db.customerPO.create({
    data: {
      id: CPO_ID,
      poNumber: CPO_NO,
      customerId: CUSTOMER.id,
      poDate: new Date(orderedAt),
      currency: 'INR',
      incoterms: 'DDP',
      paymentTerms: CUSTOMER.paymentTerms,
      requestedDeliveryDate: wantedBy,
      shipToAddress: custAddress,
      billToAddress: custAddress,
      contactName: CUSTOMER.contactName,
      sourcingRef: 'RFQ-2026-DEMO',
      notes:
        'Demonstration order. One customer order served by exactly one supplier order — nothing split, nothing pooled.',
      totalValue: sellValue,
      // One supplier order covers every line in full, so this is fully linked.
      status: 'FULLY_LINKED',
      createdById: 'u-priya',
      lines: {
        create: lines.map((l) => ({
          id: l.cpoLineId,
          lineNo: l.no,
          mpn: l.mpn,
          manufacturer: l.meta.manufacturer,
          description: l.meta.description,
          hsnCode: l.meta.hsnCode,
          quantity: l.qty,
          uom: 'PCS',
          unitPrice: l.sell,
          lineTotal: l.sellTotal,
          requestedDate: wantedBy,
          testingRequired: true,
        })),
      },
    },
  });

  // ── Our quote to the customer, accepted ───────────────────────────────────
  const freightSell = toMinor(Math.round((sellValue / 100) * 0.014));
  await db.proformaInvoice.create({
    data: {
      id: CPI_ID,
      piNumber: CPI_NO,
      direction: 'CUSTOMER_PI',
      customerPoId: CPO_ID,
      piDate: at('PI_ISSUED_TO_CUSTOMER'),
      validUntil: new Date(orderedAt + 21 * DAY),
      currency: 'INR',
      subtotal: sellValue,
      freightAmount: freightSell,
      insuranceAmount: 0,
      taxAmount: 0,
      totalValue: sellValue + freightSell,
      bankDetails: 'HDFC Bank, Koramangala · A/C 50200012345678 · IFSC HDFC0000123',
      terms: `${CUSTOMER.paymentTerms} from invoice. Delivered duty paid to ${CUSTOMER.city}. Goods supplied by 1BUY as Merchant of Record.`,
      sourcingRef: 'RFQ-2026-DEMO',
      status: 'ACCEPTED',
      issuedAt: at('PI_ISSUED_TO_CUSTOMER'),
      sentAt: at('PI_ISSUED_TO_CUSTOMER'),
      acceptedAt: at('PI_ACCEPTED_BY_CUSTOMER'),
      acceptanceRef: `Email confirmation from ${CUSTOMER.contactName}`,
      lines: {
        create: lines.map((l) => ({
          lineNo: l.no,
          mpn: l.mpn,
          description: l.meta.description,
          hsnCode: l.meta.hsnCode,
          quantity: l.qty,
          unitPrice: l.sell,
          lineTotal: l.sellTotal,
        })),
      },
    },
  });

  // ── Our order to the supplier ────────────────────────────────────────────
  await db.supplierPO.create({
    data: {
      id: SPO_ID,
      poNumber: SPO_NO,
      supplierId: SUPPLIER.id,
      poDate: at('SUPPLIER_PO_ISSUED'),
      currency: SUPPLIER.currency,
      fxRate: FX,
      incoterms: SUPPLIER.incoterms,
      paymentMethod: 'ESCROW',
      creditDays: null,
      shipToAddress: shipTo,
      requiredDeliveryDate: new Date(orderedAt + (longestLead + 7) * DAY),
      totalValue: buyValueForeign,
      // Their PI is in, which is the acknowledgement.
      status: 'ACKNOWLEDGED',
      issuedAt: at('SUPPLIER_PO_ISSUED'),
      sourcingRef: 'RFQ-2026-DEMO',
      termsAndConditions:
        'Approved vendor, franchised stock, full traceability to the manufacturer required on every lot. Escrow-backed payment.',
      lines: {
        create: lines.map((l) => ({
          id: l.spoLineId,
          lineNo: l.no,
          mpn: l.mpn,
          manufacturer: l.meta.manufacturer,
          description: l.meta.description,
          hsnCode: l.meta.hsnCode,
          quantity: l.qty,
          uom: 'PCS',
          unitPrice: l.buy,
          lineTotal: l.buyTotal,
          leadTimeDays: l.leadTimeDays,
          countryOfOrigin: l.meta.countryOfOrigin,
          dateCodeLot: `${2440 + l.no} / LOT-${SUPPLIER.code}-DEMO${l.no}`,
          msl: l.meta.msl,
          packaging: l.meta.packaging,
          testingRequired: true,
        })),
      },
    },
  });

  // ── Their PI back to us. This is the stage the order is parked at. ────────
  await db.proformaInvoice.create({
    data: {
      id: SPI_ID,
      piNumber: SPI_NO,
      direction: 'SUPPLIER_PI',
      supplierPoId: SPO_ID,
      piDate: at(TARGET_STAGE),
      currency: SUPPLIER.currency,
      subtotal: buyValueForeign,
      totalValue: buyValueForeign,
      status: 'RECEIVED',
      externalRef: `${SUPPLIER.code}/PI/DEMO`,
      leadTimeDays: longestLead,
      terms: `${SUPPLIER.incoterms} Nhava Sheva. Payment released from escrow against inspection.`,
      lines: {
        create: lines.map((l) => ({
          lineNo: l.no,
          mpn: l.mpn,
          description: l.meta.description,
          hsnCode: l.meta.hsnCode,
          quantity: l.qty,
          unitPrice: l.buy,
          lineTotal: l.buyTotal,
          leadTimeDays: l.leadTimeDays,
        })),
      },
    },
  });

  // ── The work order ───────────────────────────────────────────────────────
  // All four documents exist, so the canonical name is complete and locks. No
  // provisional name is kept: this order never had a pending segment on screen.
  const canonicalName = [CPO_NO, CPI_NO, SPO_NO, SPI_NO].join('_');

  await db.workOrder.create({
    data: {
      id: WO_ID,
      canonicalName,
      alias: ALIAS,
      provisionalName: null,
      nameLocked: true,
      customerPoId: CPO_ID,
      customerPiId: CPI_ID,
      supplierPoId: SPO_ID,
      supplierPiId: SPI_ID,
      stage: TARGET_STAGE,
      phase: target.phase,
      status: 'ACTIVE',
      stageEnteredAt: new Date(stageEnteredAt),
      paymentMethod: 'ESCROW',
      creditDays: null,
      escrowFundedBy: 'SUPPLIER',
      escrowBasis: 'BUY_VALUE',
      testingRequired: true,
      testScope: 'LOT_SAMPLE',
      incoterms: SUPPLIER.incoterms,
      buyCurrency: SUPPLIER.currency,
      sellCurrency: 'INR',
      fxRate: FX,
      // B4 has not happened, so terms are not locked yet.
      termsLockedAt: null,
      sellValue,
      buyValue,
      // Every cost below is incurred at a stage this order has not reached, so
      // all of them are zero rather than estimated. A demo that starts with
      // freight and duty already booked cannot show them being incurred.
      freightCost: 0,
      insuranceCost: 0,
      testingCost: 0,
      repackCost: 0,
      clearanceCost: 0,
      escrowFee: 0,
      dutyBcd: 0,
      dutySws: 0,
      dutyIgst: 0,
      dutyCess: 0,
      creditableGstOther: 0,
      createdAt: at('SUPPLIER_SELECTED_FROM_AVL'),
    },
  });

  // ── One-to-one line mapping: every customer line covered in full ─────────
  await db.pOLinkMapping.createMany({
    data: lines.map((l) => ({
      workOrderId: WO_ID,
      customerPoLineId: l.cpoLineId,
      supplierPoLineId: l.spoLineId,
      allocatedQty: l.qty,
      sellUnitPrice: l.sell,
      buyUnitPrice: l.buy,
    })),
  });

  // ── Stage history for the five stages behind it ──────────────────────────
  const path = [...passed.map((s) => s.id), TARGET_STAGE];
  const actorFor = (stageId: string) => {
    const owner = getStage(stageId).owner;
    if (owner === 'ONE_BUY') return { id: 'u-priya', label: 'Akash Dwivedi' };
    if (owner === 'CUSTOMER') return { id: null, label: `${CUSTOMER.contactName} (customer)` };
    if (owner === 'SUPPLIER') return { id: null, label: `${SUPPLIER.contactName} (supplier)` };
    if (owner === 'ESCROW') return { id: null, label: 'Escrow provider notification' };
    return { id: null, label: 'Logistics tracking sync' };
  };
  for (let i = 0; i < path.length; i++) {
    const stageId = path[i];
    const prev = i > 0 ? path[i - 1] : null;
    const actor = actorFor(stageId);
    await db.stageTransition.create({
      data: {
        workOrderId: WO_ID,
        fromStage: prev,
        toStage: stageId,
        actorId: actor.id,
        actorLabel: actor.label,
        provenance: actor.id ? 'MANUAL' : 'MOCK',
        durationSecondsInPrevious: prev
          ? Math.round((at(stageId).getTime() - at(prev).getTime()) / 1000)
          : null,
        createdAt: at(stageId),
      },
    });
  }

  // ── Why this order exists, on the record ─────────────────────────────────
  await db.auditLogEntry.create({
    data: {
      workOrderId: WO_ID,
      entity: 'Work order',
      entityId: WO_ID,
      action: 'CREATE',
      field: 'Purpose',
      afterValue: 'Demonstration order',
      reason:
        'Created for demonstrations: a one-to-one order held at "supplier PI received" so the remaining flow can be walked forward from a clean start.',
      actorId: 'u-priya',
      actorLabel: 'Akash Dwivedi',
      createdAt: at('SUPPLIER_SELECTED_FROM_AVL'),
    },
  });

  await db.communication.create({
    data: {
      workOrderId: WO_ID,
      entryClass: 'SYSTEM',
      channel: 'SYSTEM',
      direction: 'INTERNAL',
      subject: `Supplier proforma invoice received — ${SPI_NO}`,
      body: `${SUPPLIER.name} returned their proforma invoice against ${SPO_NO}. All four documents are now present, so the work order name is complete and locked at ${canonicalName}. Next step: lock the terms.`,
      status: 'CLOSED',
      occurredAt: at(TARGET_STAGE),
      systemIcon: 'FileCheck',
      loggedById: 'u-priya',
      participants: {
        create: [
          { role: 'FROM', stakeholder: 'SUPPLIER', name: SUPPLIER.contactName },
          { role: 'TO', stakeholder: 'ONE_BUY', name: 'Akash Dwivedi' },
        ],
      },
      contextChips: { create: [{ kind: 'DOCUMENT', refId: SPI_ID, label: SPI_NO }] },
    },
  });

  const nextStage = ladder[targetIdx + 1];
  return {
    alias: ALIAS,
    canonicalName,
    stage: `${target.code} ${target.label}`,
    done: path.length,
    remaining: ladder.length - path.length,
    nextUp: nextStage ? `${nextStage.code} ${nextStage.label}` : '—',
    sellValue,
    buyValue,
  };
}
