/**
 * PER-ORDER PHASE PLAN — reordering and curtailing the flow for one order.
 *
 * The 36-stage ladder in stages.ts is the single source of truth and is never
 * mutated per order. A phase plan is an OVERLAY on top of it: it says, for one
 * work order, what order the seven phases run in and which of them this order
 * does not go through at all.
 *
 * WHY AN ORDER WOULD EVER NEED THIS
 *
 * The ladder describes the common case: buy abroad, test at origin, ship, clear
 * customs, inspect, pay, repack, deliver. Real orders deviate in ways that are
 * not exceptions so much as different-but-normal:
 *
 *   · A domestic order from an Indian supplier never crosses a border, so the
 *     whole of phase E — shipping, customs entry, duty — does not exist for it.
 *   · Some buyers test on arrival in India rather than at the supplier's site,
 *     which puts phase D after phase E instead of before it.
 *   · An order paid against an existing credit line has no money to arm, so
 *     phase C collapses to nothing worth walking through.
 *
 * Encoding each of those as another predicate on the ladder would mean editing
 * the source of truth every time a customer negotiates something unusual. An
 * overlay keeps the ladder stable and puts the deviation, with its reason, on the
 * order it belongs to.
 *
 * WHAT CANNOT BE CHANGED, AND WHY
 *
 * Three phases are not up for negotiation:
 *
 *   A  Demand Capture       the customer's order and our accepted quote. This is
 *                           how the order comes into existence — there is no
 *                           order to re-plan without it.
 *   B  Sourcing             supplier chosen, our PO out, terms locked. Same
 *                           argument: no supplier, no work order.
 *   G  Value-Add & Delivery contains the tax invoice and the terminal stage. An
 *                           order that never delivers and never closes is not a
 *                           curtailed order, it is an abandoned one — and
 *                           cancellation, not curtailment, is the way to say so.
 *
 * That leaves C, D, E and F free to be reordered among themselves and dropped.
 *
 * AND WHAT IS ONLY WARNED ABOUT
 *
 * Beyond those, this module does not pretend to know better than the operator.
 * Putting testing after customs clearance is a real choice with a real cost, not
 * a mistake; refusing it would make the tool wrong more often than the operator.
 * So arrangements that carry a consequence are ALLOWED and the consequence is
 * stated — see planWarnings. Only the past is off limits: a phase the order has
 * already completed, or is sitting inside, cannot be moved or dropped, because
 * that would be rewriting what happened rather than planning what is left.
 */

import {
  PHASES,
  PHASE_DEFS,
  STAGE_DEFS,
  type PhaseId,
  type PhasePlan,
  type PhasePlanEntry,
  type StageContext,
} from './stages';

/** How much freedom an order has over each phase. */
export type PhaseMutability =
  /** Cannot move, cannot be dropped — the order could not exist without it. */
  | 'STRUCTURAL'
  /** Cannot move off the end, cannot be dropped — it closes the order. */
  | 'TERMINAL'
  /** Free to reorder and to drop, with a reason. */
  | 'FLEXIBLE';

export const PHASE_MUTABILITY: Record<PhaseId, PhaseMutability> = {
  A: 'STRUCTURAL',
  B: 'STRUCTURAL',
  C: 'FLEXIBLE',
  D: 'FLEXIBLE',
  E: 'FLEXIBLE',
  F: 'FLEXIBLE',
  G: 'TERMINAL',
};

/** Phases that hold their position no matter what, in the order they hold. */
const LEADING_PHASES: PhaseId[] = PHASES.filter((p) => PHASE_MUTABILITY[p] === 'STRUCTURAL');
const TRAILING_PHASES: PhaseId[] = PHASES.filter((p) => PHASE_MUTABILITY[p] === 'TERMINAL');
export const FLEXIBLE_PHASES: PhaseId[] = PHASES.filter(
  (p) => PHASE_MUTABILITY[p] === 'FLEXIBLE',
);

/** Minimum reason length. Changing an order's flow needs more than "ok". */
export const PLAN_REASON_MIN = 12;

