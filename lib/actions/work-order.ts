'use server';

/**
 * Editing a work order after it exists.
 *
 * The case this is built for: stock bought ahead of demand. A supplier order is
 * placed speculatively, and the customer order it will serve turns up later —
 * sometimes weeks later. The platform has to let that be recorded honestly
 * rather than forcing a fiction at creation time.
 *
 * Two rules:
 *
 *  1. The work order NAME is derived, never typed. It is the four document
 *     numbers joined together, so re-pointing any of them rebuilds it — and the
 *     previous name is kept searchable, because people will have quoted it in
 *     emails.
 *
 *  2. Terms that are locked stay locked unless someone gives a reason. Locking
 *     is the moment the exchange rate and prices stopped moving; changing them
 *     afterwards re-prices the job, so it is allowed but never silent.
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { ESCROW_FUNDERS } from '@/lib/domain/enums';

export interface WorkOrderEditResult {
  ok: boolean;
  message: string;
  detail?: string;
  errors?: Record<string, string>;
  /** The rebuilt name, when linking changed it. */
  canonicalName?: string;
}

const PATCH = z.object({
  /** Re-point the customer order this job serves. */
  customerPoId: z.string().optional(),
  /** Our quote out. Empty string clears it. */
  customerPiId: z.string().optional(),
  /** The supplier's quote in. Empty string clears it. */
  supplierPiId: z.string().optional(),
  paymentMethod: z.enum(['ADVANCE', 'ESCROW', 'CREDIT']).optional(),
  creditDays: z.number().int().min(0).max(365).nullable().optional(),
  escrowFundedBy: z.enum(ESCROW_FUNDERS).nullable().optional(),
  escrowBasis: z.enum(['SELL_VALUE', 'BUY_VALUE', 'CUSTOM']).nullable().optional(),
  incoterms: z.string().trim().min(2).max(12).optional(),
  testingRequired: z.boolean().optional(),
  testScope: z.enum(['LOT_SAMPLE', 'FULL_BATCH']).nullable().optional(),
  /** Required when the terms are already locked. */
  reason: z.string().trim().optional(),
});

export type WorkOrderPatch = z.input<typeof PATCH>;

function safeRevalidate(path: string) {
  try {
    revalidatePath(path);
  } catch {
    /* no request context */
  }
}

/** The four segments, in order. Pending segments are named, not blank. */
function buildName(parts: {
  customerPoNumber: string;
  customerPiNumber: string | null;
  supplierPoNumber: string;
  supplierPiNumber: string | null;
}): string {
  return [
    parts.customerPoNumber,
    parts.customerPiNumber ?? 'PI-PENDING',
    parts.supplierPoNumber,
    parts.supplierPiNumber ?? 'SPI-PENDING',
  ].join('_');
}

