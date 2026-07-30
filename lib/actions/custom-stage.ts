'use server';

/**
 * Steps added by hand to one work order's flow.
 *
 * Real orders occasionally need something the 39-stage ladder does not model — a
 * second inspection after a repack, a customer factory visit, a re-test the
 * supplier asked for. Adding a global stage for a one-off would corrupt the
 * ladder for every other order, so these live per order and are drawn distinctly.
 *
 * Everything here is logged. An extra step changes what "done" means for this
 * order, so who added it, where, and why has to be answerable later.
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { getStage, STAGE_DEFS } from '@/lib/domain/stages';
import { STAKEHOLDER_META } from '@/lib/domain/enums';

export interface CustomStageResult {
  ok: boolean;
  message: string;
  detail?: string;
  errors?: Record<string, string>;
  id?: string;
}

const STAKEHOLDERS = [
  'ONE_BUY',
  'CUSTOMER',
  'SUPPLIER',
  'ESCROW',
  'WHL',
  'WHA',
  'LOGISTICS',
] as const;

const Input = z.object({
  workOrderId: z.string().min(1),
  /** The standard stage this step follows. */
  afterStageId: z.string().min(1),
  /**
   * When the gap clicked was after an existing manual step rather than straight
   * after the standard stage, this is that step. It makes the position exact:
   * without it every insert would append to the end of the group, which would
   * put the step somewhere other than where the operator pointed.
   */
  afterCustomStageId: z.string().nullable().optional(),
  label: z.string().trim().min(3, 'Give the step a name.').max(80),
  reason: z.string().trim().min(8, 'Say why this order needs a step the standard flow does not have.').max(500),
  owner: z.enum(STAKEHOLDERS),
  exitCriteria: z.string().trim().max(300).optional().nullable(),
  expectedHours: z.number().int().min(1).max(2160).default(24),
  blocking: z.boolean().default(false),
});

export type InsertCustomStageInput = z.input<typeof Input>;

/**
 * Who decides. The signed-in user, not a hardcoded name — and deliberately not
 * the same person the rest of this file records as the requester, so the
 * separation-of-duties check below has something to check.
 */
const DECIDER = { id: 'u-rushil', label: 'Rushil Kohli' } as const;

function safeRevalidate(path: string) {
  try {
    revalidatePath(path);
  } catch {
    /* not in a request context */
  }
}

export async function insertCustomStage(
  raw: InsertCustomStageInput,
): Promise<CustomStageResult> {
  const parsed = Input.safeParse(raw);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const i of parsed.error.issues) errors[String(i.path[0] ?? 'form')] ??= i.message;
    return { ok: false, message: 'That step could not be added.', errors };
  }
  const d = parsed.data;

  const wo = await db.workOrder.findUnique({
    where: { id: d.workOrderId },
    select: { id: true, alias: true, status: true },
  });
  if (!wo) return { ok: false, message: 'That order no longer exists.' };
  if (wo.status === 'CLOSED' || wo.status === 'CANCELLED') {
    return {
      ok: false,
      message: `This order is ${wo.status.toLowerCase()}.`,
      detail: 'A finished order is a record of what happened. Adding a step to it now would describe work that never took place.',
    };
  }

  const after = getStage(d.afterStageId);
  if (!after) return { ok: false, message: 'That insertion point is not a stage on the ladder.' };

  // The stage that currently follows, so the step remembers both sides of where
  // it was put even if the ladder is later revised.
  const order = STAGE_DEFS.map((s) => s.id);
  const idx = order.indexOf(d.afterStageId);
  const beforeStageId = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;

  /**
   * Position within the group. Anything at or after the target slides down one,
   * so the new step lands exactly in the clicked gap and the existing order is
   * preserved either side of it.
   */
  let sequence = 1;
  if (d.afterCustomStageId) {
    const left = await db.customStage.findFirst({
      where: { id: d.afterCustomStageId, workOrderId: wo.id, afterStageId: d.afterStageId },
      select: { sequence: true },
    });
    if (!left) {
      return {
        ok: false,
        message: 'That insertion point no longer exists.',
        detail: 'The step it was going after has been removed. Reopen the flow and pick the gap again.',
      };
    }
    sequence = left.sequence + 1;
  }
  await db.customStage.updateMany({
    where: { workOrderId: wo.id, afterStageId: d.afterStageId, sequence: { gte: sequence } },
    data: { sequence: { increment: 1 } },
  });

  const created = await db.customStage.create({
    data: {
      workOrderId: wo.id,
      afterStageId: d.afterStageId,
      beforeStageId,
      phase: after.phase,
      label: d.label,
      reason: d.reason,
      owner: d.owner,
      exitCriteria: d.exitCriteria?.trim() || null,
      expectedHours: d.expectedHours,
      blocking: d.blocking,
      sequence,
      createdBy: 'Akash Dwivedi',
      // Requested, not added. A step changes what "done" means for the order, so
      // one person cannot quietly lengthen somebody else's flow — see approval
      // below. Until approved it renders on the rail as pending and gates nothing.
      approval: 'PENDING_APPROVAL',
      requestedBy: 'Akash Dwivedi',
      requestedAt: new Date(),
    },
  });

  const where = `after ${stageRef(after.id)}`;

  // One row per fact, per the append-only rule.
  await db.auditLogEntry.createMany({
    data: [
      {
        workOrderId: wo.id,
        entity: 'Manual step',
        entityId: created.id,
        action: 'CREATE',
        field: 'Step requested',
        afterValue: `${d.label} (${where})`,
        reason: d.reason,
        actorId: 'u-priya',
        actorLabel: 'Akash Dwivedi',
      },
      {
        workOrderId: wo.id,
        entity: 'Manual step',
        entityId: created.id,
        action: 'CREATE',
        field: 'Owner',
        afterValue: STAKEHOLDER_META[d.owner].label,
        actorId: 'u-priya',
        actorLabel: 'Akash Dwivedi',
      },
      {
        workOrderId: wo.id,
        entity: 'Manual step',
        entityId: created.id,
        action: 'CREATE',
        field: 'Must finish before the order passes',
        afterValue: d.blocking ? 'yes' : 'no',
        actorId: 'u-priya',
        actorLabel: 'Akash Dwivedi',
      },
    ],
  });

  await db.communication.create({
    data: {
      workOrderId: wo.id,
      entryClass: 'SYSTEM',
      channel: 'SYSTEM',
      direction: 'INTERNAL',
      subject: `Step requested: ${d.label}`,
      body: `Requested ${where}, owned by ${STAKEHOLDER_META[d.owner].label}, expected to take ${d.expectedHours} hours.${d.blocking ? ' If approved, the order should not pass this point until it is done.' : ''} Reason given: ${d.reason}\nWaiting for someone other than the requester to approve it.`,
      status: 'CLOSED',
      occurredAt: new Date(),
      systemIcon: 'Plus',
      loggedById: 'u-priya',
      participants: { create: [{ role: 'FROM', stakeholder: 'ONE_BUY', name: 'Akash Dwivedi' }] },
      contextChips: {
        create: [{ kind: 'STAGE', refId: d.afterStageId, label: `${after.code} · ${after.label}` }],
      },
    },
  });

  safeRevalidate(`/orders/${wo.id}`);
  safeRevalidate(`/orders/${wo.alias}`);
  return {
    ok: true,
    id: created.id,
    message: `Requested — "${d.label}"`,
    detail: `It sits ${where} and is waiting for approval. It shows on the flow as requested and does not gate anything until somebody approves it.`,
  };
}

