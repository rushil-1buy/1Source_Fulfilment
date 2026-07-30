import { db } from '@/lib/db';
import { ConnectorHealth, type ConnectorView } from './ConnectorHealth';

export const metadata = { title: 'Integrations' };

export default async function IntegrationsPage() {
  const connectors = await db.integrationConnector.findMany({
    orderBy: { id: 'asc' },
    include: {
      calls: { orderBy: { createdAt: 'desc' }, take: 12 },
    },
  });

  const views: ConnectorView[] = await Promise.all(
    connectors.map(async (c) => {
      const [total, ok, agg] = await Promise.all([
        db.integrationCallLog.count({ where: { connectorId: c.id } }),
        db.integrationCallLog.count({ where: { connectorId: c.id, ok: true } }),
        db.integrationCallLog.aggregate({
          where: { connectorId: c.id },
          _avg: { latencyMs: true },
        }),
      ]);
      return {
        id: c.id,
        label: c.label,
        mode: c.mode,
        vendorName: c.vendorName,
        vendorStatus: c.vendorStatus,
        syncSeconds: c.syncSeconds,
        credentialsOk: c.credentialsOk,
        lastSuccessAt: c.lastSuccessAt ? c.lastSuccessAt.toISOString() : null,
        lastFailureAt: c.lastFailureAt ? c.lastFailureAt.toISOString() : null,
        lastFailureMsg: c.lastFailureMsg,
        forceFailure: c.forceFailure,
        stats: {
          total,
          ok,
          failed: total - ok,
          avgLatencyMs: Math.round(agg._avg.latencyMs ?? 0),
        },
        recentCalls: c.calls.map((call) => ({
          id: call.id,
          operation: call.operation,
          ok: call.ok,
          statusCode: call.statusCode,
          errorMessage: call.errorMessage,
          latencyMs: call.latencyMs,
          attempt: call.attempt,
          mode: call.mode,
          correlationId: call.correlationId,
          createdAt: call.createdAt.toISOString(),
        })),
      };
    }),
  );

  return <ConnectorHealth connectors={views} />;
}
