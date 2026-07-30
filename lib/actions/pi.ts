'use server';

/**
 * Server actions for Create PI (§3.3).
 *
 * Two directions:
 *  * CUSTOMER_PI — our quote to the customer, generated from their PO.
 *  * SUPPLIER_PI — the supplier's quote back to us, captured and reconciled
 *    three ways against our PO (price, quantity, lead time). Capturing it is
 *    what completes the work order name: the SPI-PENDING segment resolves and
 *    the name locks (§3.4).
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { toMinor } from '@/lib/domain/money';
import { getStage } from '@/lib/domain/stages';
import { reconcile, type ReconcilePiLine, type Variance } from '@/lib/domain/reconcile';

/**
 * Outside a request there is no cache to revalidate — these actions are also
 * called from scripts and scheduled jobs, and an unguarded call throws there.
 */
function safeRevalidate(path: string) {
  try {
    revalidatePath(path);
  } catch {
    /* not in a request context */
  }
}

async function nextDocNumber(docType: string, fallbackPrefix: string): Promise<string> {
  const series = await db.numberingSeries.findUnique({ where: { docType } });
  if (!series) return `${fallbackPrefix}-0001`;
  const number = `${series.prefix}-${String(series.nextNumber).padStart(series.padding, '0')}`;
  await db.numberingSeries.update({
    where: { docType },
    data: { nextNumber: series.nextNumber + 1 },
  });
  return number;
}

export type PiActionResult =
  | {
      ok: true;
      message: string;
      id?: string;
      piNumber?: string;
      /** Set when capturing a supplier PI completed a work order name. */
      workOrderId?: string;
      newCanonicalName?: string;
      previousName?: string;
    }
  | { ok: false; error: string };

// ── Customer PI ─────────────────────────────────────────────────────────────

const customerPiSchema = z.object({
  customerPoId: z.string().min(1),
  piNumber: z.string().optional().nullable(),
  piDate: z.string().min(1),
  validUntil: z.string().optional().nullable(),
  freightAmount: z.number().nonnegative().default(0),
  insuranceAmount: z.number().nonnegative().default(0),
  bankDetails: z.string().optional().nullable(),
  terms: z.string().optional().nullable(),
  /**
   * RFQ / Sourcing ID from the sourcing step upstream of this platform. Free
   * text — that system owns the format.
   */
  sourcingRef: z.string().trim().max(64).optional().nullable(),
  issueNow: z.boolean().default(true),
  lines: z
    .array(
      z.object({
        customerPoLineId: z.string().min(1),
        quantity: z.number().int().positive(),
        unitPrice: z.number().nonnegative(),
      }),
    )
    .min(1, 'A proforma needs at least one line'),
});

