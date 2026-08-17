'use server';

/**
 * Server actions for Create PO (§3.1–3.4).
 *
 * The linking step is where a Work Order is born: a supplier PO linked to a
 * customer PO produces the internal job, named
 * CustomerPO_1BUYPI_1BUYPO_SupplierPI with the fourth segment provisional until
 * the supplier's proforma is captured.
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { toMinor } from '@/lib/domain/money';
import { getStage } from '@/lib/domain/stages';
import { PAYMENT_METHODS, TEST_SCOPES } from '@/lib/domain/enums';

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

// ── Numbering ───────────────────────────────────────────────────────────────

async function nextDocNumber(docType: string): Promise<string> {
  const series = await db.numberingSeries.findUnique({ where: { docType } });
  if (!series) {
    // Fall back to a timestamp-free deterministic form rather than throwing —
    // a missing series must never block an operator mid-form.
    const count = await db.customerPO.count();
    return `${docType}-${String(count + 1).padStart(4, '0')}`;
  }
  const number = `${series.prefix}-${String(series.nextNumber).padStart(series.padding, '0')}`;
  await db.numberingSeries.update({
    where: { docType },
    data: { nextNumber: series.nextNumber + 1 },
  });
  return number;
}

// ── Schemas ─────────────────────────────────────────────────────────────────

const lineSchema = z.object({
  mpn: z.string().min(1, 'Part number is required'),
  manufacturer: z.string().min(1),
  description: z.string().min(1),
  hsnCode: z.string().min(4, 'HSN code looks too short'),
  quantity: z.number().int().positive('Quantity must be more than zero'),
  uom: z.string().default('PCS'),
  unitPrice: z.number().nonnegative(),
  /** Days quoted or promised, per line. */
  leadTimeDays: z.number().int().nonnegative().max(999).optional().nullable(),
  /** Required or offered date code / lot, e.g. "2419+". */
  dateCodeLot: z.string().trim().max(48).optional().nullable(),
  testingRequired: z.boolean().default(false),
  remarks: z.string().optional().nullable(),
});

const customerPoSchema = z.object({
  customerId: z.string().min(1, 'Choose a customer'),
  poNumber: z.string().min(1, 'Enter the customer’s PO number'),
  poDate: z.string().min(1),
  currency: z.string().default('INR'),
  incoterms: z.string().default('DDP'),
  paymentTerms: z.string().default('30 days'),
  requestedDeliveryDate: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  /**
   * RFQ / Sourcing ID from the sourcing step upstream of this platform. Free
   * text: the format belongs to that system, so validating a shape here would
   * only reject references that are perfectly valid there.
   */
  sourcingRef: z.string().trim().max(64).optional().nullable(),
  /**
   * Addresses for THIS order, entered on the form. Optional so the customer's
   * record still supplies them when nothing was typed — but when the operator
   * corrects a delivery address for a one-off, that correction has to reach the
   * order rather than being quietly discarded in favour of the master record.
   */
  shipToAddress: z.string().trim().max(600).optional().nullable(),
  billToAddress: z.string().trim().max(600).optional().nullable(),

  lines: z.array(lineSchema).min(1, 'Add at least one part'),
});

const supplierLineSchema = lineSchema.extend({
  leadTimeDays: z.number().int().nonnegative().optional().nullable(),
  countryOfOrigin: z.string().optional().nullable(),
  dateCodeLot: z.string().optional().nullable(),
  msl: z.string().optional().nullable(),
  packaging: z.string().optional().nullable(),
  testScope: z.enum(TEST_SCOPES).optional().nullable(),
  sampleSize: z.number().int().positive().optional().nullable(),
  aql: z.string().optional().nullable(),
});

const mappingSchema = z.object({
  customerPoLineId: z.string().min(1),
  /** Index into the supplier lines array being created. */
  supplierLineIndex: z.number().int().nonnegative(),
  allocatedQty: z.number().int().positive(),
});

