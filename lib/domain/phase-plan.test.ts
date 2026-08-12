import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PHASE_PLAN,
  describePlanChanges,
  isDefaultPlan,
  normalisePhasePlan,
  phaseEditability,
  planSequence,
  planWarnings,
  validatePhasePlan,
  curtailImpact,
} from './phase-plan';
import {
  applicableStages,
  canTransition,
  nextStageFor,
  phaseProgress,
  progressFor,
  railStates,
  type PhaseId,
  type PhasePlan,
  type StageContext,
} from './stages';

const CTX: StageContext = {
  paymentMethod: 'ESCROW',
  testingRequired: true,
  testScope: 'LOT_SAMPLE',
  incoterms: 'CIF',
};

/** Build a plan from a sequence string like "A B D C E F G", with * for removed. */
function plan(spec: string): PhasePlan {
  return spec
    .trim()
    .split(/\s+/)
    .map((tok) => ({
      phase: tok.replace('*', '') as PhaseId,
      skipped: tok.endsWith('*'),
    }));
}

describe('normalisePhasePlan — always returns something coherent', () => {
  it('fills in an empty plan with the ladder order', () => {
    expect(planSequence(normalisePhasePlan(null))).toBe('A → B → C → D → E → F → G');
    expect(isDefaultPlan(normalisePhasePlan([]))).toBe(true);
  });

  it('keeps the flexible phases in the order given', () => {
    expect(planSequence(normalisePhasePlan(plan('A B E D C F G')))).toBe(
      'A → B → E → D → C → F → G',
    );
  });

  it('forces the structural phases to the front however they were sent', () => {
    // Someone posts a plan claiming testing runs before the order exists.
    expect(planSequence(normalisePhasePlan(plan('D A B C E F G')))).toBe(
      'A → B → D → C → E → F → G',
    );
  });

  it('forces the terminal phase last', () => {
    expect(planSequence(normalisePhasePlan(plan('A B G C D E F')))).toBe(
      'A → B → C → D → E → F → G',
    );
  });

  it('refuses to record a structural or terminal phase as removed', () => {
    const p = normalisePhasePlan(plan('A* B* C D E F G*'));
    expect(p.filter((e) => e.skipped)).toEqual([]);
  });

  it('drops a repeated phase rather than duplicating it', () => {
    const p = normalisePhasePlan(plan('A B C C D E F G'));
    expect(p).toHaveLength(7);
    expect(new Set(p.map((e) => e.phase)).size).toBe(7);
  });

  it('supplies any phase the input forgot', () => {
    const p = normalisePhasePlan(plan('A B C G'));
    expect(p.map((e) => e.phase).sort()).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
  });
});

describe('phaseEditability — the past is not up for re-planning', () => {
  it('locks the structural phases with a reason a person can read', () => {
    const e = phaseEditability(DEFAULT_PHASE_PLAN, 'C');
    const a = e.find((x) => x.phase === 'A')!;
    expect(a.canMove).toBe(false);
    expect(a.canSkip).toBe(false);
    expect(a.lockedBecause).toMatch(/comes into existence/);
  });

  it('locks the terminal phase and points at cancellation instead', () => {
    const g = phaseEditability(DEFAULT_PHASE_PLAN, 'C').find((x) => x.phase === 'G')!;
    expect(g.canSkip).toBe(false);
    expect(g.lockedBecause).toMatch(/cancel it/);
  });

  it('locks a phase already completed', () => {
    const c = phaseEditability(DEFAULT_PHASE_PLAN, 'E').find((x) => x.phase === 'C')!;
    expect(c.canMove).toBe(false);
    expect(c.lockedBecause).toMatch(/already been through it/);
  });

  it('locks the phase the order is inside right now', () => {
    const d = phaseEditability(DEFAULT_PHASE_PLAN, 'D').find((x) => x.phase === 'D')!;
    expect(d.canMove).toBe(false);
    expect(d.lockedBecause).toMatch(/inside this phase/);
  });

  it('opens every flexible phase still ahead', () => {
    const e = phaseEditability(DEFAULT_PHASE_PLAN, 'B');
    for (const p of ['C', 'D', 'E', 'F'] as PhaseId[]) {
      const row = e.find((x) => x.phase === p)!;
      expect(row.canMove, p).toBe(true);
      expect(row.canSkip, p).toBe(true);
      expect(row.lockedBecause, p).toBeNull();
    }
  });

  it('offers restore, not skip, on a phase already removed', () => {
    const row = phaseEditability(normalisePhasePlan(plan('A B C D* E F G')), 'B').find(
      (x) => x.phase === 'D',
    )!;
    expect(row.canSkip).toBe(false);
    expect(row.canRestore).toBe(true);
  });
});

