/**
 * SCENARIO — one customer order, three supplier orders.
 *
 * The most common real shape that the one-work-order-per-supplier model has to
 * express, and the one most likely to be got wrong. A customer orders three
 * parts; no single approved supplier can cover all of it, so:
 *
 *   Line 1  6,000 MCUs      → 3,500 from Nexus + 2,500 from Pacific Micro
 *                             (ONE customer line split across TWO suppliers)
 *   Line 2  4,000 DRAM      → all 4,000 from Pacific Micro
 *                             (a whole line from one supplier)
 *   Line 3    500 NOR flash →   300 from Shenzhen Yuan, 200 still unbought
 *                             (a line left part-covered)
 *
 * That produces three work orders against one customer PO, and a customer order
 * that is 10,300 of 10,500 units covered — part sourced, not fully sourced.
 *
 * The three jobs sit at deliberately different stages, because that is the whole
 * reason they are separate work orders: one supplier has shipped, one has only
 * just quoted, and the third has not quoted at all. A single work order spanning
 * three suppliers could not be at three stages at once, which is exactly why the
 * model does not allow one.
 *
 * Idempotent — it removes its own rows before writing, so it can be re-run
 * against a live database without touching anything else.
 */

import { PrismaClient } from '@/lib/generated/prisma';
import { applicableStages, getStage, stageIndex, type StageContext } from '../lib/domain/stages';
import { convertMinor, pctOf, toMinor } from '../lib/domain/money';
import { CUSTOMERS, MPNS, ORG, SUPPLIERS } from './seed-masters';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const pad = (n: number, w = 4) => String(n).padStart(w, '0');

/** Everything this scenario owns, so a re-run can clear exactly its own rows. */
const CPO_ID = 'split-cpo';
const CPI_ID = 'split-cpi';
const WO_IDS = ['split-wo-nexus', 'split-wo-pacific', 'split-wo-shenzhen'];

const CUSTOMER = CUSTOMERS.find((c) => c.id === 'c-nova')!;

/** The customer's three lines. Quantities are what they asked for. */
const CUSTOMER_LINES = [
  { no: 1, mpn: 'STM32F407VGT6', qty: 6000, sell: 985 },
  { no: 2, mpn: 'MT41K256M16TW-107', qty: 4000, sell: 412 },
  { no: 3, mpn: 'W25Q128JVSIQ', qty: 500, sell: 168 },
] as const;

interface Allocation {
  /** Which customer line this covers. */
  customerLineNo: number;
  /** How many pieces of it this supplier is covering. */
  qty: number;
  /** Buy price per piece in the supplier's currency. */
  buy: number;
}

interface Leg {
  id: string;
  aliasNo: number;
  supplierId: string;
  poNo: string;
  piNo: string | null;
  paymentMethod: 'ADVANCE' | 'ESCROW' | 'CREDIT';
  targetStage: string;
  startedDaysAgo: number;
  hoursInStage: number;
  allocations: Allocation[];
  /** Why this supplier got this share — shown on the split panel. */
  rationale: string;
}

