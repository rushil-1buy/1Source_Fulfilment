'use server';

/**
 * Building a real order from a chosen configuration, and clearing it away again.
 *
 * The walkthrough used to run against a seeded order, which meant it could only
 * ever demonstrate the one shape somebody had seeded. The interesting questions
 * are all about shape: what happens on EXW versus CIF, with testing on one line
 * and not another, on escrow versus credit. So the configuration comes first
 * and the order is built from it.
 *
 * WHAT "REAL" MEANS HERE. Everything below is a genuine row — customer PO,
 * supplier PO, both line sets, the allocation mappings, the work order itself.
 * It appears in the Control Tower, in every team queue, and in the order list,
 * because it is not a special kind of order. It carries a distinguishing alias
 * so a reset knows what it may delete, and that is the only thing separating it
 * from an order somebody raised by hand.
 */

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { CUSTOMERS, MPNS, SUPPLIERS, ORG } from '@/prisma/seed-masters';
import { TEAM_SLUGS } from '@/lib/domain/enums';
import { toMinor, convertMinor } from '@/lib/domain/money';
import { SIM_PREFIX, type SimConfig, type SimResult } from '@/lib/domain/simulation-config';

function safeRevalidate(path: string) {
  try {
    revalidatePath(path);
  } catch {
    /* not in a request */
  }
}

function revalidateEverything(orderId?: string) {
  safeRevalidate('/dashboard');
  safeRevalidate('/orders');
  safeRevalidate('/agentic');
  if (orderId) safeRevalidate(`/orders/${orderId}`);
  for (const slug of Object.keys(TEAM_SLUGS)) {
    safeRevalidate(`/teams/${slug}`);
    if (orderId) safeRevalidate(`/teams/${slug}/orders/${orderId}`);
  }
}

/** What the configuration screen offers — the real masters, not a fixture. */
export async function simulationOptions() {
  return {
    customers: CUSTOMERS.map((c) => ({ id: c.id, name: c.name, city: c.city })),
    suppliers: SUPPLIERS.map((s) => ({
      id: s.id,
      name: s.name,
      country: s.country,
      currency: s.currency,
      /** Their usual term, offered as the default rather than imposed. */
      incoterms: s.incoterms,
    })),
    parts: MPNS.map((m) => ({
      mpn: m.mpn,
      manufacturer: m.manufacturer,
      description: m.description,
      hsnCode: m.hsnCode,
      countryOfOrigin: m.countryOfOrigin,
    })),
  };
}

/**
 * Indicative prices.
 *
 * A configuration screen that made the operator type a unit price for every
 * part would be asking them to invent the one number the margin depends on.
 * These are derived from the part's own HSN family so the arithmetic downstream
 * is at least internally consistent, and the margin lands somewhere plausible.
 */
function pricesFor(mpn: string): { sell: number; buy: number } {
  const meta = MPNS.find((m) => m.mpn === mpn);
  const base = meta?.hsnCode === '85423100' ? 985 : meta?.hsnCode === '85423200' ? 152 : 41;
  // ~78% of sell, in USD at roughly 83 — a normal-looking gross margin.
  return { sell: base, buy: Number(((base * 0.78) / 83).toFixed(4)) };
}

/**
 * Creates a work order from the configuration.
 *
 * Sits at A1 with the whole flow ahead of it, because the run is the point —
 * an order created halfway through would make most of what follows a claim
 * rather than a demonstration.
 */
