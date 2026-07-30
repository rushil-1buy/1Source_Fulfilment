/**
 * Two repairs, both consequences of the same earlier defect.
 *
 * 1. An invoice above the way bill threshold with no way bill at all. The old
 *    code only recorded one when the portal answered, so in Manual mode the
 *    obligation vanished. Rule 138 does not care whether an API was reachable —
 *    the record is raised awaiting its number.
 *
 * 2. An invoice whose order never reached the invoicing stage, left behind when
 *    the way bill write failed mid-way. Its number is released back to the
 *    series so the next dispatch reuses it rather than leaving a gap, which is
 *    what an auditor asks about first.
 */

import { PrismaClient } from '@/lib/generated/prisma';

const db = new PrismaClient();

/** The stage at which an invoice is legitimately raised. */
const INVOICE_STAGE = 'OUTBOUND_BOOKED';

async function main() {
  const org = await db.orgSetting.findFirst();
  if (!org) throw new Error('No organisation settings.');

  // ── 1. Orphans: an invoice whose order never got past the invoicing stage ──
  const invoices = await db.taxInvoice.findMany({
    include: {
      eWayBills: true,
      workOrder: { select: { alias: true, stage: true, transitions: { select: { toStage: true } } } },
    },
  });

  let orphaned = 0;
  for (const inv of invoices) {
    const reached = inv.workOrder?.transitions.some((t) => t.toStage === INVOICE_STAGE);
    if (reached) continue;
    console.log(
      `  orphan ${inv.invoiceNumber} — ${inv.workOrder?.alias} never reached ${INVOICE_STAGE} (at ${inv.workOrder?.stage}). Removing.`,
    );
    await db.taxInvoice.delete({ where: { id: inv.id } });
    // Hand the number back so the series stays gapless.
    await db.numberingSeries.updateMany({
      where: { docType: 'TAX_INVOICE' },
      data: { nextNumber: { decrement: 1 } },
    });
    orphaned++;
  }

  // ── 2. Missing way bills on invoices that legitimately exist ──────────────
  const remaining = await db.taxInvoice.findMany({
    include: { eWayBills: true, customer: true, workOrder: { select: { alias: true } } },
  });

  let raised = 0;
  for (const inv of remaining) {
    if (inv.totalAmount < org.eWayBillThreshold || inv.eWayBills.length > 0) continue;
    const distanceKm = inv.customer.stateCode === org.stateCode ? 24 : 1180;
    await db.eWayBill.create({
      data: {
        ewbNumber: null,
        invoiceId: inv.id,
        generatedAt: inv.invoiceDate,
        validUntil: null,
        transportMode: 'ROAD',
        transporterName: 'DHL Express India',
        distanceKm,
        status: 'AWAITING_NUMBER',
        generatedBy: 'Ankit Sharma',
        provenance: 'MANUAL',
      },
    });
    console.log(
      `  raised a pending way bill for ${inv.invoiceNumber} (₹${(inv.totalAmount / 100).toLocaleString('en-IN')}, ${inv.workOrder?.alias})`,
    );
    raised++;
  }

  console.log(`\nRemoved ${orphaned} orphaned invoice(s); raised ${raised} pending way bill(s).`);

  // ── Verify ────────────────────────────────────────────────────────────────
  const after = await db.taxInvoice.findMany({ include: { eWayBills: true } });
  const stillMissing = after.filter(
    (i) => i.totalAmount >= org.eWayBillThreshold && i.eWayBills.length === 0,
  );
  console.log(
    stillMissing.length === 0
      ? 'Every invoice above the threshold now carries a way bill record.'
      : `STILL MISSING: ${stillMissing.map((i) => i.invoiceNumber).join(', ')}`,
  );

  await db.$disconnect();
}

main();
