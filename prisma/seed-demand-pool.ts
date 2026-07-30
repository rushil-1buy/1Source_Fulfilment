/**
 * SCENARIO — overlapping demand, waiting to be pooled.
 *
 * Four customer orders from three customers, deliberately overlapping on three
 * commodity parts. Individually each is a small buy at list price; together they
 * clear a volume tier:
 *
 *   SN74HC595N   shift register   4 orders   38,000 pieces combined
 *   IRF540N      power MOSFET     3 orders    9,500 pieces combined
 *   LM358N       dual op-amp      2 orders   22,000 pieces combined
 *
 * Plus one part each order wants alone, so the pool is a genuine mix of shared
 * and single-customer demand — otherwise the UI never has to show the difference.
 *
 * None of these orders is sourced, which is the state aggregation starts from.
 * Idempotent: it removes its own rows before writing.
 */

import { PrismaClient } from '@/lib/generated/prisma';
import { toMinor } from '../lib/domain/money';
import { CUSTOMERS, MPNS } from './seed-masters';

const DAY = 86_400_000;

const CPO_IDS = [
  'pool-cpo-1',
  'pool-cpo-2',
  'pool-cpo-3',
  'pool-cpo-4',
  // A second wave, so there is always open demand to consolidate even after the
  // first has been floated. Otherwise the feature demos itself once and then has
  // nothing to work on.
  'pool2-cpo-1',
  'pool2-cpo-2',
  'pool2-cpo-3',
];

interface Spec {
  id: string;
  poNumber: string;
  customerId: string;
  /** Days from now the customer wants delivery — drives the tightest-date warning. */
  wantedInDays: number;
  placedDaysAgo: number;
  sourcingRef: string;
  lines: { mpn: string; qty: number; sell: number }[];
}

const SPECS: Spec[] = [
  {
    id: 'pool-cpo-1',
    poNumber: 'CPO-ACME-0051',
    customerId: 'c-acme',
    wantedInDays: 38,
    placedDaysAgo: 6,
    sourcingRef: 'RFQ-2026-0402',
    lines: [
      { mpn: 'SN74HC595N', qty: 12000, sell: 34 },
      { mpn: 'IRF540N', qty: 3500, sell: 138 },
      { mpn: 'LM358N', qty: 15000, sell: 22 },
    ],
  },
  {
    id: 'pool-cpo-2',
    poNumber: 'CPO-NOVA-0052',
    customerId: 'c-nova',
    wantedInDays: 44,
    placedDaysAgo: 5,
    sourcingRef: 'RFQ-2026-0404',
    lines: [
      { mpn: 'SN74HC595N', qty: 9000, sell: 35 },
      { mpn: 'IRF540N', qty: 2000, sell: 142 },
      { mpn: 'NE555P', qty: 8000, sell: 19 },
    ],
  },
  {
    id: 'pool-cpo-3',
    poNumber: 'CPO-ZENITH-0053',
    customerId: 'c-zenith',
    // The tightest date in the pool — the one consolidation has to beat.
    wantedInDays: 18,
    placedDaysAgo: 3,
    sourcingRef: 'RFQ-2026-0407',
    lines: [
      { mpn: 'SN74HC595N', qty: 11000, sell: 33.5 },
      { mpn: 'LM358N', qty: 7000, sell: 23 },
      { mpn: 'RC0603FR-0710KL', qty: 50000, sell: 1.4 },
    ],
  },
  {
    id: 'pool-cpo-4',
    poNumber: 'CPO-ACME-0054',
    customerId: 'c-acme',
    wantedInDays: 52,
    placedDaysAgo: 2,
    sourcingRef: 'RFQ-2026-0411',
    lines: [
      { mpn: 'SN74HC595N', qty: 6000, sell: 36 },
      { mpn: 'IRF540N', qty: 4000, sell: 140 },
      { mpn: 'CL10B104KB8NNNC', qty: 80000, sell: 0.9 },
    ],
  },
  {
    id: 'pool2-cpo-1',
    poNumber: 'CPO-ACME-0055',
    customerId: 'c-acme',
    wantedInDays: 41,
    placedDaysAgo: 4,
    sourcingRef: 'RFQ-2026-0530',
    lines: [
      { mpn: '1N4007', qty: 40000, sell: 1.1 },
      { mpn: 'BC547B', qty: 30000, sell: 1.35 },
      { mpn: 'FT232RL', qty: 2500, sell: 168 },
    ],
  },
  {
    id: 'pool2-cpo-2',
    poNumber: 'CPO-NOVA-0056',
    customerId: 'c-nova',
    wantedInDays: 47,
    placedDaysAgo: 4,
    sourcingRef: 'RFQ-2026-0533',
    lines: [
      { mpn: '1N4007', qty: 25000, sell: 1.15 },
      { mpn: 'BC547B', qty: 18000, sell: 1.4 },
      { mpn: 'LM7805CT', qty: 9000, sell: 21 },
    ],
  },
  {
    id: 'pool2-cpo-3',
    poNumber: 'CPO-ZENITH-0057',
    customerId: 'c-zenith',
    wantedInDays: 25,
    placedDaysAgo: 3,
    sourcingRef: 'RFQ-2026-0536',
    lines: [
      { mpn: '1N4007', qty: 35000, sell: 1.08 },
      { mpn: 'FT232RL', qty: 1800, sell: 172 },
    ],
  },
];