const supplierPoSchema = z.object({
  supplierId: z.string().min(1, 'Choose a supplier from the Approved Vendor List'),
  poNumber: z.string().optional().nullable(),
  poDate: z.string().min(1),
  currency: z.string().default('USD'),
  fxRate: z.number().positive().default(1),
  incoterms: z.string().default('FOB'),
  paymentMethod: z.enum(PAYMENT_METHODS),
  creditDays: z.number().int().positive().optional().nullable(),
  requiredDeliveryDate: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  /**
   * RFQ / Sourcing ID from the sourcing step upstream of this platform. Free
   * text: the format belongs to that system, so validating a shape here would
   * only reject references that are perfectly valid there.
   */
  sourcingRef: z.string().trim().max(64).optional().nullable(),

  lines: z.array(supplierLineSchema).min(1, 'Add at least one part'),
  /** The linking panel. When absent, no work order is created. */
  link: z
    .object({
      customerPoId: z.string().min(1),
      customerPiId: z.string().optional().nullable(),
      mappings: z.array(mappingSchema).min(1, 'Map at least one line'),
    })
    .optional()
    .nullable(),
});

export type ActionResult =
  | {
      ok: true;
      message: string;
      /** The thing to navigate to — a work order when one was created. */
      id?: string;
      canonicalName?: string;
      alias?: string;
      /**
       * The document record just written, named explicitly so the caller can
       * attach an uploaded file to it. `id` is not enough: on a linked supplier
       * order it is the work order's id, not the purchase order's.
       */
      customerPoId?: string;
      supplierPoId?: string;
    }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

// ── Create customer PO ──────────────────────────────────────────────────────

export async function createCustomerPo(input: unknown): Promise<ActionResult> {
  const parsed = customerPoSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Some details need fixing before this can be saved.',
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const d = parsed.data;

  const clash = await db.customerPO.findFirst({
    where: { customerId: d.customerId, poNumber: d.poNumber },
    select: { id: true },
  });
  if (clash) {
    const customer = await db.customer.findUnique({
      where: { id: d.customerId },
      select: { name: true },
    });
    return {
      ok: false,
      error: `PO number ${d.poNumber} is already recorded for ${customer?.name ?? 'this customer'} — try adding a suffix.`,
    };
  }

  const customer = await db.customer.findUnique({ where: { id: d.customerId } });
  if (!customer) return { ok: false, error: 'That customer no longer exists.' };

  const address = `${customer.name}\n${customer.addressLine1}\n${customer.city} ${customer.pincode}, ${customer.country}\nGSTIN ${customer.gstin ?? '—'}`;
  const lines = d.lines.map((l, i) => ({
    lineNo: i + 1,
    mpn: l.mpn,
    manufacturer: l.manufacturer,
    description: l.description,
    hsnCode: l.hsnCode,
    quantity: l.quantity,
    uom: l.uom,
    unitPrice: l.unitPrice,
    lineTotal: toMinor(l.quantity * l.unitPrice, d.currency),
    leadTimeDays: l.leadTimeDays ?? null,
    dateCodeLot: l.dateCodeLot?.trim() || null,
    testingRequired: l.testingRequired,
    remarks: l.remarks ?? null,
  }));
  const totalValue = lines.reduce((a, l) => a + l.lineTotal, 0);

  const po = await db.customerPO.create({
    data: {
      poNumber: d.poNumber,
      customerId: d.customerId,
      poDate: new Date(d.poDate),
      currency: d.currency,
      incoterms: d.incoterms,
      paymentTerms: d.paymentTerms,
      requestedDeliveryDate: d.requestedDeliveryDate ? new Date(d.requestedDeliveryDate) : null,
      // What was typed wins; the master record is the fallback, not the override.
      shipToAddress: d.shipToAddress?.trim() || address,
      billToAddress: d.billToAddress?.trim() || d.shipToAddress?.trim() || address,
      contactName: customer.contactName,
      notes: d.notes ?? null,
      sourcingRef: d.sourcingRef?.trim() || null,
      totalValue,
      status: 'RECEIVED',
      lines: { create: lines },
    },
  });

  await db.auditLogEntry.create({
    data: {
      entity: 'CustomerPO',
      entityId: po.id,
      action: 'CREATE',
      actorLabel: 'Akash Dwivedi',
      afterValue: po.poNumber,
    },
  });

  safeRevalidate('/create-po');
  safeRevalidate('/orders');
  return {
    ok: true,
    id: po.id,
    customerPoId: po.id,
    message: `Customer PO ${po.poNumber} recorded with ${lines.length} line${lines.length === 1 ? '' : 's'}.`,
  };
}

