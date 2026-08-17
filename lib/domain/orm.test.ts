/**
 * The Outward Remittance Message, and who is on the hook for it.
 *
 * The ORM is the AD bank's message evidencing money leaving India for the
 * supplier. Under FEMA the bank carries it in IDPMS and it stays OPEN until the
 * importer supplies the Bill of Entry evidencing the goods actually arrived
 * against that payment.
 *
 * The liability is the part worth encoding. An unreconciled outward remittance
 * is 1BUY's exposure — not the bank's, which merely reports it, and not the
 * supplier's, who has been paid. A repeat offender loses the ability to remit
 * at all. So the ORM has to reach the desk that pays and the desk that holds
 * the Bill of Entry, because between them they hold the two halves of a pair
 * somebody has to close.
 */

import { describe, expect, it } from 'vitest';
import { docFlowFor, normaliseDocType } from './document-flow';
import { evidenceFor } from './stage-evidence';
import { STAKEHOLDER_META } from './enums';

describe('the outward remittance message', () => {
  const flow = docFlowFor('orm')!;

  it('is issued by the bank, not by our own finance desk', () => {
    // Folding it into Finance would put us down as the issuer of a document
    // only an authorised dealer can issue.
    expect(flow.provider).toBe('BANK');
    expect(STAKEHOLDER_META.BANK.internal).toBe(false);
  });

  it('reaches both halves of the pair that has to be reconciled', () => {
    // Finance sends the money; Inbound holds the Bill of Entry that closes it.
    expect(flow.requiredBy).toContain('ONE_BUY_FINANCE');
    expect(flow.requiredBy).toContain('ONE_BUY_INBOUND');
  });

  it('states the obligation and whose it is', () => {
    expect(flow.why).toMatch(/bill of entry/i);
    expect(flow.why.toLowerCase()).toContain('1buy');
  });

  it('resolves however it is spelled', () => {
    for (const spelling of ['orm', 'ORM', 'outwardRemittanceMessage', 'ORM_ADVICE']) {
      expect(docFlowFor(spelling), spelling).toEqual(flow);
    }
    expect(normaliseDocType('outwardRemittanceMessage')).toBe('orm');
  });

  it('is demanded at every step that sends money abroad', () => {
    // Both the advance and the closing payment leave India, so both generate
    // one — an order paying twice and filing one ORM is half-reconciled.
    for (const stageId of ['ADVANCE_PAYMENT_TO_SUPPLIER', 'SUPPLIER_PAID_IN_FULL']) {
      const docs = evidenceFor(stageId)?.documents ?? [];
      const orm = docs.find((d) => d.id === 'orm');
      expect(orm, stageId).toBeTruthy();
      expect(orm?.required, stageId).toBe(true);
    }
  });

  it('captures the reference as a field, not only inside the attachment', () => {
    // The bank quotes this number when it chases the reconciliation. Buried in
    // a PDF it cannot be searched, which is how a remittance goes unclosed.
    const field = evidenceFor('SUPPLIER_PAID_IN_FULL')?.fields.find((f) => f.id === 'ormRef');
    expect(field).toBeTruthy();
    expect(field?.required).toBe(true);
    expect(field?.help ?? '').toMatch(/IDPMS|bill of entry/i);
  });
});