export async function createCustomerPi(input: unknown): Promise<PiActionResult> {
  const parsed = customerPiSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Those details are not valid.' };
  }
  const d = parsed.data;

  const po = await db.customerPO.findUnique({
    where: { id: d.customerPoId },
    include: { lines: true, customer: true, workOrders: true },
  });
  if (!po) return { ok: false, error: 'That customer PO no longer exists.' };

  const piNumber = d.piNumber?.trim() || (await nextDocNumber('CUSTOMER_PI', 'PI-1B'));

  const lines = d.lines
    .map((l, i) => {
      const src = po.lines.find((x) => x.id === l.customerPoLineId);
      if (!src) return null;
      return {
        lineNo: i + 1,
        mpn: src.mpn,
        description: src.description,
        hsnCode: src.hsnCode,
        quantity: l.quantity,
        uom: src.uom,
        unitPrice: l.unitPrice,
        lineTotal: toMinor(l.quantity * l.unitPrice, po.currency),
      };
    })
    .filter(Boolean) as {
    lineNo: number;
    mpn: string;
    description: string;
    hsnCode: string;
    quantity: number;
    uom: string;
    unitPrice: number;
    lineTotal: number;
  }[];

  const subtotal = lines.reduce((a, l) => a + l.lineTotal, 0);
  const freight = toMinor(d.freightAmount, po.currency);
  const insurance = toMinor(d.insuranceAmount, po.currency);

  const pi = await db.proformaInvoice.create({
    data: {
      piNumber,
      direction: 'CUSTOMER_PI',
      customerPoId: po.id,
      piDate: new Date(d.piDate),
      validUntil: d.validUntil ? new Date(d.validUntil) : null,
      currency: po.currency,
      subtotal,
      freightAmount: freight,
      insuranceAmount: insurance,
      taxAmount: 0,
      totalValue: subtotal + freight + insurance,
      bankDetails: d.bankDetails ?? null,
      terms: d.terms ?? null,
      // Falls back to the customer order's reference, so the same RFQ stays
      // traceable across the documents it produced.
      sourcingRef: d.sourcingRef?.trim() || po.sourcingRef || null,
      status: d.issueNow ? 'ISSUED' : 'DRAFT',
      issuedAt: d.issueNow ? new Date() : null,
      sentAt: d.issueNow ? new Date() : null,
      lines: { create: lines },
    },
  });

  await db.auditLogEntry.create({
    data: {
      entity: 'ProformaInvoice',
      entityId: pi.id,
      action: 'CREATE',
      actorLabel: 'Akash Dwivedi',
      afterValue: piNumber,
    },
  });

  /**
   * If a work order already exists for this PO and its name still says
   * PI-PENDING, fill that segment in now. The name is built from four
   * documents; whichever arrives last completes its own slot.
   */
  let renamed: { workOrderId: string; from: string; to: string } | null = null;
  for (const wo of po.workOrders) {
    if (!wo.canonicalName.includes('_PI-PENDING_')) continue;
    const from = wo.canonicalName;
    const to = from.replace('_PI-PENDING_', `_${piNumber}_`);
    await db.workOrder.update({
      where: { id: wo.id },
      data: { canonicalName: to, customerPiId: pi.id },
    });
    await db.auditLogEntry.create({
      data: {
        workOrderId: wo.id,
        entity: 'WorkOrder',
        entityId: wo.id,
        action: 'UPDATE',
        field: 'canonicalName',
        beforeValue: from,
        afterValue: to,
        actorLabel: 'Akash Dwivedi',
      },
    });
    renamed = { workOrderId: wo.id, from, to };
  }

  safeRevalidate('/create-pi');
  safeRevalidate('/orders');

  return {
    ok: true,
    id: pi.id,
    piNumber,
    workOrderId: renamed?.workOrderId,
    newCanonicalName: renamed?.to,
    previousName: renamed?.from,
    message: renamed
      ? `Proforma ${piNumber} issued, and work order name updated to include it.`
      : `Proforma ${piNumber} ${d.issueNow ? 'issued' : 'saved as draft'}.`,
  };
}

// ── Supplier PI capture + three-way reconciliation ──────────────────────────

const supplierPiSchema = z.object({
  supplierPoId: z.string().min(1),
  /** The supplier's own document number. */
  externalRef: z.string().min(1, "Enter the supplier's own PI number"),
  piDate: z.string().min(1),
  leadTimeDays: z.number().int().nonnegative().optional().nullable(),
  terms: z.string().optional().nullable(),
  /**
   * RFQ / Sourcing ID from the sourcing step upstream of this platform. Free
   * text — that system owns the format.
   */
  sourcingRef: z.string().trim().max(64).optional().nullable(),
  lines: z
    .array(
      z.object({
        supplierPoLineId: z.string().min(1),
        quantity: z.number().int().positive(),
        unitPrice: z.number().nonnegative(),
        leadTimeDays: z.number().int().nonnegative().optional().nullable(),
      }),
    )
    .min(1, 'A proforma needs at least one line'),
});

/**
 * Server-side reconciliation. Delegates to the shared pure function in
 * lib/domain/reconcile so the live preview in the form and the value saved here
 * can never disagree.
 */