const LEGS: Leg[] = [
  {
    id: 'split-wo-nexus',
    aliasNo: 120,
    supplierId: 's-nexus',
    poNo: 'PO-1B-0120',
    piNo: 'SPI-NEXUS-0121',
    paymentMethod: 'ESCROW',
    // Furthest along: stock was on hand, so this leg shipped first.
    targetStage: 'IN_TRANSIT_INTERNATIONAL',
    startedDaysAgo: 26,
    hoursInStage: 30,
    allocations: [{ customerLineNo: 1, qty: 3500, buy: 9.05 }],
    rationale:
      'Had 3,500 pieces of the MCU on the shelf in Singapore and could ship immediately. Took the share that could move first.',
  },
  {
    id: 'split-wo-pacific',
    aliasNo: 121,
    supplierId: 's-pacific',
    poNo: 'PO-1B-0121',
    piNo: 'SPI-PACM-0122',
    paymentMethod: 'ADVANCE',
    // Quoted and terms locked, nothing shipped.
    targetStage: 'WORK_ORDER_ACTIVE',
    startedDaysAgo: 22,
    hoursInStage: 14,
    allocations: [
      { customerLineNo: 1, qty: 2500, buy: 9.28 },
      { customerLineNo: 2, qty: 4000, buy: 3.86 },
    ],
    rationale:
      'Covered the balance of the MCU line at a slightly higher price, and was the only approved source for the DDR3 at this volume.',
  },
  {
    id: 'split-wo-shenzhen',
    aliasNo: 122,
    supplierId: 's-shenzhen',
    poNo: 'PO-1B-0122',
    // No supplier PI yet, so this work order's name is still SPI-PENDING.
    piNo: null,
    paymentMethod: 'CREDIT',
    targetStage: 'SUPPLIER_PO_ISSUED',
    startedDaysAgo: 9,
    hoursInStage: 58,
    allocations: [{ customerLineNo: 3, qty: 300, buy: 1.39 }],
    rationale:
      'Only 300 of the 500 flash devices could be confirmed against a genuine date code. The remaining 200 are still being sourced rather than bought from an unverified lot.',
  },
];

