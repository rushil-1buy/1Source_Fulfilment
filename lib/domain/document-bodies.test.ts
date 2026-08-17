/**
 * A document has to carry what its real counterpart carries.
 *
 * Every simulated document used to open to four lines — its title, the order,
 * the stage, and a sentence saying the agent filed it. These tests are the
 * floor that stops it drifting back: not "does it render", but "does the bill
 * of entry state an assessable value", because a bill of entry without one is a
 * label rather than a customs entry.
 */

import { describe, expect, it } from 'vitest';
import { RENDERED_DOC_TYPES, renderDocumentBody, type DocContext } from './document-bodies';
import { STAGE_EVIDENCE } from './stage-evidence';
import { docFlowFor } from './document-flow';

const ctx: DocContext = {
  alias: 'WO-2026-0107',
  canonicalName: 'CPO-ACME-0042_PI-1B-0031_PO-1B-0107_SPI-NEXUS-0088',
  docDate: '2026-08-17T10:00:00.000Z',
  org: {
    legalName: 'Sharpbuy Global Solutions Private Limited',
    address: 'Okhla Phase 3\nNew Delhi 110019\nIndia',
    gstin: '07ABLCS4389M1ZG',
    iec: 'AABCS4389M',
    country: 'India',
  },
  customer: {
    name: 'ACME Electronics Private Limited',
    address: 'Plot 14\nNew Delhi 110020',
    gstin: '07AACCA1234F1Z5',
    contact: 'Procurement desk',
  },
  supplier: { name: 'Nexus Components Pte Ltd', country: 'Singapore', currency: 'USD' },
  refs: {
    customerPo: 'CPO-ACME-0042',
    supplierPo: 'PO-1B-0107',
    customerPi: 'PI-1B-0031',
    supplierPi: 'SPI-NEXUS-0088',
  },
  terms: { buyIncoterms: 'FOB', sellIncoterms: 'DDP', paymentMethod: 'ESCROW', fxRate: 83.2 },
  lines: [
    {
      mpn: 'STM32F407VGT6',
      manufacturer: 'STMicroelectronics',
      description: 'ARM Cortex-M4 MCU, 168MHz',
      hsnCode: '85423100',
      qty: 500,
      uom: 'PCS',
      unitPriceMinor: 92_500,
      lineTotalMinor: 46_250_000,
    },
  ],
  buyCurrency: 'USD',
  sellCurrency: 'INR',
  buyValueMinor: 46_250_000,
  sellValueMinor: 49_250_000,
  escrow: {
    ref: 'HKIN-000107',
    provider: 'HKIN',
    agreedMinor: 46_250_000,
    releaseCondition: 'Goods received and accepted at 1BUY.',
  },
  shipment: { awb: '41000107', carrier: 'DHL', origin: 'Singapore', destination: 'Bengaluru' },
  customs: { beNumber: 'BE-7600107', port: 'INBLR4', chaLicence: 'CHA/BLR/1147' },
  invoice: { number: 'INV-1B-0207', irn: 'IRN-XYZ', ewayBill: 'EWB-991' },
};

const body = (t: string) => renderDocumentBody(t, ctx);