export async function createSimulatedOrder(config: SimConfig): Promise<SimResult> {
  const customer = CUSTOMERS.find((c) => c.id === config.customerId);
  const supplier = SUPPLIERS.find((s) => s.id === config.supplierId);
  if (!customer || !supplier) return { ok: false, message: 'Pick a customer and a supplier.' };
  if (config.lines.length === 0) return { ok: false, message: 'Add at least one part.' };
  if (config.lines.some((l) => l.qty <= 0))
    return { ok: false, message: 'Every line needs a quantity above zero.' };

  const known = config.lines.filter((l) => MPNS.some((m) => m.mpn === l.mpn));
  if (known.length !== config.lines.length)
    return { ok: false, message: 'One of those part numbers is not on the master list.' };

  // A fresh number per run, so several simulations can coexist.
  const seq = (await db.workOrder.count({ where: { alias: { startsWith: SIM_PREFIX } } })) + 1;
  const key = `sim-${Date.now().toString(36)}`;
  const alias = `${SIM_PREFIX}${String(seq).padStart(3, '0')}`;
  const stamp = String(seq).padStart(4, '0');

  const custPoNo = `CPO-${customer.code}-S${stamp}`;
  const supPoNo = `PO-1B-S${stamp}`;
  const fxRate = supplier.currency === 'INR' ? 1 : 83.2;

  const lines = config.lines.map((l, i) => {
    const meta = MPNS.find((m) => m.mpn === l.mpn)!;
    const price = pricesFor(l.mpn);
    return {
      ...l,
      lineNo: i + 1,
      meta,
      sell: price.sell,
      buy: price.buy,
      sellTotal: toMinor(l.qty * price.sell),
      buyTotalForeign: toMinor(l.qty * price.buy, supplier.currency),
      customerLineId: `${key}-cl-${i + 1}`,
      supplierLineId: `${key}-sl-${i + 1}`,
    };
  });

  const sellValue = lines.reduce((a, l) => a + l.sellTotal, 0);
  const buyValueForeign = lines.reduce((a, l) => a + l.buyTotalForeign, 0);
  const buyValue = convertMinor(buyValueForeign, fxRate, supplier.currency, 'INR');

  const now = new Date();
  const wanted = new Date(now.getTime() + 45 * 86_400_000);
  const shipTo = `${ORG.legalName}\n${ORG.addressLine1}\n${ORG.city} ${ORG.pincode}, ${ORG.country}\nGSTIN ${ORG.gstin}`;
  const custShipTo = `${customer.name}\n${customer.addressLine1}\n${customer.city} ${customer.pincode}, ${customer.country}\nGSTIN ${customer.gstin ?? '—'}`;

  await db.customerPO.create({
    data: {
      id: `${key}-cpo`,
      poNumber: custPoNo,
      customerId: customer.id,
      poDate: now,
      currency: 'INR',
      incoterms: config.sellIncoterms,
      paymentTerms: customer.paymentTerms,
      requestedDeliveryDate: wanted,
      shipToAddress: custShipTo,
      billToAddress: custShipTo,
      contactName: customer.contactName,
      notes: `Raised from the autonomous flow simulator.`,
      totalValue: sellValue,
      status: 'FULLY_LINKED',
      createdById: 'u-priya',
      lines: {
        create: lines.map((l) => ({
          id: l.customerLineId,
          lineNo: l.lineNo,
          mpn: l.mpn,
          manufacturer: l.meta.manufacturer,
          description: l.meta.description,
          hsnCode: l.meta.hsnCode,
          quantity: l.qty,
          uom: 'PCS',
          unitPrice: l.sell,
          lineTotal: l.sellTotal,
          requestedDate: wanted,
          testingRequired: l.testing,
        })),
      },
    },
  });

  await db.supplierPO.create({
    data: {
      id: `${key}-spo`,
      poNumber: supPoNo,
      supplierId: supplier.id,
      poDate: now,
      currency: supplier.currency,
      fxRate,
      incoterms: config.buyIncoterms,
      paymentMethod: config.paymentMethod,
      creditDays: config.paymentMethod === 'CREDIT' ? 45 : null,
      shipToAddress: shipTo,
      requiredDeliveryDate: new Date(now.getTime() + 38 * 86_400_000),
      totalValue: buyValueForeign,
      status: 'ISSUED',
      issuedAt: now,
      lines: {
        create: lines.map((l) => ({
          id: l.supplierLineId,
          lineNo: l.lineNo,
          mpn: l.mpn,
          manufacturer: l.meta.manufacturer,
          description: l.meta.description,
          hsnCode: l.meta.hsnCode,
          quantity: l.qty,
          uom: 'PCS',
          unitPrice: l.buy,
          lineTotal: l.buyTotalForeign,
          leadTimeDays: 21,
        })),
      },
    },
  });

  /*
   * The order-level testing flag means "does the testing phase run at all",
   * which is true when ANY line needs it. Which parts go is on the lines.
   */
  const anyTesting = lines.some((l) => l.testing);

  const wo = await db.workOrder.create({
    data: {
      id: key,
      canonicalName: `${custPoNo}_PI-PENDING_${supPoNo}_SPI-PENDING`,
      alias,
      provisionalName: null,
      nameLocked: false,
      customerPoId: `${key}-cpo`,
      supplierPoId: `${key}-spo`,
      stage: 'CUSTOMER_PO_RECEIVED',
      phase: 'A',
      status: 'ACTIVE',
      stageEnteredAt: now,
      paymentMethod: config.paymentMethod,
      creditDays: config.paymentMethod === 'CREDIT' ? 45 : null,
      testingRequired: anyTesting,
      testScope: anyTesting ? 'LOT_SAMPLE' : null,
      incoterms: config.buyIncoterms,
      buyCurrency: supplier.currency,
      sellCurrency: 'INR',
      fxRate,
      sellValue,
      buyValue,
    },
  });

  // Allocations: one customer line to one supplier line, the simple case. The
  // Line Items tab reads these, so without them the order looks unsourced.
  await db.pOLinkMapping.createMany({
    data: lines.map((l) => ({
      workOrderId: wo.id,
      customerPoLineId: l.customerLineId,
      supplierPoLineId: l.supplierLineId,
      allocatedQty: l.qty,
      sellUnitPrice: l.sell,
      buyUnitPrice: l.buy,
    })),
  });

  await db.stageTransition.create({
    data: {
      workOrderId: wo.id,
      fromStage: null,
      toStage: 'CUSTOMER_PO_RECEIVED',
      actorLabel: 'Autonomous flow simulator',
      reason: `Raised from a chosen configuration: ${lines.length} line(s), supplier on ${config.buyIncoterms}, customer on ${config.sellIncoterms}, ${config.paymentMethod.toLowerCase()}.`,
    },
  });

  revalidateEverything(wo.id);
  return {
    ok: true,
    message: `${alias} created.`,
    detail: `${lines.length} line${lines.length === 1 ? '' : 's'} · supplier on ${config.buyIncoterms}, customer on ${config.sellIncoterms} · ${config.paymentMethod.toLowerCase()}${anyTesting ? ` · ${lines.filter((l) => l.testing).length} line(s) going to the laboratory` : ' · no testing'}. It sits at A1 with the whole flow ahead of it.`,
    orderId: wo.id,
    alias,
  };
}