export async function seedSplitSourcing(db: PrismaClient, now = Date.now()) {
  // ── Clear a previous run ──────────────────────────────────────────────────
  await db.pOLinkMapping.deleteMany({ where: { workOrderId: { in: WO_IDS } } });
  await db.auditLogEntry.deleteMany({ where: { workOrderId: { in: WO_IDS } } });
  await db.communicationParticipant.deleteMany({
    where: { communication: { workOrderId: { in: WO_IDS } } },
  });
  await db.communicationContext.deleteMany({
    where: { communication: { workOrderId: { in: WO_IDS } } },
  });
  await db.communication.deleteMany({ where: { workOrderId: { in: WO_IDS } } });
  await db.stageTransition.deleteMany({ where: { workOrderId: { in: WO_IDS } } });
  await db.escrowTransaction.deleteMany({
    where: { escrow: { workOrderId: { in: WO_IDS } } },
  });
  await db.escrowAccount.deleteMany({ where: { workOrderId: { in: WO_IDS } } });
  await db.trackingEvent.deleteMany({ where: { shipment: { workOrderId: { in: WO_IDS } } } });
  await db.shipment.deleteMany({ where: { workOrderId: { in: WO_IDS } } });
  await db.customStage.deleteMany({ where: { workOrderId: { in: WO_IDS } } });
  await db.workOrder.deleteMany({ where: { id: { in: WO_IDS } } });
  await db.pILine.deleteMany({
    where: { pi: { OR: [{ id: CPI_ID }, { supplierPoId: { in: LEGS.map((l) => `${l.id}-spo`) } }] } },
  });
  await db.proformaInvoice.deleteMany({
    where: { OR: [{ id: CPI_ID }, { supplierPoId: { in: LEGS.map((l) => `${l.id}-spo`) } }] },
  });
  await db.supplierPOLine.deleteMany({ where: { supplierPoId: { in: LEGS.map((l) => `${l.id}-spo`) } } });
  await db.supplierPO.deleteMany({ where: { id: { in: LEGS.map((l) => `${l.id}-spo`) } } });
  await db.customerPOLine.deleteMany({ where: { customerPoId: CPO_ID } });
  await db.customerPO.deleteMany({ where: { id: CPO_ID } });

  const orderedAt = now - 30 * DAY;
  const wantedBy = new Date(now + 24 * DAY);
  const sourcingRef = 'RFQ-2026-0311';

  // ── The customer's order ──────────────────────────────────────────────────
  const custLines = CUSTOMER_LINES.map((l) => {
    const meta = MPNS.find((m) => m.mpn === l.mpn)!;
    return { ...l, meta, id: `${CPO_ID}-l${l.no}`, lineTotal: toMinor(l.qty * l.sell) };
  });
  const sellValueTotal = custLines.reduce((a, l) => a + l.lineTotal, 0);
  const custAddress = `${CUSTOMER.name}\n${CUSTOMER.addressLine1}\n${CUSTOMER.city} ${CUSTOMER.pincode}, ${CUSTOMER.country}\nGSTIN ${CUSTOMER.gstin ?? '—'}`;

  await db.customerPO.create({
    data: {
      id: CPO_ID,
      poNumber: 'CPO-NOVA-0050',
      customerId: CUSTOMER.id,
      poDate: new Date(orderedAt),
      currency: 'INR',
      incoterms: 'DDP',
      paymentTerms: CUSTOMER.paymentTerms,
      requestedDeliveryDate: wantedBy,
      shipToAddress: custAddress,
      billToAddress: custAddress,
      contactName: CUSTOMER.contactName,
      sourcingRef,
      notes:
        'Split build. No single approved supplier could cover all three lines at the quantities asked for, so the order is sourced across three.',
      totalValue: sellValueTotal,
      // Not FULLY_LINKED: 200 pieces of line 3 are still unbought.
      status: 'PARTIALLY_LINKED',
      createdById: 'u-priya',
      lines: {
        create: custLines.map((l) => ({
          id: l.id,
          lineNo: l.no,
          mpn: l.mpn,
          manufacturer: l.meta.manufacturer,
          description: l.meta.description,
          hsnCode: l.meta.hsnCode,
          quantity: l.qty,
          uom: 'PCS',
          unitPrice: l.sell,
          lineTotal: l.lineTotal,
          requestedDate: wantedBy,
          testingRequired: false,
        })),
      },
    },
  });

  // ── Our quote to the customer — one PI for the whole order ────────────────
  // The customer bought one thing and gets one quote. How we source it behind
  // the scenes is our problem, not something they should have to reconcile.
  const freightSell = toMinor(Math.round((sellValueTotal / 100) * 0.012));
  await db.proformaInvoice.create({
    data: {
      id: CPI_ID,
      piNumber: 'PI-1B-0044',
      direction: 'CUSTOMER_PI',
      customerPoId: CPO_ID,
      piDate: new Date(orderedAt + 2 * DAY),
      validUntil: new Date(orderedAt + 23 * DAY),
      currency: 'INR',
      subtotal: sellValueTotal,
      freightAmount: freightSell,
      insuranceAmount: 0,
      taxAmount: 0,
      totalValue: sellValueTotal + freightSell,
      bankDetails: 'HDFC Bank, Koramangala · A/C 50200012345678 · IFSC HDFC0000123',
      terms: `${CUSTOMER.paymentTerms} from invoice. Delivered as one consignment regardless of how many suppliers it is bought from. Goods supplied by 1BUY as Merchant of Record.`,
      sourcingRef,
      status: 'ACCEPTED',
      issuedAt: new Date(orderedAt + 2 * DAY),
      sentAt: new Date(orderedAt + 2 * DAY),
      acceptedAt: new Date(orderedAt + 4 * DAY),
      acceptanceRef: `Email confirmation from ${CUSTOMER.contactName}`,
      lines: {
        create: custLines.map((l) => ({
          lineNo: l.no,
          mpn: l.mpn,
          description: l.meta.description,
          hsnCode: l.meta.hsnCode,
          quantity: l.qty,
          unitPrice: l.sell,
          lineTotal: l.lineTotal,
        })),
      },
    },
  });

  // ── One leg per supplier ─────────────────────────────────────────────────
  for (const leg of LEGS) {
    const supplier = SUPPLIERS.find((s) => s.id === leg.supplierId)!;
    const fxRate = supplier.currency === 'INR' ? 1 : 83.2;
    const ctx: StageContext = {
      paymentMethod: leg.paymentMethod,
      testingRequired: false,
      testScope: null,
    };
    const ladder = applicableStages(ctx);
    const targetIdx = stageIndex(leg.targetStage);
    const passed = ladder.filter((s) => stageIndex(s.id) < targetIdx);
    const target = getStage(leg.targetStage);
    const reached = (id: string) => stageIndex(id) <= targetIdx;
    const past = (id: string) => stageIndex(id) < targetIdx;

    // Spread the history across the elapsed window, weighted by expected hours,
    // so the stage log reads plausibly rather than evenly.
    const startedAt = now - leg.startedDaysAgo * DAY;
    const stageEnteredAt = now - leg.hoursInStage * HOUR;
    const window = stageEnteredAt - startedAt;
    const weight = passed.reduce((a, s) => a + Math.max(1, s.expectedHours), 0) || 1;
    let acc = 0;
    const enteredAt = new Map<string, Date>();
    for (const s of passed) {
      enteredAt.set(s.id, new Date(startedAt + (acc / weight) * window));
      acc += Math.max(1, s.expectedHours);
    }
    enteredAt.set(leg.targetStage, new Date(stageEnteredAt));
    const at = (id: string) => enteredAt.get(id) ?? new Date(startedAt);

    // This leg's lines, derived from its allocations against the customer's.
    const legLines = leg.allocations.map((a, i) => {
      const cl = custLines.find((c) => c.no === a.customerLineNo)!;
      return {
        ...a,
        lineNo: i + 1,
        cl,
        id: `${leg.id}-sl${i + 1}`,
        lineTotal: toMinor(a.qty * a.buy, supplier.currency),
      };
    });
    const buyValueForeign = legLines.reduce((a, l) => a + l.lineTotal, 0);
    const buyValue = convertMinor(buyValueForeign, fxRate, supplier.currency, 'INR');
    // This leg's sell value is only the share it covers — not the whole
    // customer line. Charging the full line to every leg would triple-count
    // the revenue across the three work orders.
    const sellValue = legLines.reduce((a, l) => a + toMinor(l.qty * l.cl.sell), 0);

    const shipTo = `${ORG.legalName}\n${ORG.addressLine1}, ${ORG.addressLine2}\n${ORG.city} ${ORG.pincode}, ${ORG.country}\nGSTIN ${ORG.gstin}`;

    await db.supplierPO.create({
      data: {
        id: `${leg.id}-spo`,
        poNumber: leg.poNo,
        supplierId: supplier.id,
        poDate: at('SUPPLIER_PO_ISSUED'),
        currency: supplier.currency,
        fxRate,
        incoterms: supplier.incoterms,
        paymentMethod: leg.paymentMethod,
        creditDays: leg.paymentMethod === 'CREDIT' ? 45 : null,
        shipToAddress: shipTo,
        requiredDeliveryDate: new Date(orderedAt + 38 * DAY),
        totalValue: buyValueForeign,
        status: past('SUPPLIER_PI_RECEIVED') ? 'ACKNOWLEDGED' : 'ISSUED',
        issuedAt: at('SUPPLIER_PO_ISSUED'),
        sourcingRef,
        termsAndConditions: leg.rationale,
        lines: {
          create: legLines.map((l) => ({
            id: l.id,
            lineNo: l.lineNo,
            mpn: l.cl.mpn,
            manufacturer: l.cl.meta.manufacturer,
            description: l.cl.meta.description,
            hsnCode: l.cl.meta.hsnCode,
            quantity: l.qty,
            uom: 'PCS',
            unitPrice: l.buy,
            lineTotal: l.lineTotal,
            leadTimeDays: 21,
            countryOfOrigin: l.cl.meta.countryOfOrigin,
            dateCodeLot: `${2440 + l.lineNo} / LOT-${supplier.code}-${pad(l.lineNo, 2)}`,
            msl: l.cl.meta.msl,
            packaging: l.cl.meta.packaging,
            testingRequired: false,
          })),
        },
      },
    });

    let supplierPiId: string | null = null;
    if (leg.piNo && reached('SUPPLIER_PI_RECEIVED')) {
      supplierPiId = `${leg.id}-spi`;
      await db.proformaInvoice.create({
        data: {
          id: supplierPiId,
          piNumber: leg.piNo,
          direction: 'SUPPLIER_PI',
          supplierPoId: `${leg.id}-spo`,
          piDate: at('SUPPLIER_PI_RECEIVED'),
          currency: supplier.currency,
          subtotal: buyValueForeign,
          totalValue: buyValueForeign,
          status: 'RECEIVED',
          externalRef: `${supplier.code}/PI/${pad(300 + leg.aliasNo)}`,
          leadTimeDays: 21,
          terms: `${supplier.incoterms} ${supplier.city}. Payment via ${leg.paymentMethod.toLowerCase()}.`,
          lines: {
            create: legLines.map((l) => ({
              lineNo: l.lineNo,
              mpn: l.cl.mpn,
              description: l.cl.meta.description,
              hsnCode: l.cl.meta.hsnCode,
              quantity: l.qty,
              unitPrice: l.buy,
              lineTotal: l.lineTotal,
              leadTimeDays: 21,
            })),
          },
        },
      });
    }

    const freightCost = reached('FULL_SHIPMENT_DISPATCHED_BY_SUPPLIER')
      ? toMinor(Math.round((buyValue / 100) * 0.035))
      : 0;
    const insuranceCost = freightCost ? toMinor(Math.round((buyValue / 100) * 0.004)) : 0;
    const escrowFee =
      leg.paymentMethod === 'ESCROW' && reached('ESCROW_FUNDED') ? toMinor(4_200) : 0;
    const creditableGstOther = freightCost ? pctOf(freightCost, 18) : 0;

    const provisional = `CPO-NOVA-0050_PI-1B-0044_${leg.poNo}_SPI-PENDING`;
    const canonical = supplierPiId
      ? `CPO-NOVA-0050_PI-1B-0044_${leg.poNo}_${leg.piNo}`
      : provisional;

    await db.workOrder.create({
      data: {
        id: leg.id,
        canonicalName: canonical,
        alias: `WO-2026-${pad(leg.aliasNo)}`,
        provisionalName: supplierPiId ? provisional : null,
        nameLocked: Boolean(supplierPiId),
        // All three point at the SAME customer order and the same quote.
        customerPoId: CPO_ID,
        customerPiId: CPI_ID,
        supplierPoId: `${leg.id}-spo`,
        supplierPiId,
        stage: leg.targetStage,
        phase: target.phase,
        status: 'ACTIVE',
        stageEnteredAt: new Date(stageEnteredAt),
        paymentMethod: leg.paymentMethod,
        creditDays: leg.paymentMethod === 'CREDIT' ? 45 : null,
        escrowFundedBy: leg.paymentMethod === 'ESCROW' ? 'SUPPLIER' : null,
        escrowBasis: leg.paymentMethod === 'ESCROW' ? 'BUY_VALUE' : null,
        testingRequired: false,
        incoterms: supplier.incoterms,
        buyCurrency: supplier.currency,
        sellCurrency: 'INR',
        fxRate,
        termsLockedAt: past('TERMS_LOCKED') ? at('TERMS_LOCKED') : null,
        sellValue,
        buyValue,
        freightCost,
        insuranceCost,
        testingCost: 0,
        repackCost: 0,
        clearanceCost: 0,
        escrowFee,
        dutyBcd: 0,
        dutySws: 0,
        dutyIgst: 0,
        creditableGstOther,
        createdAt: at('SUPPLIER_SELECTED_FROM_AVL'),
      },
    });

    // ── The allocations. This is what makes the split real rather than a note.
    await db.pOLinkMapping.createMany({
      data: legLines.map((l) => ({
        workOrderId: leg.id,
        customerPoLineId: l.cl.id,
        supplierPoLineId: l.id,
        allocatedQty: l.qty,
        sellUnitPrice: l.cl.sell,
        buyUnitPrice: l.buy,
      })),
    });

    // ── Stage history ────────────────────────────────────────────────────────
    const path = [...passed.map((s) => s.id), leg.targetStage];
    const actorFor = (stageId: string) => {
      const owner = getStage(stageId).owner;
      if (owner === 'ONE_BUY') return { id: 'u-priya', label: 'Akash Dwivedi' };
      if (owner === 'CUSTOMER') return { id: null, label: `${CUSTOMER.contactName} (customer)` };
      if (owner === 'SUPPLIER') return { id: null, label: `${supplier.contactName} (supplier)` };
      if (owner === 'ESCROW') return { id: null, label: 'Escrow provider notification' };
      return { id: null, label: 'Logistics tracking sync' };
    };
    for (let i = 0; i < path.length; i++) {
      const stageId = path[i];
      const prev = i > 0 ? path[i - 1] : null;
      const actor = actorFor(stageId);
      await db.stageTransition.create({
        data: {
          workOrderId: leg.id,
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

    // ── Escrow, for the leg that uses it ────────────────────────────────────
    if (leg.paymentMethod === 'ESCROW' && reached('ESCROW_ACCOUNT_OPENED')) {
      const escrowId = `${leg.id}-esc`;
      const funded = reached('ESCROW_FUNDED') ? buyValue : 0;
      await db.escrowAccount.create({
        data: {
          id: escrowId,
          workOrderId: leg.id,
          escrowRef: `ESC-2026-${pad(400 + leg.aliasNo, 5)}`,
          provider: 'TBD — provider not yet finalised',
          currency: 'INR',
          virtualAccount: `VA1BUY${pad(leg.aliasNo, 8)}`,
          agreedAmount: buyValue,
          fundedAmount: funded,
          releasedAmount: 0,
          feeAmount: escrowFee,
          status: funded ? 'FUNDED' : 'OPENED',
          openedAt: at('ESCROW_ACCOUNT_OPENED'),
          provenance: 'MOCK',
          provenanceActor: 'Escrow simulator',
          provenanceAt: at('ESCROW_ACCOUNT_OPENED'),
          provenanceRef: `ESC-2026-${pad(400 + leg.aliasNo, 5)}`,
        },
      });
      if (funded) {
        await db.escrowTransaction.create({
          data: {
            escrowId,
            type: 'FUND',
            amount: funded,
            currency: 'INR',
            reference: `FUND/${pad(leg.aliasNo)}`,
            status: 'SETTLED',
            valueDate: at('ESCROW_FUNDED'),
            reason: 'The supplier deposited the agreed amount into escrow.',
            provenance: 'MOCK',
            provenanceActor: 'Escrow simulator',
            provenanceAt: at('ESCROW_FUNDED'),
          },
        });
      }
    }

    // ── Shipment, for the leg that has moved ────────────────────────────────
    if (reached('FULL_SHIPMENT_DISPATCHED_BY_SUPPLIER')) {
      const shipmentId = `${leg.id}-shp`;
      await db.shipment.create({
        data: {
          id: shipmentId,
          workOrderId: leg.id,
          legType: 'IMPORT',
          carrierCode: 'DHL',
          awb: `61${pad(leg.aliasNo * 7919, 8)}`,
          serviceName: 'Express Worldwide',
          originName: `${supplier.city}, ${supplier.country}`,
          originCountry: supplier.country,
          destName: `${ORG.city}, ${ORG.country}`,
          destCountry: ORG.country,
          incoterms: supplier.incoterms,
          pieces: 4,
          grossWeightKg: 12.4,
          declaredValue: buyValue,
          currency: 'INR',
          freightAmount: freightCost,
          freightGst: creditableGstOther,
          status: reached('IN_TRANSIT_INTERNATIONAL') ? 'IN_TRANSIT' : 'BOOKED',
          dispatchedAt: at('FULL_SHIPMENT_DISPATCHED_BY_SUPPLIER'),
          estimatedDelivery: new Date(now + 6 * DAY),
          provenance: 'MOCK',
          provenanceActor: 'Logistics tracking sync',
          provenanceAt: at('FULL_SHIPMENT_DISPATCHED_BY_SUPPLIER'),
          provenanceRef: `DHL/${pad(leg.aliasNo)}`,
        },
      });
      await db.trackingEvent.createMany({
        data: [
          {
            shipmentId,
            code: 'PU',
            description: 'Shipment picked up',
            location: `${supplier.city}, ${supplier.country}`,
            occurredAt: at('FULL_SHIPMENT_DISPATCHED_BY_SUPPLIER'),
            provenance: 'MOCK',
          },
          {
            shipmentId,
            code: 'DF',
            description: 'Departed facility',
            location: `${supplier.city}, ${supplier.country}`,
            occurredAt: new Date(at('FULL_SHIPMENT_DISPATCHED_BY_SUPPLIER').getTime() + 8 * HOUR),
            provenance: 'MOCK',
          },
          {
            shipmentId,
            code: 'AF',
            description: 'Arrived at transit hub',
            location: 'Hong Kong',
            occurredAt: new Date(at('IN_TRANSIT_INTERNATIONAL').getTime()),
            provenance: 'MOCK',
          },
        ],
      });
    }

    // ── The record of why this supplier got this share ──────────────────────
    await db.auditLogEntry.create({
      data: {
        workOrderId: leg.id,
        entity: 'Work order',
        entityId: leg.id,
        action: 'CREATE',
        field: 'Share of the customer order',
        afterValue: leg.allocations
          .map((a) => {
            const cl = custLines.find((c) => c.no === a.customerLineNo)!;
            return `${a.qty.toLocaleString('en-IN')} of ${cl.qty.toLocaleString('en-IN')} ${cl.mpn}`;
          })
          .join('; '),
        reason: leg.rationale,
        actorId: 'u-priya',
        actorLabel: 'Akash Dwivedi',
        createdAt: at('SUPPLIER_SELECTED_FROM_AVL'),
      },
    });

    await db.communication.create({
      data: {
        workOrderId: leg.id,
        entryClass: 'SYSTEM',
        channel: 'SYSTEM',
        direction: 'INTERNAL',
        subject: `Split sourcing — ${supplier.name} takes part of CPO-NOVA-0050`,
        body: `${leg.rationale} This is one of ${LEGS.length} supplier orders against the same customer order; the other legs are tracked as separate work orders because they move at different speeds.`,
        status: 'CLOSED',
        occurredAt: at('SUPPLIER_SELECTED_FROM_AVL'),
        systemIcon: 'GitBranch',
        loggedById: 'u-priya',
        participants: {
          create: [{ role: 'FROM', stakeholder: 'ONE_BUY', name: 'Akash Dwivedi' }],
        },
        contextChips: {
          create: [{ kind: 'DOCUMENT', refId: CPO_ID, label: 'CPO-NOVA-0050' }],
        },
      },
    });
  }

  const ordered = custLines.reduce((a, l) => a + l.qty, 0);
  const allocated = LEGS.flatMap((l) => l.allocations).reduce((a, x) => a + x.qty, 0);
  return {
    customerPo: 'CPO-NOVA-0050',
    workOrders: LEGS.map((l) => `WO-2026-${pad(l.aliasNo)}`),
    ordered,
    allocated,
    shortfall: ordered - allocated,
  };
}

// Runnable on its own: `npx tsx prisma/seed-split-sourcing.ts`
if (process.argv[1]?.includes('seed-split-sourcing')) {
  const db = new PrismaClient();
  seedSplitSourcing(db)
    .then((r) => {
      console.log('split-sourcing scenario ready');
      console.log(`  customer order : ${r.customerPo}`);
      console.log(`  work orders    : ${r.workOrders.join(', ')}`);
      console.log(`  units          : ${r.allocated} of ${r.ordered} covered, ${r.shortfall} still to buy`);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => db.$disconnect());
}
