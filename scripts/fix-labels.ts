import { PrismaClient } from '@/lib/generated/prisma';
const db = new PrismaClient();
const MAP: [string, string][] = [
  ['WHL status sync', 'Testing Laboratory status sync'],
  ['ICEGATE status sync', 'Indian Customs status sync'],
  ['DHL tracking sync', 'Logistics tracking sync'],
  ['Escrow provider webhook', 'Escrow provider notification'],
  ['at WHL', 'at the testing laboratory'],
  ['to WHL', 'to the testing laboratory'],
  ['WHL Bengaluru', 'Testing Laboratory, Bengaluru'],
  ['WHL intake', 'testing laboratory intake'],
  ['Technical Manager, WHL', 'Technical Manager, Testing Laboratory'],
  ['WHL/', 'LAB/'],
];
function fix(v: string | null): string | null {
  if (!v) return v;
  let out = v;
  for (const [a, b] of MAP) out = out.split(a).join(b);
  return out;
}
async function main() {
  let n = 0;
  for (const t of await db.stageTransition.findMany()) {
    const f = fix(t.actorLabel);
    if (f !== t.actorLabel) { await db.stageTransition.update({ where: { id: t.id }, data: { actorLabel: f! } }); n++; }
  }
  for (const a of await db.auditLogEntry.findMany()) {
    const f = fix(a.actorLabel);
    if (f !== a.actorLabel) { await db.auditLogEntry.update({ where: { id: a.id }, data: { actorLabel: f! } }); n++; }
  }
  for (const c of await db.communication.findMany()) {
    const s = fix(c.subject), b = fix(c.body);
    if (s !== c.subject || b !== c.body) { await db.communication.update({ where: { id: c.id }, data: { subject: s!, body: b! } }); n++; }
  }
  for (const s of await db.shipment.findMany()) {
    const o = fix(s.originName), d = fix(s.destName);
    if (o !== s.originName || d !== s.destName) { await db.shipment.update({ where: { id: s.id }, data: { originName: o!, destName: d! } }); n++; }
  }
  for (const e of await db.trackingEvent.findMany()) {
    const d = fix(e.description), l = fix(e.location);
    if (d !== e.description || l !== e.location) { await db.trackingEvent.update({ where: { id: e.id }, data: { description: d!, location: l ?? undefined } }); n++; }
  }
  for (const r of await db.testResult.findMany()) {
    const sb = fix(r.signedBy);
    if (sb !== r.signedBy) { await db.testResult.update({ where: { id: r.id }, data: { signedBy: sb! } }); n++; }
  }
  console.log(`updated ${n} rows`);
  await db.$disconnect();
}
main();
