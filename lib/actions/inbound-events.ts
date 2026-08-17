'use server';

/**
 * Recording something that happened on the inbound leg.
 *
 * An event is not a stage and usually not an exception, so recording one has to
 * do several small things at once and do all of them or none: put it on the
 * consignment's tracking history, put it on the order's thread where the desks
 * read, put it in the audit log, cost it where it costs, and raise a full
 * exception only where the event is serious enough to need routes out.
 *
 * WHO BEARS IT IS DERIVED, NEVER SUBMITTED. The form does not ask. Demurrage is
 * ours on FOB and the supplier's on DDP, and letting whoever is logging it pick
 * would eventually record a cost against the wrong party — which is not a
 * display error, it is absorbing somebody else's money.
 */

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { eventBearer, inboundEvent } from '@/lib/domain/inbound-events';
import { getStage } from '@/lib/domain/stages';
import { slugForTeam, STAKEHOLDER_META, TEAM_SLUGS } from '@/lib/domain/enums';
import { toMinor } from '@/lib/domain/money';

export interface RecordEventResult {
  ok: boolean;
  message: string;
  detail?: string;
  /** Set where the event became a full exception. */
  exceptionId?: string;
}

function safeRevalidate(path: string) {
  try {
    revalidatePath(path);
  } catch {
    /* not in a request */
  }
}

/**
 * Records an inbound event against an order.
 *
 * `costAmount` is in major units and optional — most events cost something that
 * is not known on the day, and forcing a number would get zeros typed into a
 * field that later reads as "this was free".
 */
export async function recordInboundEvent(
  orderId: string,
  eventId: string,
  input: { note?: string; costAmount?: number | null } = {},
): Promise<RecordEventResult> {
  const def = inboundEvent(eventId);
  if (!def) return { ok: false, message: 'That is not an event this platform knows.' };

  const wo = await db.workOrder.findUnique({
    where: { id: orderId },
    include: { shipments: true, supplierPo: { include: { supplier: true } } },
  });
  if (!wo) return { ok: false, message: 'That order no longer exists.' };

  /*
   * The event has to belong to where the order actually is.
   *
   * Recording an examination order against an order that has not reached
   * customs would put a fact on the record that cannot be true, and the whole
   * value of this log is that it can be trusted later.
   */
  if (!def.stages.includes(wo.stage)) {
    const here = getStage(wo.stage);
    return {
      ok: false,
      message: `${def.label} cannot happen at ${here.code}.`,
      detail: `The order is at ${here.code} ${here.label}. This event belongs to ${def.stages
        .map((s) => getStage(s).code)
        .join(', ')}.`,
    };
  }

  const bearer = eventBearer(def, wo.incoterms);
  const stage = getStage(wo.stage);
  const now = new Date();
  const costMinor = input.costAmount ? toMinor(input.costAmount) : 0;

  /*
   * The record itself, written first.
   *
   * Everything below is a consequence of it — the tracking entry, the thread
   * post, the exception. If the record failed and those succeeded, the order
   * would show an event nobody could find, resolve, or unblock.
   */
  const record = await db.inboundEventRecord.create({
    data: {
      workOrderId: wo.id,
      eventId: def.id,
      stageId: wo.stage,
      note: input.note?.trim() || null,
      costAmount: costMinor,
      bearerParty: bearer.party,
      bearerWhy: bearer.because,
      effect: def.effect,
      status: def.effect === 'RUNS_ALONGSIDE' ? 'RESOLVED' : 'OPEN',
      resolvedAt: def.effect === 'RUNS_ALONGSIDE' ? now : null,
    },
  });

  // ── The consignment's own history ────────────────────────────────────────
  const leg = wo.shipments.find((s) => s.legType === 'IMPORT');
  if (leg) {
    await db.trackingEvent.create({
      data: {
        shipmentId: leg.id,
        occurredAt: now,
        code: def.id,
        description: `${def.label} — ${def.what}`,
        location: stage.label,
        provenance: 'MANUAL',
      },
    });
  }

  // ── The thread the desks actually read ───────────────────────────────────
  await db.communication.create({
    data: {
      workOrderId: wo.id,
      entryClass: 'SYSTEM',
      channel: 'SYSTEM',
      direction: 'INTERNAL',
      subject: `${def.label} — ${stage.code}`,
      body: [
        def.what,
        input.note ? `Noted: ${input.note}` : null,
        `Borne by ${bearer.label}. ${bearer.because}`,
        bearer.recoverableFrom
          ? `Recovery may run to ${STAKEHOLDER_META[bearer.recoverableFrom].label} — ${def.evidence ? `evidence needed: ${def.evidence.toLowerCase()}.` : 'gather the evidence today.'}`
          : null,
        `What to do: ${def.action}`,
        def.accrues ? 'The clock is running on this one — every day it stays open costs money.' : null,
      ]
        .filter(Boolean)
        .join('\n\n'),
      status: def.effect === 'RUNS_ALONGSIDE' ? 'CLOSED' : 'ACTION_REQUIRED',
      isPinned: def.effect !== 'RUNS_ALONGSIDE',
      occurredAt: now,
      systemIcon: def.effect === 'ESCALATES' ? 'ShieldAlert' : 'Truck',
      contextChips: {
        create: [{ kind: 'STAGE', refId: wo.stage, label: `${stage.code} · ${stage.label}` }],
      },
    },
  });

  await db.auditLogEntry.create({
    data: {
      workOrderId: wo.id,
      entity: 'InboundEvent',
      entityId: wo.id,
      action: 'CREATE',
      field: def.id,
      beforeValue: null,
      afterValue: `${def.label} — borne by ${bearer.label}${costMinor ? `, cost recorded` : ''}`,
      actorId: 'u-priya',
      actorLabel: STAKEHOLDER_META.ONE_BUY_INBOUND.label,
    },
  });

  // ── Where it is serious, it becomes an exception with routes out ─────────
  let exceptionId: string | undefined;
  if (def.effect === 'ESCALATES' && def.escalatesTo) {
    const ex = await db.exceptionRecord.create({
      data: {
        workOrderId: wo.id,
        type: def.escalatesTo,
        offStage: wo.stage,
        reason: `${def.label}. ${def.what}${input.note ? ` ${input.note}` : ''}`,
        severity: 'HIGH',
        status: 'OPEN',
        costImpact: costMinor,
      },
    });
    exceptionId = ex.id;
    await db.inboundEventRecord.update({
      where: { id: record.id },
      data: { exceptionId },
    });
  }

  safeRevalidate(`/orders/${orderId}`);
  for (const slug of Object.keys(TEAM_SLUGS)) {
    safeRevalidate(`/teams/${slug}`);
    safeRevalidate(`/teams/${slug}/orders/${orderId}`);
  }
  const inboundSlug = slugForTeam('ONE_BUY_INBOUND');
  if (inboundSlug) safeRevalidate(`/teams/${inboundSlug}`);

  return {
    ok: true,
    message: `${def.label} recorded.`,
    detail: [
      `Borne by ${bearer.label}.`,
      exceptionId ? 'Raised as an exception — choose a route on the order.' : null,
      def.effect === 'HOLDS' ? 'The order will not advance until this is answered.' : null,
      def.evidence ? `File the evidence: ${def.evidence.toLowerCase()}.` : null,
    ]
      .filter(Boolean)
      .join(' '),
    exceptionId,
  };
}

