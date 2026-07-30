import { PrismaClient } from '@/lib/generated/prisma';
const db = new PrismaClient();
async function main() {
  const wo = await db.workOrder.findFirst({
    orderBy: { createdAt: 'desc' },
    include: {
      customerPo: { select: { poNumber: true, status: true } },
      supplierPo: { select: { poNumber: true, status: true, currency: true, totalValue: true } },
      mappings: { include: { customerPoLine: { select: { mpn: true, quantity: true } } } },
      transitions: { orderBy: { createdAt: 'asc' }, select: { toStage: true } },
      communications: { select: { entryClass: true } },
      tasks: { select: { title: true, ownerRole: true } },
      auditEntries: { select: { action: true, afterValue: true } },
    },
  });
  if (!wo) { console.log('none'); return; }
  console.log('=== Newest work order (created through the UI) ===');
  console.log('alias           ', wo.alias);
  console.log('canonicalName   ', wo.canonicalName);
  console.log('nameLocked      ', wo.nameLocked, '(false = SPI still pending, as expected)');
  console.log('stage / phase   ', wo.stage, '/', wo.phase);
  console.log('status          ', wo.status);
  console.log('paymentMethod   ', wo.paymentMethod, '| testingRequired', wo.testingRequired);
  console.log('sellValue       ', '₹' + (wo.sellValue / 100).toLocaleString('en-IN'));
  console.log('buyValue (INR)  ', '₹' + (wo.buyValue / 100).toLocaleString('en-IN'));
  console.log('margin          ', (((wo.sellValue - wo.buyValue) / wo.sellValue) * 100).toFixed(2) + '%');
  console.log('customer PO     ', wo.customerPo.poNumber, '→ status now', wo.customerPo.status);
  console.log('supplier PO     ', wo.supplierPo.poNumber, wo.supplierPo.status, wo.supplierPo.currency, wo.supplierPo.totalValue / 100);
  console.log('mappings        ', wo.mappings.map(m => `${m.customerPoLine.mpn} ${m.allocatedQty}/${m.customerPoLine.quantity} @sell ${m.sellUnitPrice} @buy ${m.buyUnitPrice}`).join(' | '));
  console.log('transitions     ', wo.transitions.map(t => t.toStage).join(' → '));
  console.log('communications  ', wo.communications.length, '(all system events)');
  console.log('tasks           ', wo.tasks.map(t => `${t.title} [${t.ownerRole}]`).join(' | '));
  console.log('audit           ', wo.auditEntries.map(a => `${a.action}:${a.afterValue ?? ''}`).join(' | '));
  console.log('\ntotal work orders now:', await db.workOrder.count());
  await db.$disconnect();
}
main();