describe('validatePhasePlan', () => {
  const at = (p: PhaseId) => ({ current: DEFAULT_PHASE_PLAN, currentPhase: p });

  it('accepts reordering the phases still ahead', () => {
    const r = validatePhasePlan({ proposed: plan('A B C E D F G'), ...at('B') });
    expect(r.ok).toBe(true);
    if (r.ok) expect(planSequence(r.plan)).toBe('A → B → C → E → D → F → G');
  });

  it('accepts curtailing a phase still ahead', () => {
    const r = validatePhasePlan({ proposed: plan('A B C D E* F G'), ...at('B') });
    expect(r.ok).toBe(true);
    if (r.ok) expect(planSequence(r.plan)).toBe('A → B → C → D → F → G');
  });

  it('refuses to move a phase the order has already been through', () => {
    // At F, trying to shuffle C — which is behind it.
    const r = validatePhasePlan({ proposed: plan('A B D C E F G'), ...at('F') });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/already been through it/);
  });

  it('refuses to curtail the phase the order is sitting in', () => {
    const r = validatePhasePlan({ proposed: plan('A B C D* E F G'), ...at('D') });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/inside this phase/);
  });

  it('leaves at least one phase running, always', () => {
    const r = validatePhasePlan({ proposed: plan('A* B* C* D* E* F* G*'), ...at('B') });
    // normalise refuses to strike A/B/G, so this is satisfied structurally.
    if (r.ok) expect(r.plan.filter((e) => !e.skipped).length).toBeGreaterThan(0);
  });

  /**
   * These four go through normalisePhasePlan, which CORRECTS them rather than
   * failing. Validation therefore has to judge the raw intent, or an illegal
   * request comes back as "nothing changed" and the operator is never told which
   * rule they hit.
   */
  it('names the rule when asked to move a structural phase', () => {
    const r = validatePhasePlan({ proposed: plan('C A B D E F G'), ...at('B') });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/Phase A — Demand Capture cannot be moved/);
  });

  it('names the rule when asked to move the terminal phase off the end', () => {
    const r = validatePhasePlan({ proposed: plan('A B G C D E F'), ...at('B') });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/Phase G .* cannot be moved/);
  });

  it('names the rule when asked to remove a structural phase', () => {
    const r = validatePhasePlan({ proposed: plan('A B* C D E F G'), ...at('B') });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/Phase B .* cannot be removed/);
  });

  it('names the rule when asked to remove the terminal phase', () => {
    const r = validatePhasePlan({ proposed: plan('A B C D E F G*'), ...at('B') });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/raises the tax invoice/);
  });

  it('judges against the plan in force, not the default', () => {
    // Already re-planned to D-before-C; now put it back. Legal at phase B.
    const inForce = normalisePhasePlan(plan('A B D C E F G'));
    const r = validatePhasePlan({
      proposed: plan('A B C D E F G'),
      current: inForce,
      currentPhase: 'B',
    });
    expect(r.ok).toBe(true);
  });
});