export async function updateWorkOrder(
  workOrderId: string,
  patch: WorkOrderPatch,
): Promise<WorkOrderEditResult> {
  const parsed = PATCH.safeParse(patch);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const i of parsed.error.issues) errors[String(i.path[0] ?? 'form')] ??= i.message;
    return { ok: false, message: 'That change could not be saved.', errors };
  }
  const d = parsed.data;

  const wo = await db.workOrder.findUnique({
    where: { id: workOrderId },
    include: {
      customerPo: { select: { id: true, poNumber: true, totalValue: true } },
      supplierPo: { select: { id: true, poNumber: true, currency: true } },
      customerPi: { select: { id: true, piNumber: true } },
      supplierPi: { select: { id: true, piNumber: true, externalRef: true } },
      mappings: { select: { id: true } },
    },
  });
  if (!wo) return { ok: false, message: 'That order no longer exists.' };

  if (wo.status === 'CLOSED' || wo.status === 'CANCELLED') {
    return {
      ok: false,
      message: `This order is ${wo.status.toLowerCase()}.`,
      detail:
        'A closed order is a historical record — its figures feed reports that have already been read. Reopening it is not something to do by editing a field.',
    };
  }

  // ── Whether a reason is needed ───────────────────────────────────────────
  const termFieldsTouched =
    d.paymentMethod !== undefined ||
    d.incoterms !== undefined ||
    d.testingRequired !== undefined ||
    d.testScope !== undefined ||
    d.escrowFundedBy !== undefined ||
    d.escrowBasis !== undefined ||
    d.creditDays !== undefined;

  if (wo.termsLockedAt && termFieldsTouched && !d.reason) {
    return {
      ok: false,
      message: 'These terms were locked.',
      detail: `Locked on ${wo.termsLockedAt.toDateString()}. Changing them now re-prices the job, so it needs a reason — which is kept with the change.`,
      errors: { reason: 'Give a reason for changing locked terms.' },
    };
  }

  // ── Validate the documents being linked ──────────────────────────────────
  let customerPo = wo.customerPo;
  if (d.customerPoId && d.customerPoId !== wo.customerPoId) {
    const next = await db.customerPO.findUnique({
      where: { id: d.customerPoId },
      select: { id: true, poNumber: true, totalValue: true, status: true },
    });
    if (!next) return { ok: false, message: 'That customer order no longer exists.' };
    if (next.status === 'CANCELLED') {
      return {
        ok: false,
        message: 'That customer order is cancelled.',
        errors: { customerPoId: 'Pick an order that is still live.' },
      };
    }
    // Re-pointing invalidates the line allocations, which were made against the
    // old order's lines. Refusing is the honest answer: the allocation has to be
    // redone deliberately, not silently dropped.
    if (wo.mappings.length > 0) {
      return {
        ok: false,
        message: 'This job already has line allocations against its current customer order.',
        detail:
          'Moving it to a different customer order would leave those allocations pointing at the wrong lines. Clear them on the order first, or link the supplier order to the new customer order as a fresh job.',
        errors: { customerPoId: 'Allocations exist against the current order.' },
      };
    }
    customerPo = { id: next.id, poNumber: next.poNumber, totalValue: next.totalValue };
  }

  let customerPi = wo.customerPi;
  if (d.customerPiId !== undefined) {
    if (d.customerPiId === '') customerPi = null;
    else {
      const pi = await db.proformaInvoice.findUnique({
        where: { id: d.customerPiId },
        select: { id: true, piNumber: true, direction: true, customerPoId: true },
      });
      if (!pi || pi.direction !== 'CUSTOMER_PI') {
        return { ok: false, message: 'That is not one of our proforma invoices.' };
      }
      if (pi.customerPoId && pi.customerPoId !== customerPo.id) {
        return {
          ok: false,
          message: 'That quote belongs to a different customer order.',
          errors: { customerPiId: 'It was raised against another order.' },
        };
      }
      customerPi = { id: pi.id, piNumber: pi.piNumber };
    }
  }

  let supplierPi = wo.supplierPi;
  if (d.supplierPiId !== undefined) {
    if (d.supplierPiId === '') supplierPi = null;
    else {
      const pi = await db.proformaInvoice.findUnique({
        where: { id: d.supplierPiId },
        select: { id: true, piNumber: true, externalRef: true, direction: true, supplierPoId: true },
      });
      if (!pi || pi.direction !== 'SUPPLIER_PI') {
        return { ok: false, message: 'That is not a supplier proforma invoice.' };
      }
      if (pi.supplierPoId && pi.supplierPoId !== wo.supplierPo.id) {
        return {
          ok: false,
          message: 'That quote is against a different supplier order.',
          errors: { supplierPiId: 'It was received against another purchase order.' },
        };
      }
      supplierPi = { id: pi.id, piNumber: pi.piNumber, externalRef: pi.externalRef };
    }
  }

  // ── Rebuild the name from whatever is now linked ─────────────────────────
  const nextName = buildName({
    customerPoNumber: customerPo.poNumber,
    customerPiNumber: customerPi?.piNumber ?? null,
    supplierPoNumber: wo.supplierPo.poNumber,
    supplierPiNumber: supplierPi?.piNumber ?? null,
  });
  const nameChanged = nextName !== wo.canonicalName;

  if (nameChanged) {
    const clash = await db.workOrder.findFirst({
      where: { canonicalName: nextName, id: { not: wo.id } },
      select: { alias: true },
    });
    if (clash) {
      return {
        ok: false,
        message: 'Another job already has that combination of documents.',
        detail: `${clash.alias} is already ${nextName}. Two jobs cannot describe the same four documents.`,
      };
    }
  }

  const fullyNamed = !nextName.includes('PENDING');

  /**
   * One entry per changed field. The audit log is immutable and append-only, so a
   * single row lumping several changes into one sentence would be unreadable and
   * un-queryable — "what was the delivery term on the 14th" has to be answerable
   * from one row, with a real before and a real after.
   */
  const changes: { field: string; label: string; before: string | null; after: string | null }[] = [];
  const push = (field: string, label: string, from: unknown, to: unknown) => {
    const before = from === null || from === undefined || from === '' ? null : String(from);
    const after = to === null || to === undefined || to === '' ? null : String(to);
    if (before !== after) changes.push({ field, label, before, after });
  };
  push('customerPo', 'Customer order', wo.customerPo.poNumber, customerPo.poNumber);
  push('customerPi', 'Our proforma invoice', wo.customerPi?.piNumber, customerPi?.piNumber);
  push(
    'supplierPi',
    'Supplier proforma invoice',
    wo.supplierPi?.externalRef ?? wo.supplierPi?.piNumber,
    supplierPi?.externalRef ?? supplierPi?.piNumber,
  );
  if (nameChanged) push('canonicalName', 'Work order name', wo.canonicalName, nextName);
  if (d.paymentMethod !== undefined) push('paymentMethod', 'Payment method', wo.paymentMethod, d.paymentMethod);
  if (d.incoterms !== undefined) push('incoterms', 'Delivery terms', wo.incoterms, d.incoterms);
  if (d.testingRequired !== undefined) {
    push('testingRequired', 'Testing required', wo.testingRequired ? 'yes' : 'no', d.testingRequired ? 'yes' : 'no');
  }
  if (d.testScope !== undefined) push('testScope', 'Test scope', wo.testScope, d.testScope);
  if (d.escrowFundedBy !== undefined) push('escrowFundedBy', 'Escrow funded by', wo.escrowFundedBy, d.escrowFundedBy);
  if (d.escrowBasis !== undefined) push('escrowBasis', 'Escrow basis', wo.escrowBasis, d.escrowBasis);
  if (d.creditDays !== undefined) push('creditDays', 'Credit days', wo.creditDays, d.creditDays);

  if (changes.length === 0) {
    return { ok: true, message: 'Nothing changed.', detail: 'Every value was already as entered.' };
  }

  await db.workOrder.update({
    where: { id: wo.id },
    data: {
      customerPoId: customerPo.id,
      customerPiId: customerPi?.id ?? null,
      supplierPiId: supplierPi?.id ?? null,
      canonicalName: nextName,
      // The old name stays searchable — it is what people quoted in emails.
      provisionalName: nameChanged ? wo.canonicalName : wo.provisionalName,
      nameLocked: fullyNamed,
      ...(d.paymentMethod !== undefined ? { paymentMethod: d.paymentMethod } : {}),
      ...(d.creditDays !== undefined ? { creditDays: d.creditDays } : {}),
      ...(d.escrowFundedBy !== undefined ? { escrowFundedBy: d.escrowFundedBy } : {}),
      ...(d.escrowBasis !== undefined ? { escrowBasis: d.escrowBasis } : {}),
      ...(d.incoterms !== undefined ? { incoterms: d.incoterms } : {}),
      ...(d.testingRequired !== undefined ? { testingRequired: d.testingRequired } : {}),
      ...(d.testScope !== undefined ? { testScope: d.testScope } : {}),
    },
  });

  const summary = changes
    .map((c) => `${c.label}: ${c.before ?? '—'} → ${c.after ?? '—'}`)
    .join('; ');

  await db.auditLogEntry.createMany({
    data: changes.map((c) => ({
      workOrderId: wo.id,
      entity: 'WorkOrder',
      entityId: wo.id,
      action: 'UPDATE',
      field: c.label,
      beforeValue: c.before,
      afterValue: c.after,
      // The reason belongs on every row it justifies, not on one of them —
      // reading any single row must tell you why it happened.
      reason: d.reason || null,
      actorId: 'u-priya',
      actorLabel: 'Akash Dwivedi',
    })),
  });

  // On the thread too: a change of linked documents or of locked terms is
  // something the next person to pick this up needs to see without digging.
  await db.communication.create({
    data: {
      workOrderId: wo.id,
      entryClass: 'SYSTEM',
      channel: 'SYSTEM',
      direction: 'INTERNAL',
      subject: nameChanged ? 'Linked documents changed' : 'Terms amended',
      body: `${summary}.${d.reason ? ` Reason given: ${d.reason}` : ''}${
        nameChanged ? ` The work order name is now ${nextName}.` : ''
      }`,
      status: 'CLOSED',
      occurredAt: new Date(),
      systemIcon: 'PenLine',
      loggedById: 'u-priya',
      participants: { create: [{ role: 'FROM', stakeholder: 'ONE_BUY', name: 'Akash Dwivedi' }] },
    },
  });

  safeRevalidate('/orders');
  safeRevalidate(`/orders/${wo.id}`);

  return {
    ok: true,
    message: nameChanged ? 'Linked documents updated.' : 'Terms amended.',
    detail: nameChanged
      ? `The work order name is now ${nextName}. The previous name stays searchable.`
      : summary,
    canonicalName: nextName,
  };
}

