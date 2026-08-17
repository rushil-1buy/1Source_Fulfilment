/**
 * Phase B's sequence, which two separate decisions depend on.
 *
 * FIRST: terms lock BEFORE the supplier's proforma invoice arrives. The whole
 * value of the reconciliation at B5 is that there is something to reconcile
 * against — an invoice checked only against our own purchase order can quietly
 * introduce a delivery term or a currency we never agreed to, and paying it is
 * what makes it binding.
 *
 * SECOND: the invoice is not a gate. Once terms are locked the commitment is
 * real and the work order can go active, so an order may reach WORK_ORDER_ACTIVE
 * without ever standing at SUPPLIER_PI_RECEIVED, and the invoice is captured
 * whenever the supplier gets round to sending it.
 *
 * Both are easy to reverse by accident while editing the ladder, and neither
 * fails loudly at runtime — the order just moves through a sequence that lets a
 * bad term in. Hence this file.
 */

import { describe, expect, it } from 'vitest';
import { STAGE_DEFS, getStage } from './stages';

const codeOf = (id: string) => getStage(id).code;
const indexOf = (id: string) => STAGE_DEFS.findIndex((s) => s.id === id);

describe('Phase B — terms lock before the supplier invoice', () => {
  it('places TERMS_LOCKED ahead of SUPPLIER_PI_RECEIVED on the ladder', () => {
    expect(indexOf('TERMS_LOCKED')).toBeLessThan(indexOf('SUPPLIER_PI_RECEIVED'));
  });

  it('numbers them B4 then B5, so the codes match the order they happen in', () => {
    expect(codeOf('TERMS_LOCKED')).toBe('B4');
    expect(codeOf('SUPPLIER_PI_RECEIVED')).toBe('B5');
  });

  it('reaches terms locking from the customer’s acceptance, not from our own PO', () => {
    // Our purchase order now routes to the customer's sales order first — see
    // the sequencing tests below. Terms lock once both sides have committed.
    expect(getStage('PI_ACCEPTED_BY_CUSTOMER').next).toEqual(['TERMS_LOCKED']);
  });

  it('asks the invoice to be reconciled against the locked terms', () => {
    const pi = getStage('SUPPLIER_PI_RECEIVED');
    expect(`${pi.description} ${pi.exitCriteria}`.toLowerCase()).toContain('locked terms');
  });
});

describe('Phase B — the invoice does not gate activation', () => {
  it('lets a locked order go active without the invoice', () => {
    expect(getStage('TERMS_LOCKED').next).toContain('WORK_ORDER_ACTIVE');
  });

  it('still allows the invoice first, when it has already arrived', () => {
    expect(getStage('TERMS_LOCKED').next).toContain('SUPPLIER_PI_RECEIVED');
  });

  it('rejoins the ladder at WORK_ORDER_ACTIVE either way', () => {
    // Both routes converge, so nothing downstream has to know which was taken.
    expect(getStage('SUPPLIER_PI_RECEIVED').next).toEqual(['WORK_ORDER_ACTIVE']);
  });

  it('hands the next move to us at B4, not to the supplier', () => {
    // The old sequence waited on the supplier here. Now activation is ours to
    // do, and waiting on them is exactly what this change removed.
    expect(getStage('TERMS_LOCKED').nextActionOwner).toBe('ONE_BUY_SOURCING');
  });
});

/**
 * Buy before you sell.
 *
 * The supplier is already chosen when the customer's purchase order lands —
 * their availability and price are what the offer was built on — so the order
 * is: customer PO in, our PO out to the supplier, and only then the sales order
 * back to the customer.
 *
 * Reversing it is the expensive mistake in this trade. A proforma issued before
 * our own purchase order commits us to a price against supply we have not
 * secured: the customer holds us to it and the supplier is still free to move.
 * The intuitive sequence is the wrong one, which is exactly why it needs a test
 * rather than a comment.
 */
describe('supply is secured before the customer is quoted', () => {
  it('confirms the supplier before anything is issued', () => {
    expect(getStage('CUSTOMER_PO_RECEIVED').next).toEqual(['SUPPLIER_SELECTED_FROM_AVL']);
    expect(getStage('SUPPLIER_SELECTED_FROM_AVL').next).toEqual(['SUPPLIER_PO_ISSUED']);
  });

  it('issues our purchase order BEFORE the customer’s sales order', () => {
    expect(indexOf('SUPPLIER_PO_ISSUED')).toBeLessThan(indexOf('PI_ISSUED_TO_CUSTOMER'));
    expect(getStage('SUPPLIER_PO_ISSUED').next).toEqual(['PI_ISSUED_TO_CUSTOMER']);
  });

  it('numbers the whole opening sequence in the order it happens', () => {
    expect(
      [
        'CUSTOMER_PO_RECEIVED',
        'SUPPLIER_SELECTED_FROM_AVL',
        'SUPPLIER_PO_ISSUED',
        'PI_ISSUED_TO_CUSTOMER',
        'PI_ACCEPTED_BY_CUSTOMER',
        'TERMS_LOCKED',
      ].map(codeOf),
    ).toEqual(['A1', 'A2', 'B1', 'B2', 'B3', 'B4']);
  });

  it('names the customer document as both a sales order and a proforma', () => {
    // Desks and customers use the two names interchangeably; the label carries
    // both so nobody has to translate.
    const l = getStage('PI_ISSUED_TO_CUSTOMER').label.toLowerCase();
    expect(l).toContain('sales order');
    expect(l).toContain('proforma');
  });

  it('treats the supplier as confirmed rather than newly chosen', () => {
    // The decision predates the order; this step records and re-checks it.
    const s = getStage('SUPPLIER_SELECTED_FROM_AVL');
    expect(`${s.label} ${s.description}`.toLowerCase()).toContain('confirm');
  });
});
