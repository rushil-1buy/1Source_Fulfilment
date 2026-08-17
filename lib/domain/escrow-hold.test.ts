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
import { applicableStages, getStage, nextStageFor, type StageContext } from './stages';

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

  /*
   * Withholding the tranche must not withhold the TESTING.
   *
   * Declining the partial release made phase D unreachable from C2: the picker
   * walked past a step that did not apply and landed on the shipment stages,
   * so an ordinary tested escrow order skipped the laboratory in silence. The
   * common case was the broken one, and nothing failed loudly enough to say so
   * — it took running a configured order end to end and noticing phase D never
   * happened. These two tests are what that costs to prevent.
   */
  it('still routes into testing when the partial release is declined', () => {
    expect(nextStageFor('ESCROW_FUNDED', base)?.id).toBe('TEST_DISPATCH_BOOKED');
  });

  it('arranges the money first where the contract does allow a tranche', () => {
    expect(nextStageFor('ESCROW_FUNDED', { ...base, escrowPartialRelease: true })?.id).toBe(
      'ESCROW_PARTIAL_RELEASE_FOR_TESTING',
    );
  });

  it('goes straight to the shipment when no line needs testing', () => {
    // FOB: the supplier clears export, so E0 is not ours and E1 is next.
    expect(nextStageFor('ESCROW_FUNDED', { ...base, testingRequired: false })?.id).toBe(
      'FULL_SHIPMENT_DISPATCHED_BY_SUPPLIER',
    );
  });
});