describe('the documents carry what they are supposed to carry', () => {
  it('states the delivery term AND the parties on a commercial invoice', () => {
    // Customs assess against the term; the entry is filed against the parties.
    const b = body('commercialInvoice');
    expect(b).toContain('FOB');
    expect(b).toContain('Nexus Components Pte Ltd');
    expect(b).toContain('AABCS4389M');
    expect(b).toMatch(/country of origin/i);
    expect(b).toMatch(/85423100/);
  });

  it('breaks a packing list down by carton with weights that reconcile', () => {
    const b = body('packingList');
    expect(b).toMatch(/total cartons/i);
    expect(b).toMatch(/net weight/i);
    expect(b).toMatch(/gross weight/i);
    // The cartons must add back to the line quantity — the check a receiving
    // clerk actually performs.
    expect(b).toContain('500');
  });

  it('gives a bill of entry an assessable value and a duty breakdown', () => {
    const b = body('billOfEntry');
    expect(b).toMatch(/assessable value/i);
    expect(b).toMatch(/basic customs duty/i);
    expect(b).toMatch(/IGST/);
    expect(b).toContain('BE-7600107');
    expect(b).toContain('CHA/BLR/1147');
    expect(b).toMatch(/section 46/i);
  });

  it('cites methods and a sampling plan on a test report', () => {
    // A verdict without them is an opinion.
    const b = body('testReport');
    expect(b).toMatch(/AS6171/);
    expect(b).toMatch(/Z1\.4/);
    expect(b).toMatch(/X-ray/i);
    expect(b).toMatch(/verdict/i);
  });

  it('states the release conditions on the escrow order', () => {
    const b = body('escrowAgreement');
    expect(b).toContain('HKIN-000107');
    expect(b).toMatch(/conditions of release/i);
    expect(b).toMatch(/received and accepted/i);
  });

  it('carries the IDPMS obligation on the ORM', () => {
    const b = body('orm');
    expect(b).toMatch(/S0101/);
    expect(b).toMatch(/IDPMS/);
    expect(b).toMatch(/bill of entry/i);
    // Whose obligation it is, stated on the document itself.
    expect(b).toMatch(/importer's obligation|importer’s obligation/i);
  });

  it('puts GSTIN, place of supply and the IRN on a tax invoice', () => {
    const b = body('taxInvoice');
    expect(b).toContain('07ABLCS4389M1ZG');
    expect(b).toContain('07AACCA1234F1Z5');
    expect(b).toMatch(/place of supply/i);
    expect(b).toContain('IRN-XYZ');
    expect(b).toMatch(/rule 46/i);
  });

  it('names the order on every single document', () => {
    // A page detached from the screen — printed, forwarded into a dispute —
    // still has to say which order it belongs to.
    for (const t of RENDERED_DOC_TYPES) {
      expect(body(t), t).toContain(ctx.alias);
    }
  });

  it('never leaves a document at stub length', () => {
    for (const t of RENDERED_DOC_TYPES) {
      expect(body(t).length, t).toBeGreaterThan(400);
    }
  });

  it('makes every total add up to its own lines', () => {
    /*
     * The bug this caught, and it shipped into an export before anybody read
     * one. The order carries its buy value in INR after conversion while the
     * commercial invoice is priced in the supplier's currency, so the document
     * showed a line of USD 4,628 under a total of USD 385,074. A document whose
     * total does not add up is the first thing a customs officer checks.
     */
    const lineSum = ctx.lines.reduce((a, l) => a + l.lineTotalMinor, 0);
    const expected = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(lineSum / 100);

    for (const t of ['commercialInvoice', 'supplierPi', 'supplierPo']) {
      const b = body(t);
      expect(b, t).toContain(expected);
      // And nothing else claiming to be a total contradicts it.
      const totals = [...b.matchAll(/(?:Invoice total|Invoice value|Order value)\s+\S+\s+([\d,]+\.\d\d)/g)];
      for (const m of totals) expect(m[1], `${t}: ${m[0]}`).toBe(expected);
    }
  });

  it('counts a single carton as one carton', () => {
    expect(body('packingList')).not.toMatch(/\b1 cartons\b/);
  });

  it('renders something honest for a type it does not know', () => {
    const b = renderDocumentBody('someUnknownThing', ctx, 'Some unknown thing');
    expect(b).toContain(ctx.alias);
    expect(b).toContain('SOME UNKNOWN THING');
  });
});

describe('coverage of what the flow actually files', () => {
  it('renders every document the evidence gate demands', () => {
    // A gate document with no renderer falls back to the letterhead stub, which
    // is exactly the generic page this module exists to remove.
    const gateDocs = [...new Set(STAGE_EVIDENCE.flatMap((s) => s.documents.map((d) => d.id)))];
    const missing = gateDocs.filter((id) => body(id).length < 400);
    expect(missing.join(', ')).toBe('');
  });

  it('renders every type the document map knows a provider for', () => {
    for (const t of RENDERED_DOC_TYPES) expect(docFlowFor(t), t).toBeTruthy();
  });
});