/**
 * What can be linked to this job, for the edit form's pickers.
 *
 * Scoped deliberately: only quotes that belong to this job's own documents, or
 * are unattached, are offered — the validation above would refuse anything else,
 * and offering a choice that will be refused is a worse experience than not
 * offering it.
 */
export async function getLinkOptions(workOrderId: string): Promise<{
  customerPos: { id: string; label: string; linkedTo: string | null }[];
  customerPis: { id: string; label: string }[];
  supplierPis: { id: string; label: string }[];
}> {
  const wo = await db.workOrder.findUnique({
    where: { id: workOrderId },
    select: { customerPoId: true, supplierPoId: true },
  });
  if (!wo) return { customerPos: [], customerPis: [], supplierPis: [] };

  const [pos, custPis, suppPis] = await Promise.all([
    db.customerPO.findMany({
      where: { status: { not: 'CANCELLED' } },
      orderBy: { poDate: 'desc' },
      select: {
        id: true,
        poNumber: true,
        poDate: true,
        totalValue: true,
        customer: { select: { name: true } },
        workOrders: { select: { alias: true } },
      },
    }),
    db.proformaInvoice.findMany({
      where: { direction: 'CUSTOMER_PI', OR: [{ customerPoId: wo.customerPoId }, { customerPoId: null }] },
      orderBy: { piDate: 'desc' },
      select: { id: true, piNumber: true, piDate: true, totalValue: true },
    }),
    db.proformaInvoice.findMany({
      where: { direction: 'SUPPLIER_PI', OR: [{ supplierPoId: wo.supplierPoId }, { supplierPoId: null }] },
      orderBy: { piDate: 'desc' },
      select: { id: true, piNumber: true, externalRef: true, piDate: true, totalValue: true },
    }),
  ]);

  const money = (v: number) => `₹${(v / 100).toLocaleString('en-IN')}`;
  const date = (dt: Date) => dt.toISOString().slice(0, 10);

  return {
    customerPos: pos.map((p) => ({
      id: p.id,
      label: `${p.poNumber} · ${p.customer.name} · ${date(p.poDate)} · ${money(p.totalValue)}`,
      linkedTo: p.workOrders.length ? p.workOrders.map((w) => w.alias).join(', ') : null,
    })),
    customerPis: custPis.map((p) => ({
      id: p.id,
      label: `${p.piNumber} · ${date(p.piDate)} · ${money(p.totalValue)}`,
    })),
    supplierPis: suppPis.map((p) => ({
      id: p.id,
      label: `${p.externalRef ?? p.piNumber} · ${date(p.piDate)} · ${money(p.totalValue)}`,
    })),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Linking an already-issued supplier order to a customer order
// ═══════════════════════════════════════════════════════════════════════════

/** What a supplier order can be linked to, and how its lines would allocate. */
export interface LinkPreview {
  supplierPo: {
    id: string;
    poNumber: string;
    supplier: string;
    currency: string;
    fxRate: number;
    incoterms: string;
    paymentMethod: string;
    totalValue: number;
    lines: { id: string; mpn: string; quantity: number; unitPrice: number }[];
    alreadyLinkedTo: string | null;
    /**
     * Every work order already on this supplier order. Plural because a supplier
     * order can serve several customer orders — one more can be added to an order
     * that is already partly claimed.
     */
    linkedWorkOrders: { alias: string; customerPoNumber: string }[];
    /** Per line, what the existing links have already taken. */
    lineAvailability: {
      supplierPoLineId: string;
      mpn: string;
      manufacturer: string;
      description: string;
      quantity: number;
      allocatedQty: number;
      availableQty: number;
      unitPrice: number;
    }[];
  };
  candidates: {
    id: string;
    poNumber: string;
    customer: string;
    poDate: string;
    requestedDate: string | null;
    totalValue: number;
    workOrders: string[];
    /** Lines whose part number also appears on the supplier order. */
    matchingParts: number;
    customerPis: { id: string; piNumber: string }[];
    /** Units still needed of parts this supplier order actually carries. */
    outstandingOnMatchingParts: number;
    /** Its lines, with what each still needs — the other half of the matrix. */
    lines: {
      customerPoLineId: string;
      mpn: string;
      orderedQty: number;
      coveredQty: number;
      outstandingQty: number;
      sellUnitPrice: number;
    }[];
  }[];
}

export async function getLinkPreview(supplierPoId: string): Promise<LinkPreview | null> {
  const spo = await db.supplierPO.findUnique({
    where: { id: supplierPoId },
    include: {
      supplier: { select: { name: true } },
      lines: { orderBy: { lineNo: 'asc' } },
      workOrders: {
        select: { alias: true, customerPo: { select: { poNumber: true } } },
        orderBy: { alias: 'asc' },
      },
    },
  });
  if (!spo) return null;

  const mpns = new Set(spo.lines.map((l) => l.mpn.toUpperCase()));
  const pos = await db.customerPO.findMany({
    where: { status: { notIn: ['CANCELLED', 'CLOSED'] } },
    orderBy: { poDate: 'desc' },
    include: {
      customer: { select: { name: true } },
      lines: true,
      workOrders: { select: { alias: true } },
      proformas: { where: { direction: 'CUSTOMER_PI' }, select: { id: true, piNumber: true } },
    },
  });

  // What the supplier order has already committed, per line, and what each
  // customer line still needs. Both halves are needed to allocate honestly —
  // "the supplier ordered 10,000" says nothing about what is left of it.
  const [supplierTaken, customerCovered] = await Promise.all([
    db.pOLinkMapping.groupBy({
      by: ['supplierPoLineId'],
      where: { supplierPoLineId: { in: spo.lines.map((l) => l.id) } },
      _sum: { allocatedQty: true },
    }),
    db.pOLinkMapping.groupBy({
      by: ['customerPoLineId'],
      where: { customerPoLineId: { in: pos.flatMap((p) => p.lines.map((l) => l.id)) } },
      _sum: { allocatedQty: true },
    }),
  ]);
  const takenBy = new Map(supplierTaken.map((r) => [r.supplierPoLineId, r._sum.allocatedQty ?? 0]));
  const coveredBy = new Map(customerCovered.map((r) => [r.customerPoLineId, r._sum.allocatedQty ?? 0]));

  return {
    supplierPo: {
      id: spo.id,
      poNumber: spo.poNumber,
      supplier: spo.supplier.name,
      currency: spo.currency,
      fxRate: spo.fxRate,
      incoterms: spo.incoterms,
      paymentMethod: spo.paymentMethod,
      totalValue: spo.totalValue,
      lines: spo.lines.map((l) => ({
        id: l.id,
        mpn: l.mpn,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
      })),
      alreadyLinkedTo: spo.workOrders[0]?.alias ?? null,
      linkedWorkOrders: spo.workOrders.map((w) => ({
        alias: w.alias,
        customerPoNumber: w.customerPo?.poNumber ?? '—',
      })),
      lineAvailability: spo.lines.map((l) => {
        const allocatedQty = takenBy.get(l.id) ?? 0;
        return {
          supplierPoLineId: l.id,
          mpn: l.mpn,
          manufacturer: l.manufacturer,
          description: l.description,
          quantity: l.quantity,
          allocatedQty,
          availableQty: Math.max(0, l.quantity - allocatedQty),
          unitPrice: l.unitPrice,
        };
      }),
    },
    // Ordered by how well the parts overlap: the order this stock was almost
    // certainly bought for is the one sharing part numbers with it.
    candidates: pos
      .map((p) => ({
        id: p.id,
        poNumber: p.poNumber,
        customer: p.customer.name,
        poDate: p.poDate.toISOString(),
        requestedDate: p.requestedDeliveryDate?.toISOString() ?? null,
        totalValue: p.totalValue,
        workOrders: p.workOrders.map((w) => w.alias),
        /**
         * Only lines that overlap AND still need something. An order with two
         * matching part numbers and nothing outstanding is not a candidate in any
         * useful sense — counting it ranked fully-sourced orders to the top of the
         * list and pre-selected one of them.
         */
        matchingParts: p.lines.filter(
          (l) => mpns.has(l.mpn.toUpperCase()) && l.quantity - (coveredBy.get(l.id) ?? 0) > 0,
        ).length,
        /** Units this order still needs of parts this supplier order carries. */
        outstandingOnMatchingParts: p.lines
          .filter((l) => mpns.has(l.mpn.toUpperCase()))
          .reduce((a, l) => a + Math.max(0, l.quantity - (coveredBy.get(l.id) ?? 0)), 0),
        customerPis: p.proformas.map((x) => ({ id: x.id, piNumber: x.piNumber })),
        lines: p.lines.map((l) => {
          const coveredQty = coveredBy.get(l.id) ?? 0;
          return {
            customerPoLineId: l.id,
            mpn: l.mpn,
            orderedQty: l.quantity,
            coveredQty,
            outstandingQty: Math.max(0, l.quantity - coveredQty),
            sellUnitPrice: l.unitPrice,
          };
        }),
      }))
      .sort((a, b) => b.matchingParts - a.matchingParts || b.poDate.localeCompare(a.poDate)),
  };
}

/**
 * Links a supplier order that was issued ahead of demand to the customer order it
 * will serve, creating the work order that ties them together.
 *
 * Lines are allocated by part number: the quantity taken is the lesser of what
 * the customer wants and what we bought, which is the only allocation that is
 * always true. Anything more nuanced is a deliberate decision, and the work
 * order's own line allocations are where that gets adjusted afterwards.
 */
export async function linkSupplierPoToCustomerPo(
  supplierPoId: string,
  customerPoId: string,
  opts: { customerPiId?: string | null } = {},
): Promise<WorkOrderEditResult & { workOrderId?: string; alias?: string }> {
  const [spo, cpo] = await Promise.all([
    db.supplierPO.findUnique({
      where: { id: supplierPoId },
      include: { lines: true, workOrders: { select: { alias: true } } },
    }),
    db.customerPO.findUnique({
      where: { id: customerPoId },
      include: { lines: true, proformas: { where: { direction: 'CUSTOMER_PI' } } },
    }),
  ]);
  if (!spo) return { ok: false, message: 'That supplier order no longer exists.' };
  if (!cpo) return { ok: false, message: 'That customer order no longer exists.' };

  if (spo.workOrders.length > 0) {
    return {
      ok: false,
      message: `${spo.poNumber} is already on ${spo.workOrders[0].alias}.`,
      detail:
        'One supplier order belongs to one work order. To point it at a different customer order, edit that work order instead.',
    };
  }
  if (cpo.status === 'CANCELLED') {
    return { ok: false, message: 'That customer order is cancelled.' };
  }

  const customerPi = opts.customerPiId
    ? cpo.proformas.find((p) => p.id === opts.customerPiId)
    : cpo.proformas[0];

  // Allocate by part number, taking the smaller of the two quantities.
  const mappingRows: {
    customerPoLineId: string;
    supplierPoLineId: string;
    allocatedQty: number;
    sellUnitPrice: number;
    buyUnitPrice: number;
  }[] = [];
  let sellValue = 0;
  let buyNative = 0;

  for (const sl of spo.lines) {
    const cl = cpo.lines.find((l) => l.mpn.toUpperCase() === sl.mpn.toUpperCase());
    if (!cl) continue;
    const qty = Math.min(cl.quantity, sl.quantity);
    if (qty <= 0) continue;
    sellValue += Math.round(qty * cl.unitPrice * 100);
    buyNative += qty * sl.unitPrice;
    mappingRows.push({
      customerPoLineId: cl.id,
      supplierPoLineId: sl.id,
      allocatedQty: qty,
      sellUnitPrice: cl.unitPrice,
      buyUnitPrice: sl.unitPrice,
    });
  }

  if (mappingRows.length === 0) {
    return {
      ok: false,
      message: 'No part on this supplier order appears on that customer order.',
      detail: `${spo.poNumber} covers ${spo.lines.map((l) => l.mpn).join(', ')}. Nothing there matches, so linking them would create a work order with no allocated lines. Check you have picked the right customer order.`,
      errors: { customerPoId: 'No matching part numbers.' },
    };
  }

  const { getStage: stageOf } = await import('@/lib/domain/stages');
  const stage = stageOf('SUPPLIER_PO_ISSUED')!;
  const name = buildName({
    customerPoNumber: cpo.poNumber,
    customerPiNumber: customerPi?.piNumber ?? null,
    supplierPoNumber: spo.poNumber,
    supplierPiNumber: null,
  });

  const clash = await db.workOrder.findFirst({ where: { canonicalName: name }, select: { alias: true } });
  if (clash) {
    return { ok: false, message: `${clash.alias} already describes that combination of documents.` };
  }

  const series = await db.numberingSeries.findUnique({ where: { docType: 'WORK_ORDER' } });
  const next = series?.nextNumber ?? 1;
  const alias = `WO-2026-${String(next).padStart(4, '0')}`;
  if (series) {
    await db.numberingSeries.update({
      where: { docType: 'WORK_ORDER' },
      data: { nextNumber: next + 1 },
    });
  }

  const anyTesting = spo.lines.some((l) => l.testingRequired);

  const wo = await db.workOrder.create({
    data: {
      canonicalName: name,
      alias,
      provisionalName: name,
      nameLocked: false,
      customerPoId: cpo.id,
      customerPiId: customerPi?.id ?? null,
      supplierPoId: spo.id,
      stage: stage.id,
      phase: stage.phase,
      status: 'ACTIVE',
      stageEnteredAt: new Date(),
      paymentMethod: spo.paymentMethod,
      creditDays: spo.paymentMethod === 'CREDIT' ? (spo.creditDays ?? 30) : null,
      testingRequired: anyTesting,
      testScope: spo.lines.find((l) => l.testScope)?.testScope ?? null,
      incoterms: spo.incoterms,
      buyCurrency: spo.currency,
      sellCurrency: cpo.currency,
      fxRate: spo.fxRate,
      sellValue,
      buyValue: Math.round(buyNative * spo.fxRate * 100),
      mappings: { create: mappingRows },
    },
  });

  // The sourcing reference should survive the link in either direction.
  if (!spo.sourcingRef && cpo.sourcingRef) {
    await db.supplierPO.update({ where: { id: spo.id }, data: { sourcingRef: cpo.sourcingRef } });
  } else if (!cpo.sourcingRef && spo.sourcingRef) {
    await db.customerPO.update({ where: { id: cpo.id }, data: { sourcingRef: spo.sourcingRef } });
  }

  await db.customerPO.update({
    where: { id: cpo.id },
    data: { status: 'PARTIALLY_LINKED' },
  });

  // One audit row per fact established, per the append-only rule.
  await db.auditLogEntry.createMany({
    data: [
      {
        workOrderId: wo.id,
        entity: 'Work order',
        entityId: wo.id,
        action: 'CREATE',
        field: 'Work order name',
        afterValue: name,
        actorId: 'u-priya',
        actorLabel: 'Akash Dwivedi',
      },
      {
        workOrderId: wo.id,
        entity: 'Work order',
        entityId: wo.id,
        action: 'UPDATE',
        field: 'Customer order',
        beforeValue: null,
        afterValue: cpo.poNumber,
        reason: 'Supplier order was placed ahead of demand and linked to the customer order afterwards.',
        actorId: 'u-priya',
        actorLabel: 'Akash Dwivedi',
      },
      {
        workOrderId: wo.id,
        entity: 'Work order',
        entityId: wo.id,
        action: 'UPDATE',
        field: 'Line allocations',
        afterValue: `${mappingRows.length} line(s) allocated by part number`,
        actorId: 'u-priya',
        actorLabel: 'Akash Dwivedi',
      },
    ],
  });

  await db.stageTransition.create({
    data: {
      workOrderId: wo.id,
      fromStage: null,
      toStage: stage.id,
      actorLabel: 'Akash Dwivedi',
      provenance: 'MANUAL',
      reason: `${spo.poNumber} was issued ahead of demand and linked to ${cpo.poNumber}.`,
    },
  });

  await db.communication.create({
    data: {
      workOrderId: wo.id,
      entryClass: 'SYSTEM',
      channel: 'SYSTEM',
      direction: 'INTERNAL',
      subject: `${spo.poNumber} linked to ${cpo.poNumber}`,
      body: `Work order ${alias} created. ${mappingRows.length} line(s) allocated by part number. The supplier order was placed ahead of demand, so the customer order was attached afterwards.`,
      status: 'CLOSED',
      occurredAt: new Date(),
      systemIcon: 'Link2',
      loggedById: 'u-priya',
      participants: { create: [{ role: 'FROM', stakeholder: 'ONE_BUY', name: 'Akash Dwivedi' }] },
    },
  });

  safeRevalidate('/purchase-orders');
  safeRevalidate('/orders');

  return {
    ok: true,
    workOrderId: wo.id,
    alias,
    canonicalName: name,
    message: `Linked — work order ${alias} created.`,
    detail: `${mappingRows.length} line(s) allocated by part number, taking the lesser of what the customer wants and what we bought. Adjust the allocation on the order if it needs to differ.`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// What "partially linked" actually means
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A customer order is sourced line by line, not as a whole.
 *
 * "Partially linked" is not a state someone sets — it is what you get when the
 * quantities allocated to supplier orders add up to less than the customer
 * ordered. That happens for ordinary reasons: the order was split across two
 * suppliers, or only part of it could be bought at an acceptable price, or the
 * rest is still being sourced. So the status is COMPUTED from the allocations and
 * shown with the arithmetic behind it, rather than stored as a label nobody can
 * check.
 */
export interface CoverageLine {
  customerPoLineId: string;
  lineNo: number;
  mpn: string;
  description: string;
  uom: string;
  orderedQty: number;
  allocatedQty: number;
  shortfallQty: number;
  unitPrice: number;
  /** Which supplier orders cover this line, and for how much. */
  coveredBy: { supplierPoNumber: string; supplier: string; qty: number; workOrder: string }[];
}

export interface CustomerPoCoverage {
  id: string;
  poNumber: string;
  customer: string;
  currency: string;
  totalValue: number;
  orderedQty: number;
  allocatedQty: number;
  shortfallQty: number;
  coveragePct: number;
  /** NOT_SOURCED | PARTLY_SOURCED | FULLY_SOURCED — derived, never stored. */
  state: 'NOT_SOURCED' | 'PARTLY_SOURCED' | 'FULLY_SOURCED';
  /** Plain-English account of why it is not fully covered. */
  explanation: string;
  lines: CoverageLine[];
  workOrders: { id: string; alias: string; supplier: string; stage: string }[];
  /** Unlinked supplier orders that carry a part this order still needs. */
  candidateSupplierPos: {
    id: string;
    poNumber: string;
    supplier: string;
    currency: string;
    totalValue: number;
    matchingParts: number;
  }[];
}

export async function getCustomerPoCoverage(
  customerPoId: string,
): Promise<CustomerPoCoverage | null> {
  const po = await db.customerPO.findUnique({
    where: { id: customerPoId },
    include: {
      customer: { select: { name: true } },
      lines: { orderBy: { lineNo: 'asc' } },
      workOrders: {
        select: {
          id: true,
          alias: true,
          stage: true,
          supplierPo: { select: { poNumber: true, supplier: { select: { name: true } } } },
        },
      },
    },
  });
  if (!po) return null;

  const mappings = await db.pOLinkMapping.findMany({
    where: { customerPoLine: { customerPoId } },
    include: {
      workOrder: {
        select: {
          alias: true,
          supplierPo: { select: { poNumber: true, supplier: { select: { name: true } } } },
        },
      },
    },
  });

  const lines: CoverageLine[] = po.lines.map((l) => {
    const mine = mappings.filter((m) => m.customerPoLineId === l.id);
    const allocated = mine.reduce((a, m) => a + m.allocatedQty, 0);
    return {
      customerPoLineId: l.id,
      lineNo: l.lineNo,
      mpn: l.mpn,
      description: l.description,
      uom: l.uom,
      orderedQty: l.quantity,
      allocatedQty: allocated,
      shortfallQty: Math.max(0, l.quantity - allocated),
      unitPrice: l.unitPrice,
      coveredBy: mine.map((m) => ({
        supplierPoNumber: m.workOrder.supplierPo.poNumber,
        supplier: m.workOrder.supplierPo.supplier.name,
        qty: m.allocatedQty,
        workOrder: m.workOrder.alias,
      })),
    };
  });

  const orderedQty = lines.reduce((a, l) => a + l.orderedQty, 0);
  const allocatedQty = lines.reduce((a, l) => a + l.allocatedQty, 0);
  const shortfallQty = lines.reduce((a, l) => a + l.shortfallQty, 0);
  const coveragePct = orderedQty > 0 ? (allocatedQty / orderedQty) * 100 : 0;
  const state =
    allocatedQty === 0 ? 'NOT_SOURCED' : shortfallQty === 0 ? 'FULLY_SOURCED' : 'PARTLY_SOURCED';

  const untouched = lines.filter((l) => l.allocatedQty === 0);
  const short = lines.filter((l) => l.allocatedQty > 0 && l.shortfallQty > 0);

  const explanation =
    state === 'FULLY_SOURCED'
      ? `Every line is fully covered. ${po.workOrders.length} supplier order${po.workOrders.length === 1 ? '' : 's'} between them account for all ${orderedQty.toLocaleString('en-IN')} units.`
      : state === 'NOT_SOURCED'
        ? 'Nothing has been bought against this order yet, so no work order exists. Raise a supplier order and link it, or link one already placed.'
        : [
            `${allocatedQty.toLocaleString('en-IN')} of ${orderedQty.toLocaleString('en-IN')} units are covered by ${po.workOrders.length} supplier order${po.workOrders.length === 1 ? '' : 's'}.`,
            untouched.length > 0
              ? `${untouched.length} line${untouched.length === 1 ? ' has' : 's have'} nothing bought against ${untouched.length === 1 ? 'it' : 'them'} at all (${untouched.map((l) => l.mpn).join(', ')}).`
              : null,
            short.length > 0
              ? `${short.length} line${short.length === 1 ? ' is' : 's are'} part covered — bought for less than the customer ordered (${short.map((l) => `${l.mpn} short ${l.shortfallQty.toLocaleString('en-IN')}`).join('; ')}).`
              : null,
            'A part-covered order is normal while sourcing is split across suppliers or done in stages. It becomes a problem only if the shortfall is still open near the delivery date.',
          ]
            .filter(Boolean)
            .join(' ');

  // Unlinked supplier orders that could close the gap.
  const needed = new Set(lines.filter((l) => l.shortfallQty > 0).map((l) => l.mpn.toUpperCase()));
  const unlinked = await db.supplierPO.findMany({
    where: { workOrders: { none: {} }, status: { notIn: ['CANCELLED'] } },
    include: { supplier: { select: { name: true } }, lines: { select: { mpn: true } } },
    orderBy: { poDate: 'desc' },
  });

  return {
    id: po.id,
    poNumber: po.poNumber,
    customer: po.customer.name,
    currency: po.currency,
    totalValue: po.totalValue,
    orderedQty,
    allocatedQty,
    shortfallQty,
    coveragePct,
    state,
    explanation,
    lines,
    workOrders: po.workOrders.map((w) => ({
      id: w.id,
      alias: w.alias,
      supplier: w.supplierPo.supplier.name,
      stage: w.stage,
    })),
    candidateSupplierPos: unlinked
      .map((s) => ({
        id: s.id,
        poNumber: s.poNumber,
        supplier: s.supplier.name,
        currency: s.currency,
        totalValue: s.totalValue,
        matchingParts: s.lines.filter((l) => needed.has(l.mpn.toUpperCase())).length,
      }))
      .filter((s) => s.matchingParts > 0)
      .sort((a, b) => b.matchingParts - a.matchingParts),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Linking one supplier order to SEVERAL customer orders
// ═══════════════════════════════════════════════════════════════════════════

export interface MultiLinkResult extends WorkOrderEditResult {
  created?: { alias: string; customerPoNumber: string; units: number }[];
  skipped?: string[];
}

/**
 * Claims one supplier order across several customer orders at once.
 *
 * The retroactive form of demand aggregation: stock bought ahead of demand, then
 * split between the customer orders that turn up for it. Each customer gets its
 * own work order against the shared supplier order — the same rule as a pooled
 * bulk buy, and for the same reason: invoices, e-way bills and PODs name one
 * buyer and cannot be shared.
 *
 * The allocation is validated against what the supplier line actually has left,
 * counting anything already committed by an earlier link. Over-allocating would
 * promise the same physical stock twice, and that is not discovered until someone
 * is short at delivery.
 */
export async function linkSupplierPoToCustomerPos(input: {
  supplierPoId: string;
  /** Flat cells. Grouped by customer order server-side. */
  allocations: { customerPoId: string; customerPoLineId: string; supplierPoLineId: string; quantity: number }[];
  /** Chosen customer PI per customer order, where one exists. */
  customerPiByPo?: Record<string, string | null>;
  reason?: string;
}): Promise<MultiLinkResult> {
  const cells = input.allocations.filter((a) => a.quantity > 0);
  if (cells.length === 0) {
    return {
      ok: false,
      message: 'Nothing is allocated.',
      detail: 'Give at least one customer order a quantity before linking.',
    };
  }

  const spo = await db.supplierPO.findUnique({
    where: { id: input.supplierPoId },
    include: { lines: true, supplier: { select: { name: true } } },
  });
  if (!spo) return { ok: false, message: 'That supplier order no longer exists.' };

  // ── Availability, recomputed now ──────────────────────────────────────────
  const taken = await db.pOLinkMapping.groupBy({
    by: ['supplierPoLineId'],
    where: { supplierPoLineId: { in: spo.lines.map((l) => l.id) } },
    _sum: { allocatedQty: true },
  });
  const takenBy = new Map(taken.map((t) => [t.supplierPoLineId, t._sum.allocatedQty ?? 0]));

  for (const sl of spo.lines) {
    const wanted = cells
      .filter((c) => c.supplierPoLineId === sl.id)
      .reduce((a, c) => a + c.quantity, 0);
    const left = sl.quantity - (takenBy.get(sl.id) ?? 0);
    if (wanted > left) {
      return {
        ok: false,
        message: `${sl.mpn} is over-allocated.`,
        detail: `${wanted.toLocaleString('en-IN')} allocated but only ${left.toLocaleString(
          'en-IN',
        )} is left on ${spo.poNumber} — the rest is already committed to another customer order. Allocating it again would promise the same stock twice.`,
      };
    }
  }

  const byCustomerPo = new Map<string, typeof cells>();
  for (const c of cells) {
    const list = byCustomerPo.get(c.customerPoId) ?? [];
    list.push(c);
    byCustomerPo.set(c.customerPoId, list);
  }

  const cpos = await db.customerPO.findMany({
    where: { id: { in: [...byCustomerPo.keys()] } },
    include: { lines: true, proformas: { where: { direction: 'CUSTOMER_PI' } }, customer: true },
  });
  const cpoById = new Map(cpos.map((c) => [c.id, c]));

  for (const id of byCustomerPo.keys()) {
    const c = cpoById.get(id);
    if (!c) return { ok: false, message: 'One of the customer orders no longer exists.' };
    if (c.status === 'CANCELLED') {
      return { ok: false, message: `${c.poNumber} is cancelled.` };
    }
  }

  const { getStage: stageOf } = await import('@/lib/domain/stages');
  const stage = stageOf('SUPPLIER_PO_ISSUED')!;
  const series = await db.numberingSeries.findUnique({ where: { docType: 'WORK_ORDER' } });
  let next = series?.nextNumber ?? 1;

  const created: { alias: string; customerPoNumber: string; units: number }[] = [];
  const reason =
    input.reason?.trim() ||
    `Stock on ${spo.poNumber} was bought ahead of demand and split across ${byCustomerPo.size} customer order${byCustomerPo.size === 1 ? '' : 's'} as they arrived.`;

  /**
   * One transaction across every work order. A half-applied split would leave
   * some customers claiming stock and others not, with no way to tell which.
   */
  await db.$transaction(async (tx) => {
    for (const [customerPoId, myCells] of byCustomerPo) {
      const cpo = cpoById.get(customerPoId)!;
      const pi =
        (input.customerPiByPo?.[customerPoId]
          ? cpo.proformas.find((p) => p.id === input.customerPiByPo![customerPoId])
          : cpo.proformas[0]) ?? null;

      const name = buildName({
        customerPoNumber: cpo.poNumber,
        customerPiNumber: pi?.piNumber ?? null,
        supplierPoNumber: spo.poNumber,
        supplierPiNumber: null,
      });

      const alias = `WO-2026-${String(next++).padStart(4, '0')}`;
      let sellValue = 0;
      let buyNative = 0;
      const mappingRows = myCells.map((c) => {
        const cl = cpo.lines.find((l) => l.id === c.customerPoLineId)!;
        const sl = spo.lines.find((l) => l.id === c.supplierPoLineId)!;
        sellValue += Math.round(c.quantity * cl.unitPrice * 100);
        buyNative += c.quantity * sl.unitPrice;
        return {
          customerPoLineId: c.customerPoLineId,
          supplierPoLineId: c.supplierPoLineId,
          allocatedQty: c.quantity,
          sellUnitPrice: cl.unitPrice,
          buyUnitPrice: sl.unitPrice,
        };
      });

      const wo = await tx.workOrder.create({
        data: {
          canonicalName: name,
          alias,
          provisionalName: name,
          nameLocked: false,
          customerPoId: cpo.id,
          customerPiId: pi?.id ?? null,
          supplierPoId: spo.id,
          stage: stage.id,
          phase: stage.phase,
          status: 'ACTIVE',
          stageEnteredAt: new Date(),
          paymentMethod: spo.paymentMethod,
          creditDays: spo.paymentMethod === 'CREDIT' ? (spo.creditDays ?? 30) : null,
          testingRequired: spo.lines.some(
            (l) => l.testingRequired && myCells.some((c) => c.supplierPoLineId === l.id),
          ),
          incoterms: spo.incoterms,
          buyCurrency: spo.currency,
          sellCurrency: cpo.currency,
          fxRate: spo.fxRate,
          sellValue,
          buyValue: Math.round(buyNative * spo.fxRate * 100),
          mappings: { create: mappingRows },
        },
      });

      await tx.stageTransition.create({
        data: {
          workOrderId: wo.id,
          fromStage: null,
          toStage: stage.id,
          actorId: 'u-priya',
          actorLabel: 'Akash Dwivedi',
          provenance: 'MANUAL',
        },
      });

      // One row per fact established.
      await tx.auditLogEntry.createMany({
        data: [
          {
            workOrderId: wo.id,
            entity: 'Work order',
            entityId: wo.id,
            action: 'CREATE',
            field: 'Work order name',
            afterValue: name,
            actorId: 'u-priya',
            actorLabel: 'Akash Dwivedi',
          },
          {
            workOrderId: wo.id,
            entity: 'Work order',
            entityId: wo.id,
            action: 'UPDATE',
            field: 'Customer order',
            afterValue: cpo.poNumber,
            reason,
            actorId: 'u-priya',
            actorLabel: 'Akash Dwivedi',
          },
          {
            workOrderId: wo.id,
            entity: 'Work order',
            entityId: wo.id,
            action: 'CREATE',
            field: 'Share of the supplier order',
            afterValue: myCells
              .map((c) => {
                const sl = spo.lines.find((l) => l.id === c.supplierPoLineId)!;
                return `${c.quantity.toLocaleString('en-IN')} of ${sl.quantity.toLocaleString('en-IN')} ${sl.mpn}`;
              })
              .join('; '),
            reason:
              byCustomerPo.size > 1
                ? `${spo.poNumber} is shared with ${byCustomerPo.size - 1} other customer order${byCustomerPo.size === 2 ? '' : 's'}.`
                : null,
            actorId: 'u-priya',
            actorLabel: 'Akash Dwivedi',
          },
        ],
      });

      await tx.communication.create({
        data: {
          workOrderId: wo.id,
          entryClass: 'SYSTEM',
          channel: 'SYSTEM',
          direction: 'INTERNAL',
          subject:
            byCustomerPo.size > 1
              ? `Linked to ${spo.poNumber}, shared with ${byCustomerPo.size - 1} other customer order${byCustomerPo.size === 2 ? '' : 's'}`
              : `Linked to ${spo.poNumber}`,
          body: `${cpo.poNumber} claimed ${myCells.reduce((a, c) => a + c.quantity, 0).toLocaleString('en-IN')} units from ${spo.poNumber} (${spo.supplier.name}). ${reason}`,
          status: 'CLOSED',
          occurredAt: new Date(),
          systemIcon: 'Link2',
          loggedById: 'u-priya',
          participants: { create: [{ role: 'FROM', stakeholder: 'ONE_BUY', name: 'Akash Dwivedi' }] },
          contextChips: { create: [{ kind: 'DOCUMENT', refId: spo.id, label: spo.poNumber }] },
        },
      });

      // Coverage decides the status, so it is derived rather than assumed.
      const covered = await tx.pOLinkMapping.groupBy({
        by: ['customerPoLineId'],
        where: { customerPoLine: { customerPoId: cpo.id } },
        _sum: { allocatedQty: true },
      });
      const coverMap = new Map(covered.map((c) => [c.customerPoLineId, c._sum.allocatedQty ?? 0]));
      const fully = cpo.lines.every((l) => (coverMap.get(l.id) ?? 0) >= l.quantity);
      await tx.customerPO.update({
        where: { id: cpo.id },
        data: { status: fully ? 'FULLY_LINKED' : 'PARTIALLY_LINKED' },
      });

      if (!spo.sourcingRef && cpo.sourcingRef) {
        await tx.supplierPO.update({ where: { id: spo.id }, data: { sourcingRef: cpo.sourcingRef } });
      }

      created.push({
        alias,
        customerPoNumber: cpo.poNumber,
        units: myCells.reduce((a, c) => a + c.quantity, 0),
      });
    }

    if (series) {
      await tx.numberingSeries.update({
        where: { docType: 'WORK_ORDER' },
        data: { nextNumber: next },
      });
    }
  });

  safeRevalidate('/purchase-orders');
  safeRevalidate('/orders');

  const totalUnits = created.reduce((a, c) => a + c.units, 0);
  return {
    ok: true,
    created,
    message:
      created.length === 1
        ? `${created[0].alias} created against ${spo.poNumber}.`
        : `${created.length} work orders created against ${spo.poNumber}.`,
    detail: `${totalUnits.toLocaleString('en-IN')} units split across ${created
      .map((c) => `${c.customerPoNumber} (${c.units.toLocaleString('en-IN')})`)
      .join(', ')}. Each customer order has its own job, quote and delivery against the shared supplier order.`,
  };
}
