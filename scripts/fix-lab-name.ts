import { PrismaClient } from '@/lib/generated/prisma';
const db = new PrismaClient();
async function main() {
  await db.testingLab.updateMany({ where: { code: 'WHL-BLR' }, data: { code: 'LAB-BLR', name: 'Independent Test Laboratory, Bengaluru', contactEmail: 'intake.blr@testlab-blr.in' } });
  await db.testingLab.updateMany({ where: { code: 'WHL-SZX' }, data: { code: 'LAB-SZX', name: 'Independent Test Laboratory, Shenzhen', contactEmail: 'intake@testlab-szx.cn' } });
  await db.integrationConnector.update({ where: { id: 'WHL' }, data: { label: 'Testing Laboratory' } });
  await db.integrationConnector.update({ where: { id: 'DHL' }, data: { label: 'DHL Express (logistics partner)' } });
  await db.integrationConnector.update({ where: { id: 'ICEGATE' }, data: { label: 'Indian Customs (ICEGATE portal)' } });
  await db.integrationConnector.update({ where: { id: 'GST_GSP' }, data: { label: 'Goods and Services Tax — electronic invoice and way bill' } });
  let n = 0;
  for (const c of await db.communication.findMany()) {
    const b = c.body.split('WHL').join('the testing laboratory');
    const s = c.subject.split('WHL').join('the testing laboratory');
    if (b !== c.body || s !== c.subject) { await db.communication.update({ where: { id: c.id }, data: { body: b, subject: s } }); n++; }
  }
  for (const t of await db.testRequest.findMany()) {
    if (t.labRequestRef?.includes('WHL')) {
      await db.testRequest.update({ where: { id: t.id }, data: { labRequestRef: t.labRequestRef.replace('WHL/', 'LAB/'), provenanceRef: t.provenanceRef?.replace('WHL/', 'LAB/') ?? null } }); n++;
    }
  }
  for (const r of await db.testResult.findMany()) {
    if (r.reportNo.includes('WHL')) { await db.testResult.update({ where: { id: r.id }, data: { reportNo: r.reportNo.replace('WHL-RPT', 'LAB-RPT'), provenanceRef: r.provenanceRef?.replace('WHL-RPT','LAB-RPT') ?? null } }); n++; }
  }
  for (const d of await db.document.findMany()) {
    if (d.title.includes('WHL') || d.fileName.includes('WHL') || (d.bodyText ?? '').includes('WHL')) {
      await db.document.update({ where: { id: d.id }, data: {
        title: d.title.split('WHL').join('Laboratory'),
        fileName: d.fileName.split('WHL').join('LAB'),
        bodyText: (d.bodyText ?? '').split('WHL').join('Laboratory') || null,
      }}); n++;
    }
  }
  console.log('updated', n, 'rows');
  await db.$disconnect();
}
main();
