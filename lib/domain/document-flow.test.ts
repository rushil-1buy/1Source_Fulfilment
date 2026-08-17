/**
 * The register's second column is the one that earns its place: "who is stuck
 * without this". These tests protect the mapping from the two ways it silently
 * rots — a document type nothing resolves, and a naming convention drifting
 * apart from the lookup that folds them together.
 */

import { describe, expect, it } from 'vitest';
import { docFlowFor, normaliseDocType, MAPPED_DOC_TYPES } from './document-flow';
import { STAKEHOLDERS } from './enums';

describe('naming conventions all fold onto one key', () => {
  it('folds the SCREAMING_SNAKE types the documents are stored with', () => {
    expect(normaliseDocType('SUPPLIER_PI')).toBe('supplier_pi');
    expect(docFlowFor('SUPPLIER_PI')?.provider).toBe('SUPPLIER');
  });

  it('folds the camelCase ids the evidence gate uses', () => {
    // The gate files documents under EvidenceDoc.id, not under a doc type.
    expect(normaliseDocType('supplierPo')).toBe('supplier_po');
    expect(docFlowFor('supplierPo')?.provider).toBe('ONE_BUY_SOURCING');
  });

  it('folds the deliverable kinds an approved document is filed under', () => {
    expect(docFlowFor('ESCROW_RELEASE')?.requiredBy).toEqual(['ESCROW']);
    expect(docFlowFor('GRN_NOTE')?.provider).toBe('ONE_BUY_INBOUND');
  });

  it('carries an alias where an evidence id has no matching type', () => {
    // signedTerms is the gate's name for the terms sheet; inventing a document
    // type to make the lookup succeed would put a type in the register that
    // nothing else in the system knows about.
    expect(docFlowFor('signedTerms')?.provider).toBe('ONE_BUY_SOURCING');
  });

  it('returns null for a genuinely unknown type rather than guessing', () => {
    expect(docFlowFor('SOME_FUTURE_DOC')).toBeNull();
  });
});

describe('the mapping says something useful about every entry', () => {
  it('names a real stakeholder as provider', () => {
    for (const t of MAPPED_DOC_TYPES) {
      expect(STAKEHOLDERS).toContain(docFlowFor(t)!.provider);
    }
  });

  it('names only real stakeholders as consumers', () => {
    for (const t of MAPPED_DOC_TYPES) {
      for (const r of docFlowFor(t)!.requiredBy) expect(STAKEHOLDERS).toContain(r);
    }
  });

  it('never lists the provider as needing its own document', () => {
    for (const t of MAPPED_DOC_TYPES) {
      const f = docFlowFor(t)!;
      expect(f.requiredBy).not.toContain(f.provider);
    }
  });

  it('explains what each is needed FOR, since that is what justifies a chase', () => {
    for (const t of MAPPED_DOC_TYPES) {
      expect(docFlowFor(t)!.why.length).toBeGreaterThan(25);
    }
  });
});

describe('the entries the flow actually turns on', () => {
  it('has customs producing the entry documents, not us', () => {
    for (const t of ['BOE', 'DUTY_CHALLAN', 'OUT_OF_CHARGE']) {
      expect(docFlowFor(t)?.provider).toBe('CHA');
    }
  });

  it('has the laboratory producing the report and Finance waiting on it', () => {
    const r = docFlowFor('TEST_REPORT')!;
    expect(r.provider).toBe('WHL');
    expect(r.requiredBy).toContain('ONE_BUY_FINANCE');
  });

  it('has the carrier producing proof of delivery, not the desk that booked it', () => {
    expect(docFlowFor('POD')?.provider).toBe('LOGISTICS');
    expect(docFlowFor('POD')?.requiredBy).toContain('ONE_BUY_OUTBOUND');
  });

  it('marks the P&L internal — nobody outside is waiting on it', () => {
    expect(docFlowFor('PNL')?.requiredBy).toEqual([]);
  });
});
