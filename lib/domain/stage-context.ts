/**
 * BUILDING A StageContext FROM A WORK ORDER ROW — the only sanctioned way.
 *
 * Every stage computation takes a StageContext: which stages apply, what comes
 * next, whether a transition is legal, how far along the order is. Get the
 * context wrong and every one of those answers is wrong together.
 *
 * This exists because the context was being assembled by hand in four places, and
 * when per-order phase plans arrived only one of them learned about them. The
 * result was an order that RENDERED its re-planned flow correctly — the page knew
 * the plan — while the server computed the standard ladder and refused the very
 * advance the page was offering. The order could not move at all, and the two
 * halves each looked right on their own.
 *
 * So there is one function, it takes the row, and the row must carry its plan.
 * A caller that forgets to fetch `phasePlan` now gets a type error rather than an
 * order that quietly cannot be advanced.
 */

import { normalisePhasePlan } from './phase-plan';
import type { PaymentMethod, TestScope } from './enums';
import type { PhaseId, StageContext } from './stages';

/** The columns a stage computation actually depends on. */
export interface StageContextSource {
  paymentMethod: string;
  testingRequired: boolean;
  testScope: string | null;
  /**
   * The order's phase plan rows, in position order, or an empty array for an
   * order on the standard ladder.
   *
   * Required rather than optional on purpose: an omitted plan and a standard
   * ladder are indistinguishable once inside this function, and that ambiguity is
   * exactly what let the bug through. Callers must fetch it and pass it, even if
   * that means passing `[]`.
   */
  phasePlan: readonly { phase: string; skipped: boolean }[];
}

export function stageContextFrom(wo: StageContextSource): StageContext {
  return {
    paymentMethod: wo.paymentMethod as PaymentMethod,
    testingRequired: wo.testingRequired,
    testScope: (wo.testScope as TestScope | null) ?? null,
    // No rows means the standard ladder, which the engine represents as no plan
    // rather than as the default plan — cheaper, and it keeps "unplanned" and
    // "planned back to standard" behaving identically.
    phasePlan: wo.phasePlan.length
      ? normalisePhasePlan(
          wo.phasePlan.map((r) => ({ phase: r.phase as PhaseId, skipped: r.skipped })),
        )
      : null,
  };
}

/** The Prisma include every caller needs so the plan is never left behind. */
export const STAGE_CONTEXT_INCLUDE = {
  phasePlan: { orderBy: { position: 'asc' } },
} as const;
