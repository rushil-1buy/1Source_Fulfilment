'use server';

/**
 * The filing agents: sending the escrow instruction, filing it on the
 * partner's portal, and lodging supporting documents on eSanchit.
 *
 * THE ONE RULE, same as everywhere else in this platform: the agent never acts
 * on anything a person has not approved. Both escrow paths refuse a draft —
 * approval is the human decision, filing is clerical execution of it. The
 * eSanchit filing lodges documents that already exist on the order, which is
 * why it has no approval gate of its own: every one of those documents got
 * onto the order through a gate already.
 *
 * WHAT IS SIMULATED AND WHAT IS NOT. No real portal is contacted in this
 * build — the runs come from lib/domain/portal-agents.ts and say so on their
 * face. What is real: the gating, the integration log rows, the audit entries,
 * the communication thread entries, and the acknowledgement references the
 * rest of the flow can quote. Swapping the simulator for a live portal driver
 * changes none of those contracts.
 */

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { slugForTeam, type Stakeholder } from '@/lib/domain/enums';
import { fromMinor } from '@/lib/domain/money';
import {
  activeEscrowPartner,
  eSanchitFilingRun,
  eSanchitUploads,
  escrowFilingRun,
  type AgentRun,
} from '@/lib/domain/portal-agents';
import type { DeliverableValues } from '@/lib/domain/deliverables/types';

export interface FilingResult {
  ok: boolean;
  message: string;
  detail?: string;
  run?: AgentRun;
  /** For the email path: a mailto URL the browser opens in the user's client. */
  mailto?: string;
}

function safeRevalidate(path: string) {
  try {
    revalidatePath(path);
  } catch {
    /* not in a request */
  }
}

function revalidateFor(orderId: string, team: Stakeholder) {
  safeRevalidate(`/orders/${orderId}`);
  const slug = slugForTeam(team);
  if (slug) {
    safeRevalidate(`/teams/${slug}`);
    safeRevalidate(`/teams/${slug}/orders/${orderId}`);
  }
}

/** Connector rows are upserted on use so a fresh database never 500s a filing. */
async function ensureConnector(id: string, label: string, vendorName: string) {
  await db.integrationConnector.upsert({
    where: { id },
    update: {},
    create: { id, label, mode: 'MOCK', vendorName, credentialsOk: true },
  });
}

/** Loads an escrow-release deliverable and refuses anything unapproved. */
async function approvedRelease(deliverableId: string) {
  const row = await db.teamDeliverable.findUnique({
    where: { id: deliverableId },
    include: { workOrder: { select: { id: true, alias: true } } },
  });
  if (!row || row.kind !== 'ESCROW_RELEASE') return { row: null, error: 'That instruction no longer exists.' };
  if (row.status !== 'APPROVED')
    return {
      row: null,
      error: 'Only an approved instruction can leave the building. Approve it first — the agent executes decisions, it does not make them.',
    };
  return { row, error: null };
}

/**
 * Records the instruction as sent to the partner and hands back a mailto URL.
 *
 * There is no mail connector in this build, so the honest mechanics are: file
 * the outbound message on the order (so the thread shows it), then open the
 * user's own mail client pre-filled — the send is theirs. Nothing claims a
 * delivery that did not happen.
 */
