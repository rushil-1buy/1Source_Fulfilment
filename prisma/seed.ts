/**
 * SEED — master prompt §11 "Seed data".
 *
 * The work-order builder walks the stage ladder from lib/domain/stages and, for
 * every stage the order has already passed, creates the artifacts that stage is
 * defined to produce. Seeded data therefore cannot contradict the state machine,
 * and adding a stage to the ladder automatically slots into the seed.
 */

import { PrismaClient } from '@/lib/generated/prisma';
import {
  applicableStages,
  getStage,
  stageApplies,
  stageIndex,
  type StageContext,
} from '../lib/domain/stages';
import { computeGstInvoice, makeRateLookup, type HsnRateRow } from '../lib/tax/gst-engine';
import { computeLandedCost } from '../lib/tax/landed-cost';
import { amountInWords, convertMinor, pctOf, toMinor } from '../lib/domain/money';
import { GLOSSARY } from '../lib/glossary';
import { seedDemoOrder } from './seed-demo-order';
import {
  AVL,
  CARRIERS,
  CONNECTORS,
  CUSTOMERS,
  HSN_RATES,
  MPNS,
  NUMBERING,
  ORG,
  SUPPLIERS,
  TESTING_LABS,
  TEST_PARAMETERS,
  USERS,
} from './seed-masters';

const db = new PrismaClient();

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const NOW = Date.now();

const ago = (ms: number) => new Date(NOW - ms);
const pad = (n: number, w = 4) => String(n).padStart(w, '0');

// ── Work order specifications ───────────────────────────────────────────────

interface LineSpec {
  mpn: string;
  qty: number;
  /** Sell price per piece, INR major units. */
  sell: number;
  /** Buy price per piece, in the supplier's currency, major units. */
  buy: number;
  testing?: boolean;
}

interface WoSpec {
  key: string;
  aliasNo: number;
  docNo: number;
  customerId: string;
  supplierId: string;
  paymentMethod: 'ADVANCE' | 'ESCROW' | 'CREDIT';
  testingRequired: boolean;
  testScope?: 'LOT_SAMPLE' | 'FULL_BATCH';
  targetStage: string;
  /** Set for the blocked order. */
  exception?: { type: string; reason: string; severity: string };
  startedDaysAgo: number;
  /** Hours already spent in the current stage — drives at-risk / breached. */
  hoursInStage: number;
  labId?: string;
  lines: LineSpec[];
  headline: string;
}