/**
 * Deletes every simulated order.
 *
 * Scoped hard to the SIM- prefix. A reset that could reach a seeded or
 * hand-raised order is not a reset, it is data loss waiting for a demo — and
 * the cascade rules mean one wrong id would take its whole history with it.
 */
export async function resetSimulations(): Promise<SimResult> {
  const sims = await db.workOrder.findMany({
    where: { alias: { startsWith: SIM_PREFIX } },
    select: { id: true, customerPoId: true, supplierPoId: true },
  });
  if (sims.length === 0) return { ok: true, message: 'Nothing to reset.', detail: 'No simulated orders exist.' };

  // Work orders cascade to their own children; the two purchase orders are
  // parents rather than children, so they are removed explicitly afterwards.
  await db.workOrder.deleteMany({ where: { id: { in: sims.map((s) => s.id) } } });
  await db.customerPO.deleteMany({ where: { id: { in: sims.map((s) => s.customerPoId) } } });
  await db.supplierPO.deleteMany({ where: { id: { in: sims.map((s) => s.supplierPoId) } } });

  revalidateEverything();
  return {
    ok: true,
    message: `${sims.length} simulated order${sims.length === 1 ? '' : 's'} removed.`,
    detail: 'Seeded and hand-raised orders are untouched — the reset only ever reaches the SIM- prefix.',
  };
}

/** The simulated orders that currently exist, newest first. */
export async function listSimulations() {
  const rows = await db.workOrder.findMany({
    where: { alias: { startsWith: SIM_PREFIX } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      alias: true,
      stage: true,
      status: true,
      incoterms: true,
      paymentMethod: true,
      testingRequired: true,
      customerPo: { select: { incoterms: true, customer: { select: { name: true } } } },
      supplierPo: { select: { supplier: { select: { name: true } } } },
      _count: { select: { documents: true, transitions: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    alias: r.alias,
    stage: r.stage,
    status: r.status,
    buyIncoterms: r.incoterms,
    sellIncoterms: r.customerPo.incoterms,
    paymentMethod: r.paymentMethod,
    testingRequired: r.testingRequired,
    customer: r.customerPo.customer.name,
    supplier: r.supplierPo.supplier.name,
    documents: r._count.documents,
    transitions: r._count.transitions,
  }));
}
