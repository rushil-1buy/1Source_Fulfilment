import { describe, expect, it } from 'vitest';
import { stageContextFrom } from './stage-context';
import { canTransition, nextStageFor } from './stages';

/** A work order row as the database hands it back. */
const row = (over: Partial<Parameters<typeof stageContextFrom>[0]> = {}) => ({
  paymentMethod: 'ESCROW',
  testingRequired: true,
  testScope: 'LOT_SAMPLE',
  phasePlan: [] as { phase: string; skipped: boolean }[],
  incoterms: 'CIF',
  ...over,
});

/** Testing moved after customs — the arrangement the server used to ignore. */
const REPLANNED = ['A', 'B', 'C', 'E', 'D', 'F', 'G'].map((phase) => ({ phase, skipped: false }));

describe('stageContextFrom — the columns a stage decision depends on', () => {
  it('carries payment method, testing and scope through', () => {
    const ctx = stageContextFrom(row({ paymentMethod: 'CREDIT', testingRequired: false, testScope: null }));
    expect(ctx.paymentMethod).toBe('CREDIT');
    expect(ctx.testingRequired).toBe(false);
    expect(ctx.testScope).toBeNull();
  });

  it('treats no plan rows as the standard ladder, not as an unknown', () => {
    expect(stageContextFrom(row()).phasePlan).toBeNull();
  });

  it('normalises whatever the rows contain', () => {
    // Rows written under older rules, or read back out of order.
    const ctx = stageContextFrom(row({ phasePlan: [{ phase: 'D', skipped: false }, { phase: 'A', skipped: false }] }));
    expect(ctx.phasePlan?.map((e) => e.phase)).toEqual(['A', 'B', 'D', 'C', 'E', 'F', 'G']);
  });
});

/**
 * The regression this file exists for.
 *
 * The plan was fetched for the order page but not for the server actions, so a
 * re-planned order rendered its own flow while the server computed the standard
 * one. The page offered a step the server then refused, and the order could not
 * be advanced at all.
 */
describe('a re-planned order computes the same answer on both sides', () => {
  const planned = stageContextFrom(row({ phasePlan: REPLANNED }));
  const unplanned = stageContextFrom(row());

  it('sends the order to the re-planned phase, not the ladder-next one', () => {
    expect(nextStageFor('ESCROW_PARTIAL_RELEASE_FOR_TESTING', unplanned)?.code).toBe('D1');
    expect(nextStageFor('ESCROW_PARTIAL_RELEASE_FOR_TESTING', planned)?.code).toBe('E1');
  });

  it('permits the transition the re-planned page offers', () => {
    // This is the exact pair that was refused: the page said E1, the server
    // computed the standard ladder and would not allow it.
    expect(
      canTransition('ESCROW_PARTIAL_RELEASE_FOR_TESTING', 'FULL_SHIPMENT_DISPATCHED_BY_SUPPLIER', planned).ok,
    ).toBe(true);
    expect(
      canTransition('ESCROW_PARTIAL_RELEASE_FOR_TESTING', 'FULL_SHIPMENT_DISPATCHED_BY_SUPPLIER', unplanned).ok,
    ).toBe(false);
  });

  it('still refuses a move that is wrong under the plan too', () => {
    expect(canTransition('CUSTOMER_PO_RECEIVED', 'ORDER_CLOSED', planned).ok).toBe(false);
  });

  it('steps over a curtailed phase', () => {
    const curtailed = stageContextFrom(
      row({ phasePlan: ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((phase) => ({ phase, skipped: phase === 'E' })) }),
    );
    expect(nextStageFor('PARTS_RETURNED_TO_SUPPLIER', curtailed)?.phase).toBe('F');
  });

  it('leaves an order with no plan behaving exactly as before', () => {
    for (const stage of ['CUSTOMER_PO_RECEIVED', 'TERMS_LOCKED', 'ESCROW_FUNDED', 'INSPECTION_PASSED']) {
      expect(nextStageFor(stage, unplanned)?.id).toBe(
        nextStageFor(stage, { paymentMethod: 'ESCROW', testingRequired: true, testScope: 'LOT_SAMPLE', incoterms: 'CIF' })?.id,
      );
    }
  });
});
