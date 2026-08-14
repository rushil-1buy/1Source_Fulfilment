/**
 * The checks are the human-in-the-loop gate, so they are what gets tested.
 *
 * A generator producing a slightly odd draft is a nuisance; a check that fails
 * to fire is a wrong document approved by somebody who was told it was fine.
 * These cover the ones where that consequence is real — money leaving escrow,
 * a lot passed that should not have been, and the accounting error the P&L
 * exists to prevent.
 */

import { describe, expect, it } from 'vitest';
import { DELIVERABLES, deliverableFor, deliverablesForTeam } from './registry';
import { hasBlockingFailure, needsReviewNote, type DeliverableInput } from './types';

/** A complete, healthy order. Each test spoils exactly the one thing it is about. */
const base: DeliverableInput = {
  orderId: 'wo-1',
  alias: 'WO-2026-0001',
  soNumber: 'SO-1B-0201',
  stage: 'INSPECTION_PASSED',
  stageLabel: 'Inspection passed',
  incoterms: 'CIF',
  sellIncoterms: 'DDP',
  paymentMethod: 'ESCROW',
  buyCurrency: 'USD',
  fxRate: 83.5,
  customerName: 'Acme Electronics',
  customerGstin: '29AABCA1234A1Z5',
  customerAddress: 'Bengaluru, 560001',
  supplierName: 'Global Chip Source',
  supplierCountry: 'SG',
  customerPoNumber: 'CPO-ACME-052',
  supplierPoNumber: 'PO-1B-0117',
  customerPiNumber: 'PI-1B-041',
  supplierPiNumber: 'SPI-GCSF-098',
  sellValue: 1_000_000,
  buyValue: 600_000,
  landedCost: 750_000,
  creditableTaxes: 120_000,
  nonCreditableLevies: 40_000,
  trueMargin: 250_000,
  trueMarginPct: 25,
  marginBeforeCredits: 130_000,
  creditBenefit: 120_000,
  belowFloor: false,
  costComponents: [
    { key: 'buyValue', label: 'Supplier value', amount: 600_000, included: true },
    { key: 'dutyBcd', label: 'BCD', amount: 30_000, included: true },
    { key: 'dutySws', label: 'SWS', amount: 5_000, included: true },
    { key: 'dutyCess', label: 'Cess', amount: 5_000, included: true },
    { key: 'dutyIgst', label: 'IGST', amount: 120_000, included: false },
    { key: 'freightCost', label: 'Freight', amount: 60_000, included: true },
    { key: 'insuranceCost', label: 'Insurance', amount: 10_000, included: true },
    { key: 'testingCost', label: 'Testing', amount: 20_000, included: true },
    { key: 'repackCost', label: 'Repack', amount: 10_000, included: true },
    { key: 'clearanceCost', label: 'Clearance', amount: 8_000, included: true },
    { key: 'escrowFee', label: 'Escrow fee', amount: 2_000, included: true },
  ],
  lines: [
    { mpn: 'STM32F407', description: 'MCU', qty: 1000, uom: 'PCS', hsnCode: '8542', unitSell: 985, unitBuy: 9.15 },
  ],
  totalQty: 1000,
  lineCount: 1,
  escrowHeld: 600_000,
  escrowReleased: 0,
  inspection: { verdict: 'PASSED', sampleSize: 50, defectsFound: 0, inspectedAt: '2026-08-01' },
  shipment: { carrier: 'DHL', trackingRef: 'AWB-123', grossWeightKg: 12, packageCount: 3, dispatchedAt: '2026-07-20' },
  customs: { beNumber: 'BOE-9911', beDate: '2026-07-28', portCode: 'INBLR4', assessedValue: 620_000 },
  warehouseLocation: 'A-12-3',
  completedStageIds: ['DUTY_ASSESSED_AND_PAID', 'GOODS_RECEIVED_INBOUND_AT_1BUY', 'DELIVERED'],
  today: '2026-08-14',
};

const pnl = deliverableFor('PNL')!;
const escrow = deliverableFor('ESCROW_RELEASE')!;
const inspection = deliverableFor('INSPECTION_REPORT')!;
const packing = deliverableFor('PACKING_LIST')!;

const check = (def: typeof pnl, over: Record<string, unknown> = {}, input = base) =>
  def.check({ ...def.compute(input), ...over } as never, input);

const status = (checks: ReturnType<typeof check>, key: string) =>
  checks.find((c) => c.key === key)?.status;

describe('the registry covers every team', () => {
  it('gives all five internal teams something to produce', () => {
    for (const team of [
      'ONE_BUY_SOURCING',
      'ONE_BUY_FINANCE',
      'ONE_BUY_INBOUND',
      'ONE_BUY_INSPECTION',
      'ONE_BUY_OUTBOUND',
    ] as const) {
      expect(deliverablesForTeam(team).length).toBeGreaterThan(0);
    }
  });

  it('gives every field a help line, since the form renders one per field', () => {
    for (const def of DELIVERABLES) {
      for (const field of def.fields) expect(field.help.length).toBeGreaterThan(10);
    }
  });

  it('points every field at a section the document actually declares', () => {
    for (const def of DELIVERABLES) {
      const keys = new Set(def.sections.map((s) => s.key));
      for (const field of def.fields) expect(keys.has(field.section)).toBe(true);
    }
  });
});

