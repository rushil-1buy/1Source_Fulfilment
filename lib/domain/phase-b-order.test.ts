/**
 * Phase B's sequence, which two separate decisions depend on.
 *
 * FIRST: terms lock BEFORE the supplier's proforma invoice arrives. The whole
 * value of the reconciliation at B4 is that there is something to reconcile
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

  it('numbers them B3 then B4, so the codes match the order they happen in', () => {
    expect(codeOf('TERMS_LOCKED')).toBe('B3');
    expect(codeOf('SUPPLIER_PI_RECEIVED')).toBe('B4');
  });

  it('routes the purchase order into terms locking, not into the invoice', () => {
    expect(getStage('SUPPLIER_PO_ISSUED').next).toEqual(['TERMS_LOCKED']);
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

  it('hands the next move to us at B3, not to the supplier', () => {
    // The old sequence waited on the supplier here. Now activation is ours to
    // do, and waiting on them is exactly what this change removed.
    expect(getStage('TERMS_LOCKED').nextActionOwner).toBe('ONE_BUY_SOURCING');
  });
});
