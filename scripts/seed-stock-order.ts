/**
 * One supplier order bought ahead of demand, with no customer order behind it.
 *
 * Without an unlinked order in the data the "Link to customer order" control has
 * nothing to act on, so the buy-ahead path is invisible. This is demo data — it
 * is a real, valid record, just one nobody has allocated yet.
 */
import { PrismaClient } from '@/lib/generated/prisma';
import { createSupplierPo } from '@/lib/actions/po';
const db = new PrismaClient();

async function main() {
  const existing = await db.supplierPO.findFirst({
    where: { workOrders: { none: {} } },
    include: { supplier: true },
  });
  if (existing) {
    console.log(`Already have an unlinked order: ${existing.poNumber} (${existing.supplier.name})`);
    await db.$disconnect();
    return;
  }

  const sup = await db.supplier.findFirst({ where: { avl: { status: 'APPROVED' } } });
  if (!sup) throw new Error('No approved supplier on the vendor list.');

  const res = await createSupplierPo({
    supplierId: sup.id,
    poDate: new Date().toISOString().slice(0, 10),
    currency: sup.currency,
    fxRate: sup.currency === 'INR' ? 1 : 83.2,
    incoterms: sup.incoterms,
    paymentMethod: 'ADVANCE',
    sourcingRef: 'RFQBUNDLE-STOCK-01',
    notes: 'Stock buy — price held for a week, allocated to a customer order when one lands.',
    lines: [
      { mpn: 'LM358N', manufacturer: 'Texas Instruments', description: 'Dual operational amplifier, PDIP-8',
        hsnCode: '85423900', quantity: 12000, uom: 'PCS', unitPrice: 0.25, leadTimeDays: 14,
        dateCodeLot: '2438', testingRequired: false },
      { mpn: 'NE555P', manufacturer: 'Texas Instruments', description: 'Precision timer IC, PDIP-8',
        hsnCode: '85423900', quantity: 6000, uom: 'PCS', unitPrice: 0.11, leadTimeDays: 14,
        dateCodeLot: '2437', testingRequired: false },
    ],
    link: null,
  });
  console.log(res.ok ? res.message : `FAILED: ${res.error}`);
  if (res.ok) {
    const n = await db.supplierPO.count({ where: { workOrders: { none: {} } } });
    console.log(`Unlinked supplier orders now: ${n}`);
  }
  await db.$disconnect();
}
main();
