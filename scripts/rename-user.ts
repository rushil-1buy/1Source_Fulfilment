import { PrismaClient } from '@/lib/generated/prisma';
const db = new PrismaClient();
const swap = (v: string | null) =>
  v ? v.split('Priya Nair').join('Akash Dwivedi').split('priya.nair@1buy.ai').join('akash.dwivedi@1buy.ai').split('Priya,').join('Akash,') : v;
async function main() {
  await db.user.updateMany({
    where: { email: 'priya.nair@1buy.ai' },
    data: { name: 'Akash Dwivedi', email: 'akash.dwivedi@1buy.ai', initials: 'AD' },
  });
  let n = 1;
  for (const t of await db.stageTransition.findMany()) {
    const f = swap(t.actorLabel);
    if (f !== t.actorLabel) { await db.stageTransition.update({ where: { id: t.id }, data: { actorLabel: f! } }); n++; }
  }
  for (const a of await db.auditLogEntry.findMany()) {
    const f = swap(a.actorLabel);
    if (f !== a.actorLabel) { await db.auditLogEntry.update({ where: { id: a.id }, data: { actorLabel: f! } }); n++; }
  }
  for (const c of await db.communication.findMany()) {
    const s = swap(c.subject), b = swap(c.body);
    if (s !== c.subject || b !== c.body) { await db.communication.update({ where: { id: c.id }, data: { subject: s!, body: b! } }); n++; }
  }
  for (const p of await db.communicationParticipant.findMany()) {
    const nm = swap(p.name), em = swap(p.email);
    if (nm !== p.name || em !== p.email) { await db.communicationParticipant.update({ where: { id: p.id }, data: { name: nm!, email: em } }); n++; }
  }
  for (const e of await db.escrowTransaction.findMany()) {
    const a = swap(e.provenanceActor);
    if (a !== e.provenanceActor) { await db.escrowTransaction.update({ where: { id: e.id }, data: { provenanceActor: a } }); n++; }
  }
  for (const d of await db.document.findMany()) {
    const u = swap(d.uploadedBy);
    if (u !== d.uploadedBy) { await db.document.update({ where: { id: d.id }, data: { uploadedBy: u! } }); n++; }
  }
  for (const t of await db.testRequest.findMany()) {
    const a = swap(t.provenanceActor);
    if (a !== t.provenanceActor) { await db.testRequest.update({ where: { id: t.id }, data: { provenanceActor: a } }); n++; }
  }
  for (const s of await db.shipment.findMany()) {
    const a = swap(s.provenanceActor);
    if (a !== s.provenanceActor) { await db.shipment.update({ where: { id: s.id }, data: { provenanceActor: a } }); n++; }
  }
  console.log('updated', n, 'records');
  await db.$disconnect();
}
main();
