/**
 * Deferring a payment, without forgiving it.
 *
 * The warehouse should not wait on Finance. Goods received and accepted can be
 * repacked and dispatched while the escrow release is still outstanding —
 * holding a customer's delivery for an internal money step helps nobody,
 * including the supplier waiting to be paid.
 *
 * The whole design rests on the difference between deferring and skipping, and
 * that difference is entirely whether anything still chases it. These tests are
 * that "still chases it": the step stays outstanding, it names who owes it and
 * what it costs, and the order will not close over it.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFERRABLE,
  isDeferrable,
  obligationsBlocking,
  outstandingObligations,
} from './obligations';
import { applicableStages, getStage, type StageContext } from './stages';

const ctx: StageContext = {
  paymentMethod: 'ESCROW',
  testingRequired: false,
  testScope: null,
  incoterms: 'FOB',
};

/** Every stage up to and including `id`, as a completed set. */
const completedThrough = (id: string): string[] => {
  const ladder = applicableStages(ctx);
  const i = ladder.findIndex((s) => s.id === id);
  return ladder.slice(0, i + 1).map((s) => s.id);
};

describe('what may be deferred', () => {
  it('lets the money steps be carried', () => {
    expect(isDeferrable('ESCROW_FINAL_RELEASE_AUTHORISED')).toBe(true);
    expect(isDeferrable('SUPPLIER_PAID_IN_FULL')).toBe(true);
  });

  it('never lets a step the next one reads be carried', () => {
    /*
     * The line that matters. Anything deciding what physically happens to the
     * goods is read by the step after it — repacking a lot that was never
     * inspected, or moving one customs never released, is not a deferral, it
     * is a different and much worse thing.
     */
    for (const id of [
      'GOODS_RECEIVED_INBOUND_AT_1BUY',
      'INBOUND_INSPECTION_IN_PROGRESS',
      'INSPECTION_PASSED',
      'CUSTOMS_CLEARED',
      'CUSTOMS_ENTRY_FILED_ICEGATE',
      'READY_FOR_OUTBOUND',
      'DELIVERED',
    ]) {
      expect(isDeferrable(id), id).toBe(false);
    }
  });

  it('gives every deferrable step a wall it cannot pass', () => {
    // A deferral with no wall is an abandonment with extra steps.
    for (const [id, rule] of Object.entries(DEFERRABLE)) {
      expect(rule.blocksAt, id).toBeTruthy();
      expect(() => getStage(rule.blocksAt), id).not.toThrow();
      expect(rule.cost.length, id).toBeGreaterThan(40);
    }
  });
});

describe('the flow may go on around it', () => {
  it('offers repacking straight from inspection passed', () => {
    // The route that lets the warehouse move while Finance settles up.
    expect(getStage('INSPECTION_PASSED').next).toContain('REBRAND_AND_REPACK_IN_PROGRESS');
  });

  it('still offers the payment steps first', () => {
    // Deferring is the exception, not the default: the money route is listed
    // ahead of the bypass so the ordinary order takes it.
    const next = getStage('INSPECTION_PASSED').next;
    expect(next.indexOf('ESCROW_FINAL_RELEASE_AUTHORISED')).toBeLessThan(
      next.indexOf('REBRAND_AND_REPACK_IN_PROGRESS'),
    );
  });
});

describe('what the order then owes', () => {
  /** Inspection passed, then straight to repacking — payment left behind. */
  const deferred = completedThrough('INSPECTION_PASSED');

  it('carries the skipped payment as an outstanding obligation', () => {
    const owed = outstandingObligations(ctx, 'REBRAND_AND_REPACK_IN_PROGRESS', deferred);
    expect(owed.map((o) => o.stageId)).toContain('ESCROW_FINAL_RELEASE_AUTHORISED');
  });

  it('names who owes it and what leaving it costs', () => {
    const o = outstandingObligations(ctx, 'REBRAND_AND_REPACK_IN_PROGRESS', deferred)[0];
    expect(o.owedBy).toBe('ONE_BUY_FINANCE');
    expect(o.owedByLabel.length).toBeGreaterThan(3);
    expect(o.cost).toMatch(/supplier/i);
  });

  it('owes nothing when the payment was taken in order', () => {
    const paid = completedThrough('SUPPLIER_PAID_IN_FULL');
    expect(outstandingObligations(ctx, 'REBRAND_AND_REPACK_IN_PROGRESS', paid)).toEqual([]);
  });

  it('does not count a step the order has not reached yet as owed', () => {
    // Everything ahead of the order is "not done" and none of it is a debt.
    const early = completedThrough('GOODS_RECEIVED_INBOUND_AT_1BUY');
    expect(outstandingObligations(ctx, 'INBOUND_INSPECTION_IN_PROGRESS', early)).toEqual([]);
  });
});

describe('but the order will not close over it', () => {
  const deferred = completedThrough('POD_ISSUED_TO_CUSTOMER').filter(
    (id) => !isDeferrable(id),
  );

  it('blocks closure while a payment is outstanding', () => {
    const blocking = obligationsBlocking(
      ctx,
      'CUSTOMER_INVOICED_AND_SETTLED',
      deferred,
      'ORDER_CLOSED',
    );
    expect(blocking.length).toBeGreaterThan(0);
    for (const o of blocking) expect(o.blocksAt).toBe('ORDER_CLOSED');
  });

  it('lets it close once the debt is discharged', () => {
    const all = completedThrough('CUSTOMER_INVOICED_AND_SETTLED');
    expect(obligationsBlocking(ctx, 'CUSTOMER_INVOICED_AND_SETTLED', all, 'ORDER_CLOSED')).toEqual(
      [],
    );
  });

  it('does not block an earlier step over a deferred payment', () => {
    // The whole point: dispatch goes ahead. Only closure waits.
    expect(
      obligationsBlocking(ctx, 'REBRAND_AND_REPACK_IN_PROGRESS', deferred, 'READY_FOR_OUTBOUND'),
    ).toEqual([]);
  });
});