// ── Create supplier PO (and, when linked, the work order) ────────────────────

export async function createSupplierPo(input: unknown): Promise<ActionResult> {
  const parsed = supplierPoSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Some details need fixing before this can be issued.',
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const d = parsed.data;

  // AVL gate (AC#3): only approved, unexpired vendors may be used.
  const supplier = await db.supplier.findUnique({
    where: { id: d.supplierId },
    include: { avl: true },
  });
  if (!supplier) return { ok: false, error: 'That supplier no longer exists.' };
  if (!supplier.avl || supplier.avl.status !== 'APPROVED') {
    return {
      ok: false,
      error: `${supplier.name} is not an approved vendor (status: ${supplier.avl?.status ?? 'not on the AVL'}). A purchase order cannot be raised on them.`,
    };
  }
  if (supplier.avl.approvedUpto < new Date()) {
    return {
      ok: false,
      error: `${supplier.name}'s AVL approval expired on ${supplier.avl.approvedUpto.toLocaleDateString('en-IN')}. Re-approve the vendor before raising a PO.`,
    };
  }

  const org = await db.orgSetting.findFirst();
  const poNumber = d.poNumber?.trim() || (await nextDocNumber('SUPPLIER_PO'));

  const supplierLines = d.lines.map((l, i) => ({
    lineNo: i + 1,
    mpn: l.mpn,
    manufacturer: l.manufacturer,
    description: l.description,
    hsnCode: l.hsnCode,
    quantity: l.quantity,
    uom: l.uom,
    unitPrice: l.unitPrice,
    lineTotal: toMinor(l.quantity * l.unitPrice, d.currency),
    leadTimeDays: l.leadTimeDays ?? null,
    countryOfOrigin: l.countryOfOrigin ?? null,
    dateCodeLot: l.dateCodeLot ?? null,
    msl: l.msl ?? null,
    packaging: l.packaging ?? null,
    testingRequired: l.testingRequired,
    testScope: l.testScope ?? null,
    sampleSize: l.sampleSize ?? null,
    aql: l.aql ?? null,
    remarks: l.remarks ?? null,
  }));
  const buyTotal = supplierLines.reduce((a, l) => a + l.lineTotal, 0);

  const shipTo = org
    ? `${org.legalName}\n${org.shipAddressLine1 ?? org.addressLine1}\n${org.shipCity ?? org.city} ${org.shipPincode ?? org.pincode}, ${org.country}\nGSTIN ${org.gstin}`
    : '1BUY warehouse';

  const supplierPo = await db.supplierPO.create({
    data: {
      poNumber,
      supplierId: d.supplierId,
      poDate: new Date(d.poDate),
      currency: d.currency,
      fxRate: d.fxRate,
      incoterms: d.incoterms,
      paymentMethod: d.paymentMethod,
      creditDays: d.paymentMethod === 'CREDIT' ? (d.creditDays ?? 30) : null,
      shipToAddress: shipTo,
      requiredDeliveryDate: d.requiredDeliveryDate ? new Date(d.requiredDeliveryDate) : null,
      notes: d.notes ?? null,
      sourcingRef: d.sourcingRef?.trim() || null,
      totalValue: buyTotal,
      status: 'ISSUED',
      issuedAt: new Date(),
      lines: { create: supplierLines },
    },
    include: { lines: { orderBy: { lineNo: 'asc' } } },
  });

  await db.auditLogEntry.create({
    data: {
      entity: 'SupplierPO',
      entityId: supplierPo.id,
      action: 'CREATE',
      actorLabel: 'Akash Dwivedi',
      afterValue: poNumber,
    },
  });

  // ── Not linked: the PO stands alone, no work order ────────────────────────
  if (!d.link) {
    safeRevalidate('/create-po');
    safeRevalidate('/orders');
    return {
      ok: true,
      id: supplierPo.id,
      supplierPoId: supplierPo.id,
      message: `Supplier PO ${poNumber} issued. It is not linked to a customer PO, so no work order was created.`,
    };
  }

  // ── Linked: create the work order ─────────────────────────────────────────
  const customerPo = await db.customerPO.findUnique({
    where: { id: d.link.customerPoId },
    include: { lines: true, customer: true, proformas: true },
  });
  if (!customerPo) return { ok: false, error: 'That customer PO no longer exists.' };

  const customerPi =
    (d.link.customerPiId
      ? customerPo.proformas.find((p) => p.id === d.link!.customerPiId)
      : undefined) ?? customerPo.proformas.find((p) => p.direction === 'CUSTOMER_PI');

  // Carry the sourcing reference across the link when the supplier order did not
  // state its own. This is the whole point of the field: the same RFQ should be
  // traceable from the customer's demand through to the order we placed.
  if (!d.sourcingRef?.trim() && customerPo.sourcingRef) {
    await db.supplierPO.update({
      where: { id: supplierPo.id },
      data: { sourcingRef: customerPo.sourcingRef },
    });
  }

  const custPiSegment = customerPi?.piNumber ?? 'PI-PENDING';
  const provisionalName = `${customerPo.poNumber}_${custPiSegment}_${poNumber}_SPI-PENDING`;
  const alias = await nextDocNumber('WORK_ORDER').then((n) => `WO-2026-${n.split('-').pop()}`);

  // Sell / buy values from the mappings actually made.
  let sellValue = 0;
  const mappingRows: {
    customerPoLineId: string;
    supplierPoLineId: string;
    allocatedQty: number;
    sellUnitPrice: number;
    buyUnitPrice: number;
  }[] = [];

  for (const m of d.link.mappings) {
    const cl = customerPo.lines.find((l) => l.id === m.customerPoLineId);
    const sl = supplierPo.lines[m.supplierLineIndex];
    if (!cl || !sl) continue;
    sellValue += toMinor(m.allocatedQty * cl.unitPrice, customerPo.currency);
    mappingRows.push({
      customerPoLineId: cl.id,
      supplierPoLineId: sl.id,
      allocatedQty: m.allocatedQty,
      sellUnitPrice: cl.unitPrice,
      buyUnitPrice: sl.unitPrice,
    });
  }
  if (mappingRows.length === 0) {
    return { ok: false, error: 'None of the line mappings could be resolved. Check the allocations.' };
  }

  const buyValueInr = toMinor(
    mappingRows.reduce((a, m) => a + m.allocatedQty * m.buyUnitPrice, 0) * d.fxRate,
    'INR',
  );

  const anyTesting = supplierLines.some((l) => l.testingRequired);
  const testScope = supplierLines.find((l) => l.testScope)?.testScope ?? null;
  const stage = getStage('SUPPLIER_PO_ISSUED');

  const workOrder = await db.workOrder.create({
    data: {
      canonicalName: provisionalName,
      alias,
      provisionalName,
      nameLocked: false,
      customerPoId: customerPo.id,
      customerPiId: customerPi?.id ?? null,
      supplierPoId: supplierPo.id,
      stage: stage.id,
      phase: stage.phase,
      status: 'ACTIVE',
      stageEnteredAt: new Date(),
      paymentMethod: d.paymentMethod,
      creditDays: d.paymentMethod === 'CREDIT' ? (d.creditDays ?? 30) : null,
      testingRequired: anyTesting,
      testScope,
      incoterms: d.incoterms,
      buyCurrency: d.currency,
      sellCurrency: customerPo.currency,
      fxRate: d.fxRate,
      sellValue,
      buyValue: buyValueInr,
      mappings: { create: mappingRows },
    },
  });

  /*
   * Stage history in the order these things actually happen.
   *
   * The supplier is confirmed and our purchase order issued BEFORE the sales
   * order goes to the customer — supply is secured before a price is committed
   * to. The customer-facing steps are therefore appended after, not threaded
   * through the middle, and they only appear once that paperwork exists.
   */
  const path = [
    'CUSTOMER_PO_RECEIVED',
    'SUPPLIER_SELECTED_FROM_AVL',
    'SUPPLIER_PO_ISSUED',
    ...(customerPi ? ['PI_ISSUED_TO_CUSTOMER'] : []),
    ...(customerPi?.status === 'ACCEPTED' ? ['PI_ACCEPTED_BY_CUSTOMER'] : []),
  ];
  let prev: string | null = null;
  for (const stageId of path) {
    await db.stageTransition.create({
      data: {
        workOrderId: workOrder.id,
        fromStage: prev,
        toStage: stageId,
        actorLabel: 'Akash Dwivedi',
        provenance: 'MANUAL',
      },
    });
    await db.communication.create({
      data: {
        workOrderId: workOrder.id,
        entryClass: 'SYSTEM',
        channel: 'SYSTEM',
        direction: 'INTERNAL',
        subject: `Stage advanced to ${getStage(stageId).label}`,
        body: `${getStage(stageId).description} Recorded by Akash Dwivedi.`,
        status: 'CLOSED',
        occurredAt: new Date(),
        systemIcon: 'Activity',
        contextChips: {
          create: [
            { kind: 'STAGE', refId: stageId, label: `${getStage(stageId).code} · ${getStage(stageId).label}` },
          ],
        },
      },
    });
    prev = stageId;
  }

  await db.auditLogEntry.create({
    data: {
      workOrderId: workOrder.id,
      entity: 'WorkOrder',
      entityId: workOrder.id,
      action: 'CREATE',
      actorLabel: 'Akash Dwivedi',
      afterValue: provisionalName,
    },
  });

  // Coverage: does this PO fully cover the customer's order?
  const orderedQty = customerPo.lines.reduce((a, l) => a + l.quantity, 0);
  const allExisting = await db.pOLinkMapping.findMany({
    where: { customerPoLine: { customerPoId: customerPo.id } },
    select: { allocatedQty: true },
  });
  const coveredQty = allExisting.reduce((a, m) => a + m.allocatedQty, 0);
  await db.customerPO.update({
    where: { id: customerPo.id },
    data: { status: coveredQty >= orderedQty ? 'FULLY_LINKED' : 'PARTIALLY_LINKED' },
  });

  await db.task.create({
    data: {
      workOrderId: workOrder.id,
      title: stage.nextAction,
      ownerRole: stage.nextActionOwner,
      linkedStage: stage.id,
      priority: 'NORMAL',
      dueAt: new Date(Date.now() + stage.expectedHours * 3600_000),
      status: 'OPEN',
    },
  });

  safeRevalidate('/create-po');
  safeRevalidate('/orders');
  safeRevalidate('/dashboard');

  return {
    ok: true,
    id: workOrder.id,
    supplierPoId: supplierPo.id,
    canonicalName: provisionalName,
    alias,
    message: `Work order ${alias} created and linked to ${customerPo.poNumber}.`,
  };
}
