'use server';

/**
 * Drafting, editing and approving the documents a team owes on an order.
 *
 * THE HUMAN-IN-THE-LOOP RULE, stated once and enforced here rather than in the
 * UI: nothing this file produces counts until a person approves it. The system
 * drafts, the checks report, the person decides. `generateDraft` never sets a
 * status other than DRAFT, and `approveDeliverable` is the only path to
 * APPROVED — so a future caller cannot accidentally file something by writing
 * the row directly through some convenience helper.
 *
 * WHAT AN AGENT IS HERE. The drafting is deterministic: every figure is
 * computed from the order's own record by the generator for that document. No
 * language model is invoked and none should be — a P&L or a bill-of-entry
 * summary assembled from plausible-looking numbers is precisely the artefact
 * that must never exist. Where the system genuinely cannot know a value it
 * leaves it blank and the checks say so, which is honest in a way a confident
 * guess is not.
 */

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { getStage } from '@/lib/domain/stages';
import { stageContextFrom } from '@/lib/domain/stage-context';
import { slugForTeam, STAKEHOLDER_META, type Stakeholder } from '@/lib/domain/enums';
import { buildDeliverableInput } from '@/lib/queries/deliverable-input';
import { deliverableFor, isReady } from '@/lib/domain/deliverables/registry';
import {
  hasBlockingFailure,
  needsReviewNote,
  type DeliverableValues,
} from '@/lib/domain/deliverables/types';

export interface DeliverableResult {
  ok: boolean;
  message: string;
  detail?: string;
}

function safeRevalidate(path: string) {
  try {
    revalidatePath(path);
  } catch {
    /* not in a request */
  }
}

/** Revalidates the order and the owning team's screens together. */
function revalidateFor(orderId: string, team: string) {
  safeRevalidate(`/orders/${orderId}`);
  const slug = slugForTeam(team as Stakeholder);
  if (slug) {
    safeRevalidate(`/teams/${slug}`);
    safeRevalidate(`/teams/${slug}/orders/${orderId}`);
  }
}


/**
 * Cuts a fresh draft.
 *
 * Supersedes any existing draft for the same document rather than editing it:
 * a draft cut at customs clearance and one cut after duty landed are different
 * statements about different facts, and overwriting the first hides that the
 * numbers moved. Approved versions are never touched — a new draft supersedes
 * itself, not somebody's signature.
 */
export async function generateDraft(orderId: string, kind: string): Promise<DeliverableResult> {
  const def = deliverableFor(kind);
  if (!def) return { ok: false, message: 'Unknown document type.' };

  const input = await buildDeliverableInput(orderId);
  if (!input) return { ok: false, message: 'That order no longer exists.' };

  const wo = await db.workOrder.findUnique({
    where: { id: orderId },
    include: { customerPo: true, phasePlan: true },
  });
  if (!wo) return { ok: false, message: 'That order no longer exists.' };

  const ctx = stageContextFrom(wo as Parameters<typeof stageContextFrom>[0]);
  if (!isReady(def, wo.stage, ctx)) {
    return {
      ok: false,
      message: `Too early to draft the ${def.label.toLowerCase()}.`,
      detail: `Its figures only mean something once the order reaches ${getStage(def.readyFromStage).label}. Drafting now would produce a confident document full of placeholders.`,
    };
  }

  const values = def.compute(input);
  const latest = await db.teamDeliverable.findFirst({
    where: { workOrderId: orderId, kind },
    orderBy: { version: 'desc' },
  });

  // Only unapproved drafts are superseded. An approved one stays as it is.
  if (latest && latest.status !== 'APPROVED') {
    await db.teamDeliverable.update({ where: { id: latest.id }, data: { status: 'SUPERSEDED' } });
  }

  const created = await db.teamDeliverable.create({
    data: {
      workOrderId: orderId,
      team: def.team,
      kind: def.kind,
      status: 'DRAFT',
      computed: JSON.stringify(values),
      values: JSON.stringify(values),
      version: (latest?.version ?? 0) + 1,
      generatedAtStage: wo.stage,
    },
  });

  await db.auditLogEntry.create({
    data: {
      workOrderId: orderId,
      entity: 'TeamDeliverable',
      entityId: created.id,
      action: 'CREATE',
      field: def.kind,
      afterValue: `Draft v${created.version} generated at ${getStage(wo.stage).code}`,
      actorId: 'u-priya',
      actorLabel: 'Akash Dwivedi',
    },
  });

  revalidateFor(orderId, def.team);
  return {
    ok: true,
    message: `${def.label} drafted.`,
    detail: `Version ${created.version}, from the order's own figures as at ${getStage(wo.stage).label}. Nothing is filed until you approve it.`,
  };
}

