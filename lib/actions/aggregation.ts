'use server';

/**
 * DEMAND AGGREGATION — writing pools and floating them.
 *
 * `floatAggregation` is the one that matters. It turns a pool into:
 *
 *   1 bulk SupplierPO      — one line per MPN, quantity summed across customers
 *   N WorkOrders           — one per contributing customer order
 *   M POLinkMappings       — each customer line allocated to its bulk PO line
 *
 * The work orders are the reason this is not just "a purchase order with a lot of
 * lines". Every customer needs their own proforma invoice, tax invoice, e-way bill
 * and proof of delivery, all naming one buyer. Those cannot be pooled, so the
 * fulfilment side stays one job per customer while the buying side is a single
 * negotiation. That is what demand aggregation actually is.
 *
 * Everything is written in one transaction. A bulk PO that exists without its work
 * orders would be an order nobody is fulfilling, and work orders without the PO
 * would be jobs against a document that was never placed.
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { assessPool, poolDemand, poolIsFloatable, type PoolInput } from '@/lib/domain/aggregation';
import { listDemandCandidates } from '@/lib/queries/aggregation';
import { getStage } from '@/lib/domain/stages';
import { convertMinor, toMinor } from '@/lib/domain/money';

export interface AggregationResult {
  ok: boolean;
  message: string;
  detail?: string;
  errors?: Record<string, string>;
  id?: string;
  /** Set by floatAggregation, so the caller can link straight to the result. */
  supplierPoNumber?: string;
  workOrderAliases?: string[];
}

const ACTOR = { id: 'u-priya', label: 'Akash Dwivedi' };

function safeRevalidate(path: string) {
  try {
    revalidatePath(path);
  } catch {
    /* not in a request context */
  }
}

function fieldErrors(e: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of e.issues) out[String(i.path[0] ?? 'form')] ??= i.message;
  return out;
}