/**
 * Closes an event that was holding the order.
 *
 * A holding event is the platform keeping a promise the screen made: it said
 * the order would not advance until this was answered, and the advance gate
 * enforces exactly that. Which means there has to be a way to say it IS
 * answered, and a resolution note, because "somebody closed it" is not an
 * answer anybody can audit six weeks later.
 */
export async function resolveInboundEvent(
  recordId: string,
  resolution: string,
): Promise<RecordEventResult> {
  const text = resolution.trim();
  if (text.length < 10) {
    return {
      ok: false,
      message: 'Say how it was resolved.',
      detail:
        'A holding event is what stops the order, so closing one without a reason leaves the order moving on an unexplained decision.',
    };
  }

  const rec = await db.inboundEventRecord.findUnique({ where: { id: recordId } });
  if (!rec) return { ok: false, message: 'That event is no longer on the order.' };
  if (rec.status === 'RESOLVED') return { ok: true, message: 'That event is already closed.' };

  const def = inboundEvent(rec.eventId);
  const now = new Date();

  await db.inboundEventRecord.update({
    where: { id: recordId },
    data: { status: 'RESOLVED', resolution: text, resolvedAt: now },
  });

  await db.communication.create({
    data: {
      workOrderId: rec.workOrderId,
      entryClass: 'SYSTEM',
      channel: 'SYSTEM',
      direction: 'INTERNAL',
      subject: `Resolved — ${def?.label ?? rec.eventId}`,
      body: text,
      status: 'CLOSED',
      occurredAt: now,
      systemIcon: 'CheckCircle2',
    },
  });

  await db.auditLogEntry.create({
    data: {
      workOrderId: rec.workOrderId,
      entity: 'InboundEvent',
      entityId: recordId,
      action: 'UPDATE',
      field: rec.eventId,
      beforeValue: 'OPEN',
      afterValue: `RESOLVED — ${text}`,
      actorId: 'u-priya',
      actorLabel: STAKEHOLDER_META.ONE_BUY_INBOUND.label,
    },
  });

  safeRevalidate(`/orders/${rec.workOrderId}`);
  for (const slug of Object.keys(TEAM_SLUGS)) {
    safeRevalidate(`/teams/${slug}/orders/${rec.workOrderId}`);
  }

  return {
    ok: true,
    message: `${def?.label ?? 'Event'} closed.`,
    detail: def?.effect === 'HOLDS' ? 'The order can advance again.' : undefined,
  };
}