/** The plan every order starts with: the ladder's own order, nothing dropped. */
export const DEFAULT_PHASE_PLAN: PhasePlan = PHASES.map((phase) => ({ phase, skipped: false }));

export function isDefaultPlan(plan: PhasePlan): boolean {
  if (plan.length !== PHASES.length) return false;
  return plan.every((e, i) => e.phase === PHASES[i] && !e.skipped);
}

/** Position of a phase in this order's flow. */
export function phaseRank(plan: PhasePlan, phase: PhaseId): number {
  const i = plan.findIndex((e) => e.phase === phase);
  return i < 0 ? PHASES.indexOf(phase) : i;
}

export function isPhaseSkipped(plan: PhasePlan | null | undefined, phase: PhaseId): boolean {
  return Boolean(plan?.some((e) => e.phase === phase && e.skipped));
}

/**
 * Forces any input into a well-formed plan: all seven phases exactly once,
 * structural phases first in their own order, the terminal phase last, and the
 * flexible ones in whatever order the input put them.
 *
 * Written to be total rather than to validate, because it also runs on rows read
 * back from the database. A plan that was written under an older set of rules
 * must still load into something coherent instead of throwing on read.
 */
export function normalisePhasePlan(input: readonly PhasePlanEntry[] | null | undefined): PhasePlan {
  if (!input?.length) return DEFAULT_PHASE_PLAN.map((e) => ({ ...e }));

  const seen = new Map<PhaseId, boolean>();
  const order: PhaseId[] = [];
  for (const e of input) {
    if (!PHASES.includes(e.phase) || seen.has(e.phase)) continue;
    seen.set(e.phase, Boolean(e.skipped));
    order.push(e.phase);
  }
  // Anything the input omitted keeps its ladder position among the flexible run.
  for (const p of PHASES) {
    if (!seen.has(p)) {
      seen.set(p, false);
      order.push(p);
    }
  }

  const flexible = order.filter((p) => PHASE_MUTABILITY[p] === 'FLEXIBLE');
  const arranged = [...LEADING_PHASES, ...flexible, ...TRAILING_PHASES];

  return arranged.map((phase) => ({
    phase,
    // A phase that cannot be dropped is never stored as dropped, whatever the
    // input claimed.
    skipped: PHASE_MUTABILITY[phase] === 'FLEXIBLE' ? Boolean(seen.get(phase)) : false,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// What is still open to change on THIS order
// ═══════════════════════════════════════════════════════════════════════════

export interface PhaseEditability {
  phase: PhaseId;
  /** False for structural/terminal phases and for anything already begun. */
  canMove: boolean;
  canSkip: boolean;
  canRestore: boolean;
  /** Plain reason it is locked, for the tooltip. Null when it is editable. */
  lockedBecause: string | null;
}

/**
 * Which phases this order can still re-plan.
 *
 * The rule is the past: everything up to and including the phase the order is
 * currently sitting in is fixed. Moving a completed phase would misstate history,
 * and moving a future phase to before the current one would schedule work into a
 * point the order has already gone past.
 */
export function phaseEditability(plan: PhasePlan, currentPhase: PhaseId): PhaseEditability[] {
  const currentRank = phaseRank(plan, currentPhase);

  return plan.map(({ phase, skipped }) => {
    const mut = PHASE_MUTABILITY[phase];
    const rank = phaseRank(plan, phase);

    if (mut === 'STRUCTURAL') {
      return {
        phase,
        canMove: false,
        canSkip: false,
        canRestore: false,
        lockedBecause: `${PHASE_DEFS[phase].label} is how the order comes into existence — it always runs, and always first.`,
      };
    }
    if (mut === 'TERMINAL') {
      return {
        phase,
        canMove: false,
        canSkip: false,
        canRestore: false,
        lockedBecause: `${PHASE_DEFS[phase].label} raises the tax invoice and closes the order, so it always runs last. To stop an order, cancel it rather than removing this phase.`,
      };
    }
    if (rank < currentRank) {
      return {
        phase,
        canMove: false,
        canSkip: false,
        canRestore: false,
        lockedBecause: 'This order has already been through it.',
      };
    }
    if (rank === currentRank) {
      return {
        phase,
        canMove: false,
        canSkip: false,
        canRestore: false,
        lockedBecause: 'The order is inside this phase right now.',
      };
    }
    return {
      phase,
      canMove: true,
      canSkip: !skipped,
      canRestore: skipped,
      lockedBecause: null,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// What dropping a phase actually costs
// ═══════════════════════════════════════════════════════════════════════════

/** How much weight the lost stages carry. Drives the badge on the dialog. */
export type CurtailWeight = 'MONEY' | 'STATUTORY' | 'ROUTINE';

export interface CurtailImpact {
  phase: PhaseId;
  /** Codes and labels of the stages this order would no longer walk through. */
  stages: { code: string; label: string }[];
  weight: CurtailWeight;
  /** The specific thing that stops being recorded. Written to be read out loud. */
  consequence: string;
  /** The case in which dropping it is genuinely the right call. */
  legitimateWhen: string;
}

const CURTAIL_NOTES: Record<
  PhaseId,
  { weight: CurtailWeight; consequence: string; legitimateWhen: string } | null
> = {
  A: null,
  B: null,
  G: null,
  C: {
    weight: 'MONEY',
    consequence:
      'No money is arranged before the supplier starts work. Nothing funds the escrow, and the part-release that pays for testing never happens.',
    legitimateWhen:
      'The supplier is on an existing credit line already confirmed outside this order, so there is nothing to arm.',
  },
  D: {
    weight: 'ROUTINE',
    consequence:
      'Nothing is independently tested before the full quantity ships. A bad lot is found on arrival in India instead of at the supplier, after duty has been paid on it.',
    legitimateWhen:
      'No line on this order requires testing, or the customer has accepted the supplier’s own certificate of conformance in place of an independent test.',
  },
  E: {
    weight: 'STATUTORY',
    consequence:
      'No customs entry is filed and no duty is assessed or paid. The order records no import at all, so there is no Bill of Entry to claim import IGST against.',
    legitimateWhen:
      'The supplier is in India and the goods never cross a border, so there is no import to declare.',
  },
  F: {
    weight: 'MONEY',
    consequence:
      'The goods are never inspected on arrival and the supplier is never marked paid. The final escrow release is not authorised, so the money stays held.',
    legitimateWhen:
      'Practically never on a live order. Use it only where settlement is genuinely handled outside this platform.',
  },
};

export function curtailImpact(phase: PhaseId): CurtailImpact | null {
  const note = CURTAIL_NOTES[phase];
  if (!note) return null;
  return {
    phase,
    stages: STAGE_DEFS.filter((s) => s.phase === phase && !s.isExceptionBranch).map((s) => ({
      code: s.code,
      label: s.label,
    })),
    ...note,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Arrangements that are allowed but have a cost
// ═══════════════════════════════════════════════════════════════════════════

export interface PlanWarning {
  /** Phases the warning is about, for highlighting. */
  phases: PhaseId[];
  message: string;
}

/**
 * Consequences of a proposed arrangement, in the operator's words.
 *
 * None of these block a save. They exist because the alternative — silently
 * accepting an arrangement whose cost is not obvious — is how a demo flow becomes
 * a live flow that nobody checked.
 */
export function planWarnings(plan: PhasePlan, ctx?: StageContext | null): PlanWarning[] {
  const out: PlanWarning[] = [];
  const live = plan.filter((e) => !e.skipped).map((e) => e.phase);
  const rankOf = (p: PhaseId) => live.indexOf(p);
  const has = (p: PhaseId) => live.includes(p);
  const before = (a: PhaseId, b: PhaseId) =>
    has(a) && has(b) && rankOf(a) < rankOf(b);

  // ── Reordering ───────────────────────────────────────────────────────────
  if (before('D', 'C')) {
    out.push({
      phases: ['C', 'D'],
      message:
        'Testing now runs before the money is armed. C3 “Escrow partial release for testing” exists to pay the laboratory, so with D first that release has nothing left to fund — the testing has to be paid for another way.',
    });
  }
  if (before('E', 'D')) {
    out.push({
      phases: ['D', 'E'],
      message:
        'Testing now happens after the goods have cleared customs. A failed lot cannot simply go back to the supplier — duty has already been assessed and paid on it, so returning it becomes a re-export.',
    });
  }
  if (before('F', 'E')) {
    out.push({
      phases: ['E', 'F'],
      message:
        'Inbound inspection is scheduled before the shipment arrives. F1 inspects goods received at 1BUY, which does not happen until E7.',
    });
  }
  if (before('F', 'C')) {
    out.push({
      phases: ['C', 'F'],
      message:
        'The supplier is paid in full before any money is put in escrow. F3 authorises a final release from an account that phase C has not opened yet.',
    });
  }

  // ── Curtailment against what the order actually is ───────────────────────
  if (isPhaseSkipped(plan, 'E') && ctx) {
    out.push({
      phases: ['E'],
      message:
        'Logistics is removed, so this order is being treated as a domestic purchase. Check the supplier is Indian and the buy currency is INR — a foreign supplier with no customs entry means an import that was never declared.',
    });
  }
  if (isPhaseSkipped(plan, 'D') && ctx?.testingRequired) {
    out.push({
      phases: ['D'],
      message:
        'Quality assurance is removed, but lines on this order are still marked as requiring testing. Either the flow or those lines is wrong.',
    });
  }
  if (isPhaseSkipped(plan, 'C') && ctx?.paymentMethod === 'ESCROW') {
    out.push({
      phases: ['C'],
      message:
        'Financial arming is removed, but this order is on escrow terms. With no account opened and nothing funded, the escrow release in phase F has no account to release from.',
    });
  }

  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// Validation and change description
// ═══════════════════════════════════════════════════════════════════════════

export type PlanValidation =
  | { ok: true; plan: PhasePlan }
  | { ok: false; errors: string[] };

/**
 * Checks a proposed plan against what this order is still allowed to change.
 *
 * Compares against the plan currently in force rather than the default, so an
 * order that was already re-planned once is judged on where it is now.
 */
export function validatePhasePlan(args: {
  proposed: readonly PhasePlanEntry[];
  current: PhasePlan;
  currentPhase: PhaseId;
}): PlanValidation {
  const proposed = normalisePhasePlan(args.proposed);
  const current = normalisePhasePlan(args.current);
  const editable = new Map(phaseEditability(current, args.currentPhase).map((e) => [e.phase, e]));
  const errors: string[] = [];

  /**
   * Violations of the pinned-position rules are caught against the RAW input,
   * before normalisation.
   *
   * normalisePhasePlan corrects an impossible arrangement rather than throwing —
   * it has to, because it also runs on rows read back from the database. But that
   * correction launders the caller's intent: a request to move phase A into the
   * middle comes back as the standard order, compares equal to what is already in
   * force, and would be reported as "nothing changed" rather than as the thing it
   * actually was. The operator deserves to be told which rule they hit.
   */
  const rawOrder: PhaseId[] = [];
  const rawSkipped = new Set<PhaseId>();
  for (const e of args.proposed) {
    if (!PHASES.includes(e.phase) || rawOrder.includes(e.phase)) continue;
    rawOrder.push(e.phase);
    if (e.skipped) rawSkipped.add(e.phase);
  }
  for (const p of PHASES) if (!rawOrder.includes(p)) rawOrder.push(p);

  for (const p of PHASES) {
    const mut = PHASE_MUTABILITY[p];
    if (mut === 'FLEXIBLE') continue;
    if (rawOrder.indexOf(p) !== proposed.findIndex((e) => e.phase === p)) {
      errors.push(
        `Phase ${p} — ${PHASE_DEFS[p].label} cannot be moved. ${
          editable.get(p)?.lockedBecause ?? ''
        }`.trim(),
      );
    }
    if (rawSkipped.has(p)) {
      errors.push(
        `Phase ${p} — ${PHASE_DEFS[p].label} cannot be removed. ${
          editable.get(p)?.lockedBecause ?? ''
        }`.trim(),
      );
    }
  }

  for (const p of PHASES) {
    const rule = editable.get(p)!;
    const movedTo = phaseRank(proposed, p);
    const wasAt = phaseRank(current, p);
    const nowSkipped = isPhaseSkipped(proposed, p);
    const wasSkipped = isPhaseSkipped(current, p);

    if (movedTo !== wasAt && !rule.canMove) {
      errors.push(
        `Phase ${p} — ${PHASE_DEFS[p].label} cannot be moved. ${rule.lockedBecause ?? ''}`.trim(),
      );
    }
    if (nowSkipped && !wasSkipped && !rule.canSkip) {
      errors.push(
        `Phase ${p} — ${PHASE_DEFS[p].label} cannot be removed. ${rule.lockedBecause ?? ''}`.trim(),
      );
    }
    if (!nowSkipped && wasSkipped && !rule.canRestore) {
      errors.push(
        `Phase ${p} — ${PHASE_DEFS[p].label} cannot be put back. ${rule.lockedBecause ?? ''}`.trim(),
      );
    }
  }

  // Belt and braces. normalisePhasePlan already guarantees this, so a failure
  // here means the invariant broke rather than the operator doing something odd.
  if (proposed.filter((e) => !e.skipped).length === 0) {
    errors.push('An order needs at least one phase to run through.');
  }

  return errors.length ? { ok: false, errors } : { ok: true, plan: proposed };
}

export interface PlanChange {
  kind: 'MOVED' | 'REMOVED' | 'RESTORED';
  phase: PhaseId;
  /** One line, past tense, naming what changed. Goes into the audit log. */
  detail: string;
}

/** The difference between two plans, as sentences rather than a diff. */
export function describePlanChanges(before: PhasePlan, after: PhasePlan): PlanChange[] {
  const a = normalisePhasePlan(before);
  const b = normalisePhasePlan(after);
  const out: PlanChange[] = [];

  for (const p of PHASES) {
    const wasSkipped = isPhaseSkipped(a, p);
    const nowSkipped = isPhaseSkipped(b, p);
    if (nowSkipped && !wasSkipped) {
      out.push({
        kind: 'REMOVED',
        phase: p,
        detail: `Phase ${p} — ${PHASE_DEFS[p].label} removed from this order's flow.`,
      });
      continue;
    }
    if (!nowSkipped && wasSkipped) {
      out.push({
        kind: 'RESTORED',
        phase: p,
        detail: `Phase ${p} — ${PHASE_DEFS[p].label} put back into this order's flow.`,
      });
      continue;
    }
  }

  /**
   * Position changes are measured only among the phases live in BOTH plans.
   *
   * Comparing raw positions would report a move for every phase downstream of a
   * removal: drop E and F closes up from 6th to 5th, which is not a decision
   * anyone made. Restricting the comparison to the common set asks the right
   * question — did these phases change order relative to each other.
   */
  const liveBefore = a.filter((e) => !e.skipped).map((e) => e.phase);
  const liveAfter = b.filter((e) => !e.skipped).map((e) => e.phase);
  const common = new Set(liveBefore.filter((p) => liveAfter.includes(p)));
  const seqBefore = liveBefore.filter((p) => common.has(p));
  const seqAfter = liveAfter.filter((p) => common.has(p));

  for (const p of seqAfter) {
    const from = seqBefore.indexOf(p);
    const to = seqAfter.indexOf(p);
    if (from === to) continue;
    // Named against its neighbour in the full live sequence, which is what the
    // operator reads off the rail.
    const fullTo = liveAfter.indexOf(p);
    const neighbour = fullTo > 0 ? liveAfter[fullTo - 1] : null;
    out.push({
      kind: 'MOVED',
      phase: p,
      detail: neighbour
        ? `Phase ${p} — ${PHASE_DEFS[p].label} moved to run after phase ${neighbour} — ${PHASE_DEFS[neighbour].label}.`
        : `Phase ${p} — ${PHASE_DEFS[p].label} moved to run first.`,
    });
  }

  return out;
}

/** The flow as a single readable line: "A → B → D → C → E → F → G". */
export function planSequence(plan: PhasePlan): string {
  return normalisePhasePlan(plan)
    .filter((e) => !e.skipped)
    .map((e) => e.phase)
    .join(' → ');
}
