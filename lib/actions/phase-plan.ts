'use server';

/**
 * Re-planning one order's flow — reordering the seven macro phases, or taking
 * some of them out of it entirely.
 *
 * The stage ladder is never touched. This writes a per-order overlay; see
 * lib/domain/phase-plan.ts for what may be moved, what may be dropped, and the
 * reasoning behind each restriction.
 *
 * Everything is logged, one audit row per phase that actually changed, because a
 * re-planned flow changes what "done" means for this order. An operator looking at
 * a 30-stage order six months from now has to be able to find out who shortened it
 * and on what grounds.
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import {
  PHASES,
  PHASE_DEFS,
  applicableStages,
  getStage,
  resolveRailAnchor,
  type PhaseId,
  type PhasePlan,
  type StageContext,
} from '@/lib/domain/stages';
import {
  DEFAULT_PHASE_PLAN,
  PLAN_REASON_MIN,
  describePlanChanges,
  isDefaultPlan,
  normalisePhasePlan,
  planSequence,
  planWarnings,
  validatePhasePlan,
} from '@/lib/domain/phase-plan';

export interface PhasePlanResult {
  ok: boolean;
  message: string;
  detail?: string;
  errors?: Record<string, string>;
  /** Blocking problems from validatePhasePlan, so the dialog can list them. */
  problems?: string[];
  /** Non-blocking consequences of what was saved, echoed back for the toast. */
  warnings?: string[];
}

const Entry = z.object({
  phase: z.enum(PHASES),
  skipped: z.boolean(),
});

const Input = z.object({
  workOrderId: z.string().min(1),
  /** The proposed flow, in order. Curtailed phases keep their place in the list. */
  plan: z.array(Entry).min(1),
  reason: z
    .string()
    .trim()
    .min(
      PLAN_REASON_MIN,
      'Say why this order does not follow the standard flow. A re-planned order with no reason cannot be reviewed later.',
    )
    .max(600),
});

export type SavePhasePlanInput = z.input<typeof Input>;

function safeRevalidate(path: string) {
  try {
    revalidatePath(path);
  } catch {
    /* not in a request context */
  }
}

const ACTOR = { id: 'u-priya', label: 'Akash Dwivedi' };

/** Reads the plan in force for an order. No rows means the standard ladder. */
export async function loadPhasePlan(workOrderId: string): Promise<PhasePlan> {
  const rows = await db.orderPhasePlan.findMany({
    where: { workOrderId },
    orderBy: { position: 'asc' },
    select: { phase: true, skipped: true },
  });
  if (!rows.length) return DEFAULT_PHASE_PLAN.map((e) => ({ ...e }));
  return normalisePhasePlan(
    rows.map((r) => ({ phase: r.phase as PhaseId, skipped: r.skipped })),
  );
}

