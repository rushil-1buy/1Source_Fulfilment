'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { CONNECTOR_IDS, CONNECTOR_MODES, type ConnectorId, type ConnectorMode } from '@/lib/domain/enums';
import { dhlTrack, escrowGetBalance, gspValidateGstin, icegateGetBoeStatus, whlGetTestResult } from '@/lib/integrations/adapters';

export interface ConnectorActionResult {
  ok: boolean;
  message: string;
  detail?: string;
}

export async function setConnectorMode(
  connectorId: string,
  mode: string,
): Promise<ConnectorActionResult> {
  if (!CONNECTOR_IDS.includes(connectorId as ConnectorId)) {
    return { ok: false, message: 'Unknown connector.' };
  }
  if (!CONNECTOR_MODES.includes(mode as ConnectorMode)) {
    return { ok: false, message: 'Unknown mode.' };
  }

  const connector = await db.integrationConnector.findUnique({ where: { id: connectorId } });
  if (!connector) return { ok: false, message: 'Connector not found.' };

  // Live/Sandbox need credentials we do not have in this MVP. Refuse clearly
  // rather than letting an operator believe automation is on.
  if ((mode === 'LIVE' || mode === 'SANDBOX') && !connector.credentialsOk) {
    return {
      ok: false,
      message: `${connector.label} has no credentials, so ${mode.toLowerCase()} mode cannot be enabled.`,
      detail:
        'Supply credentials via environment variables first. Until then use Mock to simulate, or Manual to enter everything by hand.',
    };
  }

  await db.integrationConnector.update({
    where: { id: connectorId },
    data: { mode },
  });

  await db.auditLogEntry.create({
    data: {
      entity: 'IntegrationConnector',
      entityId: connectorId,
      action: 'UPDATE',
      field: 'mode',
      beforeValue: connector.mode,
      afterValue: mode,
      actorLabel: 'Rushil Kohli',
    },
  });

  revalidatePath('/settings/integrations');
  return {
    ok: true,
    message: `${connector.label} switched to ${mode.toLowerCase()} mode.`,
    detail:
      mode === 'MANUAL'
        ? 'Nothing is automated now — every value on this connector is entered by a person.'
        : undefined,
  };
}

/** Drives the AC#28 resilience demonstration. */
export async function setForceFailure(
  connectorId: string,
  on: boolean,
): Promise<ConnectorActionResult> {
  const connector = await db.integrationConnector.findUnique({ where: { id: connectorId } });
  if (!connector) return { ok: false, message: 'Connector not found.' };

  await db.integrationConnector.update({
    where: { id: connectorId },
    data: { forceFailure: on },
  });
  revalidatePath('/settings/integrations');
  return {
    ok: true,
    message: on
      ? `${connector.label} will now fail every call, so you can see the fallback behaviour.`
      : `${connector.label} is back to normal.`,
  };
}

/**
 * Exercises a real read operation through the full runtime — retry, logging and
 * provenance included — so "Test connection" proves the actual path rather than
 * just pinging. `workOrderId: ''` marks a call that belongs to no order.
 */
export async function testConnection(connectorId: string): Promise<ConnectorActionResult> {
  const connector = await db.integrationConnector.findUnique({ where: { id: connectorId } });
  if (!connector) return { ok: false, message: 'Connector not found.' };

  const outcome = await (async () => {
    switch (connectorId as ConnectorId) {
      case 'WHL':
        return whlGetTestResult({
          workOrderId: '',
          labRequestRef: 'CONNECTION-TEST',
          lines: [{ mpn: 'TEST-PART', quantity: 100 }],
          sampleSize: 50,
        });
      case 'DHL':
        return dhlTrack({ workOrderId: '', awb: 'CONNECTION-TEST' });
      case 'ICEGATE':
        return icegateGetBoeStatus({ workOrderId: '', boeNo: 'CONNECTION-TEST' });
      case 'ESCROW':
        return escrowGetBalance({ workOrderId: '', escrowRef: 'CONNECTION-TEST' });
      case 'GST_GSP':
        return gspValidateGstin({ gstin: '07ABLCS4389M1ZG' });
      default:
        return null;
    }
  })();

  revalidatePath('/settings/integrations');

  if (!outcome) return { ok: false, message: 'No test operation defined for this connector.' };

  if (outcome.ok) {
    return {
      ok: true,
      message: `${connector.label} responded successfully in ${outcome.mode.toLowerCase()} mode.`,
      detail: `Data came back marked as ${outcome.provenance}. Correlation id ${outcome.correlationId}.`,
    };
  }
  if (outcome.manual) {
    return {
      ok: true,
      message: `${connector.label} is in ${outcome.mode.toLowerCase()} mode — there is nothing to test.`,
      detail: outcome.reason,
    };
  }
  return {
    ok: false,
    message: `${connector.label} failed after ${outcome.attempts} attempt${outcome.attempts === 1 ? '' : 's'}.`,
    detail: outcome.error,
  };
}

export async function clearConnectorLog(connectorId: string): Promise<ConnectorActionResult> {
  const { count } = await db.integrationCallLog.deleteMany({ where: { connectorId } });
  await db.integrationConnector.update({
    where: { id: connectorId },
    data: { lastFailureMsg: null },
  });
  revalidatePath('/settings/integrations');
  return { ok: true, message: `Cleared ${count} logged call${count === 1 ? '' : 's'}.` };
}

/** Switch every connector at once — the fastest way to prove AC#19. */
export async function setAllConnectorModes(mode: string): Promise<ConnectorActionResult> {
  if (!CONNECTOR_MODES.includes(mode as ConnectorMode)) {
    return { ok: false, message: 'Unknown mode.' };
  }
  if (mode === 'LIVE' || mode === 'SANDBOX') {
    return {
      ok: false,
      message: 'No connector has credentials, so live and sandbox cannot be enabled in bulk.',
    };
  }
  await db.integrationConnector.updateMany({ data: { mode } });
  await db.auditLogEntry.create({
    data: {
      entity: 'IntegrationConnector',
      entityId: 'ALL',
      action: 'UPDATE',
      field: 'mode',
      afterValue: mode,
      actorLabel: 'Rushil Kohli',
    },
  });
  revalidatePath('/settings/integrations');
  return {
    ok: true,
    message: `Every connector switched to ${mode.toLowerCase()} mode.`,
    detail:
      mode === 'MANUAL'
        ? 'The platform is now fully manual. Every order can still be driven end to end by hand.'
        : undefined,
  };
}