describe('P&L — the accounting rule it exists to enforce', () => {
  it('passes a clean statement once it is signed', () => {
    const c = check(pnl, { preparedBy: 'A. Dwivedi' });
    expect(hasBlockingFailure(c)).toBe(false);
  });

  it('fails when recoverable tax has been booked as a cost', () => {
    // Exactly what expensing ITC looks like: landed cost up by the credit amount.
    const c = check(pnl, { preparedBy: 'A. Dwivedi', landedCost: 750_000 + 120_000 });
    expect(status(c, 'creditsNotExpensed')).toBe('FAIL');
    expect(hasBlockingFailure(c)).toBe(true);
  });

  it('fails when the bottom line no longer follows from the figures above it', () => {
    const c = check(pnl, { preparedBy: 'A. Dwivedi', trueMargin: 900_000 });
    expect(status(c, 'marginConsistent')).toBe('FAIL');
  });

  it('fails when the cost lines no longer sum to the total', () => {
    const c = check(pnl, { preparedBy: 'A. Dwivedi', freightCost: 500_000 });
    expect(status(c, 'costAddsUp')).toBe('FAIL');
  });

  it('refuses to be signed by nobody', () => {
    expect(status(check(pnl), 'signed')).toBe('FAIL');
  });

  it('warns rather than blocks when margin is under the floor', () => {
    const c = check(pnl, { preparedBy: 'A. Dwivedi', trueMarginPct: 4 });
    expect(status(c, 'aboveFloor')).toBe('WARN');
    expect(hasBlockingFailure(c)).toBe(false);
    // A warning is a judgement call, and a judgement call needs a reason.
    expect(needsReviewNote(c)).toBe(true);
  });

  it('warns that the figures are provisional while duty is still outstanding', () => {
    const early = { ...base, completedStageIds: ['GOODS_RECEIVED_INBOUND_AT_1BUY'] };
    const c = check(pnl, { preparedBy: 'A. Dwivedi' }, early);
    expect(status(c, 'costsComplete')).toBe('WARN');
  });
});

describe('escrow release — money leaving needs a reason', () => {
  it('blocks a release larger than the balance held', () => {
    const c = check(escrow, { reason: 'Inspection passed', authorisedBy: 'R. Nair', amount: 900_000 });
    expect(status(c, 'notOverdrawn')).toBe('FAIL');
  });

  it('blocks an instruction with no stated reason', () => {
    const c = check(escrow, { authorisedBy: 'R. Nair' });
    expect(hasBlockingFailure(c)).toBe(true);
  });

  it('warns when paying for goods no inspection has passed', () => {
    const unchecked = { ...base, inspection: null };
    const c = check(escrow, { reason: 'Supplier chased', authorisedBy: 'R. Nair' }, unchecked);
    expect(status(c, 'inspectionPassed')).toBe('WARN');
  });
});

describe('inspection report — the verdict must follow the findings', () => {
  it('blocks a pass on a lot whose defect rate is too high', () => {
    const c = check(inspection, {
      verdict: 'PASSED',
      inspector: 'S. Rao',
      acceptedBy: 'S. Rao',
      sampleSize: 100,
      defectsFound: 9,
    });
    expect(status(c, 'verdictMatchesFindings')).toBe('FAIL');
  });

  it('blocks a report where nothing was actually sampled', () => {
    const c = check(inspection, { verdict: 'PASSED', inspector: 'S. Rao', acceptedBy: 'S. Rao', sampleSize: 0 });
    expect(status(c, 'sampled')).toBe('FAIL');
  });

  it('warns when part markings were never verified', () => {
    const c = check(inspection, {
      verdict: 'PASSED',
      inspector: 'S. Rao',
      acceptedBy: 'S. Rao',
      sampleSize: 50,
      defectsFound: 0,
      markingsChecked: false,
    });
    expect(status(c, 'markings')).toBe('WARN');
  });
});

describe('packing list — reads the term we sold on', () => {
  it('warns when it carries the buy term instead of the sell term', () => {
    const c = check(packing, {
      deliveryAddress: 'Bengaluru',
      packedBy: 'M. Iyer',
      packageCount: 3,
      grossWeightKg: 12,
      incoterms: 'CIF', // what we bought on, not what we sold on
    });
    expect(status(c, 'sellTerm')).toBe('WARN');
  });

  it('blocks a list with no weight or package count', () => {
    const c = check(packing, { deliveryAddress: 'Bengaluru', packedBy: 'M. Iyer' });
    expect(status(c, 'packages')).toBe('FAIL');
  });
});
