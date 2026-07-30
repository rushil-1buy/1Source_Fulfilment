import { PrismaClient } from '@/lib/generated/prisma';
const db = new PrismaClient();
async function main() {
  const wo = await db.workOrder.findFirst({
    orderBy: { createdAt: 'desc' },
    include: {
      supplierPi: { include: { lines: true } },
      communications: { where: { entryClass: 'HUMAN' }, include: { contextChips: true } },
    },
  });
  if (!wo) return;
  console.log('canonicalName   ', wo.canonicalName);
  console.log('provisionalName ', wo.provisionalName, '(kept searchable)');
  console.log('nameLocked      ', wo.nameLocked);
  console.log('supplierPi      ', wo.supplierPi?.piNumber, '| their ref:', wo.supplierPi?.externalRef, '| status', wo.supplierPi?.status);
  console.log('PI lines        ', wo.supplierPi?.lines.map(l => `${l.mpn} qty ${l.quantity} @ ${l.unitPrice} lead ${l.leadTimeDays ?? '—'}`).join(' | '));
  console.log('\n=== Variance note auto-logged to Communication ===');
  for (const c of wo.communications) {
    console.log('subject :', c.subject);
    console.log('status  :', c.status, '| unread:', c.isUnread, '| visibility:', c.visibility);
    console.log('body    :\n' + c.body.split('\n').map(l => '          ' + l).join('\n'));
    console.log('chips   :', c.contextChips.map(x => `${x.kind}:${x.label}`).join(', '));
  }
  // searchability of the old provisional name
  const found = await db.workOrder.findMany({ where: { provisionalName: { contains: 'SPI-PENDING' } }, select: { alias: true } });
  console.log('\nOrders still findable by their provisional name:', found.map(f => f.alias).join(', ') || 'none');
  await db.$disconnect();
}
main();
