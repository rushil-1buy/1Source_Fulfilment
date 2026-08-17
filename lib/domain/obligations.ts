/**
 * Steps the order may move past, and the debt it carries when it does.
 *
 * THE FLOW IS NOT A QUEUE. Goods arrive, they are inspected, they are repacked
 * and they go out — and none of that waits on Finance telling the escrow to pay
 * the supplier. Forcing the payment to complete before the warehouse may touch
 * the lot holds a customer's delivery hostage to an internal money step, which
 * is a worse outcome for everybody including the supplier.
 *
 * SO IT IS DEFERRED, NOT SKIPPED. A step passed without being completed becomes
 * an OUTSTANDING OBLIGATION: it stays applicable, it stays visible, it names who
 * owes it and what it costs to leave it, and it is carried on the order until
 * somebody discharges it. The difference between deferring and skipping is
 * entirely whether anything is still chasing it afterwards.
 *
 * AND IT CANNOT BE DEFERRED FOREVER. Each obligation names the point past which
 * the order may not go while it is open. A supplier who shipped and was never
 * paid is not a paperwork problem, so the order does not close over an unpaid
 * one — the deferral buys time for the warehouse, it does not forgive the debt.
 *
 * Nothing here needs a new table. An obligation IS a stage the order has moved
 * beyond without completing, which the transition history already records; a
 * parallel list of "things we owe" would be a second source of truth that could
 * disagree with the first.
 */

import { applicableStages, getStage, type StageContext } from './stages';
import { STAKEHOLDER_META, type Stakeholder } from './enums';

export interface DeferralRule {
  /** Who is left holding it. */
  owedBy: Stakeholder;
  /** Why the flow is allowed to go on without it. */
  whyDeferrable: string;
  /** What it costs to leave it open — the reason somebody has to come back. */
  cost: string;
  /**
   * The stage the order may not pass while this is open.
   *
   * A deferral with no wall is an abandonment with extra steps.
   */
  blocksAt: string;
}

/**
 * The steps that may be carried rather than completed in order.
 *
 * Deliberately short. Anything that decides what physically happens to the
 * goods — receiving, inspecting, clearing customs — cannot be deferred, because
 * the next step reads its result. What CAN be deferred is money leaving the
 * company: the warehouse does not need it to have happened, only the supplier
 * does, and the supplier is protected by the wall rather than by the sequence.
 */
export const DEFERRABLE: Record<string, DeferralRule> = {
  ESCROW_FINAL_RELEASE_AUTHORISED: {
    owedBy: 'ONE_BUY_FINANCE',
    whyDeferrable:
      'The goods are received and accepted, so the warehouse has everything it needs. Authorising the release is a money step that nothing downstream reads.',
    cost:
      'The supplier has shipped and is unpaid. Every day this sits open is a day of their working capital funding our order, and it is the thing that costs a supplier relationship.',
    blocksAt: 'ORDER_CLOSED',
  },
  SUPPLIER_PAID_IN_FULL: {
    owedBy: 'ONE_BUY_FINANCE',
    whyDeferrable:
      'Repacking and dispatch do not depend on the money having landed. Holding a customer’s delivery for an internal payment step helps nobody.',
    cost:
      'The supplier is owed the balance. Leaving it open past dispatch means we have been paid for goods we have not finished paying for.',
    blocksAt: 'ORDER_CLOSED',
  },
  CUSTOMER_INVOICED_AND_SETTLED: {
    owedBy: 'ONE_BUY_FINANCE',
    whyDeferrable:
      'Proof of delivery is issued and the customer has their goods. Collection runs on its own terms.',
    cost: 'The receivable is open. The order cannot be closed against a margin nobody has collected.',
    blocksAt: 'ORDER_CLOSED',
  },
};

export const isDeferrable = (stageId: string): boolean => stageId in DEFERRABLE;

export interface Obligation {
  stageId: string;
  code: string;
  label: string;
  owedBy: Stakeholder;
  owedByLabel: string;
  cost: string;
  /** The stage the order may not pass while this is open. */
  blocksAt: string;
  blocksAtCode: string;
  blocksAtLabel: string;
  /** True once the order is standing at the wall this obligation puts up. */
  blockingNow: boolean;
}

/**
 * What this order owes.
 *
 * An obligation is a deferrable stage that is applicable to the order, sits
 * BEHIND where the order now stands, and was never completed. Derived rather
 * than stored, so it cannot drift from the transition history that produced it.
 */
export function outstandingObligations(
  ctx: StageContext,
  currentStageId: string,
  completedStageIds: string[],
): Obligation[] {
  const ladder = applicableStages(ctx);
  const done = new Set(completedStageIds);
  const currentIdx = ladder.findIndex((s) => s.id === currentStageId);
  if (currentIdx < 0) return [];

  return ladder.slice(0, currentIdx).flatMap((s) => {
    const rule = DEFERRABLE[s.id];
    if (!rule || done.has(s.id)) return [];
    const wall = getStage(rule.blocksAt);
    return [
      {
        stageId: s.id,
        code: s.code,
        label: s.label,
        owedBy: rule.owedBy,
        owedByLabel: STAKEHOLDER_META[rule.owedBy].label,
        cost: rule.cost,
        blocksAt: rule.blocksAt,
        blocksAtCode: wall.code,
        blocksAtLabel: wall.label,
        // The wall bites when the order tries to ENTER the blocking stage.
        blockingNow: currentStageId === rule.blocksAt || ladder[currentIdx + 1]?.id === rule.blocksAt,
      },
    ];
  });
}

/**
 * Whether an advance into `targetStageId` is barred by something still owed.
 *
 * Returns the obligations in the way, or an empty array. The gate that calls
 * this refuses with these in its own message, so the desk is told what to
 * discharge rather than that the order is stuck.
 */
export function obligationsBlocking(
  ctx: StageContext,
  currentStageId: string,
  completedStageIds: string[],
  targetStageId: string,
): Obligation[] {
  return outstandingObligations(ctx, currentStageId, completedStageIds).filter(
    (o) => o.blocksAt === targetStageId,
  );
}