/** Saves edits. Stays a draft — saving is not approving. */
export async function saveDraft(
  deliverableId: string,
  values: DeliverableValues,
): Promise<DeliverableResult> {
  const row = await db.teamDeliverable.findUnique({ where: { id: deliverableId } });
  if (!row) return { ok: false, message: 'That draft no longer exists.' };
  if (row.status === 'APPROVED') {
    return {
      ok: false,
      message: 'This version is already approved.',
      detail: 'Approved documents are not edited. Generate a new version instead, so the change is visible rather than silent.',
    };
  }

  await db.teamDeliverable.update({
    where: { id: deliverableId },
    data: { values: JSON.stringify(values), status: 'IN_REVIEW' },
  });

  revalidateFor(row.workOrderId, row.team);
  return { ok: true, message: 'Draft saved.', detail: 'Still a draft — approve it when you are satisfied.' };
}

/**
 * The gate.
 *
 * Re-runs the checks server-side rather than trusting what the form said. The
 * browser's copy of the checks is a convenience for the reviewer; this one is
 * the control, and a form that has been open in a tab for an hour may be
 * checking against figures that have since moved.
 */
export async function approveDeliverable(
  deliverableId: string,
  reviewNote: string,
): Promise<DeliverableResult> {
  const row = await db.teamDeliverable.findUnique({ where: { id: deliverableId } });
  if (!row) return { ok: false, message: 'That draft no longer exists.' };
  if (row.status === 'APPROVED') return { ok: false, message: 'This version is already approved.' };

  const def = deliverableFor(row.kind);
  if (!def) return { ok: false, message: 'Unknown document type.' };

  const input = await buildDeliverableInput(row.workOrderId);
  if (!input) return { ok: false, message: 'That order no longer exists.' };

  const values = JSON.parse(row.values) as DeliverableValues;
  const checks = def.check(values, input);

  if (hasBlockingFailure(checks)) {
    const failed = checks.filter((c) => c.status === 'FAIL');
    return {
      ok: false,
      message: 'This cannot be approved yet.',
      detail: `${failed.length} check${failed.length === 1 ? '' : 's'} still failing: ${failed.map((c) => c.label).join('; ')}.`,
    };
  }
  if (needsReviewNote(checks) && !reviewNote.trim()) {
    return {
      ok: false,
      message: 'A reason is needed.',
      detail: 'Some checks came back with a warning. Approving over one is a judgement call, and a judgement call with no reason recorded is indistinguishable from an oversight.',
    };
  }

  await db.teamDeliverable.update({
    where: { id: deliverableId },
    data: {
      status: 'APPROVED',
      approvedAt: new Date(),
      reviewedById: 'u-priya',
      reviewNote: reviewNote.trim() || null,
    },
  });

  // Filed as a document on the order, so it appears in the register beside
  // everything else rather than only inside the team's own screen.
  await db.document.create({
    data: {
      workOrderId: row.workOrderId,
      docType: row.kind,
      title: `${def.label} — ${input.alias} (v${row.version})`,
      fileName: `${row.kind.toLowerCase()}-${input.alias}-v${row.version}.pdf`,
      bodyText: JSON.stringify(values, null, 2),
      uploadedBy: 'Akash Dwivedi',
      provenance: 'SYSTEM',
      stageId: row.generatedAtStage,
    },
  });

  await db.auditLogEntry.create({
    data: {
      workOrderId: row.workOrderId,
      entity: 'TeamDeliverable',
      entityId: row.id,
      action: 'AUTHORISE',
      field: row.kind,
      afterValue: `Approved v${row.version}${reviewNote.trim() ? ` — ${reviewNote.trim()}` : ''}`,
      actorId: 'u-priya',
      actorLabel: 'Akash Dwivedi',
    },
  });

  await db.communication.create({
    data: {
      workOrderId: row.workOrderId,
      entryClass: 'SYSTEM',
      channel: 'SYSTEM',
      direction: 'INTERNAL',
      subject: `${def.label} approved (v${row.version})`,
      body: `${STAKEHOLDER_META[def.team].label} approved the ${def.label.toLowerCase()} for ${input.alias}.${reviewNote.trim() ? ` Reason noted: ${reviewNote.trim()}` : ''}`,
      status: 'CLOSED',
      occurredAt: new Date(),
      systemIcon: 'FileCheck',
    },
  });

  revalidateFor(row.workOrderId, row.team);
  return {
    ok: true,
    message: `${def.label} approved.`,
    detail: `Version ${row.version} is filed against ${input.alias} and appears in the order's document register.`,
  };
}