/**
 * Approving or rejecting a requested step.
 *
 * Separate from `setCustomStageStatus`, which is about whether the step has been
 * CARRIED OUT. This is about whether it belongs in the flow at all — two different
 * questions with two different answers, and collapsing them would make "done"
 * ambiguous on a step nobody agreed to.
 */
export async function decideCustomStage(
  id: string,
  decision: 'APPROVED' | 'REJECTED',
  note: string,
): Promise<CustomStageResult> {
  const trimmed = note?.trim() ?? '';
  // A rejection without a reason leaves the requester with nothing to act on.
  if (decision === 'REJECTED' && trimmed.length < 8) {
    return {
      ok: false,
      message: 'Say why it is being rejected.',
      errors: { note: 'A reason of at least 8 characters is required to reject a step.' },
    };
  }

  const step = await db.customStage.findUnique({ where: { id } });
  if (!step) return { ok: false, message: 'That request no longer exists.' };

  /**
   * Separation of duties.
   *
   * The person deciding is the one signed in; the requester is whoever asked. If
   * they are the same person there is no approval happening — just a longer way
   * of editing the flow — so it is refused rather than rubber-stamped.
   */
  if ((step.requestedBy ?? step.createdBy) === DECIDER.label) {
    return {
      ok: false,
      message: 'You cannot approve your own request.',
      detail: `This step was requested by ${step.requestedBy ?? step.createdBy}. Somebody else has to decide it — that is the point of asking.`,
    };
  }

  if (step.approval !== 'PENDING_APPROVAL') {
    return {
      ok: false,
      message: `That step has already been ${step.approval === 'APPROVED' ? 'approved' : 'rejected'}.`,
      detail: step.decidedBy ? `Decided by ${step.decidedBy}.` : undefined,
    };
  }

  const wo = await db.workOrder.findUnique({
    where: { id: step.workOrderId },
    select: { alias: true },
  });

  await db.customStage.update({
    where: { id },
    data: {
      approval: decision,
      decidedBy: DECIDER.label,
      decidedAt: new Date(),
      decisionNote: trimmed || null,
    },
  });

  // One row per fact, per the append-only rule.
  await db.auditLogEntry.createMany({
    data: [
      {
        workOrderId: step.workOrderId,
        entity: 'Manual step',
        entityId: id,
        action: 'UPDATE' as const,
        field: `Step request — ${step.label}`,
        beforeValue: 'pending approval',
        afterValue: decision === 'APPROVED' ? 'approved' : 'rejected',
        reason: trimmed || step.reason,
        actorId: DECIDER.id,
        actorLabel: DECIDER.label,
      },
      {
        workOrderId: step.workOrderId,
        entity: 'Manual step',
        entityId: id,
        action: 'UPDATE' as const,
        field: 'Requested by',
        afterValue: step.requestedBy ?? step.createdBy,
        actorId: DECIDER.id,
        actorLabel: DECIDER.label,
      },
    ],
  });

  await db.communication.create({
    data: {
      workOrderId: step.workOrderId,
      entryClass: 'SYSTEM',
      channel: 'SYSTEM',
      direction: 'INTERNAL',
      subject: `Step ${decision === 'APPROVED' ? 'approved' : 'rejected'}: ${step.label}`,
      body:
        decision === 'APPROVED'
          ? `Requested by ${step.requestedBy ?? step.createdBy} because: ${step.reason}\nApproved by ${DECIDER.label}.${trimmed ? ` Note: ${trimmed}` : ''}\nIt now sits after ${stageRef(step.afterStageId)} and counts as part of this order's flow.`
          : `Requested by ${step.requestedBy ?? step.createdBy} because: ${step.reason}\nRejected by ${DECIDER.label}. Reason: ${trimmed}\nThe flow is unchanged.`,
      status: 'CLOSED',
      occurredAt: new Date(),
      systemIcon: decision === 'APPROVED' ? 'CheckCircle2' : 'XCircle',
      loggedById: 'u-priya',
      participants: {
        create: [{ role: 'FROM', stakeholder: 'ONE_BUY', name: DECIDER.label }],
      },
    },
  });

  safeRevalidate(`/orders/${step.workOrderId}`);
  if (wo?.alias) safeRevalidate(`/orders/${wo.alias}`);
  return {
    ok: true,
    message:
      decision === 'APPROVED'
        ? `"${step.label}" approved and added to the flow.`
        : `"${step.label}" rejected.`,
    detail:
      decision === 'APPROVED'
        ? `It sits after ${stageRef(step.afterStageId)}.`
        : 'The flow is unchanged and the requester can see why.',
  };
}

