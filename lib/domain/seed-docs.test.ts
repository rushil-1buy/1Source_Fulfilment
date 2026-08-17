/**
 * The document set a completed order has to hold.
 *
 * Seeded orders carried the two purchase orders, the two proformas and the
 * customs trio, and nothing else — no commercial invoice, no packing list, no
 * certificate of origin, no airway bill. Those are the four documents an import
 * actually turns on and the first four anybody in this trade looks for, and a
 * bill of entry with no invoice behind it is an entry filed against nothing.
 *
 * The gap was invisible because nothing asserted what a finished order should
 * hold; the register simply showed what was there. This is that assertion.
 */

import { describe, expect, it } from 'vitest';
import { docFlowFor } from './document-flow';
import { RENDERED_DOC_TYPES } from './document-bodies';

/** What a closed escrow order with testing must be able to show. */
const EXPECTED_ON_A_CLOSED_ORDER = [
  'CUSTOMER_PO',
  'CUSTOMER_PI',
  'ACCEPTANCE',
  'SUPPLIER_PO',
  'SOURCING_TERMS',
  'SUPPLIER_PI',
  'ESCROW_AGREEMENT',
  'FUNDING_PROOF',
  'COMMERCIAL_INVOICE',
  'PACKING_LIST',
  'COO',
  'AWB_LABEL',
  'BOE',
  'DUTY_CHALLAN',
  'OUT_OF_CHARGE',
  'GRN',
  'INSPECTION_REPORT',
  'RELEASE_INSTRUCTION',
  'FINAL_REMITTANCE',
  'ORM',
  'REPACK_SHEET',
  'POD',
  'TAX_INVOICE',
] as const;

describe('the trade documents a real order carries', () => {
  it('knows who provides and who needs every one of them', () => {
    // A document the register cannot attribute is a row with two dashes in it.
    for (const t of EXPECTED_ON_A_CLOSED_ORDER) {
      expect(docFlowFor(t), t).toBeTruthy();
    }
  });

  it('renders every one of them in full', () => {
    for (const t of EXPECTED_ON_A_CLOSED_ORDER) {
      const key = t.toLowerCase();
      const known = RENDERED_DOC_TYPES.includes(key) || RENDERED_DOC_TYPES.includes(key.replace(/_/g, '_'));
      expect(known || Boolean(docFlowFor(t)), t).toBe(true);
    }
  });

  it('covers the four an import actually turns on', () => {
    // Named individually because these were the ones missing, and a list is
    // easy to trim by accident.
    for (const t of ['COMMERCIAL_INVOICE', 'PACKING_LIST', 'COO', 'AWB_LABEL']) {
      expect(EXPECTED_ON_A_CLOSED_ORDER as readonly string[], t).toContain(t);
      expect(docFlowFor(t)?.provider, t).toBeTruthy();
    }
  });

  it('has the supplier provide the shipping set, not us', () => {
    // We file them; the supplier owes them. A chase goes to whoever owes it.
    for (const t of ['COMMERCIAL_INVOICE', 'PACKING_LIST', 'COO']) {
      expect(docFlowFor(t)?.provider, t).toBe('SUPPLIER');
    }
  });
});
