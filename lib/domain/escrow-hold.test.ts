/**
 * Escrow holds until the goods arrive.
 *
 * The real arrangement: the provider confirms to the supplier that the money is
 * held, the supplier ships against that confirmation, and the funds move only
 * once the goods are received at 1BUY. A part-payment before then gives up the
 * exact leverage the escrow exists to create — so it is a concession that has
 * to be negotiated and written down, never a path the flow assumes.
 *
 * This was previously keyed to "escrow + testing required", which made an
 * unusual concession the standard route for every tested order. These tests
 * exist so it cannot drift back.
 */

import { describe, expect, it } from 'vitest';
import { applicableStages, getStage, type StageContext } from './stages';

const base: StageContext = {
  paymentMethod: 'ESCROW',
  testingRequired: true,
  testScope: 'LOT_SAMPLE',
  incoterms: 'CIF',
};

const codes = (ctx: StageContext) => applicableStages(ctx).map((s) => s.id);

describe('escrow releases nothing before the goods land', () => {
  it('omits the partial-release step on a normal tested escrow order', () => {
    expect(codes(base)).not.toContain('ESCROW_PARTIAL_RELEASE_FOR_TESTING');
  });

  it('treats a missing term as "not allowed" rather than "unknown"', () => {
    expect(codes({ ...base, escrowPartialRelease: undefined })).not.toContain(
      'ESCROW_PARTIAL_RELEASE_FOR_TESTING',
    );
    expect(codes({ ...base, escrowPartialRelease: false })).not.toContain(
      'ESCROW_PARTIAL_RELEASE_FOR_TESTING',
    );
  });

  it('runs it only where the contract explicitly allows it', () => {
    expect(codes({ ...base, escrowPartialRelease: true })).toContain(
      'ESCROW_PARTIAL_RELEASE_FOR_TESTING',
    );
  });

  it('still needs testing for it to make sense at all', () => {
    // The tranche exists to fund sending parts to a lab. No lab, no tranche,
    // whatever the contract says.
    expect(
      codes({ ...base, testingRequired: false, escrowPartialRelease: true }),
    ).not.toContain('ESCROW_PARTIAL_RELEASE_FOR_TESTING');
  });

  it('explains the omission in terms of the hold, not of testing', () => {
    const stage = getStage('ESCROW_PARTIAL_RELEASE_FOR_TESTING');
    const reason = stage.notApplicableReason?.({ ...base, escrowPartialRelease: false }) ?? '';
    expect(reason).toMatch(/received at 1BUY/i);
  });

  it('says on the funding step that the supplier ships against a confirmation', () => {
    const funded = getStage('ESCROW_FUNDED');
    expect(`${funded.description} ${funded.exitCriteria}`).toMatch(/confirm/i);
    expect(funded.description).toMatch(/do not move until the goods are received/i);
  });
});