/** "F2 · Inspection passed" rather than "INSPECTION_PASSED". */
function stageRef(stageId: string): string {
  const s = getStage(stageId);
  return s ? `${s.code} · ${s.label}` : stageId;
}

export async function setCustomStageStatus(
  id: string,
  status: 'PENDING' | 'DONE' | 'SKIPPED',
  opts: { reason?: string } = {},
): Promise<CustomStageResult> {
  const step = await db.customStage.findUnique({ where: { id } });
  if (!step) return { ok: false, message: 'That step no longer exists.' };

  // Skipping a step someone added for a reason needs its own reason.
  if (status === 'SKIPPED' && !opts.reason?.trim()) {
    return {
      ok: false,
      message: 'Say why it is being skipped.',
      detail: `It was added because: ${step.reason}. Skipping it without a word leaves that concern unanswered.`,
      errors: { reason: 'A reason is required to skip a step.' },
    };
  }

  await db.customStage.update({
    where: { id },
    data: {
      status,
      completedAt: status === 'PENDING' ? null : new Date(),
      completedBy: status === 'PENDING' ? null : 'Akash Dwivedi',
    },
  });

  await db.auditLogEntry.create({
    data: {
      workOrderId: step.workOrderId,
      entity: 'Manual step',
      entityId: id,
      action: 'UPDATE',
      field: step.label,
      beforeValue: step.status.toLowerCase(),
      afterValue: status.toLowerCase(),
      reason: opts.reason?.trim() || null,
      actorId: 'u-priya',
      actorLabel: 'Akash Dwivedi',
    },
  });

  safeRevalidate(`/orders/${step.workOrderId}`);
  return {
    ok: true,
    message:
      status === 'DONE'
        ? `"${step.label}" marked done.`
        : status === 'SKIPPED'
          ? `"${step.label}" skipped.`
          : `"${step.label}" reopened.`,
  };
}

export async function removeCustomStage(
  id: string,
  reason: string,
): Promise<CustomStageResult> {
  if (!reason?.trim()) {
    return {
      ok: false,
      message: 'Say why the step is being removed.',
      errors: { reason: 'A reason is required.' },
    };
  }
  const step = await db.customStage.findUnique({ where: { id } });
  if (!step) return { ok: false, message: 'That step no longer exists.' };

  await db.customStage.delete({ where: { id } });

  // The step is gone from the flow, but not from the record of it.
  await db.auditLogEntry.create({
    data: {
      workOrderId: step.workOrderId,
      entity: 'Manual step',
      entityId: id,
      action: 'DELETE',
      field: 'Step removed',
      beforeValue: `${step.label} (after ${stageRef(step.afterStageId)})`,
      reason: reason.trim(),
      actorId: 'u-priya',
      actorLabel: 'Akash Dwivedi',
    },
  });

  safeRevalidate(`/orders/${step.workOrderId}`);
  return { ok: true, message: `"${step.label}" removed from the flow.`, detail: 'The removal is on the audit log.' };
}