describe('describePlanChanges — reads as sentences, not a diff', () => {
  it('names a removal', () => {
    const c = describePlanChanges(DEFAULT_PHASE_PLAN, normalisePhasePlan(plan('A B C D E* F G')));
    expect(c).toHaveLength(1);
    expect(c[0].kind).toBe('REMOVED');
    expect(c[0].detail).toMatch(/Logistics removed from this order's flow/);
  });

  it('names a move against the phase it now follows', () => {
    const c = describePlanChanges(DEFAULT_PHASE_PLAN, normalisePhasePlan(plan('A B D C E F G')));
    const moved = c.find((x) => x.kind === 'MOVED' && x.phase === 'D')!;
    expect(moved.detail).toMatch(/moved to run after phase B/);
  });

  it('names a restore', () => {
    const c = describePlanChanges(
      normalisePhasePlan(plan('A B C D* E F G')),
      DEFAULT_PHASE_PLAN,
    );
    expect(c[0].kind).toBe('RESTORED');
    expect(c[0].detail).toMatch(/put back into this order's flow/);
  });

  it('says nothing when nothing changed', () => {
    expect(describePlanChanges(DEFAULT_PHASE_PLAN, DEFAULT_PHASE_PLAN)).toEqual([]);
  });
});

describe('planWarnings — allowed, but the cost is stated', () => {
  it('flags testing scheduled before the money is armed', () => {
    const w = planWarnings(normalisePhasePlan(plan('A B D C E F G')), CTX);
    expect(w.map((x) => x.message).join(' ')).toMatch(/partial release for testing/i);
  });

  it('flags testing after customs, and says why it costs more', () => {
    const w = planWarnings(normalisePhasePlan(plan('A B C E D F G')), CTX);
    expect(w.map((x) => x.message).join(' ')).toMatch(/re-export/);
  });

  it('flags inspection scheduled before the goods arrive', () => {
    const w = planWarnings(normalisePhasePlan(plan('A B C D F E G')), CTX);
    expect(w.map((x) => x.message).join(' ')).toMatch(/before the shipment arrives/);
  });

  it('flags removing customs on an order that is priced in a foreign currency', () => {
    const w = planWarnings(normalisePhasePlan(plan('A B C D E* F G')), CTX);
    expect(w.map((x) => x.message).join(' ')).toMatch(/domestic purchase/);
  });

  it('flags removing testing while lines still require it', () => {
    const w = planWarnings(normalisePhasePlan(plan('A B C D* E F G')), CTX);
    expect(w.map((x) => x.message).join(' ')).toMatch(/still marked as requiring testing/);
  });

  it('flags removing escrow arming on an escrow order', () => {
    const w = planWarnings(normalisePhasePlan(plan('A B C* D E F G')), CTX);
    expect(w.map((x) => x.message).join(' ')).toMatch(/no account opened/i);
  });

  it('says nothing about the standard flow', () => {
    expect(planWarnings(DEFAULT_PHASE_PLAN, CTX)).toEqual([]);
  });
});

describe('curtailImpact — names the stages that would be lost', () => {
  it('lists the customs stages and marks them statutory', () => {
    const i = curtailImpact('E')!;
    expect(i.weight).toBe('STATUTORY');
    expect(i.stages.map((s) => s.code)).toContain('E4');
    expect(i.consequence).toMatch(/Bill of Entry/);
  });

  it('marks the settlement phase as money', () => {
    expect(curtailImpact('F')!.weight).toBe('MONEY');
  });

  it('returns nothing for a phase that cannot be dropped', () => {
    expect(curtailImpact('A')).toBeNull();
    expect(curtailImpact('G')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The plan has to change the flow, not just the picture
// ═══════════════════════════════════════════════════════════════════════════

describe('the stage engine honours a phase plan', () => {
  const reordered: StageContext = { ...CTX, phasePlan: normalisePhasePlan(plan('A B C E D F G')) };
  const curtailed: StageContext = { ...CTX, phasePlan: normalisePhasePlan(plan('A B C D E* F G')) };

  it('reorders the ladder itself', () => {
    const phases = applicableStages(reordered).map((s) => s.phase);
    const firstD = phases.indexOf('D');
    const firstE = phases.indexOf('E');
    expect(firstE).toBeLessThan(firstD);
  });

  it('keeps the ladder order inside each phase', () => {
    const codes = applicableStages(reordered)
      .filter((s) => s.phase === 'E')
      .map((s) => s.code);
    expect(codes).toEqual(['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7']);
  });

  it('shortens the flow when a phase is curtailed', () => {
    const before = applicableStages(CTX).filter((s) => s.phase === 'E').length;
    const live = railStates({
      currentStage: 'WORK_ORDER_ACTIVE',
      ctx: curtailed,
      isBlocked: false,
      stageEnteredAt: new Date(),
      completedStageIds: [],
    }).filter((s) => s.state !== 'SKIPPED');
    const standard = railStates({
      currentStage: 'WORK_ORDER_ACTIVE',
      ctx: CTX,
      isBlocked: false,
      stageEnteredAt: new Date(),
      completedStageIds: [],
    }).filter((s) => s.state !== 'SKIPPED');
    expect(before).toBe(7);
    expect(standard.length - live.length).toBe(7);
  });

  it('keeps a curtailed phase visible, struck through, with the reason why', () => {
    const states = railStates({
      currentStage: 'WORK_ORDER_ACTIVE',
      ctx: curtailed,
      isBlocked: false,
      stageEnteredAt: new Date(),
      completedStageIds: [],
    });
    const e1 = states.find((s) => s.stage.code === 'E1')!;
    expect(e1.state).toBe('SKIPPED');
    expect(e1.skipReason).toMatch(/taken out of this order's flow/);
  });

  it('sends the order to the re-planned phase next, not the ladder-next one', () => {
    // Last stage of C on an escrow order is C3. Standard flow goes to D1; with D
    // moved after E it must go to E1 instead.
    expect(nextStageFor('ESCROW_PARTIAL_RELEASE_FOR_TESTING', CTX)?.code).toBe('D1');
    expect(nextStageFor('ESCROW_PARTIAL_RELEASE_FOR_TESTING', reordered)?.code).toBe('E1');
  });

  it('steps over a curtailed phase entirely', () => {
    // With E removed, the last stage of D leads straight into F.
    expect(nextStageFor('PARTS_RETURNED_TO_SUPPLIER', CTX)?.phase).toBe('E');
    expect(nextStageFor('PARTS_RETURNED_TO_SUPPLIER', curtailed)?.phase).toBe('F');
  });

  it('allows the re-planned transition and still refuses a random one', () => {
    const ok = canTransition('ESCROW_PARTIAL_RELEASE_FOR_TESTING', 'FULL_SHIPMENT_DISPATCHED_BY_SUPPLIER', reordered);
    expect(ok.ok).toBe(true);
    // The same jump is not adjacent on the standard flow.
    expect(canTransition('ESCROW_PARTIAL_RELEASE_FOR_TESTING', 'FULL_SHIPMENT_DISPATCHED_BY_SUPPLIER', CTX).ok).toBe(false);
    // And a plan does not open the gates generally.
    expect(canTransition('CUSTOMER_PO_RECEIVED', 'ORDER_CLOSED', reordered).ok).toBe(false);
  });

  it('does not paint a phase that was moved later as already done', () => {
    // Order is in E, which now runs BEFORE D. D must still read as upcoming.
    const states = railStates({
      currentStage: 'IN_TRANSIT_INTERNATIONAL',
      ctx: reordered,
      isBlocked: false,
      stageEnteredAt: new Date(),
      completedStageIds: [],
    });
    for (const s of states.filter((x) => x.stage.phase === 'D')) {
      expect(s.state, s.stage.code).toBe('UPCOMING');
    }
    // And E1, which is behind the current stage, does read as done.
    expect(states.find((s) => s.stage.code === 'E1')!.state).toBe('COMPLETED');
  });

  it('reports the phase strip in the order the work happens', () => {
    const rows = phaseProgress({
      currentStage: 'WORK_ORDER_ACTIVE',
      ctx: reordered,
      isBlocked: false,
      stageEnteredAt: new Date(),
      completedStageIds: [],
    });
    expect(rows.map((r) => r.phase.id)).toEqual(['A', 'B', 'C', 'E', 'D', 'F', 'G']);
  });

  it('marks a curtailed phase as curtailed, distinctly from an empty one', () => {
    const rows = phaseProgress({
      currentStage: 'WORK_ORDER_ACTIVE',
      ctx: curtailed,
      isBlocked: false,
      stageEnteredAt: new Date(),
      completedStageIds: [],
    });
    expect(rows.find((r) => r.phase.id === 'E')!.curtailed).toBe(true);
    expect(rows.find((r) => r.phase.id === 'D')!.curtailed).toBe(false);
  });

  it('moves progress forward when the flow is shortened', () => {
    // Same stage, fewer stages left to walk, so a higher fraction is complete.
    const standard = progressFor('WORK_ORDER_ACTIVE', CTX);
    const shorter = progressFor('WORK_ORDER_ACTIVE', curtailed);
    expect(shorter).toBeGreaterThan(standard);
  });

  it('leaves an order with no plan behaving exactly as before', () => {
    const withNull: StageContext = { ...CTX, phasePlan: null };
    expect(applicableStages(withNull).map((s) => s.id)).toEqual(
      applicableStages(CTX).map((s) => s.id),
    );
    expect(nextStageFor('TERMS_LOCKED', withNull)?.id).toBe(nextStageFor('TERMS_LOCKED', CTX)?.id);
  });
});
