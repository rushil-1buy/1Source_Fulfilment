import { PrismaClient } from '@/lib/generated/prisma';
const db = new PrismaClient();
async function main() {
  // Restore a sane demo state
  await db.integrationConnector.updateMany({ data: { mode: 'MOCK', forceFailure: false } });
  console.log('=== Connectors (restored to Mock) ===');
  for (const c of await db.integrationConnector.findMany({ orderBy: { id: 'asc' } })) {
    console.log(`${c.id.padEnd(9)} ${c.mode.padEnd(7)} vendor=${(c.vendorStatus).padEnd(14)} creds=${c.credentialsOk} lastOk=${c.lastSuccessAt ? 'yes' : 'no'} lastFail=${c.lastFailureAt ? 'yes' : 'no'}`);
  }
  console.log('\n=== Call log (proves every attempt is recorded) ===');
  const calls = await db.integrationCallLog.findMany({ orderBy: { createdAt: 'asc' } });
  for (const l of calls) {
    console.log([
      l.connectorId.padEnd(8),
      l.operation.padEnd(16),
      (l.ok ? 'OK ' : 'ERR'),
      `status=${String(l.statusCode ?? '-').padEnd(4)}`,
      `attempt=${l.attempt}`,
      `${String(l.latencyMs).padStart(4)}ms`,
      `mode=${l.mode.padEnd(6)}`,
      `corr=${l.correlationId}`,
      l.workOrderId ? `wo=${l.workOrderId.slice(0,8)}` : 'wo=none',
    ].join(' '));
    if (!l.ok) console.log('         └─', l.errorMessage);
  }
  console.log('\ntotal logged calls:', calls.length);
  console.log('retry attempts on one operation:', calls.filter(c => c.operation === 'track').map(c => c.attempt).join(','));
  await db.$disconnect();
}
main();