export async function emailEscrowInstruction(deliverableId: string): Promise<FilingResult> {
  const { row, error } = await approvedRelease(deliverableId);
  if (!row) return { ok: false, message: error! };

  const partner = activeEscrowPartner();
  const v = JSON.parse(row.values) as DeliverableValues;
  const amount = fromMinor(Number(v.amount ?? 0)).toLocaleString('en-IN');
  const subject = `Release instruction ${row.workOrder.alias} v${row.version} — ${partner.code}`;
  const body = [
    `To ${partner.name},`,
    '',
    `Please action the attached release instruction for ${row.workOrder.alias}.`,
    `Beneficiary: ${String(v.beneficiary ?? '')}`,
    `Amount: INR ${amount}`,
    `Basis: ${String(v.reason ?? '')}`,
    '',
    'Authorised as recorded on the instruction. The signed PDF is attached.',
    '— 1BUY Finance',
  ].join('\n');

  await db.communication.create({
    data: {
      workOrderId: row.workOrder.id,
      entryClass: 'HUMAN',
      channel: 'EMAIL',
      direction: 'OUTBOUND',
      subject,
      body,
      status: 'AWAITING_REPLY',
      occurredAt: new Date(),
      loggedById: 'u-priya',
      participants: {
        create: [
          { role: 'FROM', stakeholder: 'ONE_BUY_FINANCE', name: '1BUY Finance', email: 'finance@1buy.ai' },
          { role: 'TO', stakeholder: 'ESCROW', name: partner.name, email: partner.mailbox },
        ],
      },
      contextChips: { create: [{ kind: 'DOCUMENT', refId: row.id, label: `Release instruction v${row.version}` }] },
    },
  });

  revalidateFor(row.workOrder.id, 'ONE_BUY_FINANCE');
  return {
    ok: true,
    message: `Recorded and opened in your mail client.`,
    detail: `Filed on ${row.workOrder.alias}'s thread as awaiting reply. Attach the instruction PDF before sending — there is no mail connector, so the send itself is yours.`,
    mailto: `mailto:${partner.mailbox}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
  };
}

/**
 * The escrow filing agent: takes the APPROVED instruction to the partner's
 * portal and files it, capturing the acknowledgement reference.
 */
export async function fileEscrowViaAgent(deliverableId: string): Promise<FilingResult> {
  const { row, error } = await approvedRelease(deliverableId);
  if (!row) return { ok: false, message: error! };
  if (row.filedRef) {
    return {
      ok: false,
      message: `Already filed with ${row.filedWith}.`,
      detail: `Reference ${row.filedRef}. Filing twice would open a duplicate release request on the portal.`,
    };
  }

  const partner = activeEscrowPartner();
  const v = JSON.parse(row.values) as DeliverableValues;
  const run = escrowFilingRun({
    partner,
    deliverableId: row.id,
    orderAlias: row.workOrder.alias,
    beneficiary: String(v.beneficiary ?? ''),
    amountLabel: `INR ${fromMinor(Number(v.amount ?? 0)).toLocaleString('en-IN')}`,
  });

  await ensureConnector(partner.code, `${partner.name} portal`, partner.name);
  await db.integrationCallLog.create({
    data: {
      connectorId: partner.code,
      workOrderId: row.workOrder.id,
      operation: 'FILE_RELEASE_INSTRUCTION',
      direction: 'OUTBOUND',
      requestBody: JSON.stringify({ deliverableId: row.id, version: row.version, steps: run.steps }),
      responseBody: JSON.stringify({ acknowledgement: run.reference }),
      statusCode: 200,
      ok: true,
      latencyMs: run.steps[run.steps.length - 1].atMs,
      correlationId: run.reference,
      mode: 'MOCK',
    },
  });

  await db.teamDeliverable.update({
    where: { id: row.id },
    data: { filedWith: partner.code, filedRef: run.reference, filedAt: new Date() },
  });

  await db.auditLogEntry.create({
    data: {
      workOrderId: row.workOrder.id,
      entity: 'TeamDeliverable',
      entityId: row.id,
      action: 'AUTHORISE',
      field: 'ESCROW_RELEASE_FILED',
      afterValue: `Filed with ${partner.code} by the portal agent — ref ${run.reference}`,
      actorId: 'u-priya',
      actorLabel: 'Portal agent (on approval by Akash Dwivedi)',
    },
  });

  await db.communication.create({
    data: {
      workOrderId: row.workOrder.id,
      entryClass: 'SYSTEM',
      channel: 'SYSTEM',
      direction: 'INTERNAL',
      subject: `Release instruction filed with ${partner.name} — ${run.reference}`,
      body: `The portal agent filed the approved release instruction (v${row.version}) on ${partner.portalUrl}. Acknowledgement ${run.reference}. Simulated run — no external portal is contacted in this build.`,
      status: 'CLOSED',
      occurredAt: new Date(),
      systemIcon: 'Bot',
    },
  });

  revalidateFor(row.workOrder.id, 'ONE_BUY_FINANCE');
  return {
    ok: true,
    message: `Filed with ${partner.name}.`,
    detail: `Acknowledgement ${run.reference}. Every step of the run is on the integration log and the order's thread.`,
    run,
  };
}

/**
 * The eSanchit filing: lodges the order's supporting documents with customs,
 * one DRN per document, ahead of the Bill of Entry on ICEGATE.
 */