export async function savePhasePlan(raw: SavePhasePlanInput): Promise<PhasePlanResult> {
  const parsed = Input.safeParse(raw);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const i of parsed.error.issues) errors[String(i.path[0] ?? 'form')] ??= i.message;
    return { ok: false, message: 'The flow could not be saved.', errors };
  }
  const d = parsed.data;

  const wo = await db.workOrder.findUnique({
    where: { id: d.workOrderId },
    select: {
      id: true,
      alias: true,
      status: true,
      stage: true,
      paymentMethod: true,
      testingRequired: true,
      testScope: true,
      incoterms: true,
    },
  });
  if (!wo) return { ok: false, message: 'That order no longer exists.' };
  if (wo.status === 'CLOSED' || wo.status === 'CANCELLED') {
    return {
      ok: false,
      message: `This order is ${wo.status.toLowerCase()}.`,
      detail:
        'A finished order is a record of what happened. Re-planning its flow now would describe a route it never took.',
    };
  }

  const current = await loadPhasePlan(wo.id);

  // The phase the order is sitting in. Read through resolveRailAnchor so a
  // blocked order on an exception branch is judged on the phase it is stuck in
  // rather than on a branch that is not a ladder position at all.
  const { anchorStageId } = resolveRailAnchor(wo.stage);
  const currentPhase = getStage(anchorStageId).phase;

  const check = validatePhasePlan({ proposed: d.plan, current, currentPhase });
  if (!check.ok) {
    return {
      ok: false,
      message: 'That flow is not allowed on this order.',
      problems: check.errors,
    };
  }
  const next = check.plan;

  const changes = describePlanChanges(current, next);
  if (!changes.length) {
    return {
      ok: false,
      message: 'Nothing changed.',
      detail: 'The flow you saved is the one already in force on this order.',
    };
  }

  // Guard the one thing validation cannot see: the order must still have
  // somewhere to go. Curtailing every phase ahead of the current one would leave
  // an order that is neither finished nor able to advance.
  const ctxAfter: StageContext = {
    paymentMethod: wo.paymentMethod as StageContext['paymentMethod'],
    testingRequired: wo.testingRequired,
    testScope: wo.testScope as StageContext['testScope'],
    phasePlan: next,
    incoterms: wo.incoterms,
  };
  const ladderAfter = applicableStages(ctxAfter).filter(
    (s) => !next.some((e) => e.phase === s.phase && e.skipped),
  );
  if (!ladderAfter.some((s) => s.id === anchorStageId)) {
    return {
      ok: false,
      message: 'That flow removes the stage the order is currently on.',
      detail: `The order is at ${getStage(anchorStageId).label}. Put phase ${currentPhase} back into the flow before saving.`,
    };
  }

  const changedPhases = new Set(changes.map((c) => c.phase));

  await db.$transaction(async (tx) => {
    // Written as a full replace of all seven rows rather than a patch: the plan is
    // one arrangement, and a partial update could leave two phases claiming the
    // same position if a write failed halfway.
    await tx.orderPhasePlan.deleteMany({ where: { workOrderId: wo.id } });

    // An order back on the standard flow stores nothing, so "no rows" keeps
    // meaning "standard ladder" rather than drifting into "plan unknown".
    if (!isDefaultPlan(next)) {
      await tx.orderPhasePlan.createMany({
        data: next.map((e, i) => ({
          workOrderId: wo.id,
          phase: e.phase,
          position: i,
          skipped: e.skipped,
          // The reason is attached to the phases this save actually changed.
          // Copying it onto untouched phases would make an old, unrelated
          // decision look like it was justified by today's note.
          reason: changedPhases.has(e.phase) ? d.reason : null,
          changedBy: ACTOR.label,
        })),
      });
    }

    // One audit row per phase that changed — the append-only rule. A single row
    // saying "flow changed" would not answer which phase, or in which direction.
    await tx.auditLogEntry.createMany({
      data: changes.map((c) => ({
        workOrderId: wo.id,
        entity: 'Order flow',
        entityId: `${wo.id}:${c.phase}`,
        action: 'UPDATE' as const,
        field: `Phase ${c.phase} — ${PHASE_DEFS[c.phase].label}`,
        beforeValue: describePhaseState(current, c.phase),
        afterValue: describePhaseState(next, c.phase),
        reason: d.reason,
        actorId: ACTOR.id,
        actorLabel: ACTOR.label,
      })),
    });

    // Plus one row for the sequence as a whole, because the individual moves do
    // not read as a route. "A → B → D → C → E → F → G" does.
    await tx.auditLogEntry.create({
      data: {
        workOrderId: wo.id,
        entity: 'Order flow',
        entityId: wo.id,
        action: 'UPDATE',
        field: 'Flow sequence',
        beforeValue: planSequence(current),
        afterValue: planSequence(next),
        reason: d.reason,
        actorId: ACTOR.id,
        actorLabel: ACTOR.label,
      },
    });

    const removed = changes.filter((c) => c.kind === 'REMOVED');
    const stagesLost = removed.reduce(
      (n, c) => n + applicableStages({ ...ctxAfter, phasePlan: null }).filter((s) => s.phase === c.phase).length,
      0,
    );

    await tx.communication.create({
      data: {
        workOrderId: wo.id,
        entryClass: 'SYSTEM',
        channel: 'SYSTEM',
        direction: 'INTERNAL',
        subject: `Order flow re-planned — ${planSequence(next)}`,
        body: [
          ...changes.map((c) => `· ${c.detail}`),
          '',
          `Flow is now ${planSequence(next)}${
            stagesLost ? `, which is ${stagesLost} stage${stagesLost === 1 ? '' : 's'} fewer than the standard ladder` : ''
          }.`,
          `Reason given: ${d.reason}`,
        ].join('\n'),
        status: 'CLOSED',
        occurredAt: new Date(),
        systemIcon: 'GitBranch',
        loggedById: ACTOR.id,
        participants: {
          create: [{ role: 'FROM', stakeholder: 'ONE_BUY', name: ACTOR.label }],
        },
      },
    });
  });

  safeRevalidate(`/orders/${wo.alias}`);
  safeRevalidate(`/orders/${wo.id}`);
  safeRevalidate('/orders');
  safeRevalidate('/dashboard');

  const warnings = planWarnings(next, ctxAfter).map((w) => w.message);
  const removedCount = changes.filter((c) => c.kind === 'REMOVED').length;
  const movedCount = changes.filter((c) => c.kind === 'MOVED').length;
  const restoredCount = changes.filter((c) => c.kind === 'RESTORED').length;
  const bits = [
    movedCount ? `${movedCount} phase${movedCount === 1 ? '' : 's'} moved` : null,
    removedCount ? `${removedCount} removed` : null,
    restoredCount ? `${restoredCount} put back` : null,
  ].filter(Boolean);

  return {
    ok: true,
    message: `Flow is now ${planSequence(next)}`,
    detail: bits.join(' · '),
    warnings,
  };
}

/** Resets an order to the standard ladder. Same audit trail as any other change. */
export async function resetPhasePlan(
  workOrderId: string,
  reason: string,
): Promise<PhasePlanResult> {
  return savePhasePlan({
    workOrderId,
    plan: DEFAULT_PHASE_PLAN.map((e) => ({ ...e })),
    reason,
  });
}

/** "runs 3rd" / "removed from the flow" — the before/after value in the log. */
function describePhaseState(plan: PhasePlan, phase: PhaseId): string {
  if (plan.some((e) => e.phase === phase && e.skipped)) return 'removed from the flow';
  const live = plan.filter((e) => !e.skipped).map((e) => e.phase);
  const pos = live.indexOf(phase);
  if (pos < 0) return 'not in the flow';
  const ordinal = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th'][pos] ?? `${pos + 1}th`;
  return `runs ${ordinal} of ${live.length}`;
}