const SPECS: WoSpec[] = [
  {
    key: 'wo-testing',
    aliasNo: 107,
    docNo: 42,
    customerId: 'c-acme',
    supplierId: 's-nexus',
    paymentMethod: 'ESCROW',
    testingRequired: true,
    testScope: 'LOT_SAMPLE',
    targetStage: 'TESTING_IN_PROGRESS',
    startedDaysAgo: 21,
    hoursInStage: 26,
    labId: 'lab-whl-blr',
    headline: 'Reference scenario — escrow with lot-sample testing, lab is mid-test.',
    lines: [
      { mpn: 'STM32F407VGT6', qty: 1200, sell: 985, buy: 9.15, testing: true },
      { mpn: 'W25Q128JVSIQ', qty: 3000, sell: 152, buy: 1.42, testing: true },
    ],
  },
  {
    key: 'wo-customs',
    aliasNo: 104,
    docNo: 39,
    customerId: 'c-nova',
    supplierId: 's-pacific',
    paymentMethod: 'ESCROW',
    testingRequired: true,
    testScope: 'LOT_SAMPLE',
    targetStage: 'CUSTOMS_ENTRY_FILED_ICEGATE',
    startedDaysAgo: 34,
    hoursInStage: 19,
    labId: 'lab-whl-blr',
    headline: 'Bill of Entry filed, waiting on assessment from customs.',
    lines: [
      { mpn: 'TL072CP', qty: 8000, sell: 41, buy: 0.38, testing: true },
      { mpn: 'SN74HC595N', qty: 6000, sell: 33, buy: 0.3, testing: true },
      { mpn: 'LM7805CT', qty: 4000, sell: 27, buy: 0.25 },
    ],
  },
  {
    key: 'wo-inspection',
    aliasNo: 101,
    docNo: 36,
    customerId: 'c-acme',
    supplierId: 's-global',
    paymentMethod: 'ESCROW',
    testingRequired: true,
    testScope: 'FULL_BATCH',
    targetStage: 'INBOUND_INSPECTION_IN_PROGRESS',
    startedDaysAgo: 46,
    hoursInStage: 11,
    // Foreign lab on purpose: import of services, so this order exercises the
    // reverse-charge self-invoice path rather than a normal input credit.
    labId: 'lab-whl-szx',
    headline:
      'Goods received and cleared; inbound inspection under way. Tested by the foreign lab, so testing is reverse-charged.',
    lines: [
      { mpn: 'MT41K256M16TW-107', qty: 900, sell: 412, buy: 3.85, testing: true },
      { mpn: 'GRM188R71H104KA93D', qty: 20000, sell: 3.4, buy: 0.031, testing: true },
    ],
  },
  {
    key: 'wo-testfail',
    aliasNo: 106,
    docNo: 41,
    customerId: 'c-nova',
    supplierId: 's-shenzhen',
    paymentMethod: 'ESCROW',
    testingRequired: true,
    testScope: 'FULL_BATCH',
    targetStage: 'TEST_FAILED',
    exception: {
      type: 'TEST_FAIL',
      reason:
        'Lot LOT-A7734 failed X-ray and marking-permanency checks — 12 of 50 sampled pieces show re-marked packages inconsistent with the declared date code.',
      severity: 'CRITICAL',
    },
    startedDaysAgo: 26,
    hoursInStage: 61,
    labId: 'lab-whl-blr',
    headline: 'BLOCKED — full-batch test failed on suspected re-marked parts.',
    lines: [
      { mpn: 'ESP32-WROOM-32D', qty: 2500, sell: 268, buy: 2.48, testing: true },
      { mpn: 'FT232RL', qty: 1500, sell: 189, buy: 1.76, testing: true },
    ],
  },
  {
    key: 'wo-late',
    aliasNo: 110,
    docNo: 45,
    customerId: 'c-zenith',
    supplierId: 's-global',
    paymentMethod: 'CREDIT',
    testingRequired: false,
    targetStage: 'SUPPLIER_PI_RECEIVED',
    // 5 days in a stage that should take 1 → breached.
    startedDaysAgo: 9,
    hoursInStage: 122,
    headline: 'OVERDUE — supplier proforma sitting unreconciled for five days.',
    lines: [
      { mpn: '1N4007', qty: 50000, sell: 1.15, buy: 0.0098 },
      { mpn: 'BC547B', qty: 30000, sell: 1.85, buy: 0.016 },
    ],
  },
  {
    key: 'wo-advance',
    aliasNo: 109,
    docNo: 44,
    customerId: 'c-acme',
    supplierId: 's-pacific',
    paymentMethod: 'ADVANCE',
    testingRequired: false,
    targetStage: 'IN_TRANSIT_INTERNATIONAL',
    startedDaysAgo: 15,
    hoursInStage: 62,
    headline: 'No testing, paid up front — the whole testing phase is skipped.',
    lines: [
      { mpn: 'RC0603FR-0710KL', qty: 100000, sell: 0.72, buy: 0.0062 },
      { mpn: 'CL10B104KB8NNNC', qty: 80000, sell: 0.95, buy: 0.0081 },
    ],
  },
  {
    key: 'wo-closed',
    aliasNo: 96,
    docNo: 31,
    customerId: 'c-nova',
    supplierId: 's-nexus',
    paymentMethod: 'ESCROW',
    testingRequired: true,
    testScope: 'LOT_SAMPLE',
    targetStage: 'ORDER_CLOSED',
    startedDaysAgo: 78,
    hoursInStage: 0,
    labId: 'lab-whl-blr',
    headline:
      'Fully closed — complete tax invoice with IRN and e-way bill, input credits booked, margin locked.',
    lines: [
      { mpn: 'ATMEGA328P-PU', qty: 5000, sell: 214, buy: 1.98, testing: true },
      { mpn: 'LM358N', qty: 12000, sell: 28, buy: 0.255, testing: true },
      { mpn: 'NE555P', qty: 10000, sell: 24, buy: 0.219 },
    ],
  },
  {
    // Delhi customer = same state as our registration → CGST + SGST split.
    key: 'wo-closed-delhi',
    aliasNo: 94,
    docNo: 29,
    customerId: 'c-acme',
    supplierId: 's-pacific',
    paymentMethod: 'ESCROW',
    testingRequired: true,
    testScope: 'LOT_SAMPLE',
    targetStage: 'ORDER_CLOSED',
    startedDaysAgo: 92,
    hoursInStage: 0,
    labId: 'lab-whl-blr',
    headline: 'Closed, same-state customer — invoice splits into CGST and SGST.',
    lines: [
      { mpn: 'SN74HC595N', qty: 14000, sell: 34, buy: 0.31, testing: true },
      { mpn: 'BC547B', qty: 40000, sell: 1.9, buy: 0.0165 },
    ],
  },
  {
    // SEZ customer → zero-rated supply under LUT, no tax charged.
    key: 'wo-closed-sez',
    aliasNo: 92,
    docNo: 27,
    customerId: 'c-zenith',
    supplierId: 's-nexus',
    paymentMethod: 'ADVANCE',
    testingRequired: false,
    targetStage: 'ORDER_CLOSED',
    startedDaysAgo: 104,
    hoursInStage: 0,
    headline: 'Closed, SEZ customer — zero-rated under LUT, so no GST is charged.',
    lines: [
      { mpn: 'W25Q128JVSIQ', qty: 4000, sell: 158, buy: 1.44 },
      { mpn: 'FT232RL', qty: 2200, sell: 192, buy: 1.78 },
    ],
  },
  {
    key: 'wo-escrow-release',
    aliasNo: 99,
    docNo: 34,
    customerId: 'c-zenith',
    supplierId: 's-pacific',
    paymentMethod: 'ESCROW',
    testingRequired: true,
    testScope: 'LOT_SAMPLE',
    targetStage: 'ESCROW_FINAL_RELEASE_AUTHORISED',
    startedDaysAgo: 58,
    hoursInStage: 6,
    labId: 'lab-whl-blr',
    headline: 'Inspection passed — final escrow release authorised by two Finance approvers.',
    lines: [
      { mpn: 'IRF540N', qty: 3000, sell: 88, buy: 0.81, testing: true },
      { mpn: 'LTV-817S', qty: 9000, sell: 19, buy: 0.172, testing: true },
    ],
  },
  {
    key: 'wo-early',
    aliasNo: 112,
    docNo: 47,
    customerId: 'c-acme',
    supplierId: 's-nexus',
    paymentMethod: 'ESCROW',
    testingRequired: true,
    testScope: 'LOT_SAMPLE',
    // A Work Order cannot predate its supplier PO — the Work Order is created BY
    // linking a supplier PO to a customer PO (§3.2). Orders earlier than B2 exist
    // as standalone customer POs instead; see seedUnlinkedCustomerPos().
    targetStage: 'SUPPLIER_PO_ISSUED',
    startedDaysAgo: 3,
    hoursInStage: 5,
    headline:
      'Brand new — supplier PO just issued, so the Work Order name still ends in SPI-PENDING.',
    lines: [
      { mpn: '2N3904', qty: 25000, sell: 2.1, buy: 0.018 },
      { mpn: 'EEU-FR1V101', qty: 6000, sell: 12.5, buy: 0.112 },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════════════

async function wipe() {
  // Order matters: children before parents.
  const tables = [
    'auditLogEntry',
    'communicationContext',
    'communicationParticipant',
    'document',
    'communication',
    'task',
    'exceptionRecord',
    'eWayBill',
    'creditNote',
    'taxInvoiceLine',
    'taxInvoice',
    'inputTaxCredit',
    'reverseChargeSelfInvoice',
    'taxPeriodSummary',
    'proofOfDelivery',
    'repackJob',
    'inspectionChecklistItem',
    'inspectionReport',
    'grnLine',
    'grn',
    'customsQuery',
    'customsStatusEvent',
    'customsEntry',
    'trackingEvent',
    'shipment',
    'testLineResult',
    'testResult',
    'testRequest',
    'escrowApproval',
    'escrowDispute',
    'escrowTransaction',
    'escrowAccount',
    'stageTransition',
    'pOLinkMapping',
    'workOrder',
    'pILine',
    'proformaInvoice',
    'supplierPOLine',
    'supplierPO',
    'customerPOLine',
    'customerPO',
    'integrationCallLog',
    'integrationConnector',
    'hsnRate',
    'mpnCatalogueItem',
    'testParameterMaster',
    'testingLab',
    'carrier',
    'aVLRecord',
    'supplier',
    'customer',
    'glossaryTerm',
    'numberingSeries',
    'savedView',
    'user',
    'orgSetting',
  ] as const;

  for (const t of tables) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any)[t].deleteMany();
  }
}

async function seedMasters() {
  await db.orgSetting.create({ data: ORG });
  await db.user.createMany({ data: USERS });
  await db.numberingSeries.createMany({ data: NUMBERING });
  await db.glossaryTerm.createMany({
    data: GLOSSARY.map((g) => ({
      key: g.key,
      term: g.term,
      plainTerm: g.plainTerm ?? null,
      whatItIs: g.whatItIs,
      whyItMatters: g.whyItMatters,
      example: g.example,
      whoFillsItIn: g.whoFillsItIn ?? null,
      category: g.category,
    })),
  });
  await db.customer.createMany({ data: CUSTOMERS });
  await db.supplier.createMany({ data: SUPPLIERS });
  await db.aVLRecord.createMany({
    data: AVL.map((a) => ({
      ...a,
      categories: JSON.stringify(a.categories),
      certifications: JSON.stringify(a.certifications),
    })),
  });
  await db.mpnCatalogueItem.createMany({ data: MPNS });
  await db.hsnRate.createMany({ data: HSN_RATES });
  await db.testParameterMaster.createMany({ data: TEST_PARAMETERS });
  await db.carrier.createMany({ data: CARRIERS });
  await db.testingLab.createMany({
    data: TESTING_LABS.map((l) => ({ ...l, accreditations: JSON.stringify(l.accreditations) })),
  });
  await db.integrationConnector.createMany({ data: CONNECTORS });
}

// ── The work order builder ──────────────────────────────────────────────────

interface BuiltLine extends LineSpec {
  lineNo: number;
  mpnMeta: (typeof MPNS)[number];
  sellTotal: number; // INR minor
  buyTotalForeign: number; // supplier currency minor
  customerLineId: string;
  supplierLineId: string;
}

async function buildWorkOrder(spec: WoSpec) {
  const customer = CUSTOMERS.find((c) => c.id === spec.customerId)!;
  const supplier = SUPPLIERS.find((s) => s.id === spec.supplierId)!;
  const ctx: StageContext = {
    paymentMethod: spec.paymentMethod,
    testingRequired: spec.testingRequired,
    testScope: spec.testScope ?? null,
  };
  const fxRate = supplier.currency === 'INR' ? 1 : 83.2;

  // Which stages has this order already been through?
  const ladder = applicableStages(ctx).filter((s) => stageApplies(s, ctx));
  const targetIdx = stageIndex(spec.targetStage);
  const passed = ladder.filter((s) => stageIndex(s.id) < targetIdx);
  const target = getStage(spec.targetStage);
  const reached = (stageId: string) =>
    passed.some((s) => s.id === stageId) || spec.targetStage === stageId;
  const past = (stageId: string) => passed.some((s) => s.id === stageId);

  // Timeline: spread the passed stages across the elapsed window, weighted by
  // each stage's expected duration so the history reads plausibly.
  const startedAt = NOW - spec.startedDaysAgo * DAY;
  const stageEnteredAt = NOW - spec.hoursInStage * HOUR;
  const window = stageEnteredAt - startedAt;
  const totalWeight = passed.reduce((a, s) => a + Math.max(1, s.expectedHours), 0) || 1;
  let acc = 0;
  const enteredAtFor = new Map<string, Date>();
  for (const s of passed) {
    enteredAtFor.set(s.id, new Date(startedAt + (acc / totalWeight) * window));
    acc += Math.max(1, s.expectedHours);
  }
  enteredAtFor.set(spec.targetStage, new Date(stageEnteredAt));

  const at = (stageId: string) => enteredAtFor.get(stageId) ?? new Date(startedAt);

  // ── Documents: customer PO ────────────────────────────────────────────────
  const custPoNo = `CPO-${customer.code}-${pad(spec.docNo)}`;
  const custPiNo = `PI-1B-${pad(spec.docNo - 11)}`;
  const supPoNo = `PO-1B-${pad(spec.aliasNo)}`;
  const supPiNo = `SPI-${supplier.code}-${pad(spec.docNo + 46)}`;

  const lines: BuiltLine[] = spec.lines.map((l, i) => {
    const mpnMeta = MPNS.find((m) => m.mpn === l.mpn)!;
    return {
      ...l,
      lineNo: i + 1,
      mpnMeta,
      sellTotal: toMinor(l.qty * l.sell),
      buyTotalForeign: toMinor(l.qty * l.buy, supplier.currency),
      customerLineId: `${spec.key}-cl-${i + 1}`,
      supplierLineId: `${spec.key}-sl-${i + 1}`,
    };
  });

  const sellValue = lines.reduce((a, l) => a + l.sellTotal, 0);
  const buyValueForeign = lines.reduce((a, l) => a + l.buyTotalForeign, 0);
  const buyValue = convertMinor(buyValueForeign, fxRate, supplier.currency, 'INR');

  const shipTo = `${ORG.legalName}\n${ORG.addressLine1}, ${ORG.addressLine2}\n${ORG.city} ${ORG.pincode}, ${ORG.country}\nGSTIN ${ORG.gstin}`;
  const custShipTo = `${customer.name}\n${customer.addressLine1}\n${customer.city} ${customer.pincode}, ${customer.country}\nGSTIN ${customer.gstin ?? '—'}`;

  await db.customerPO.create({
    data: {
      id: `${spec.key}-cpo`,
      poNumber: custPoNo,
      customerId: customer.id,
      poDate: at('CUSTOMER_PO_RECEIVED'),
      currency: 'INR',
      incoterms: 'DDP',
      paymentTerms: customer.paymentTerms,
      requestedDeliveryDate: new Date(startedAt + 45 * DAY),
      shipToAddress: custShipTo,
      billToAddress: custShipTo,
      contactName: customer.contactName,
      notes: `Received by email from ${customer.contactEmail}.`,
      totalValue: sellValue,
      status: 'FULLY_LINKED',
      createdById: 'u-priya',
      lines: {
        create: lines.map((l) => ({
          id: l.customerLineId,
          lineNo: l.lineNo,
          mpn: l.mpn,
          manufacturer: l.mpnMeta.manufacturer,
          description: l.mpnMeta.description,
          hsnCode: l.mpnMeta.hsnCode,
          quantity: l.qty,
          uom: 'PCS',
          unitPrice: l.sell,
          lineTotal: l.sellTotal,
          requestedDate: new Date(startedAt + 45 * DAY),
          testingRequired: Boolean(l.testing),
        })),
      },
    },
  });

  // ── Customer PI ───────────────────────────────────────────────────────────
  const freightSell = toMinor(Math.round((sellValue / 100) * 0.012));
  let customerPiId: string | null = null;
  if (reached('PI_ISSUED_TO_CUSTOMER')) {
    const accepted = past('PI_ACCEPTED_BY_CUSTOMER') || reached('PI_ACCEPTED_BY_CUSTOMER');
    customerPiId = `${spec.key}-cpi`;
    await db.proformaInvoice.create({
      data: {
        id: customerPiId,
        piNumber: custPiNo,
        direction: 'CUSTOMER_PI',
        customerPoId: `${spec.key}-cpo`,
        piDate: at('PI_ISSUED_TO_CUSTOMER'),
        validUntil: new Date(at('PI_ISSUED_TO_CUSTOMER').getTime() + 21 * DAY),
        currency: 'INR',
        subtotal: sellValue,
        freightAmount: freightSell,
        insuranceAmount: 0,
        taxAmount: 0,
        totalValue: sellValue + freightSell,
        bankDetails: 'HDFC Bank, Koramangala · A/C 50200012345678 · IFSC HDFC0000123',
        terms: `${customer.paymentTerms} from invoice. Prices firm until the validity date. Goods supplied by 1BUY as Merchant of Record.`,
        status: accepted ? 'ACCEPTED' : 'SENT',
        issuedAt: at('PI_ISSUED_TO_CUSTOMER'),
        sentAt: at('PI_ISSUED_TO_CUSTOMER'),
        acceptedAt: accepted ? at('PI_ACCEPTED_BY_CUSTOMER') : null,
        acceptanceRef: accepted ? `Email confirmation from ${customer.contactName}` : null,
        lines: {
          create: lines.map((l) => ({
            lineNo: l.lineNo,
            mpn: l.mpn,
            description: l.mpnMeta.description,
            hsnCode: l.mpnMeta.hsnCode,
            quantity: l.qty,
            unitPrice: l.sell,
            lineTotal: l.sellTotal,
          })),
        },
      },
    });
  }

  // ── Supplier PO ───────────────────────────────────────────────────────────
  const hasSupplierPo = reached('SUPPLIER_PO_ISSUED');
  if (hasSupplierPo) {
    await db.supplierPO.create({
      data: {
        id: `${spec.key}-spo`,
        poNumber: supPoNo,
        supplierId: supplier.id,
        poDate: at('SUPPLIER_PO_ISSUED'),
        currency: supplier.currency,
        fxRate,
        incoterms: supplier.incoterms,
        paymentMethod: spec.paymentMethod,
        creditDays: spec.paymentMethod === 'CREDIT' ? 45 : null,
        shipToAddress: shipTo,
        requiredDeliveryDate: new Date(startedAt + 38 * DAY),
        totalValue: buyValueForeign,
        status: past('SUPPLIER_PI_RECEIVED') ? 'ACKNOWLEDGED' : 'ISSUED',
        issuedAt: at('SUPPLIER_PO_ISSUED'),
        lines: {
          create: lines.map((l) => ({
            id: l.supplierLineId,
            lineNo: l.lineNo,
            mpn: l.mpn,
            manufacturer: l.mpnMeta.manufacturer,
            description: l.mpnMeta.description,
            hsnCode: l.mpnMeta.hsnCode,
            quantity: l.qty,
            uom: 'PCS',
            unitPrice: l.buy,
            lineTotal: l.buyTotalForeign,
            leadTimeDays: 21,
            countryOfOrigin: l.mpnMeta.countryOfOrigin,
            dateCodeLot: `${2437 + l.lineNo} / LOT-${supplier.code}-${pad(l.lineNo, 2)}`,
            msl: l.mpnMeta.msl,
            packaging: l.mpnMeta.packaging,
            testingRequired: Boolean(l.testing),
            testScope: l.testing ? (spec.testScope ?? null) : null,
            sampleSize: l.testing && spec.testScope === 'LOT_SAMPLE' ? 50 : null,
            aql: l.testing && spec.testScope === 'LOT_SAMPLE' ? 'AQL 1.0' : null,
          })),
        },
      },
    });
  }

  // ── Supplier PI — completes the Work Order name ────────────────────────────
  const hasSupplierPi = reached('SUPPLIER_PI_RECEIVED');
  let supplierPiId: string | null = null;
  if (hasSupplierPi) {
    supplierPiId = `${spec.key}-spi`;
    await db.proformaInvoice.create({
      data: {
        id: supplierPiId,
        piNumber: supPiNo,
        direction: 'SUPPLIER_PI',
        supplierPoId: `${spec.key}-spo`,
        piDate: at('SUPPLIER_PI_RECEIVED'),
        currency: supplier.currency,
        subtotal: buyValueForeign,
        totalValue: buyValueForeign,
        status: 'RECEIVED',
        externalRef: `${supplier.code}/PI/${pad(spec.docNo + 200)}`,
        leadTimeDays: 21,
        terms: `${supplier.incoterms} ${supplier.city}. Payment via ${spec.paymentMethod.toLowerCase()}.`,
        lines: {
          create: lines.map((l) => ({
            lineNo: l.lineNo,
            mpn: l.mpn,
            description: l.mpnMeta.description,
            hsnCode: l.mpnMeta.hsnCode,
            quantity: l.qty,
            unitPrice: l.buy,
            lineTotal: l.buyTotalForeign,
            leadTimeDays: 21,
          })),
        },
      },
    });
  }

  // ── Costs ─────────────────────────────────────────────────────────────────
  const freightCost = reached('FULL_SHIPMENT_DISPATCHED_BY_SUPPLIER')
    ? toMinor(Math.round((buyValue / 100) * 0.035))
    : 0;
  const insuranceCost = freightCost ? toMinor(Math.round((buyValue / 100) * 0.004)) : 0;
  const testingCost = reached('PARTS_RECEIVED_AT_WHL') ? toMinor(24_500) : 0;
  const repackCost = reached('REBRAND_AND_REPACK_IN_PROGRESS') ? toMinor(7_800) : 0;
  const clearanceCost = reached('CUSTOMS_ENTRY_FILED_ICEGATE') ? toMinor(11_500) : 0;
  const escrowFee = spec.paymentMethod === 'ESCROW' && reached('ESCROW_FUNDED') ? toMinor(5_400) : 0;

  // Customs duty — assessed on CIF, using the customs rate (not our locked FX).
  const customsFx = 83.85;
  const assessableValue = reached('CUSTOMS_ENTRY_FILED_ICEGATE')
    ? convertMinor(buyValueForeign, customsFx, supplier.currency, 'INR') + freightCost + insuranceCost
    : 0;
  const dutyBcd = assessableValue ? pctOf(assessableValue, 10) : 0;
  const dutySws = dutyBcd ? pctOf(dutyBcd, 10) : 0;
  const dutyIgst = assessableValue ? pctOf(assessableValue + dutyBcd + dutySws, 18) : 0;

  // Creditable GST on domestic services (freight, testing if Indian, repack).
  const labIsForeign = TESTING_LABS.find((l) => l.id === spec.labId)?.isForeign ?? false;
  const creditableGstOther =
    (freightCost ? pctOf(freightCost, 18) : 0) +
    (testingCost && !labIsForeign ? pctOf(testingCost, 18) : 0) +
    (repackCost ? pctOf(repackCost, 18) : 0);

  // ── The Work Order ────────────────────────────────────────────────────────
  const provisional = `${custPoNo}_${custPiNo}_${supPoNo}_SPI-PENDING`;
  const canonical = hasSupplierPi
    ? `${custPoNo}_${custPiNo}_${supPoNo}_${supPiNo}`
    : provisional;

  await db.workOrder.create({
    data: {
      id: spec.key,
      canonicalName: canonical,
      alias: `WO-2026-${pad(spec.aliasNo)}`,
      provisionalName: hasSupplierPi ? provisional : null,
      nameLocked: hasSupplierPi,
      customerPoId: `${spec.key}-cpo`,
      customerPiId,
      supplierPoId: `${spec.key}-spo`,
      supplierPiId,
      stage: spec.targetStage,
      phase: target.phase,
      status: spec.exception ? 'BLOCKED' : target.isTerminal ? 'CLOSED' : 'ACTIVE',
      stageEnteredAt: new Date(stageEnteredAt),
      paymentMethod: spec.paymentMethod,
      creditDays: spec.paymentMethod === 'CREDIT' ? 45 : null,
      testingRequired: spec.testingRequired,
      testScope: spec.testScope ?? null,
      incoterms: supplier.incoterms,
      buyCurrency: supplier.currency,
      sellCurrency: 'INR',
      fxRate,
      termsLockedAt: past('TERMS_LOCKED') ? at('TERMS_LOCKED') : null,
      sellValue,
      buyValue,
      freightCost,
      insuranceCost,
      testingCost,
      repackCost,
      clearanceCost,
      escrowFee,
      dutyBcd,
      dutySws,
      dutyIgst,
      creditableGstOther,
      createdAt: at('CUSTOMER_PO_RECEIVED'),
      closedAt: target.isTerminal ? new Date(stageEnteredAt) : null,
    },
  });

  if (hasSupplierPo) {
    await db.pOLinkMapping.createMany({
      data: lines.map((l) => ({
        workOrderId: spec.key,
        customerPoLineId: l.customerLineId,
        supplierPoLineId: l.supplierLineId,
        allocatedQty: l.qty,
        sellUnitPrice: l.sell,
        buyUnitPrice: l.buy,
      })),
    });
  }

  // ── Stage history ─────────────────────────────────────────────────────────
  const path = [...passed.map((s) => s.id), spec.targetStage];
  const actorFor = (stageId: string) => {
    const owner = getStage(stageId).owner;
    if (owner === 'ONE_BUY') return { id: 'u-priya', label: 'Akash Dwivedi' };
    if (owner === 'CUSTOMER') return { id: null, label: `${customer.contactName} (customer)` };
    if (owner === 'SUPPLIER') return { id: null, label: `${supplier.contactName} (supplier)` };
    if (owner === 'ESCROW') return { id: null, label: 'Escrow provider notification' };
    if (owner === 'WHL') return { id: null, label: 'Testing Laboratory status sync' };
    if (owner === 'WHA') return { id: null, label: 'Indian Customs status sync' };
    return { id: null, label: 'Logistics tracking sync' };
  };

  for (let i = 0; i < path.length; i++) {
    const stageId = path[i];
    const prev = i > 0 ? path[i - 1] : null;
    const actor = actorFor(stageId);
    const enteredAt = at(stageId);
    await db.stageTransition.create({
      data: {
        workOrderId: spec.key,
        fromStage: prev,
        toStage: stageId,
        actorId: actor.id,
        actorLabel: actor.label,
        provenance: actor.id ? 'MANUAL' : 'MOCK',
        durationSecondsInPrevious: prev
          ? Math.round((enteredAt.getTime() - at(prev).getTime()) / 1000)
          : null,
        createdAt: enteredAt,
      },
    });
  }

  // ── Escrow ────────────────────────────────────────────────────────────────
  if (spec.paymentMethod === 'ESCROW' && reached('ESCROW_ACCOUNT_OPENED')) {
    const escrowId = `${spec.key}-esc`;
    const testTranche = reached('ESCROW_PARTIAL_RELEASE_FOR_TESTING')
      ? Math.round(buyValue * 0.15)
      : 0;
    const finalReleased = reached('SUPPLIER_PAID_IN_FULL') ? buyValue - testTranche : 0;
    const funded = reached('ESCROW_FUNDED') ? buyValue : 0;
    const released = testTranche + finalReleased;

    await db.escrowAccount.create({
      data: {
        id: escrowId,
        workOrderId: spec.key,
        escrowRef: `ESC-2026-${pad(400 + spec.aliasNo, 5)}`,
        provider: 'TBD — provider not yet finalised',
        currency: 'INR',
        virtualAccount: `VA1BUY${pad(spec.aliasNo, 8)}`,
        agreedAmount: buyValue,
        fundedAmount: funded,
        releasedAmount: released,
        feeAmount: escrowFee,
        status: reached('SUPPLIER_PAID_IN_FULL')
          ? 'SETTLED'
          : testTranche
            ? 'PARTIALLY_RELEASED'
            : funded
              ? 'FUNDED'
              : 'OPENED',
        openedAt: at('ESCROW_ACCOUNT_OPENED'),
        settledAt: reached('SUPPLIER_PAID_IN_FULL') ? at('SUPPLIER_PAID_IN_FULL') : null,
        provenance: 'MOCK',
        provenanceActor: 'Escrow simulator',
        provenanceAt: at('ESCROW_ACCOUNT_OPENED'),
        provenanceRef: `ESC-2026-${pad(400 + spec.aliasNo, 5)}`,
      },
    });

    if (funded) {
      await db.escrowTransaction.create({
        data: {
          escrowId,
          type: 'FUND',
          amount: funded,
          currency: 'INR',
          reference: `FUND/${pad(spec.aliasNo)}`,
          status: 'SETTLED',
          valueDate: at('ESCROW_FUNDED'),
          reason: 'Order value deposited into escrow.',
          provenance: 'MOCK',
          provenanceActor: 'Escrow simulator',
          provenanceAt: at('ESCROW_FUNDED'),
          createdAt: at('ESCROW_FUNDED'),
        },
      });
      await db.escrowTransaction.create({
        data: {
          escrowId,
          type: 'FEE',
          amount: escrowFee,
          currency: 'INR',
          reference: `FEE/${pad(spec.aliasNo)}`,
          status: 'SETTLED',
          valueDate: at('ESCROW_FUNDED'),
          reason: 'Escrow provider fee.',
          provenance: 'MOCK',
          createdAt: at('ESCROW_FUNDED'),
        },
      });
    }

    if (testTranche) {
      await db.escrowTransaction.create({
        data: {
          escrowId,
          type: 'PARTIAL_RELEASE',
          milestone: 'TEST_ENABLEMENT',
          amount: testTranche,
          currency: 'INR',
          beneficiary: supplier.name,
          reference: `REL/TEST/${pad(spec.aliasNo)}`,
          status: 'SETTLED',
          valueDate: at('ESCROW_PARTIAL_RELEASE_FOR_TESTING'),
          reason: 'Test-enablement tranche so the supplier can ship parts to the lab.',
          provenance: 'MOCK',
          provenanceActor: 'Escrow simulator',
          provenanceAt: at('ESCROW_PARTIAL_RELEASE_FOR_TESTING'),
          createdAt: at('ESCROW_PARTIAL_RELEASE_FOR_TESTING'),
        },
      });
    }

    // Final release — dual authorisation by two distinct Finance users (AC#23).
    if (reached('ESCROW_FINAL_RELEASE_AUTHORISED')) {
      const finalAmount = buyValue - testTranche;
      const tx = await db.escrowTransaction.create({
        data: {
          escrowId,
          type: 'FINAL_RELEASE',
          milestone: 'FINAL_SETTLEMENT',
          amount: finalAmount,
          currency: 'INR',
          beneficiary: supplier.name,
          reference: `REL/FINAL/${pad(spec.aliasNo)}`,
          status: reached('SUPPLIER_PAID_IN_FULL') ? 'SETTLED' : 'INSTRUCTED',
          valueDate: at('ESCROW_FINAL_RELEASE_AUTHORISED'),
          reason: 'Inbound inspection passed — releasing the remaining balance.',
          provenance: 'MANUAL',
          provenanceActor: 'Ankit Sharma',
          provenanceAt: at('ESCROW_FINAL_RELEASE_AUTHORISED'),
          createdAt: at('ESCROW_FINAL_RELEASE_AUTHORISED'),
        },
      });
      await db.escrowApproval.createMany({
        data: [
          {
            transactionId: tx.id,
            approverId: 'u-ankit',
            approvedAt: at('ESCROW_FINAL_RELEASE_AUTHORISED'),
            note: 'Inspection report INS signed off. Quantities and date codes verified.',
          },
          {
            transactionId: tx.id,
            approverId: 'u-priya',
            approvedAt: new Date(at('ESCROW_FINAL_RELEASE_AUTHORISED').getTime() + 40 * 60_000),
            note: 'Second authorisation. Landed cost and margin reviewed.',
          },
        ],
      });
    }
  }

  // ── Testing ───────────────────────────────────────────────────────────────
  if (spec.testingRequired && reached('TEST_DISPATCH_BOOKED')) {
    const trId = `${spec.key}-tr`;
    const testedLines = lines.filter((l) => l.testing);
    const failed = spec.targetStage === 'TEST_FAILED';
    const scopeSample = spec.testScope === 'LOT_SAMPLE';

    await db.testRequest.create({
      data: {
        id: trId,
        workOrderId: spec.key,
        requestNo: `TR-2026-${pad(60 + spec.aliasNo - 96)}`,
        labId: spec.labId ?? null,
        labRequestRef: reached('PARTS_RECEIVED_AT_WHL')
          ? `LAB/${pad(spec.aliasNo)}/2026`
          : null,
        scope: spec.testScope ?? 'LOT_SAMPLE',
        sampleSize: scopeSample ? 50 : null,
        aql: scopeSample ? 'AQL 1.0' : null,
        parameters: JSON.stringify(
          TEST_PARAMETERS.filter((p) => p.isDefault || !scopeSample).map((p) => p.code),
        ),
        status: reached('TESTING_IN_PROGRESS')
          ? failed || reached('TEST_PASSED')
            ? 'COMPLETED'
            : 'IN_PROGRESS'
          : reached('TEST_SCOPE_CONFIRMED')
            ? 'SCOPE_CONFIRMED'
            : reached('PARTS_RECEIVED_AT_WHL')
              ? 'RECEIVED'
              : 'SUBMITTED',
        submittedAt: at('TEST_DISPATCH_BOOKED'),
        receivedAt: reached('PARTS_RECEIVED_AT_WHL') ? at('PARTS_RECEIVED_AT_WHL') : null,
        receivedQty: reached('PARTS_RECEIVED_AT_WHL')
          ? scopeSample
            ? 50 * testedLines.length
            : testedLines.reduce((a, l) => a + l.qty, 0)
          : null,
        testCost: testingCost,
        labIsForeign,
        provenance: 'MOCK',
        provenanceActor: 'Testing Laboratory simulator',
        provenanceAt: at('TEST_DISPATCH_BOOKED'),
        provenanceRef: `LAB/${pad(spec.aliasNo)}/2026`,
      },
    });

    if (failed || reached('TEST_PASSED')) {
      const resultId = `${spec.key}-trr`;
      await db.testResult.create({
        data: {
          id: resultId,
          testRequestId: trId,
          verdict: failed ? 'FAIL' : 'PASS',
          reportNo: `LAB-RPT-2026-${pad(spec.aliasNo)}`,
          signedBy: 'Dr S. Raghavan, Technical Manager',
          testedAt: failed ? at('TEST_FAILED') : at('TEST_PASSED'),
          summary: failed
            ? 'Sampled units failed X-ray die verification and marking permanency. Batch not fit for supply.'
            : 'All sampled units conform to datasheet limits and show no evidence of re-marking.',
          provenance: 'MOCK',
          provenanceActor: 'Testing Laboratory simulator',
          provenanceAt: failed ? at('TEST_FAILED') : at('TEST_PASSED'),
          provenanceRef: `LAB-RPT-2026-${pad(spec.aliasNo)}`,
        },
      });
      await db.testLineResult.createMany({
        data: testedLines.map((l, i) => {
          const tested = scopeSample ? 50 : l.qty;
          const failedQty = failed && i === 0 ? 12 : 0;
          return {
            testResultId: resultId,
            mpn: l.mpn,
            lotRef: `LOT-${supplier.code}-${pad(l.lineNo, 2)}`,
            testedQty: tested,
            passedQty: tested - failedQty,
            failedQty,
            verdict: failedQty > 0 ? 'FAIL' : 'PASS',
            failureMode:
              failedQty > 0
                ? 'Re-marked package — die markings inconsistent with declared date code'
                : null,
            parameterResults: JSON.stringify(
              TEST_PARAMETERS.filter((p) => p.isDefault).map((p) => ({
                code: p.code,
                name: p.name,
                observed: failedQty > 0 && p.code === 'XRAY-2D' ? 'Non-conforming' : 'Within limits',
                spec: p.method,
                pass: !(failedQty > 0 && (p.code === 'XRAY-2D' || p.code === 'MRK-PERM')),
              })),
            ),
          };
        }),
      });
    }
  }

  // ── Shipments (four legs) ─────────────────────────────────────────────────
  const mkShipment = async (
    legType: 'TEST_OUT' | 'TEST_RETURN' | 'IMPORT' | 'OUTBOUND',
    opts: {
      carrier: string;
      from: [string, string];
      to: [string, string];
      status: string;
      dispatchedStage: string;
      deliveredStage?: string;
      freight?: number;
      declared: number;
      events: { code: string; description: string; location: string; offsetH: number }[];
    },
  ) => {
    const dispatchedAt = at(opts.dispatchedStage);
    const shipment = await db.shipment.create({
      data: {
        id: `${spec.key}-shp-${legType.toLowerCase()}`,
        workOrderId: spec.key,
        legType,
        carrierCode: opts.carrier,
        serviceName: opts.carrier === 'DHL' ? 'EXPRESS WORLDWIDE' : 'Standard',
        awb: `${opts.carrier === 'DHL' ? '78' : '44'}${pad(spec.aliasNo, 6)}${legType.length}`,
        originName: opts.from[0],
        originCountry: opts.from[1],
        destName: opts.to[0],
        destCountry: opts.to[1],
        pieces: legType === 'TEST_OUT' || legType === 'TEST_RETURN' ? 1 : 4,
        grossWeightKg: legType === 'TEST_OUT' || legType === 'TEST_RETURN' ? 1.2 : 18.4,
        chargeableWeightKg: legType === 'TEST_OUT' || legType === 'TEST_RETURN' ? 1.5 : 22.5,
        declaredValue: opts.declared,
        currency: 'INR',
        freightAmount: opts.freight ?? 0,
        freightGst: opts.freight ? pctOf(opts.freight, 18) : 0,
        incoterms: legType === 'IMPORT' ? supplier.incoterms : 'DAP',
        status: opts.status,
        dispatchedAt,
        estimatedDelivery: new Date(dispatchedAt.getTime() + 5 * DAY),
        deliveredAt: opts.deliveredStage ? at(opts.deliveredStage) : null,
        rateQuotes:
          legType === 'OUTBOUND'
            ? JSON.stringify([
                { service: 'EXPRESS WORLDWIDE', transitDays: 1, amount: 486000, currency: 'INR' },
                { service: 'ECONOMY SELECT', transitDays: 3, amount: 312000, currency: 'INR' },
              ])
            : null,
        provenance: opts.carrier === 'DHL' ? 'MOCK' : 'MANUAL',
        provenanceActor: opts.carrier === 'DHL' ? 'DHL simulator' : 'Akash Dwivedi',
        provenanceAt: dispatchedAt,
        createdAt: dispatchedAt,
      },
    });
    await db.trackingEvent.createMany({
      data: opts.events.map((e) => ({
        shipmentId: shipment.id,
        occurredAt: new Date(dispatchedAt.getTime() + e.offsetH * HOUR),
        code: e.code,
        description: e.description,
        location: e.location,
        provenance: opts.carrier === 'DHL' ? 'MOCK' : 'MANUAL',
      })),
    });
    return shipment;
  };

  if (spec.testingRequired && reached('TEST_DISPATCH_BOOKED')) {
    await mkShipment('TEST_OUT', {
      carrier: 'SFEXP',
      from: [supplier.city, supplier.country],
      to: ['Testing Laboratory, Bengaluru', 'India'],
      status: reached('PARTS_RECEIVED_AT_WHL') ? 'DELIVERED' : 'IN_TRANSIT',
      dispatchedStage: 'TEST_DISPATCH_BOOKED',
      deliveredStage: reached('PARTS_RECEIVED_AT_WHL') ? 'PARTS_RECEIVED_AT_WHL' : undefined,
      declared: toMinor(45_000),
      events: [
        { code: 'PU', description: 'Shipment picked up', location: supplier.city, offsetH: 2 },
        { code: 'DF', description: 'Departed origin facility', location: supplier.city, offsetH: 9 },
        ...(reached('PARTS_RECEIVED_AT_WHL')
          ? [
              { code: 'AF', description: 'Arrived Bengaluru', location: 'Bengaluru', offsetH: 30 },
              { code: 'OK', description: 'Delivered to the testing laboratory intake', location: 'Bengaluru', offsetH: 38 },
            ]
          : []),
      ],
    });
  }

  if (spec.testingRequired && reached('PARTS_RETURNED_TO_SUPPLIER')) {
    await mkShipment('TEST_RETURN', {
      carrier: 'SFEXP',
      from: ['Testing Laboratory, Bengaluru', 'India'],
      to: [supplier.city, supplier.country],
      status: 'DELIVERED',
      dispatchedStage: 'PARTS_RETURNED_TO_SUPPLIER',
      deliveredStage: 'PARTS_RETURNED_TO_SUPPLIER',
      declared: toMinor(45_000),
      events: [
        { code: 'PU', description: 'Tested parts collected from WHL', location: 'Bengaluru', offsetH: 3 },
        { code: 'OK', description: 'Delivered to supplier', location: supplier.city, offsetH: 52 },
      ],
    });
  }

  if (reached('FULL_SHIPMENT_DISPATCHED_BY_SUPPLIER')) {
    await mkShipment('IMPORT', {
      carrier: 'DHL',
      from: [supplier.city, supplier.country],
      to: [ORG.city, 'India'],
      status: reached('GOODS_RECEIVED_INBOUND_AT_1BUY')
        ? 'DELIVERED'
        : reached('BORDER_ARRIVAL_WHA_ENGAGED')
          ? 'CUSTOMS'
          : 'IN_TRANSIT',
      dispatchedStage: 'FULL_SHIPMENT_DISPATCHED_BY_SUPPLIER',
      deliveredStage: reached('GOODS_RECEIVED_INBOUND_AT_1BUY')
        ? 'GOODS_RECEIVED_INBOUND_AT_1BUY'
        : undefined,
      freight: freightCost,
      declared: buyValue,
      events: [
        { code: 'PU', description: 'Shipment picked up', location: supplier.city, offsetH: 3 },
        { code: 'DF', description: 'Departed origin facility', location: supplier.city, offsetH: 11 },
        ...(reached('IN_TRANSIT_INTERNATIONAL')
          ? [{ code: 'AR', description: 'Arrived transit hub', location: 'Hong Kong', offsetH: 26 }]
          : []),
        ...(reached('BORDER_ARRIVAL_WHA_ENGAGED')
          ? [
              { code: 'AF', description: 'Arrived Bengaluru — customs processing', location: 'Bengaluru', offsetH: 44 },
              { code: 'CC', description: 'Handed to customs broker', location: 'Bengaluru', offsetH: 48 },
            ]
          : []),
        ...(reached('GOODS_RECEIVED_INBOUND_AT_1BUY')
          ? [{ code: 'OK', description: 'Delivered to 1BUY warehouse', location: 'Bengaluru', offsetH: 120 }]
          : []),
      ],
    });
  }

  if (reached('OUTBOUND_BOOKED')) {
    await mkShipment('OUTBOUND', {
      carrier: 'DHL',
      from: [ORG.city, 'India'],
      to: [customer.city, 'India'],
      status: reached('DELIVERED') ? 'DELIVERED' : 'OUT_FOR_DELIVERY',
      dispatchedStage: 'OUTBOUND_BOOKED',
      deliveredStage: reached('DELIVERED') ? 'DELIVERED' : undefined,
      freight: toMinor(4_860),
      declared: sellValue,
      events: [
        { code: 'PU', description: 'Collected from 1BUY', location: ORG.city, offsetH: 2 },
        ...(reached('OUT_FOR_DELIVERY')
          ? [{ code: 'WC', description: 'With delivery courier', location: customer.city, offsetH: 18 }]
          : []),
        ...(reached('DELIVERED')
          ? [{ code: 'OK', description: `Delivered — signed by ${customer.contactName}`, location: customer.city, offsetH: 22 }]
          : []),
      ],
    });
  }

  // ── Customs ───────────────────────────────────────────────────────────────
  if (reached('CUSTOMS_ENTRY_FILED_ICEGATE')) {
    const ceId = `${spec.key}-ce`;
    const status = reached('CUSTOMS_CLEARED')
      ? 'OUT_OF_CHARGE'
      : reached('DUTY_ASSESSED_AND_PAID')
        ? 'DUTY_PAID'
        : 'UNDER_ASSESSMENT';
    await db.customsEntry.create({
      data: {
        id: ceId,
        workOrderId: spec.key,
        boeNumber: `${7600000 + spec.aliasNo}`,
        filingAckNo: `ACK/INBLR4/${pad(spec.aliasNo, 6)}`,
        filedAt: at('CUSTOMS_ENTRY_FILED_ICEGATE'),
        portCode: 'INBLR4',
        whaAgentName: 'WHA Customs & Compliance — Bengaluru Air Cargo',
        assessableValue,
        exchangeRateUsed: customsFx,
        dutyBcd,
        dutySws,
        dutyIgst,
        totalDuty: dutyBcd + dutySws + dutyIgst,
        challanRef: reached('DUTY_ASSESSED_AND_PAID') ? `CHLN/2026/${pad(spec.aliasNo, 7)}` : null,
        dutyPaidAt: reached('DUTY_ASSESSED_AND_PAID') ? at('DUTY_ASSESSED_AND_PAID') : null,
        status,
        outOfChargeAt: reached('CUSTOMS_CLEARED') ? at('CUSTOMS_CLEARED') : null,
        provenance: 'MOCK',
        provenanceActor: 'ICEGATE simulator',
        provenanceAt: at('CUSTOMS_ENTRY_FILED_ICEGATE'),
        provenanceRef: `${7600000 + spec.aliasNo}`,
        statusHistory: {
          create: [
            { status: 'FILED', occurredAt: at('CUSTOMS_ENTRY_FILED_ICEGATE'), note: 'Bill of Entry lodged; supporting documents uploaded via eSanchit.', provenance: 'MOCK' },
            { status: 'UNDER_ASSESSMENT', occurredAt: new Date(at('CUSTOMS_ENTRY_FILED_ICEGATE').getTime() + 6 * HOUR), note: 'Assigned to assessing officer.', provenance: 'MOCK' },
            ...(reached('DUTY_ASSESSED_AND_PAID')
              ? [
                  { status: 'ASSESSED', occurredAt: new Date(at('DUTY_ASSESSED_AND_PAID').getTime() - 4 * HOUR), note: 'Assessment complete. Duty payable generated.', provenance: 'MOCK' },
                  { status: 'DUTY_PAID', occurredAt: at('DUTY_ASSESSED_AND_PAID'), note: 'Duty paid via ICEGATE e-payment.', provenance: 'MOCK' },
                ]
              : []),
            ...(reached('CUSTOMS_CLEARED')
              ? [{ status: 'OUT_OF_CHARGE', occurredAt: at('CUSTOMS_CLEARED'), note: 'Out of charge granted. Goods may be removed.', provenance: 'MOCK' }]
              : []),
          ],
        },
      },
    });
  }

  // ── Warehouse: GRN, inspection, repack, POD ───────────────────────────────
  if (reached('GOODS_RECEIVED_INBOUND_AT_1BUY')) {
    await db.grn.create({
      data: {
        workOrderId: spec.key,
        grnNumber: `GRN-2026-${pad(200 + spec.aliasNo)}`,
        receivedAt: at('GOODS_RECEIVED_INBOUND_AT_1BUY'),
        cartons: 4,
        // Zone-rack-bin, derived from the order number so a reseed puts the same
        // consignment back in the same place rather than shuffling the warehouse.
        storageLocation: `${'ABCD'[spec.aliasNo % 4]}-${pad(1 + (spec.aliasNo % 12), 2)}-R${1 + (spec.aliasNo % 3)}`,
        receivedBy: 'Akash Dwivedi',
        hasShortfall: false,
        remarks: 'All cartons intact. Seals matched the packing list.',
        lines: {
          create: lines.map((l) => ({
            mpn: l.mpn,
            expectedQty: l.qty,
            receivedQty: l.qty,
            dateCodeLot: `${2437 + l.lineNo} / LOT-${supplier.code}-${pad(l.lineNo, 2)}`,
            condition: 'OK',
          })),
        },
      },
    });
  }

  if (reached('INBOUND_INSPECTION_IN_PROGRESS')) {
    const passedInspection = reached('INSPECTION_PASSED');
    const checks: { category: string; label: string; plainLabel: string; expected: string }[] = [
      { category: 'COUNT', label: 'Piece count against packing list', plainLabel: 'Count everything', expected: `${lines.reduce((a, l) => a + l.qty, 0)} pcs` },
      { category: 'CONDITION', label: 'Physical condition of packaging', plainLabel: 'Check for damage', expected: 'No damage, seals intact' },
      { category: 'MPN_VERIFY', label: 'Part number verification against PO', plainLabel: 'Right parts?', expected: lines.map((l) => l.mpn).join(', ') },
      { category: 'DATE_CODE_LOT', label: 'Date code and lot traceability', plainLabel: 'Batch markings', expected: 'Within 24 months' },
      { category: 'PACKAGING', label: 'ESD packaging integrity', plainLabel: 'Anti-static packing', expected: 'MBB sealed, ESD bags intact' },
      { category: 'MSL', label: 'Moisture barrier bag and humidity indicator', plainLabel: 'Moisture check', expected: 'HIC below 10%' },
      { category: 'DOCUMENTATION', label: 'Certificate of origin and test report match', plainLabel: 'Paperwork matches', expected: 'COO + WHL report on file' },
    ];
    await db.inspectionReport.create({
      data: {
        workOrderId: spec.key,
        reportNo: `INS-2026-${pad(180 + spec.aliasNo)}`,
        startedAt: at('INBOUND_INSPECTION_IN_PROGRESS'),
        completedAt: passedInspection ? at('INSPECTION_PASSED') : null,
        inspectorId: 'u-priya',
        verdict: passedInspection ? 'PASSED' : 'IN_PROGRESS',
        signedOffAt: passedInspection ? at('INSPECTION_PASSED') : null,
        remarks: passedInspection
          ? 'All checks passed. Cleared for rebranding and repacking.'
          : 'Count and condition done. Date-code verification in progress.',
        checklist: {
          create: checks.map((c, i) => {
            const done = passedInspection || i < 3;
            return {
              sequence: i + 1,
              category: c.category,
              label: c.label,
              plainLabel: c.plainLabel,
              expected: c.expected,
              observed: done ? 'As expected' : null,
              result: done ? 'PASS' : 'PENDING',
              evidenceCount: done ? 3 : 0,
            };
          }),
        },
      },
    });
  }

  if (reached('REBRAND_AND_REPACK_IN_PROGRESS')) {
    await db.repackJob.create({
      data: {
        workOrderId: spec.key,
        jobNo: `RPK-2026-${pad(100 + spec.aliasNo)}`,
        startedAt: at('REBRAND_AND_REPACK_IN_PROGRESS'),
        completedAt: reached('READY_FOR_OUTBOUND') ? at('READY_FOR_OUTBOUND') : null,
        status: reached('READY_FOR_OUTBOUND') ? 'COMPLETED' : 'IN_PROGRESS',
        cartonCount: 5,
        labelTemplate: '1BUY-STD',
        repackCost,
        repackGst: repackCost ? pctOf(repackCost, 18) : 0,
        serialsCaptured: lines.reduce((a, l) => a + l.qty, 0),
        beforePhotos: 6,
        afterPhotos: 8,
        qcBy: reached('READY_FOR_OUTBOUND') ? 'Akash Dwivedi' : null,
        remarks: '1BUY labels applied over supplier markings. Manufacturer reels, trays and part markings untouched.',
      },
    });
  }

  if (reached('POD_ISSUED_TO_CUSTOMER')) {
    await db.proofOfDelivery.create({
      data: {
        workOrderId: spec.key,
        shipmentId: `${spec.key}-shp-outbound`,
        podNumber: `POD-2026-${pad(180 + spec.aliasNo)}`,
        signedBy: customer.contactName,
        deliveredAt: at('DELIVERED'),
        remarks: 'Received in good condition, 5 cartons.',
        sharedWithCustomerAt: at('POD_ISSUED_TO_CUSTOMER'),
        provenance: 'MOCK',
        provenanceActor: 'DHL simulator',
        provenanceAt: at('POD_ISSUED_TO_CUSTOMER'),
        provenanceRef: `78${pad(spec.aliasNo, 6)}8`,
      },
    });
  }

  // ── Tax invoice, e-way bill, input credits ────────────────────────────────
  const rateLookup = makeRateLookup(
    HSN_RATES.map((r, i) => ({ ...r, id: `rate-${i}` }) as HsnRateRow),
  );

  if (reached('CUSTOMER_INVOICED_AND_SETTLED')) {
    const invoiceDate = at('CUSTOMER_INVOICED_AND_SETTLED');
    const computation = computeGstInvoice({
      invoiceDate,
      seller: { gstin: ORG.gstin, stateCode: ORG.stateCode },
      buyer: {
        gstin: customer.gstin,
        stateCode: customer.stateCode,
        isSez: customer.isSez,
        isExport: customer.isExport,
      },
      shipToStateCode: customer.stateCode,
      lutApplied: customer.isSez,
      rateLookup,
      lines: lines.map((l) => ({
        lineNo: l.lineNo,
        mpn: l.mpn,
        description: l.mpnMeta.description,
        hsnCode: l.mpnMeta.hsnCode,
        quantity: l.qty,
        unitPrice: l.sell,
      })),
    });

    const invoiceNo = `INV-1B-${pad(200 + spec.aliasNo)}`;
    const eInvoiceApplies = computation.totalAmount >= ORG.eInvoiceThreshold && !customer.isSez;
    const inv = await db.taxInvoice.create({
      data: {
        invoiceNumber: invoiceNo,
        workOrderId: spec.key,
        customerId: customer.id,
        invoiceDate,
        dueDate: new Date(invoiceDate.getTime() + 45 * DAY),
        placeOfSupply: computation.placeOfSupply,
        placeOfSupplyName: customer.stateName,
        taxTreatment: computation.treatment,
        lutApplied: customer.isSez,
        currency: 'INR',
        taxableValue: computation.taxableValue,
        cgstAmount: computation.cgstAmount,
        sgstAmount: computation.sgstAmount,
        igstAmount: computation.igstAmount,
        cessAmount: computation.cessAmount,
        roundingAdjustment: computation.roundingAdjustment,
        totalAmount: computation.totalAmount,
        amountInWords: amountInWords(computation.totalAmount),
        irn: eInvoiceApplies
          ? `${pad(spec.aliasNo, 4)}f1b2c4d5e6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5`
          : null,
        ackNo: eInvoiceApplies ? `1120260${pad(spec.aliasNo, 8)}` : null,
        ackDate: eInvoiceApplies ? invoiceDate : null,
        signedQrCode: eInvoiceApplies ? `eyJhbGciOiJSUzI1NiJ9.${invoiceNo}.MOCK-SIGNED-QR` : null,
        eInvoiceStatus: eInvoiceApplies ? 'GENERATED' : 'NOT_APPLICABLE',
        status: reached('ORDER_CLOSED') ? 'PAID' : 'SENT',
        paidAt: reached('ORDER_CLOSED') ? at('ORDER_CLOSED') : null,
        provenance: eInvoiceApplies ? 'MOCK' : 'MANUAL',
        provenanceActor: eInvoiceApplies ? 'GST e-invoice simulator' : 'Ankit Sharma',
        provenanceAt: invoiceDate,
        lines: {
          create: computation.lines.map((cl) => ({
            lineNo: cl.lineNo,
            mpn: cl.mpn,
            description: cl.description,
            hsnCode: cl.hsnCode,
            quantity: cl.quantity,
            unitPrice: cl.unitPrice,
            taxableValue: cl.taxableValue,
            cgstRate: cl.cgstRate,
            cgstAmount: cl.cgstAmount,
            sgstRate: cl.sgstRate,
            sgstAmount: cl.sgstAmount,
            igstRate: cl.igstRate,
            igstAmount: cl.igstAmount,
            cessRate: cl.cessRate,
            cessAmount: cl.cessAmount,
            lineTotal: cl.lineTotal,
            rateSourceId: cl.rateSourceId,
          })),
        },
      },
    });

    if (computation.totalAmount >= ORG.eWayBillThreshold) {
      await db.eWayBill.create({
        data: {
          ewbNumber: `${321098000000 + spec.aliasNo}`,
          invoiceId: inv.id,
          generatedAt: invoiceDate,
          validUntil: new Date(invoiceDate.getTime() + 3 * DAY),
          transportMode: 'ROAD',
          vehicleNumber: `KA01AB${pad(spec.aliasNo, 4)}`,
          transporterName: 'DHL Express India',
          distanceKm: customer.stateCode === '29' ? 18 : customer.stateCode === '27' ? 984 : 346,
          status: 'ACTIVE',
          generatedBy: 'Ankit Sharma',
          provenance: 'MOCK',
        },
      });
    }
  }

  // Input tax credits — import IGST plus creditable GST on services.
  const taxPeriod = new Date(stageEnteredAt).toISOString().slice(0, 7);
  if (dutyIgst > 0) {
    await db.inputTaxCredit.create({
      data: {
        workOrderId: spec.key,
        source: 'IMPORT_IGST',
        documentRef: `BOE ${7600000 + spec.aliasNo}`,
        documentDate: at('DUTY_ASSESSED_AND_PAID'),
        supplierName: 'Customs — Bill of Entry',
        taxableValue: assessableValue,
        igstAmount: dutyIgst,
        totalCredit: dutyIgst,
        eligible: true,
        gstr2bStatus: 'MATCHED',
        gstr2bNote: 'Import IGST reflects in GSTR-2B from the ICEGATE feed.',
        taxPeriod,
      },
    });
  }
  if (freightCost > 0) {
    await db.inputTaxCredit.create({
      data: {
        workOrderId: spec.key,
        source: 'FREIGHT',
        documentRef: `DHL/INV/${pad(spec.aliasNo, 6)}`,
        documentDate: at('FULL_SHIPMENT_DISPATCHED_BY_SUPPLIER'),
        supplierName: 'DHL Express India',
        supplierGstin: '29AAACD0980H1ZO',
        taxableValue: freightCost,
        cgstAmount: pctOf(freightCost, 9),
        sgstAmount: pctOf(freightCost, 9),
        totalCredit: pctOf(freightCost, 18),
        eligible: true,
        gstr2bStatus: spec.key === 'wo-closed' ? 'MATCHED' : 'UNMATCHED',
        gstr2bNote:
          spec.key === 'wo-closed' ? null : 'Awaiting the supplier to file — chase before the return.',
        taxPeriod,
      },
    });
  }
  if (testingCost > 0) {
    if (labIsForeign) {
      await db.reverseChargeSelfInvoice.create({
        data: {
          invoiceNumber: `RCM-2026-${pad(spec.aliasNo)}`,
          workOrderId: spec.key,
          invoiceDate: at('PARTS_RECEIVED_AT_WHL'),
          vendorName: 'Independent Test Laboratory, Shenzhen',
          vendorCountry: 'China',
          serviceType: 'TESTING',
          hsnSacCode: '998346',
          taxableValue: testingCost,
          igstRate: 18,
          igstAmount: pctOf(testingCost, 18),
          taxPeriod,
        },
      });
    } else {
      await db.inputTaxCredit.create({
        data: {
          workOrderId: spec.key,
          source: 'TESTING',
          documentRef: `WHL/INV/${pad(spec.aliasNo, 5)}`,
          documentDate: at('PARTS_RECEIVED_AT_WHL'),
          supplierName: 'Independent Test Laboratory',
          supplierGstin: '29AADCW8812L1ZQ',
          taxableValue: testingCost,
          cgstAmount: pctOf(testingCost, 9),
          sgstAmount: pctOf(testingCost, 9),
          totalCredit: pctOf(testingCost, 18),
          eligible: true,
          gstr2bStatus: 'MATCHED',
          taxPeriod,
        },
      });
    }
  }

  // ── Exception + tasks ─────────────────────────────────────────────────────
  if (spec.exception) {
    await db.exceptionRecord.create({
      data: {
        id: `${spec.key}-exc`,
        workOrderId: spec.key,
        type: spec.exception.type,
        offStage: spec.targetStage,
        reason: spec.exception.reason,
        severity: spec.exception.severity,
        status: 'OPEN',
        openedAt: new Date(stageEnteredAt),
      },
    });
    await db.task.create({
      data: {
        workOrderId: spec.key,
        title: 'Decide how to resolve the failed test',
        description:
          'Choose a resolution route: reject and replace the lot, ask the supplier to re-submit, accept only the passing sub-lots, retest with expanded scope, cancel and refund from escrow, or source from an alternate AVL vendor.',
        ownerId: 'u-priya',
        ownerRole: 'Procurement',
        linkedStage: spec.targetStage,
        exceptionId: `${spec.key}-exc`,
        priority: 'URGENT',
        dueAt: new Date(NOW + 1 * DAY),
        status: 'OPEN',
        createdAt: new Date(stageEnteredAt),
      },
    });
  }

  if (!target.isTerminal && !spec.exception) {
    await db.task.create({
      data: {
        workOrderId: spec.key,
        title: target.nextAction,
        ownerId: target.nextActionOwner === 'ONE_BUY' ? 'u-priya' : null,
        ownerRole: target.nextActionOwner,
        linkedStage: spec.targetStage,
        priority: spec.hoursInStage > target.expectedHours ? 'HIGH' : 'NORMAL',
        dueAt: new Date(stageEnteredAt + target.expectedHours * HOUR),
        status: 'OPEN',
        createdAt: new Date(stageEnteredAt),
      },
    });
  }

  // ── Communication: system entries from every transition, plus human threads ─
  for (let i = 0; i < path.length; i++) {
    const stageId = path[i];
    const st = getStage(stageId);
    const actor = actorFor(stageId);
    await db.communication.create({
      data: {
        workOrderId: spec.key,
        entryClass: 'SYSTEM',
        channel: 'SYSTEM',
        direction: 'INTERNAL',
        subject: `Stage advanced to ${st.label}`,
        body: `${st.description} Recorded by ${actor.label}.`,
        visibility: 'INTERNAL',
        status: 'CLOSED',
        occurredAt: at(stageId),
        loggedById: actor.id,
        systemIcon: 'Activity',
        createdAt: at(stageId),
        contextChips: {
          create: [{ kind: 'STAGE', refId: stageId, label: `${st.code} · ${st.label}` }],
        },
      },
    });
  }

  const humanThreads = buildHumanThreads(spec, customer, supplier, at, reached);
  for (const h of humanThreads) {
    await db.communication.create({
      data: {
        workOrderId: spec.key,
        entryClass: 'HUMAN',
        channel: h.channel,
        direction: h.direction,
        subject: h.subject,
        body: h.body,
        quotedHistory: h.quoted ?? null,
        visibility: h.visibility,
        sharedWith: h.sharedWith ?? null,
        status: h.status,
        isPinned: h.pinned ?? false,
        isUnread: h.unread ?? false,
        occurredAt: h.occurredAt,
        loggedById: h.loggedById,
        createdAt: h.occurredAt,
        participants: { create: h.participants },
        contextChips: { create: h.context },
      },
    });
  }

  // ── Documents ─────────────────────────────────────────────────────────────
  const docs: { docType: string; title: string; fileName: string; stage: string; by: string }[] = [
    { docType: 'CUSTOMER_PO', title: `Customer PO ${custPoNo}`, fileName: `${custPoNo}.pdf`, stage: 'CUSTOMER_PO_RECEIVED', by: 'Akash Dwivedi' },
  ];
  if (reached('PI_ISSUED_TO_CUSTOMER')) docs.push({ docType: 'CUSTOMER_PI', title: `Proforma invoice ${custPiNo}`, fileName: `${custPiNo}.pdf`, stage: 'PI_ISSUED_TO_CUSTOMER', by: 'Akash Dwivedi' });
  if (hasSupplierPo) docs.push({ docType: 'SUPPLIER_PO', title: `Purchase order ${supPoNo}`, fileName: `${supPoNo}.pdf`, stage: 'SUPPLIER_PO_ISSUED', by: 'Akash Dwivedi' });
  if (hasSupplierPi) docs.push({ docType: 'SUPPLIER_PI', title: `Supplier proforma ${supPiNo}`, fileName: `${supPiNo}.pdf`, stage: 'SUPPLIER_PI_RECEIVED', by: 'Akash Dwivedi' });
  if (reached('TEST_PASSED') || spec.targetStage === 'TEST_FAILED') docs.push({ docType: 'TEST_REPORT', title: `WHL test report (${spec.targetStage === 'TEST_FAILED' ? 'FAIL' : 'PASS'})`, fileName: `WHL-RPT-2026-${pad(spec.aliasNo)}.pdf`, stage: spec.targetStage === 'TEST_FAILED' ? 'TEST_FAILED' : 'TEST_PASSED', by: 'WHL upload' });
  if (reached('CUSTOMS_ENTRY_FILED_ICEGATE')) docs.push({ docType: 'BOE', title: `Bill of Entry ${7600000 + spec.aliasNo}`, fileName: `BOE-${7600000 + spec.aliasNo}.pdf`, stage: 'CUSTOMS_ENTRY_FILED_ICEGATE', by: 'WHA agent' });
  if (reached('DUTY_ASSESSED_AND_PAID')) docs.push({ docType: 'DUTY_CHALLAN', title: `Duty challan`, fileName: `CHLN-2026-${pad(spec.aliasNo, 7)}.pdf`, stage: 'DUTY_ASSESSED_AND_PAID', by: 'WHA agent' });
  if (reached('CUSTOMS_CLEARED')) docs.push({ docType: 'OUT_OF_CHARGE', title: 'Out-of-charge document', fileName: `OOC-${7600000 + spec.aliasNo}.pdf`, stage: 'CUSTOMS_CLEARED', by: 'WHA agent' });
  if (reached('GOODS_RECEIVED_INBOUND_AT_1BUY')) docs.push({ docType: 'GRN', title: `Goods receipt note`, fileName: `GRN-2026-${pad(200 + spec.aliasNo)}.pdf`, stage: 'GOODS_RECEIVED_INBOUND_AT_1BUY', by: 'Akash Dwivedi' });
  if (reached('INSPECTION_PASSED')) docs.push({ docType: 'INSPECTION_REPORT', title: 'Signed inbound inspection report', fileName: `INS-2026-${pad(180 + spec.aliasNo)}.pdf`, stage: 'INSPECTION_PASSED', by: 'Akash Dwivedi' });
  if (reached('POD_ISSUED_TO_CUSTOMER')) docs.push({ docType: 'POD', title: 'Proof of delivery', fileName: `POD-2026-${pad(180 + spec.aliasNo)}.pdf`, stage: 'POD_ISSUED_TO_CUSTOMER', by: 'DHL retrieval' });
  if (reached('CUSTOMER_INVOICED_AND_SETTLED')) docs.push({ docType: 'TAX_INVOICE', title: `Tax invoice INV-1B-${pad(200 + spec.aliasNo)}`, fileName: `INV-1B-${pad(200 + spec.aliasNo)}.pdf`, stage: 'CUSTOMER_INVOICED_AND_SETTLED', by: 'Ankit Sharma' });

  await db.document.createMany({
    data: docs.map((d) => ({
      docType: d.docType,
      title: d.title,
      fileName: d.fileName,
      sizeBytes: 40_000 + d.title.length * 900,
      uploadedBy: d.by,
      provenance: d.by.includes('retrieval') || d.by.includes('upload') ? 'MOCK' : 'MANUAL',
      workOrderId: spec.key,
      createdAt: at(d.stage),
      bodyText: `${d.title}\n\nWork order: ${canonical}\nGenerated for the ${spec.key} demonstration dataset.`,
    })),
  });

  // ── Audit log ─────────────────────────────────────────────────────────────
  await db.auditLogEntry.createMany({
    data: [
      {
        workOrderId: spec.key,
        entity: 'Work order',
        entityId: spec.key,
        action: 'CREATE',
        field: 'Work order name',
        actorId: 'u-priya',
        actorLabel: 'Akash Dwivedi',
        afterValue: provisional,
        createdAt: at('SUPPLIER_PO_ISSUED'),
      },
      ...(hasSupplierPi
        ? [
            {
              workOrderId: spec.key,
              entity: 'Work order',
              entityId: spec.key,
              action: 'UPDATE',
              field: 'Work order name',
              beforeValue: provisional,
              afterValue: canonical,
              actorId: 'u-priya',
              actorLabel: 'Akash Dwivedi',
              createdAt: at('SUPPLIER_PI_RECEIVED'),
            },
          ]
        : []),
      // Stage rows carry a real before AND after, in the labels a person reads —
      // a log row that says only "TESTING_IN_PROGRESS" makes the reader work out
      // what it replaced.
      ...path.map((stageId, i) => ({
        workOrderId: spec.key,
        entity: 'Work order stage',
        entityId: spec.key,
        action: 'TRANSITION',
        field: 'Stage',
        beforeValue: i === 0 ? null : (getStage(path[i - 1])?.label ?? path[i - 1]),
        afterValue: getStage(stageId)?.label ?? stageId,
        actorLabel: actorFor(stageId).label,
        actorId: actorFor(stageId).id,
        provenance: actorFor(stageId).id ? 'MANUAL' : 'MOCK',
        createdAt: at(stageId),
      })),
    ],
  });

  // Landed cost sanity check while seeding — proves the §9 rule on real data.
  const landed = computeLandedCost({
    buyValue,
    dutyBcd,
    dutySws,
    dutyIgst,
    dutyCess: 0,
    creditableGstOther,
    freightCost,
    insuranceCost,
    testingCost,
    repackCost,
    clearanceCost,
    escrowFee,
  });
  return { sellValue, buyValue, landed };
}

// ── Human communication threads ─────────────────────────────────────────────

interface HumanThread {
  channel: string;
  direction: string;
  subject: string;
  body: string;
  quoted?: string;
  visibility: string;
  sharedWith?: string;
  status: string;
  pinned?: boolean;
  unread?: boolean;
  occurredAt: Date;
  loggedById: string | null;
  participants: { role: string; stakeholder: string; name: string; email?: string }[];
  context: { kind: string; refId?: string; label: string }[];
}

function buildHumanThreads(
  spec: WoSpec,
  customer: (typeof CUSTOMERS)[number],
  supplier: (typeof SUPPLIERS)[number],
  at: (s: string) => Date,
  reached: (s: string) => boolean,
): HumanThread[] {
  const threads: HumanThread[] = [];
  const oneBuy = { role: 'FROM', stakeholder: 'ONE_BUY', name: 'Akash Dwivedi', email: 'akash.dwivedi@1buy.ai' };

  threads.push({
    channel: 'EMAIL',
    direction: 'INBOUND',
    subject: `PO ${spec.docNo} — please confirm availability and lead time`,
    body: `Hi team,\n\nPlease find our purchase order attached. We need these on site before the month end for a production build. Could you confirm availability and the earliest delivery date?\n\nRegards,\n${customer.contactName}\n${customer.name}`,
    visibility: 'SHARED',
    sharedWith: 'CUSTOMER',
    status: 'REPLIED',
    pinned: true,
    occurredAt: at('CUSTOMER_PO_RECEIVED'),
    loggedById: 'u-priya',
    participants: [
      { role: 'FROM', stakeholder: 'CUSTOMER', name: customer.contactName, email: customer.contactEmail },
      { role: 'TO', stakeholder: 'ONE_BUY', name: 'Akash Dwivedi', email: 'akash.dwivedi@1buy.ai' },
    ],
    context: [{ kind: 'STAGE', refId: 'CUSTOMER_PO_RECEIVED', label: 'A1 · Customer PO received' }],
  });

  if (reached('PI_ISSUED_TO_CUSTOMER')) {
    threads.push({
      channel: 'EMAIL',
      direction: 'OUTBOUND',
      subject: `Proforma invoice for your PO — valid 21 days`,
      body: `Dear ${customer.contactName},\n\nOur proforma invoice is attached. Prices hold for 21 days. Testing is included as agreed, and delivery is quoted as DDP your site.\n\nPlease confirm so we can place the supply order.\n\nRegards,\nAkash Dwivedi\n1BUY Technologies`,
      quoted: `> Please confirm availability and the earliest delivery date?`,
      visibility: 'SHARED',
      sharedWith: 'CUSTOMER',
      status: reached('PI_ACCEPTED_BY_CUSTOMER') ? 'REPLIED' : 'AWAITING_REPLY',
      unread: !reached('PI_ACCEPTED_BY_CUSTOMER'),
      occurredAt: at('PI_ISSUED_TO_CUSTOMER'),
      loggedById: 'u-priya',
      participants: [
        oneBuy,
        { role: 'TO', stakeholder: 'CUSTOMER', name: customer.contactName, email: customer.contactEmail },
      ],
      context: [{ kind: 'STAGE', refId: 'PI_ISSUED_TO_CUSTOMER', label: 'A2 · PI issued to customer' }],
    });
  }

  if (reached('SUPPLIER_PO_ISSUED')) {
    threads.push({
      channel: 'EMAIL',
      direction: 'OUTBOUND',
      subject: `Purchase order — testing required before full shipment`,
      body: `Hello ${supplier.contactName},\n\nOur PO is attached. Please note testing is mandatory on this order: send the sample quantity to our nominated lab in Bengaluru first, and hold the balance until we confirm the pass.\n\nPayment is via escrow. We will release a test-enablement tranche once the escrow is funded so you are not out of pocket on the sample freight.\n\nRegards,\nAkash Dwivedi\nProcurement, 1BUY`,
      visibility: 'SHARED',
      sharedWith: 'SUPPLIER',
      status: 'REPLIED',
      occurredAt: at('SUPPLIER_PO_ISSUED'),
      loggedById: 'u-priya',
      participants: [
        { role: 'FROM', stakeholder: 'ONE_BUY', name: 'Akash Dwivedi', email: 'akash.dwivedi@1buy.ai' },
        { role: 'TO', stakeholder: 'SUPPLIER', name: supplier.contactName, email: supplier.contactEmail },
      ],
      context: [
        { kind: 'STAGE', refId: 'SUPPLIER_PO_ISSUED', label: 'B2 · Supplier PO issued' },
        { kind: 'LINE_ITEM', label: spec.lines[0].mpn },
      ],
    });
  }

  if (spec.targetStage === 'TEST_FAILED') {
    threads.push({
      channel: 'EMAIL',
      direction: 'INBOUND',
      subject: 'URGENT — test report FAIL, suspected re-marked parts',
      body: `Akash,\n\nOur X-ray and marking-permanency checks failed on lot LOT-A7734. Twelve of fifty sampled pieces show die markings inconsistent with the declared date code, which is consistent with re-marking.\n\nWe have quarantined the full sample and are holding it pending your instruction. Signed report attached.\n\nDr S. Raghavan\nTechnical Manager, Testing Laboratory`,
      visibility: 'INTERNAL',
      status: 'ACTION_REQUIRED',
      pinned: true,
      unread: true,
      occurredAt: at('TEST_FAILED'),
      loggedById: 'u-priya',
      participants: [
        { role: 'FROM', stakeholder: 'WHL', name: 'Dr S. Raghavan', email: 'intake.blr@whl-labs.in' },
        { role: 'TO', stakeholder: 'ONE_BUY', name: 'Akash Dwivedi', email: 'akash.dwivedi@1buy.ai' },
      ],
      context: [
        { kind: 'STAGE', refId: 'TEST_FAILED', label: 'D5b · Test failed' },
        { kind: 'EXCEPTION', refId: `${spec.key}-exc`, label: 'Test failed' },
        { kind: 'LINE_ITEM', label: spec.lines[0].mpn },
      ],
    });
    threads.push({
      channel: 'PHONE',
      direction: 'INTERNAL',
      subject: 'Internal note — do not release escrow balance',
      body: 'Spoke to Anita. Escrow balance is frozen until we decide the route. Do not authorise any further release on this order. Considering partial acceptance of the second line, which passed cleanly.',
      visibility: 'INTERNAL',
      status: 'CLOSED',
      occurredAt: new Date(at('TEST_FAILED').getTime() + 2 * HOUR),
      loggedById: 'u-priya',
      participants: [
        { role: 'FROM', stakeholder: 'ONE_BUY', name: 'Akash Dwivedi' },
        { role: 'TO', stakeholder: 'ONE_BUY', name: 'Ankit Sharma' },
      ],
      context: [{ kind: 'EXCEPTION', refId: `${spec.key}-exc`, label: 'Test failed' }],
    });
  }

  if (reached('CUSTOMS_ENTRY_FILED_ICEGATE')) {
    threads.push({
      channel: 'WHATSAPP',
      direction: 'INBOUND',
      subject: 'BoE filed, assessment expected tomorrow',
      body: `BoE lodged this morning at INBLR4. eSanchit uploads accepted. Assessing officer assigned — expect duty payable figure by tomorrow midday. Will send the challan as soon as it generates.`,
      visibility: 'INTERNAL',
      status: 'REPLIED',
      occurredAt: new Date(at('CUSTOMS_ENTRY_FILED_ICEGATE').getTime() + 3 * HOUR),
      loggedById: 'u-ankit',
      participants: [
        { role: 'FROM', stakeholder: 'WHA', name: 'WHA Bengaluru Air Cargo desk' },
        { role: 'TO', stakeholder: 'ONE_BUY', name: 'Ankit Sharma' },
      ],
      context: [{ kind: 'STAGE', refId: 'CUSTOMS_ENTRY_FILED_ICEGATE', label: 'E4 · Customs entry filed' }],
    });
  }

  if (reached('POD_ISSUED_TO_CUSTOMER')) {
    threads.push({
      channel: 'EMAIL',
      direction: 'OUTBOUND',
      subject: 'Delivered — proof of delivery attached',
      body: `Dear ${customer.contactName},\n\nYour order was delivered and signed for. The proof of delivery is attached, along with our tax invoice.\n\nThank you for the business.\n\nRegards,\nAkash Dwivedi\n1BUY Technologies`,
      visibility: 'SHARED',
      sharedWith: 'CUSTOMER',
      status: 'CLOSED',
      occurredAt: at('POD_ISSUED_TO_CUSTOMER'),
      loggedById: 'u-priya',
      participants: [
        oneBuy,
        { role: 'TO', stakeholder: 'CUSTOMER', name: customer.contactName, email: customer.contactEmail },
      ],
      context: [
        { kind: 'STAGE', refId: 'POD_ISSUED_TO_CUSTOMER', label: 'G6 · POD issued' },
        { kind: 'SHIPMENT_LEG', label: 'Leg 4 · Outbound' },
      ],
    });
  }

  if (spec.hoursInStage > 100) {
    threads.push({
      channel: 'EMAIL',
      direction: 'OUTBOUND',
      subject: 'Chasing — proforma still not reconciled',
      body: `Hello ${supplier.contactName},\n\nThis is our third follow-up. Your proforma shows a unit price above our PO and we cannot proceed until it is reconciled or corrected. Please respond today.\n\nAkash Dwivedi\n1BUY`,
      visibility: 'SHARED',
      sharedWith: 'SUPPLIER',
      status: 'AWAITING_REPLY',
      unread: true,
      occurredAt: new Date(NOW - 30 * HOUR),
      loggedById: 'u-priya',
      participants: [
        { role: 'FROM', stakeholder: 'ONE_BUY', name: 'Akash Dwivedi' },
        { role: 'TO', stakeholder: 'SUPPLIER', name: supplier.contactName, email: supplier.contactEmail },
      ],
      context: [{ kind: 'STAGE', refId: spec.targetStage, label: 'Awaiting supplier' }],
    });
  }

  return threads;
}

/**
 * Customer POs that have NOT yet been sourced — no supplier PO, so no work
 * order. These are what the "Link this PO with Customer PO" panel picks from,
 * and they exercise the Unlinked / Partially linked coverage badges (§3.2).
 */
async function seedUnlinkedCustomerPos() {
  const specs = [
    {
      id: 'cpo-open-1',
      customerId: 'c-nova',
      docNo: 46,
      daysAgo: 4,
      status: 'RECEIVED',
      withPi: true,
      lines: [
        { mpn: '2N3904', qty: 25000, sell: 2.1 },
        { mpn: 'EEU-FR1V101', qty: 6000, sell: 12.5 },
      ],
    },
    {
      id: 'cpo-open-2',
      customerId: 'c-zenith',
      docNo: 48,
      daysAgo: 1,
      status: 'RECEIVED',
      withPi: false,
      lines: [
        { mpn: 'LM358N', qty: 15000, sell: 28 },
        { mpn: 'SN74HC595N', qty: 9000, sell: 33 },
        { mpn: 'IRF540N', qty: 2000, sell: 88 },
      ],
    },
  ];

  for (const s of specs) {
    const customer = CUSTOMERS.find((c) => c.id === s.customerId)!;
    const poDate = ago(s.daysAgo * DAY);
    const lines = s.lines.map((l, i) => {
      const meta = MPNS.find((m) => m.mpn === l.mpn)!;
      return { ...l, lineNo: i + 1, meta, total: toMinor(l.qty * l.sell) };
    });
    const total = lines.reduce((a, l) => a + l.total, 0);
    const addr = `${customer.name}\n${customer.addressLine1}\n${customer.city} ${customer.pincode}, ${customer.country}\nGSTIN ${customer.gstin ?? '—'}`;

    await db.customerPO.create({
      data: {
        id: s.id,
        poNumber: `CPO-${customer.code}-${pad(s.docNo)}`,
        customerId: customer.id,
        poDate,
        currency: 'INR',
        incoterms: 'DDP',
        paymentTerms: customer.paymentTerms,
        requestedDeliveryDate: new Date(poDate.getTime() + 40 * DAY),
        shipToAddress: addr,
        billToAddress: addr,
        contactName: customer.contactName,
        notes: 'Awaiting sourcing — no supplier order raised yet.',
        totalValue: total,
        status: s.status,
        createdById: 'u-priya',
        createdAt: poDate,
        lines: {
          create: lines.map((l) => ({
            lineNo: l.lineNo,
            mpn: l.mpn,
            manufacturer: l.meta.manufacturer,
            description: l.meta.description,
            hsnCode: l.meta.hsnCode,
            quantity: l.qty,
            unitPrice: l.sell,
            lineTotal: l.total,
            requestedDate: new Date(poDate.getTime() + 40 * DAY),
            testingRequired: l.qty > 10000,
          })),
        },
      },
    });

    if (s.withPi) {
      await db.proformaInvoice.create({
        data: {
          // Distinct range so it cannot collide with a work order's PI number.
          piNumber: `PI-1B-${pad(s.docNo + 40)}`,
          direction: 'CUSTOMER_PI',
          customerPoId: s.id,
          piDate: new Date(poDate.getTime() + 6 * HOUR),
          validUntil: new Date(poDate.getTime() + 21 * DAY),
          currency: 'INR',
          subtotal: total,
          totalValue: total,
          status: 'SENT',
          issuedAt: new Date(poDate.getTime() + 6 * HOUR),
          sentAt: new Date(poDate.getTime() + 6 * HOUR),
          terms: `${customer.paymentTerms} from invoice.`,
          lines: {
            create: lines.map((l) => ({
              lineNo: l.lineNo,
              mpn: l.mpn,
              description: l.meta.description,
              hsnCode: l.meta.hsnCode,
              quantity: l.qty,
              unitPrice: l.sell,
              lineTotal: l.total,
            })),
          },
        },
      });
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('Wiping existing data…');
  await wipe();

  console.log('Seeding masters…');
  await seedMasters();

  console.log('Seeding unsourced customer POs…');
  await seedUnlinkedCustomerPos();

  console.log('Building work orders…');
  for (const spec of SPECS) {
    const r = await buildWorkOrder(spec);
    console.log(
      `  ${spec.key.padEnd(20)} ${spec.targetStage.padEnd(38)} sell ₹${(r.sellValue / 100).toLocaleString('en-IN')}  landed ₹${(r.landed.landedCost / 100).toLocaleString('en-IN')}`,
    );
  }

  // A clean one-to-one order held at "supplier PI received", for demos. Seeded
  // last so a reset always leaves it in the same untouched state.
  console.log('Building the demo order…');
  const demo = await seedDemoOrder(db, NOW);
  console.log(
    `  ${demo.alias} · ${demo.stage} · ${demo.done} stages done, ${demo.remaining} still to do · next up ${demo.nextUp}`,
  );

  // Tax period rollups.
  const invoices = await db.taxInvoice.findMany();
  const credits = await db.inputTaxCredit.findMany();
  const rcm = await db.reverseChargeSelfInvoice.findMany();
  const periods = new Set([
    ...invoices.map((i) => i.invoiceDate.toISOString().slice(0, 7)),
    ...credits.map((c) => c.taxPeriod),
  ]);
  for (const p of periods) {
    const inv = invoices.filter((i) => i.invoiceDate.toISOString().slice(0, 7) === p);
    const cr = credits.filter((c) => c.taxPeriod === p && c.eligible);
    const rc = rcm.filter((r) => r.taxPeriod === p);
    const sum = <T>(arr: T[], f: (x: T) => number) => arr.reduce((a, x) => a + f(x), 0);
    const outputTax =
      sum(inv, (i) => i.cgstAmount) + sum(inv, (i) => i.sgstAmount) + sum(inv, (i) => i.igstAmount);
    const itc =
      sum(cr, (c) => c.cgstAmount) + sum(cr, (c) => c.sgstAmount) + sum(cr, (c) => c.igstAmount);
    await db.taxPeriodSummary.create({
      data: {
        taxPeriod: p,
        outputTaxable: sum(inv, (i) => i.taxableValue),
        outputCgst: sum(inv, (i) => i.cgstAmount),
        outputSgst: sum(inv, (i) => i.sgstAmount),
        outputIgst: sum(inv, (i) => i.igstAmount),
        zeroRatedValue: sum(
          inv.filter((i) => i.taxTreatment.startsWith('ZERO')),
          (i) => i.taxableValue,
        ),
        itcCgst: sum(cr, (c) => c.cgstAmount),
        itcSgst: sum(cr, (c) => c.sgstAmount),
        itcIgst: sum(cr, (c) => c.igstAmount),
        rcmLiability: sum(rc, (r) => r.igstAmount),
        netPayable: Math.max(0, outputTax - itc),
        invoiceCount: inv.length,
        status: 'DRAFT',
      },
    });
  }

  const counts = {
    workOrders: await db.workOrder.count(),
    transitions: await db.stageTransition.count(),
    communications: await db.communication.count(),
    documents: await db.document.count(),
    shipments: await db.shipment.count(),
    invoices: await db.taxInvoice.count(),
    itc: await db.inputTaxCredit.count(),
    tasks: await db.task.count(),
  };
  console.log('\nSeed complete:', counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