export async function fileDocsOnESanchit(orderId: string): Promise<FilingResult> {
  const wo = await db.workOrder.findUnique({
    where: { id: orderId },
    include: { documents: { select: { id: true, title: true, docType: true } } },
  });
  if (!wo) return { ok: false, message: 'That order no longer exists.' };

  const uploads = eSanchitUploads(wo.documents);
  if (uploads.length === 0) {
    return {
      ok: false,
      message: 'Nothing to lodge yet.',
      detail: 'eSanchit takes the supporting documents — the supplier invoice, packing list, certificate of origin, airway bill. None of those are on the order yet.',
    };
  }

  const already = await db.integrationCallLog.findFirst({
    where: { workOrderId: orderId, operation: 'ESANCHIT_LODGE_DOCS', ok: true },
    orderBy: { createdAt: 'desc' },
  });
  if (already) {
    return {
      ok: false,
      message: 'Already lodged on eSanchit.',
      detail: `Reference ${already.correlationId}. The DRNs are on the integration log — lodging twice would duplicate them against the same Bill of Entry.`,
    };
  }

  const run = eSanchitFilingRun({ orderAlias: wo.alias, uploads });

  await ensureConnector('ESANCHIT', 'eSanchit document portal', 'ICEGATE / CBIC');
  await db.integrationCallLog.create({
    data: {
      connectorId: 'ESANCHIT',
      workOrderId: wo.id,
      operation: 'ESANCHIT_LODGE_DOCS',
      direction: 'OUTBOUND',
      requestBody: JSON.stringify({ documents: uploads.map((u) => ({ id: u.docId, title: u.title })), steps: run.steps }),
      responseBody: JSON.stringify({ reference: run.reference, drns: uploads.map((u) => ({ docId: u.docId, drn: u.drn })) }),
      statusCode: 200,
      ok: true,
      latencyMs: run.steps[run.steps.length - 1].atMs,
      correlationId: run.reference,
      mode: 'MOCK',
    },
  });

  await db.auditLogEntry.create({
    data: {
      workOrderId: wo.id,
      entity: 'WorkOrder',
      entityId: wo.id,
      action: 'CREATE',
      field: 'ESANCHIT_DRNS',
      afterValue: uploads.map((u) => `${u.title}: ${u.drn}`).join('; '),
      actorId: 'u-priya',
      actorLabel: 'Portal agent (CHA credential)',
    },
  });

  await db.communication.create({
    data: {
      workOrderId: wo.id,
      entryClass: 'SYSTEM',
      channel: 'SYSTEM',
      direction: 'INTERNAL',
      subject: `Supporting documents lodged on eSanchit — ${run.reference}`,
      body: `The CHA's filing agent lodged ${uploads.length} supporting document${uploads.length === 1 ? '' : 's'} on eSanchit ahead of the Bill of Entry: ${uploads.map((u) => `${u.title} (${u.drn})`).join(', ')}. Simulated run — no external portal is contacted in this build.`,
      status: 'CLOSED',
      occurredAt: new Date(),
      systemIcon: 'Bot',
    },
  });

  revalidateFor(wo.id, 'ONE_BUY_INBOUND');
  return {
    ok: true,
    message: `${uploads.length} document${uploads.length === 1 ? '' : 's'} lodged on eSanchit.`,
    detail: `Reference ${run.reference}. Each document's DRN is recorded for the Bill of Entry to quote.`,
    run,
  };
}

/** What the Inbound screen shows about the eSanchit state without re-filing. */
export async function eSanchitStatus(orderId: string): Promise<{
  filed: boolean;
  reference: string | null;
  drns: { title: string; drn: string }[];
  lodgeable: number;
}> {
  const [wo, log] = await Promise.all([
    db.workOrder.findUnique({
      where: { id: orderId },
      include: { documents: { select: { id: true, title: true, docType: true } } },
    }),
    db.integrationCallLog.findFirst({
      where: { workOrderId: orderId, operation: 'ESANCHIT_LODGE_DOCS', ok: true },
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  const uploads = wo ? eSanchitUploads(wo.documents) : [];
  if (!log) return { filed: false, reference: null, drns: [], lodgeable: uploads.length };
  const resp = JSON.parse(log.responseBody ?? '{}') as { drns?: { docId: string; drn: string }[] };
  const titleById = new Map(wo!.documents.map((d) => [d.id, d.title]));
  return {
    filed: true,
    reference: log.correlationId,
    drns: (resp.drns ?? []).map((d) => ({ title: titleById.get(d.docId) ?? d.docId, drn: d.drn })),
    lodgeable: uploads.length,
  };
}
