/**
 * The register's second column is the one that earns its place: "who is stuck
 * without this". These tests protect the mapping from the two ways it silently
 * rots — a document type nothing resolves, and a naming convention drifting
 * apart from the lookup that folds them together.
 */

import { describe, expect, it } from 'vitest';
import { MAPPED_DOC_TYPES, docConcernsTeam, docFlowFor, docRelevanceFor, normaliseDocType } from './document-flow';
import { STAGE_EVIDENCE } from './stage-evidence';
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

/**
 * Scoping a desk's register.
 *
 * The team documents tab shows a desk only what it owes and what it is blocked
 * without. That is a boundary, so it is worth testing as one: what gets in,
 * what stays out, and what happens to a type nobody has mapped.
 */
describe('whose document is it', () => {
  it('lets a desk see what it is answerable for producing', () => {
    // Sourcing raises the customer proforma, so it is theirs to file.
    expect(docRelevanceFor('CUSTOMER_PI', 'ONE_BUY_SOURCING')?.relation).toBe('PROVIDES');
  });

  it('lets a desk see paperwork somebody else filed that it cannot work without', () => {
    // The whole reason the register is not filtered by "who filed it": the CHA
    // produces the bill of entry and Finance cannot settle duty without it.
    const r = docRelevanceFor('BOE', 'ONE_BUY_FINANCE');
    expect(r?.relation).toBe('REQUIRES');
    expect(docFlowFor('BOE')?.provider).toBe('CHA');
  });

  it('keeps another desk’s paperwork off the register', () => {
    // Outbound neither produces the duty challan nor is blocked by it.
    expect(docRelevanceFor('DUTY_CHALLAN', 'ONE_BUY_OUTBOUND')).toBeNull();
    expect(docConcernsTeam('DUTY_CHALLAN', 'ONE_BUY_OUTBOUND')).toBe(false);
  });

  it('reports a desk that both owes and needs a document as owing it', () => {
    // Owing is the stronger obligation and the one that puts the desk on the
    // hook, so it is the relation the row should show.
    const both = MAPPED_DOC_TYPES.filter((t) => {
      const f = docFlowFor(t)!;
      return f.requiredBy.includes(f.provider);
    });
    for (const t of both) expect(docRelevanceFor(t, docFlowFor(t)!.provider)?.relation).toBe('PROVIDES');
  });

  it('hides an unmapped type rather than showing it to everyone', () => {
    // A type nobody recorded an owner for must not default to visible: that is
    // how a scoped register quietly stops being scoped.
    expect(docRelevanceFor('SOME_UNMAPPED_THING', 'ONE_BUY_FINANCE')).toBeNull();
  });

  it('phrases the note at the desk reading it', () => {
    expect(docRelevanceFor('CUSTOMER_PI', 'ONE_BUY_SOURCING')?.note).toMatch(/^Yours to produce/);
    expect(docRelevanceFor('BOE', 'ONE_BUY_FINANCE')?.note).toMatch(/^You need this/);
  });

  it('leaves every 1BUY desk with something on a full order', () => {
    // A desk whose register is empty on every possible document would mean the
    // scoping had swallowed the tab whole.
    for (const team of [
      'ONE_BUY_SOURCING',
      'ONE_BUY_FINANCE',
      'ONE_BUY_INBOUND',
      'ONE_BUY_INSPECTION',
      'ONE_BUY_OUTBOUND',
    ] as const) {
      const n = MAPPED_DOC_TYPES.filter((t) => docConcernsTeam(t, team)).length;
      expect(n, team).toBeGreaterThan(0);
    }
  });
});

/**
 * Coverage of the evidence gate.
 *
 * This is the test that would have caught the gap. Nineteen of the gate's
 * thirty-five document ids were unmapped, which cost nothing while the register
 * listed every document and showed a dash in two columns — and became invisible
 * documents the moment the register started filtering by those same two
 * columns. A mapping gap is only cosmetic until something depends on it.
 */
describe('every document the evidence gate can file is mapped', () => {
  const gateDocs = STAGE_EVIDENCE.flatMap((s) => s.documents.map((d) => ({ id: d.id, label: d.label })));

  it('resolves every one of them', () => {
    const unmapped = gateDocs.filter((d) => !docFlowFor(d.id));
    expect(unmapped.map((d) => `${d.id} (${d.label})`)).toEqual([]);
  });

  it('gives every one of them at least one 1BUY desk that can see it', () => {
    // A document no desk can see is a document that vanished from the product.
    for (const d of gateDocs) {
      const seenBy = OUR_DESKS.filter((t) => docConcernsTeam(d.id, t));
      expect(seenBy.length, `${d.id} (${d.label})`).toBeGreaterThan(0);
    }
  });
});

/** The five internal desks that have a scoped register. */
const OUR_DESKS = [
  'ONE_BUY_SOURCING',
  'ONE_BUY_FINANCE',
  'ONE_BUY_INBOUND',
  'ONE_BUY_INSPECTION',
  'ONE_BUY_OUTBOUND',
] as const;

/**
 * Names, not identifiers.
 *
 * The register is read by a warehouse clerk and a finance analyst, neither of
 * whom should meet `taxInvoice` on screen. The label table is keyed on the
 * stored enum; normalising first is what lets the gate's own ids find it.
 */
describe('the gate’s ids fold onto the stored enum', () => {
  it('maps the camelCase ids onto their SCREAMING_SNAKE equivalents', () => {
    for (const [gate, stored] of [
      ['taxInvoice', 'TAX_INVOICE'],
      ['pod', 'POD'],
      ['packingList', 'PACKING_LIST'],
      ['inspectionReport', 'INSPECTION_REPORT'],
      ['testReport', 'TEST_REPORT'],
    ] as const) {
      expect(normaliseDocType(gate).toUpperCase(), gate).toBe(stored);
    }
  });

  it('resolves both spellings to the same flow', () => {
    for (const [a, b] of [
      ['taxInvoice', 'TAX_INVOICE'],
      ['pod', 'POD'],
      ['billOfEntry', 'BOE'],
      ['challan', 'DUTY_CHALLAN'],
      ['awbDoc', 'AWB_LABEL'],
    ] as const) {
      expect(docFlowFor(a), `${a} vs ${b}`).toEqual(docFlowFor(b));
    }
  });
});
