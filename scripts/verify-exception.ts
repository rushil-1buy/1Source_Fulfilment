import { PrismaClient } from '@/lib/generated/prisma';
const db = new PrismaClient();
async function main() {
  const wo = await db.workOrder.findFirst({
    where: { alias: 'WO-2026-0106' },
    include: {
      exceptions: true,
      transitions: { orderBy: { createdAt: 'desc' }, take: 2 },
      communications: { orderBy: { occurredAt: 'desc' }, take: 2, include: { contextChips: true } },
      tasks: { orderBy: { createdAt: 'desc' }, take: 2 },
      auditEntries: { orderBy: { createdAt: 'desc' }, take: 2 },
    },
  });
  if (!wo) return;
  console.log('=== Order state after choosing a resolution route ===');
  console.log('stage        ', wo.stage, '| phase', wo.phase, '| status', wo.status);
  console.log('\n=== Exception ===');
  for (const e of wo.exceptions) {
    console.log(`${e.type}  status=${e.status}`);
    console.log('  chosenRoute :', e.chosenRoute);
    console.log('  resolution  :', e.resolutionNote);
    console.log('  resolvedAt  :', e.resolvedAt?.toISOString() ?? 'not resolved');
  }
  console.log('\n=== Latest stage transitions ===');
  for (const t of wo.transitions) console.log(` ${t.fromStage ?? '-'} -> ${t.toStage}  by ${t.actorLabel}  reason: ${t.reason ?? '-'}`);
  console.log('\n=== Latest communication entries (the decision log) ===');
  for (const c of wo.communications) {
    console.log(` [${c.entryClass}] ${c.subject}`);
    console.log(`   ${c.body.split('\n')[0]}`);
    console.log(`   chips: ${c.contextChips.map(x => `${x.kind}:${x.label}`).join(', ')}`);
  }
  console.log('\n=== Tasks ===');
  for (const t of wo.tasks) console.log(` ${t.status.padEnd(5)} ${t.title}`);
  console.log('\n=== Audit ===');
  for (const a of wo.auditEntries) console.log(` ${a.action} ${a.field ?? ''}: ${a.beforeValue ?? ''} -> ${a.afterValue ?? ''} by ${a.actorLabel}`);
  await db.$disconnect();
}
main();