export async function reconcileSupplierPi(input: {
  supplierPoId: string;
  lines: ReconcilePiLine[];
}): Promise<Variance[]> {
  const po = await db.supplierPO.findUnique({
    where: { id: input.supplierPoId },
    include: { lines: true },
  });
  if (!po) return [];
  return reconcile(
    po.lines.map((l) => ({
      id: l.id,
      mpn: l.mpn,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      leadTimeDays: l.leadTimeDays,
    })),
    input.lines,
  );
}

export async function captureSupplierPi(input: unknown): Promise<PiActionResult> {
  const parsed = supplierPiSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Those details are not valid.' };
  }
  const d = parsed.data;

  const po = await db.supplierPO.findUnique({
    where: { id: d.supplierPoId },
    include: { lines: true, supplier: true, workOrders: true, proformas: true },
  });
  if (!po) return { ok: false, error: 'That supplier PO no longer exists.' };
  if (po.proformas.some((p) => p.direction === 'SUPPLIER_PI')) {
    return {
      ok: false,
      error: `A supplier proforma is already recorded against ${po.poNumber}.`,
    };
  }

  const piNumber = await nextDocNumber('SUPPLIER_PI', 'SPI');

  const lines = d.lines
    .map((l, i) => {
      const src = po.lines.find((x) => x.id === l.supplierPoLineId);
      if (!src) return null;
      return {
        lineNo: i + 1,
        mpn: src.mpn,
        description: src.description,
        hsnCode: src.hsnCode,
        quantity: l.quantity,
        uom: src.uom,
        unitPrice: l.unitPrice,
        lineTotal: toMinor(l.quantity * l.unitPrice, po.currency),
        leadTimeDays: l.leadTimeDays ?? null,
      };
    })
    .filter(Boolean) as {
    lineNo: number;
    mpn: string;
    description: string;
    hsnCode: string;
    quantity: number;
    uom: string;
    unitPrice: number;
    lineTotal: number;
    leadTimeDays: number | null;
  }[];

  const subtotal = lines.reduce((a, l) => a + l.lineTotal, 0);

  const pi = await db.proformaInvoice.create({
    data: {
      piNumber,
      direction: 'SUPPLIER_PI',
      supplierPoId: po.id,
      piDate: new Date(d.piDate),
      currency: po.currency,
      subtotal,
      totalValue: subtotal,
      status: 'RECEIVED',
      externalRef: d.externalRef,
      leadTimeDays: d.leadTimeDays ?? null,
      terms: d.terms ?? null,
      sourcingRef: d.sourcingRef?.trim() || po.sourcingRef || null,
      lines: { create: lines },
    },
  });

  const variances = await reconcileSupplierPi({
    supplierPoId: po.id,
    lines: d.lines,
  });

  // ── Complete the work order name (§3.4) ───────────────────────────────────
  let renamed: { workOrderId: string; from: string; to: string; alias: string } | null = null;

  for (const wo of po.workOrders) {
    const from = wo.canonicalName;
    const to = from.replace('_SPI-PENDING', `_${piNumber}`);
    const buyValueInr = toMinor(
      lines.reduce((a, l) => a + l.quantity * l.unitPrice, 0) * wo.fxRate,
      'INR',
    );

    await db.workOrder.update({
      where: { id: wo.id },
      data: {
        supplierPiId: pi.id,
        canonicalName: to,
        // The provisional name stays searchable as an alias.
        provisionalName: from,
        nameLocked: true,
        buyValue: buyValueInr,
      },
    });

    await db.auditLogEntry.create({
      data: {
        workOrderId: wo.id,
        entity: 'WorkOrder',
        entityId: wo.id,
        action: 'UPDATE',
        field: 'canonicalName',
        beforeValue: from,
        afterValue: to,
        actorLabel: 'Akash Dwivedi',
      },
    });

    // Advance the ladder if the order is still sitting at SUPPLIER_PO_ISSUED.
    if (wo.stage === 'SUPPLIER_PO_ISSUED') {
      const next = getStage('SUPPLIER_PI_RECEIVED');
      await db.workOrder.update({
        where: { id: wo.id },
        data: { stage: next.id, phase: next.phase, stageEnteredAt: new Date() },
      });
      await db.stageTransition.create({
        data: {
          workOrderId: wo.id,
          fromStage: 'SUPPLIER_PO_ISSUED',
          toStage: next.id,
          actorLabel: 'Akash Dwivedi',
          provenance: 'MANUAL',
          reason: `Supplier proforma ${d.externalRef} recorded.`,
        },
      });
      await db.communication.create({
        data: {
          workOrderId: wo.id,
          entryClass: 'SYSTEM',
          channel: 'SYSTEM',
          direction: 'INTERNAL',
          subject: `Stage advanced to ${next.label}`,
          body: `${next.description} Work order name completed: ${to}`,
          status: 'CLOSED',
          occurredAt: new Date(),
          systemIcon: 'Activity',
          contextChips: {
            create: [{ kind: 'STAGE', refId: next.id, label: `${next.code} · ${next.label}` }],
          },
        },
      });
      await db.task.updateMany({
        where: { workOrderId: wo.id, linkedStage: 'SUPPLIER_PO_ISSUED', status: 'OPEN' },
        data: { status: 'DONE', completedAt: new Date() },
      });
      await db.task.create({
        data: {
          workOrderId: wo.id,
          title: next.nextAction,
          ownerRole: next.nextActionOwner,
          linkedStage: next.id,
          priority: variances.some((v) => v.severity === 'CRITICAL') ? 'HIGH' : 'NORMAL',
          dueAt: new Date(Date.now() + next.expectedHours * 3600_000),
          status: 'OPEN',
        },
      });
    }

    // Variances worth a human decision become a logged internal note.
    if (variances.length > 0) {
      await db.communication.create({
        data: {
          workOrderId: wo.id,
          entryClass: 'HUMAN',
          channel: 'PORTAL',
          direction: 'INTERNAL',
          subject: `Supplier proforma ${d.externalRef} does not match our PO on ${variances.length} point${variances.length === 1 ? '' : 's'}`,
          body: variances.map((v) => `• ${v.mpn} — ${v.note}`).join('\n'),
          visibility: 'INTERNAL',
          status: variances.some((v) => v.severity === 'CRITICAL') ? 'ACTION_REQUIRED' : 'CLOSED',
          isUnread: variances.some((v) => v.severity === 'CRITICAL'),
          occurredAt: new Date(),
          participants: {
            create: [{ role: 'FROM', stakeholder: 'ONE_BUY', name: 'Akash Dwivedi' }],
          },
          contextChips: {
            create: variances.slice(0, 4).map((v) => ({
              kind: 'LINE_ITEM',
              label: `${v.mpn} · ${v.field}`,
            })),
          },
        },
      });
    }

    renamed = { workOrderId: wo.id, from, to, alias: wo.alias };
  }

  await db.supplierPO.update({ where: { id: po.id }, data: { status: 'ACKNOWLEDGED' } });

  safeRevalidate('/create-pi');
  safeRevalidate('/orders');
  safeRevalidate('/dashboard');

  const varianceNote =
    variances.length === 0
      ? 'It matches our PO exactly.'
      : `${variances.length} variance${variances.length === 1 ? '' : 's'} flagged against our PO.`;

  return {
    ok: true,
    id: pi.id,
    piNumber,
    workOrderId: renamed?.workOrderId,
    newCanonicalName: renamed?.to,
    previousName: renamed?.from,
    message: renamed
      ? `Supplier proforma recorded as ${piNumber}. Work order ${renamed.alias} name is now complete and locked. ${varianceNote}`
      : `Supplier proforma recorded as ${piNumber}. ${varianceNote}`,
  };
}
