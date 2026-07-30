import { PrismaClient } from '@/lib/generated/prisma';
const db = new PrismaClient();
async function main() {
  await db.integrationConnector.updateMany({ data: { mode: 'MANUAL' } });
  const c = await db.integrationConnector.findMany({ select: { id: true, mode: true } });
  console.log('Connectors:', c.map(x => `${x.id}=${x.mode}`).join(' '));
  const wo = await db.workOrder.findFirst({ where: { alias: 'WO-2026-0113' }, select: { alias: true, stage: true, paymentMethod: true, testingRequired: true, status: true } });
  console.log('Start point:', wo);
  await db.$disconnect();
}
main();