export async function seedDemandPool(db: PrismaClient, now = Date.now()) {
  // ── Clear a previous run ──────────────────────────────────────────────────
  const aggs = await db.demandAggregation.findMany({
    where: { lines: { some: { customerPoLine: { customerPoId: { in: CPO_IDS } } } } },
    select: { id: true },
  });
  const aggIds = aggs.map((a) => a.id);
  if (aggIds.length) {
    await db.demandAggregationLine.deleteMany({ where: { aggregationId: { in: aggIds } } });
    await db.demandAggregationPart.deleteMany({ where: { aggregationId: { in: aggIds } } });
    await db.demandAggregation.deleteMany({ where: { id: { in: aggIds } } });
  }
  await db.customerPOLine.deleteMany({ where: { customerPoId: { in: CPO_IDS } } });
  await db.customerPO.deleteMany({ where: { id: { in: CPO_IDS } } });

  for (const spec of SPECS) {
    const customer = CUSTOMERS.find((c) => c.id === spec.customerId)!;
    const wantedBy = new Date(now + spec.wantedInDays * DAY);
    const address = `${customer.name}\n${customer.addressLine1}\n${customer.city} ${customer.pincode}, ${customer.country}\nGSTIN ${customer.gstin ?? '—'}`;

    const lines = spec.lines.map((l, i) => {
      const meta = MPNS.find((m) => m.mpn === l.mpn)!;
      return { ...l, meta, lineNo: i + 1, lineTotal: toMinor(l.qty * l.sell) };
    });

    await db.customerPO.create({
      data: {
        id: spec.id,
        poNumber: spec.poNumber,
        customerId: customer.id,
        poDate: new Date(now - spec.placedDaysAgo * DAY),
        currency: 'INR',
        incoterms: 'DDP',
        paymentTerms: customer.paymentTerms,
        requestedDeliveryDate: wantedBy,
        shipToAddress: address,
        billToAddress: address,
        contactName: customer.contactName,
        sourcingRef: spec.sourcingRef,
        notes:
          'Commodity parts at modest volume. Worth pooling with other open demand before going to a supplier.',
        totalValue: lines.reduce((a, l) => a + l.lineTotal, 0),
        // Nothing bought yet — this is the state aggregation starts from.
        status: 'NOT_LINKED',
        createdById: 'u-priya',
        lines: {
          create: lines.map((l) => ({
            lineNo: l.lineNo,
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
  }

  // What overlaps, for the console summary.
  const counts = new Map<string, number>();
  for (const s of SPECS) for (const l of s.lines) counts.set(l.mpn, (counts.get(l.mpn) ?? 0) + 1);
  const shared = [...counts.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);

  return {
    customerPos: SPECS.map((s) => s.poNumber),
    sharedParts: shared.map(([mpn, n]) => ({ mpn, orders: n })),
    totalUnits: SPECS.flatMap((s) => s.lines).reduce((a, l) => a + l.qty, 0),
  };
}

// Runnable on its own: `npx tsx prisma/seed-demand-pool.ts`
if (process.argv[1]?.includes('seed-demand-pool')) {
  const db = new PrismaClient();
  seedDemandPool(db)
    .then((r) => {
      console.log('overlapping-demand scenario ready');
      console.log(`  customer orders : ${r.customerPos.join(', ')}`);
      console.log(`  shared parts    : ${r.sharedParts.map((s) => `${s.mpn} (${s.orders} orders)`).join(', ')}`);
      console.log(`  total units     : ${r.totalUnits.toLocaleString('en-IN')}`);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => db.$disconnect());
}