/** AGG-2026-0001, continuing from whatever exists. */
async function nextReference(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `AGG-${year}-`;
  const last = await db.demandAggregation.findFirst({
    where: { reference: { startsWith: prefix } },
    orderBy: { reference: 'desc' },
    select: { reference: true },
  });
  const n = last ? Number(last.reference.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(n).padStart(4, '0')}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Creating and editing a pool
// ═══════════════════════════════════════════════════════════════════════════

const CreateInput = z.object({
  title: z.string().trim().min(3, 'Give the pool a name.').max(120),
  rationale: z
    .string()
    .trim()
    .min(12, 'Say why these orders are being pooled — a dozen characters is not an explanation.')
    .max(600),
  supplierId: z.string().nullable().optional(),
  sourcingRef: z.string().trim().max(60).nullable().optional(),
  requiredBy: z.string().nullable().optional(),
  incoterms: z.string().trim().max(10).default('FOB'),
  paymentMethod: z.enum(['ADVANCE', 'ESCROW', 'CREDIT']).default('ESCROW'),
  notes: z.string().trim().max(1000).nullable().optional(),
  /** Customer PO lines going in, with the slice of each. */
  lines: z
    .array(z.object({ customerPoLineId: z.string().min(1), quantity: z.number().int().positive() }))
    .default([]),
  /** Negotiated bulk price per MPN. */
  parts: z
    .array(
      z.object({
        mpn: z.string().min(1),
        buyUnitPrice: z.number().nonnegative(),
        baselineUnitPrice: z.number().nonnegative().nullable().optional(),
        leadTimeDays: z.number().int().nonnegative().nullable().optional(),
      }),
    )
    .default([]),
});

export type CreateAggregationInput = z.input<typeof CreateInput>;

export async function saveAggregation(
  raw: CreateAggregationInput & { id?: string | null },
): Promise<AggregationResult> {
  const parsed = CreateInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: 'That pool could not be saved.', errors: fieldErrors(parsed.error) };
  }
  const d = parsed.data;
  const id = raw.id || null;

  if (id) {
    const existing = await db.demandAggregation.findUnique({
      where: { id },
      select: { status: true, reference: true },
    });
    if (!existing) return { ok: false, message: 'That pool no longer exists.' };
    if (existing.status !== 'DRAFT') {
      return {
        ok: false,
        message: `${existing.reference} has already been ${existing.status.toLowerCase()}.`,
        detail:
          'A floated pool is a record of a purchase order that exists. Changing it now would describe a negotiation that did not happen — raise a new pool for the remaining demand.',
      };
    }
  }

  // Supplier currency drives the pool's currency: a bulk price is quoted in the
  // supplier's currency, and storing it against the wrong one would silently
  // mis-value the whole order.
  const supplier = d.supplierId
    ? await db.supplier.findUnique({
        where: { id: d.supplierId },
        select: { id: true, currency: true, incoterms: true },
      })
    : null;
  if (d.supplierId && !supplier) {
    return { ok: false, message: 'That supplier is not on file.', errors: { supplierId: 'Unknown supplier.' } };
  }

  const data = {
    title: d.title,
    rationale: d.rationale,
    supplierId: supplier?.id ?? null,
    sourcingRef: d.sourcingRef?.trim() || null,
    requiredBy: d.requiredBy ? new Date(d.requiredBy) : null,
    currency: supplier?.currency ?? 'USD',
    incoterms: d.incoterms || supplier?.incoterms || 'FOB',
    paymentMethod: d.paymentMethod,
    notes: d.notes?.trim() || null,
  };

  const agg = id
    ? await db.demandAggregation.update({ where: { id }, data })
    : await db.demandAggregation.create({
        data: { ...data, reference: await nextReference(), createdBy: ACTOR.label },
      });

  // Lines and parts are replaced wholesale. They are a set the operator is
  // editing, not an append-only log — the audit trail below is what records the
  // history, so diffing them here would add complexity for nothing.
  await db.demandAggregationLine.deleteMany({ where: { aggregationId: agg.id } });
  await db.demandAggregationPart.deleteMany({ where: { aggregationId: agg.id } });

  if (d.lines.length) {
    const lineRows = await db.customerPOLine.findMany({
      where: { id: { in: d.lines.map((l) => l.customerPoLineId) } },
      select: { id: true, mpn: true, manufacturer: true, description: true, hsnCode: true, testingRequired: true },
    });
    const byId = new Map(lineRows.map((l) => [l.id, l]));

    await db.demandAggregationLine.createMany({
      data: d.lines
        .filter((l) => byId.has(l.customerPoLineId))
        .map((l) => ({
          aggregationId: agg.id,
          customerPoLineId: l.customerPoLineId,
          quantity: l.quantity,
        })),
    });

    /**
     * A part row is created for every MPN in the pool, whether or not a price has
     * been entered. Without it the part disappears from the pool on reload and the
     * operator has to re-add the demand they already picked.
     */
    const priced = new Map(d.parts.map((p) => [p.mpn, p]));
    const mpns = [...new Set(d.lines.map((l) => byId.get(l.customerPoLineId)?.mpn).filter(Boolean) as string[])];
    await db.demandAggregationPart.createMany({
      data: mpns.map((mpn) => {
        const meta = lineRows.find((l) => l.mpn === mpn)!;
        const p = priced.get(mpn);
        return {
          aggregationId: agg.id,
          mpn,
          manufacturer: meta.manufacturer,
          description: meta.description,
          hsnCode: meta.hsnCode,
          buyUnitPrice: p?.buyUnitPrice ?? 0,
          baselineUnitPrice: p?.baselineUnitPrice ?? null,
          leadTimeDays: p?.leadTimeDays ?? null,
          testingRequired: lineRows.some((l) => l.mpn === mpn && l.testingRequired),
        };
      }),
    });
  }

  await db.auditLogEntry.create({
    data: {
      entity: 'Demand aggregation',
      entityId: agg.id,
      action: id ? 'UPDATE' : 'CREATE',
      field: id ? 'Pool edited' : 'Pool created',
      afterValue: `${agg.reference} · ${d.title} · ${d.lines.length} customer line${d.lines.length === 1 ? '' : 's'}`,
      reason: d.rationale,
      actorId: ACTOR.id,
      actorLabel: ACTOR.label,
    },
  });

  safeRevalidate('/demand-aggregation');
  return {
    ok: true,
    id: agg.id,
    message: id ? `${agg.reference} saved.` : `${agg.reference} created.`,
    detail: `${d.lines.length} customer line${d.lines.length === 1 ? '' : 's'} in the pool.`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Floating the bulk order
// ═══════════════════════════════════════════════════════════════════════════

export async function floatAggregation(id: string): Promise<AggregationResult> {
  const agg = await db.demandAggregation.findUnique({
    where: { id },
    include: {
      supplier: true,
      parts: true,
      lines: {
        include: {
          customerPoLine: {
            include: {
              customerPo: {
                include: {
                  customer: true,
                  // The customer's accepted quote, so each work order can carry it.
                  proformas: {
                    where: { direction: 'CUSTOMER_PI' },
                    orderBy: { piDate: 'desc' },
                    take: 1,
                    select: { id: true, piNumber: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!agg) return { ok: false, message: 'That pool no longer exists.' };
  if (agg.status !== 'DRAFT') {
    return {
      ok: false,
      message: `${agg.reference} has already been ${agg.status.toLowerCase()}.`,
      detail: agg.supplierPoId
        ? 'The bulk order it produced already exists. Raise a new pool for any remaining demand.'
        : undefined,
    };
  }
  if (!agg.supplier) {
    return { ok: false, message: 'Choose a supplier before floating the bulk order.' };
  }

  // ── Re-validate against live availability ─────────────────────────────────
  // The draft may have been built yesterday. Anything committed since has to be
  // taken off, or the float over-commits a line that looked free at the time.
  const candidates = await listDemandCandidates({ excludeAggregationId: id });
  const byLine = new Map(candidates.map((c) => [c.customerPoLineId, c]));

  const inputs: PoolInput[] = [];
  for (const l of agg.lines) {
    const candidate = byLine.get(l.customerPoLineId);
    if (!candidate) {
      return {
        ok: false,
        message: 'One of the pooled customer lines no longer exists.',
        detail: 'Reopen the pool and rebuild it from the current demand.',
      };
    }
    inputs.push({ candidate, quantity: l.quantity });
  }

  const prices: Record<string, { buyUnitPrice: number; baselineUnitPrice: number | null }> = {};
  for (const p of agg.parts) {
    if (p.buyUnitPrice > 0) {
      prices[p.mpn] = { buyUnitPrice: p.buyUnitPrice, baselineUnitPrice: p.baselineUnitPrice };
    }
  }

  const summary = poolDemand(inputs, prices);
  const problems = assessPool(inputs, summary, {
    supplierChosen: true,
    hasRationale: agg.rationale.trim().length >= 12,
  });
  if (!poolIsFloatable(problems)) {
    const blocking = problems.filter((p) => p.severity === 'BLOCKING');
    return {
      ok: false,
      message: blocking[0].message,
      detail: [blocking[0].detail, blocking.length > 1 ? `${blocking.length - 1} more problem${blocking.length > 2 ? 's' : ''} to fix.` : null]
        .filter(Boolean)
        .join(' '),
    };
  }

  const fxRate = agg.supplier.currency === 'INR' ? 1 : 83.2;
  const now = new Date();

  // ── Numbering, taken before the transaction so a clash fails cheaply ───────
  const lastPo = await db.supplierPO.findFirst({
    where: { poNumber: { startsWith: 'PO-1B-' } },
    orderBy: { poNumber: 'desc' },
    select: { poNumber: true },
  });
  const poSeq = lastPo ? Number(lastPo.poNumber.slice('PO-1B-'.length)) + 1 : 1;
  const poNumber = `PO-1B-${String(poSeq).padStart(4, '0')}`;

  const lastWo = await db.workOrder.findFirst({
    where: { alias: { startsWith: `WO-${now.getFullYear()}-` } },
    orderBy: { alias: 'desc' },
    select: { alias: true },
  });
  let woSeq = lastWo ? Number(lastWo.alias.slice(`WO-${now.getFullYear()}-`.length)) + 1 : 1;

  // Distinct customer orders, each of which becomes one work order.
  const customerPos = new Map<string, (typeof agg.lines)[number]['customerPoLine']['customerPo']>();
  for (const l of agg.lines) customerPos.set(l.customerPoLine.customerPo.id, l.customerPoLine.customerPo);

  const org = await db.orgSetting.findFirst();
  const shipTo = org
    ? `${org.legalName}\n${org.addressLine1}, ${org.addressLine2 ?? ''}\n${org.city} ${org.pincode}, ${org.country}\nGSTIN ${org.gstin}`
    : '1BUY';

  const stage = getStage('SUPPLIER_PO_ISSUED');
  const createdAliases: string[] = [];

  /**
   * One transaction. A bulk order without its work orders is an order nobody is
   * fulfilling; work orders without the order are jobs against a document that
   * was never placed. Neither half is meaningful alone.
   */
  await db.$transaction(async (tx) => {
    // ── The bulk purchase order: one line per MPN ──────────────────────────
    const supplierPo = await tx.supplierPO.create({
      data: {
        poNumber,
        supplierId: agg.supplier!.id,
        poDate: now,
        currency: agg.currency,
        fxRate,
        incoterms: agg.incoterms,
        paymentMethod: agg.paymentMethod,
        creditDays: agg.paymentMethod === 'CREDIT' ? 45 : null,
        shipToAddress: shipTo,
        requiredDeliveryDate: agg.requiredBy,
        totalValue: toMinor(summary.pooledSpend, agg.currency),
        status: 'ISSUED',
        issuedAt: now,
        sourcingRef: agg.sourcingRef,
        termsAndConditions: `Consolidated order raised from demand aggregation ${agg.reference}. ${agg.rationale}`,
        lines: {
          create: summary.parts.map((p, i) => ({
            lineNo: i + 1,
            mpn: p.mpn,
            manufacturer: p.manufacturer,
            description: p.description,
            hsnCode: p.hsnCode,
            quantity: p.pooledQty,
            uom: 'PCS',
            unitPrice: p.buyUnitPrice ?? 0,
            lineTotal: toMinor((p.pooledSpend ?? 0), agg.currency),
            leadTimeDays: agg.parts.find((x) => x.mpn === p.mpn)?.leadTimeDays ?? null,
            testingRequired: p.testingRequired,
          })),
        },
      },
      include: { lines: true },
    });

    const supplierLineByMpn = new Map(supplierPo.lines.map((l) => [l.mpn, l]));

    // ── One work order per contributing customer order ─────────────────────
    for (const cpo of customerPos.values()) {
      const myLines = agg.lines.filter((l) => l.customerPoLine.customerPo.id === cpo.id);
      const pi = cpo.proformas[0] ?? null;

      // This customer's share of the buy and the sell. Never the pool total —
      // that would book the whole bulk order's value to every customer.
      const buyForeign = myLines.reduce((a, l) => {
        const price = summary.parts.find((p) => p.mpn === l.customerPoLine.mpn)?.buyUnitPrice ?? 0;
        return a + toMinor(l.quantity * price, agg.currency);
      }, 0);
      const sellValue = myLines.reduce(
        (a, l) => a + toMinor(l.quantity * l.customerPoLine.unitPrice),
        0,
      );

      const alias = `WO-${now.getFullYear()}-${String(woSeq++).padStart(4, '0')}`;
      const provisional = `${cpo.poNumber}_${pi?.piNumber ?? 'PI-PENDING'}_${poNumber}_SPI-PENDING`;

      const wo = await tx.workOrder.create({
        data: {
          canonicalName: provisional,
          alias,
          provisionalName: null,
          nameLocked: false,
          customerPoId: cpo.id,
          customerPiId: pi?.id ?? null,
          supplierPoId: supplierPo.id,
          supplierPiId: null,
          stage: 'SUPPLIER_PO_ISSUED',
          phase: stage.phase,
          status: 'ACTIVE',
          stageEnteredAt: now,
          paymentMethod: agg.paymentMethod,
          creditDays: agg.paymentMethod === 'CREDIT' ? 45 : null,
          escrowFundedBy: agg.paymentMethod === 'ESCROW' ? 'SUPPLIER' : null,
          escrowBasis: agg.paymentMethod === 'ESCROW' ? 'BUY_VALUE' : null,
          testingRequired: myLines.some((l) => l.customerPoLine.testingRequired),
          incoterms: agg.incoterms,
          buyCurrency: agg.currency,
          sellCurrency: 'INR',
          fxRate,
          sellValue,
          buyValue: convertMinor(buyForeign, fxRate, agg.currency, 'INR'),
          createdAt: now,
        },
      });
      createdAliases.push(alias);

      // ── Allocations: this customer's lines against the shared bulk lines ──
      await tx.pOLinkMapping.createMany({
        data: myLines
          .map((l) => {
            const sl = supplierLineByMpn.get(l.customerPoLine.mpn);
            if (!sl) return null;
            return {
              workOrderId: wo.id,
              customerPoLineId: l.customerPoLineId,
              supplierPoLineId: sl.id,
              allocatedQty: l.quantity,
              sellUnitPrice: l.customerPoLine.unitPrice,
              buyUnitPrice: sl.unitPrice,
            };
          })
          .filter((x) => x !== null),
      });

      await tx.stageTransition.create({
        data: {
          workOrderId: wo.id,
          fromStage: null,
          toStage: 'SUPPLIER_PO_ISSUED',
          actorId: ACTOR.id,
          actorLabel: ACTOR.label,
          provenance: 'MANUAL',
          createdAt: now,
        },
      });

      await tx.auditLogEntry.createMany({
        data: [
          {
            workOrderId: wo.id,
            entity: 'Work order',
            entityId: wo.id,
            action: 'CREATE',
            field: 'Raised from a pooled bulk order',
            afterValue: `${alias} · ${cpo.poNumber} allocated against ${poNumber}`,
            reason: `Demand aggregation ${agg.reference}: ${agg.rationale}`,
            actorId: ACTOR.id,
            actorLabel: ACTOR.label,
          },
          {
            workOrderId: wo.id,
            entity: 'Work order',
            entityId: wo.id,
            action: 'CREATE',
            field: 'Shares a supplier order with',
            afterValue: `${customerPos.size - 1} other customer order${customerPos.size === 2 ? '' : 's'} on ${poNumber}`,
            actorId: ACTOR.id,
            actorLabel: ACTOR.label,
          },
        ],
      });

      await tx.communication.create({
        data: {
          workOrderId: wo.id,
          entryClass: 'SYSTEM',
          channel: 'SYSTEM',
          direction: 'INTERNAL',
          subject: `Raised from bulk order ${poNumber} (${agg.reference})`,
          body: `${cpo.poNumber} was pooled with ${customerPos.size - 1} other customer order${customerPos.size === 2 ? '' : 's'} into one order to ${agg.supplier!.name}. Combined quantity ${summary.totalUnits.toLocaleString('en-IN')} units across ${summary.parts.length} part${summary.parts.length === 1 ? '' : 's'}${summary.saving > 0 ? `, saving ${agg.currency} ${summary.saving.toLocaleString('en-IN')} against the last prices paid` : ''}. Reason: ${agg.rationale}`,
          status: 'CLOSED',
          occurredAt: now,
          systemIcon: 'Layers',
          loggedById: ACTOR.id,
          participants: { create: [{ role: 'FROM', stakeholder: 'ONE_BUY', name: ACTOR.label }] },
          contextChips: { create: [{ kind: 'DOCUMENT', refId: supplierPo.id, label: poNumber }] },
        },
      });
    }

    // ── Close the pool ─────────────────────────────────────────────────────
    await tx.demandAggregation.update({
      where: { id: agg.id },
      data: { status: 'FLOATED', supplierPoId: supplierPo.id, floatedAt: now },
    });

    await tx.auditLogEntry.createMany({
      data: [
        {
          entity: 'Demand aggregation',
          entityId: agg.id,
          action: 'AUTHORISE',
          field: 'Floated as a bulk order',
          beforeValue: 'DRAFT',
          afterValue: `${poNumber} to ${agg.supplier!.name} · ${summary.totalUnits.toLocaleString('en-IN')} units · ${agg.currency} ${summary.pooledSpend.toLocaleString('en-IN')}`,
          reason: agg.rationale,
          actorId: ACTOR.id,
          actorLabel: ACTOR.label,
        },
        {
          entity: 'Demand aggregation',
          entityId: agg.id,
          action: 'CREATE',
          field: 'Work orders created',
          afterValue: createdAliases.join(', '),
          actorId: ACTOR.id,
          actorLabel: ACTOR.label,
        },
        ...(summary.saving !== 0
          ? [
              {
                entity: 'Demand aggregation',
                entityId: agg.id,
                action: 'CREATE',
                field: summary.saving > 0 ? 'Saving against unpooled prices' : 'Premium over unpooled prices',
                afterValue: `${agg.currency} ${Math.abs(summary.saving).toLocaleString('en-IN')} (${Math.abs(summary.savingPct).toFixed(1)}%)`,
                actorId: ACTOR.id,
                actorLabel: ACTOR.label,
              },
            ]
          : []),
      ],
    });
  });

  safeRevalidate('/demand-aggregation');
  safeRevalidate('/orders');
  safeRevalidate('/purchase-orders');

  return {
    ok: true,
    id: agg.id,
    supplierPoNumber: poNumber,
    workOrderAliases: createdAliases,
    message: `${agg.reference} floated as ${poNumber}.`,
    detail: `${summary.totalUnits.toLocaleString('en-IN')} units across ${summary.parts.length} part${summary.parts.length === 1 ? '' : 's'} on one order to ${agg.supplier.name}, with ${createdAliases.length} work order${createdAliases.length === 1 ? '' : 's'} created — one per customer order. ${
      summary.saving > 0
        ? `Saved ${agg.currency} ${summary.saving.toLocaleString('en-IN')} against the last prices paid.`
        : ''
    }`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Cancelling
// ═══════════════════════════════════════════════════════════════════════════

export async function cancelAggregation(id: string, reason: string): Promise<AggregationResult> {
  if (!reason?.trim() || reason.trim().length < 8) {
    return {
      ok: false,
      message: 'Say why the pool is being cancelled.',
      errors: { reason: 'A reason is required.' },
    };
  }
  const agg = await db.demandAggregation.findUnique({
    where: { id },
    select: { reference: true, status: true },
  });
  if (!agg) return { ok: false, message: 'That pool no longer exists.' };
  if (agg.status === 'FLOATED') {
    return {
      ok: false,
      message: `${agg.reference} has already been floated.`,
      detail:
        'The bulk order exists and work orders are running against it. Cancel those individually rather than the pool that produced them.',
    };
  }

  await db.demandAggregation.update({
    where: { id },
    data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason.trim() },
  });

  // The demand goes back into the pool of what is available, so the audit row is
  // how anyone finds out where it went.
  await db.auditLogEntry.create({
    data: {
      entity: 'Demand aggregation',
      entityId: id,
      action: 'DELETE',
      field: 'Pool cancelled',
      beforeValue: agg.status,
      afterValue: 'CANCELLED — the pooled demand is available again',
      reason: reason.trim(),
      actorId: ACTOR.id,
      actorLabel: ACTOR.label,
    },
  });

  safeRevalidate('/demand-aggregation');
  return {
    ok: true,
    message: `${agg.reference} cancelled.`,
    detail: 'The customer lines it held are available to pool again.',
  };
}
