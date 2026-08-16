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
  /**
   * The term we BUY on — the work order's own Incoterm.
   *
   * This is what governs the inbound journey: who clears export, who books the
   * freight, who is importer of record and pays the duty. Phase E is derived
   * from it, so an EXW order and a DDP order no longer walk the same stages.
   *
   * Required for the same reason as `phasePlan`: a missing term is
   * indistinguishable from a term that happens to imply the default path, and
   * that ambiguity is what let the phase-plan bug through.
   */
  incoterms: string;
  /**
   * The customer order, for the term we SELL on — which governs the outbound leg
   * exactly as `incoterms` governs the inbound one.
   *
   * Asked for as the RELATION rather than a flat `sellIncoterms`, because every
   * caller already loads `customerPo`; this way they need no change at all,
   * while a caller that selects too narrowly gets a type error instead of an
   * outbound disclosure that silently never renders.
   */
  customerPo: { incoterms: string };
  /**
   * Whether the contract lets money leave escrow before the goods arrive.
   *
   * Optional, unlike the two above, because the safe reading of "absent" is
   * unambiguous here: no recorded term means no early release. That is the
   * opposite of the phase-plan case, where absence could mean either thing.
   */
  escrowPartialRelease?: boolean | null;
}

export function stageContextFrom(wo: StageContextSource): StageContext {
  return {
    paymentMethod: wo.paymentMethod as PaymentMethod,
    testingRequired: wo.testingRequired,
    testScope: (wo.testScope as TestScope | null) ?? null,
    incoterms: wo.incoterms,
    sellIncoterms: wo.customerPo.incoterms,
    // Defaults false when the column is null, which is the safe direction: an
    // order with no recorded term does not get an early release.
    escrowPartialRelease: wo.escrowPartialRelease === true,
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
