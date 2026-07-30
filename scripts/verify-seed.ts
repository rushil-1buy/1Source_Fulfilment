import { PrismaClient } from '@/lib/generated/prisma';
const db = new PrismaClient();
async function main() {
  const inv = await db.taxInvoice.findMany({ include: { customer: true, eWayBills: true } });
  console.log('=== Tax invoices: all three GST treatments ===');
  for (const i of inv) {
    console.log([
      i.invoiceNumber,
      i.customer.name.slice(0, 24).padEnd(24),
      `POS ${i.placeOfSupply}`,
      i.taxTreatment.padEnd(18),
      `CGST ${(i.cgstAmount / 100).toFixed(2).padStart(10)}`,
      `SGST ${(i.sgstAmount / 100).toFixed(2).padStart(10)}`,
      `IGST ${(i.igstAmount / 100).toFixed(2).padStart(10)}`,
      `total ${(i.totalAmount / 100).toFixed(2).padStart(12)}`,
      i.irn ? 'IRN✓' : 'IRN—',
      i.eWayBills.length ? 'EWB✓' : 'EWB—',
    ].join(' | '));
  }
  const per = await db.taxPeriodSummary.findMany({ orderBy: { taxPeriod: 'asc' } });
  console.log('\n=== Tax period summaries (GSTR working sheets) ===');
  for (const p of per) {
    console.log(`${p.taxPeriod}  output ₹${(p.outputCgst + p.outputSgst + p.outputIgst) / 100}  itc ₹${(p.itcCgst + p.itcSgst + p.itcIgst) / 100}  rcm ₹${p.rcmLiability / 100}  net payable ₹${p.netPayable / 100}  invoices ${p.invoiceCount}`);
  }
  const wo = await db.workOrder.findMany({ select: { alias: true, canonicalName: true, stage: true, status: true, nameLocked: true } , orderBy: { alias: 'asc' }});
  console.log('\n=== Work orders ===');
  for (const w of wo) console.log(`${w.alias}  ${w.stage.padEnd(38)} ${w.status.padEnd(8)} ${w.nameLocked ? 'locked' : 'PROVISIONAL'}  ${w.canonicalName}`);
  const open = await db.customerPO.findMany({ where: { workOrders: { none: {} } }, select: { poNumber: true, status: true, totalValue: true } });
  console.log('\n=== Unsourced customer POs (available to link) ===');
  for (const c of open) console.log(`${c.poNumber}  ${c.status}  ₹${c.totalValue / 100}`);
  const rcm = await db.reverseChargeSelfInvoice.count();
  console.log(`\nReverse-charge self-invoices: ${rcm}`);
  await db.$disconnect();
}
main();
