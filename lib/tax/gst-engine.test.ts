/**
 * GST ENGINE TEST TABLE — master prompt acceptance criterion #24.
 *
 * AC#24 requires evidence from passing unit tests, not screenshots:
 *   intra-state splits CGST+SGST · inter-state applies IGST · SEZ/export is
 *   zero-rated with LUT flag · multi-line mixed-rate computes per line ·
 *   rounding matches the invoice total · reverse-charge self-invoice for a
 *   foreign service provider · a credit note correctly reverses tax.
 *
 * Plus the rules that are easy to get wrong: date-effective rate lookup (never
 * a hardcoded 18%), GSTIN checksum validation, and the landed-cost inclusion
 * rule from §9 (AC#26).
 */

import { describe, expect, it } from 'vitest';
import {
  computeCreditNote,
  computeGstInvoice,
  computeReverseCharge,
  deriveTreatment,
  makeRateLookup,
  validateGstin,
  type HsnRateRow,
} from './gst-engine';
import { computeLandedCost, computeMargin } from './landed-cost';
import { amountInWords, roundHalfUp, toMinor } from '../domain/money';

// ── Fixtures ───────────────────────────────────────────────────────────────

const KARNATAKA = '29';
const MAHARASHTRA = '27';

/**
 * Note the two rows for HSN 8542 — an older 12% row that expired, and the
 * current 18% row. Any test that gets 18% for a pre-2020 date is reading the
 * wrong row, which is exactly the bug the date-effective lookup prevents.
 */
const RATES: HsnRateRow[] = [
  {
    id: 'r-8542-old',
    hsnCode: '85423100',
    description: 'Processors and controllers (superseded rate)',
    cgstRate: 6,
    sgstRate: 6,
    igstRate: 12,
    cessRate: 0,
    effectiveFrom: new Date('2017-07-01'),
    effectiveTo: new Date('2019-12-31'),
  },
  {
    id: 'r-8542-current',
    hsnCode: '85423100',
    description: 'Processors and controllers',
    cgstRate: 9,
    sgstRate: 9,
    igstRate: 18,
    cessRate: 0,
    effectiveFrom: new Date('2020-01-01'),
    effectiveTo: null,
  },
  {
    id: 'r-8533',
    hsnCode: '85332100',
    description: 'Fixed resistors',
    cgstRate: 9,
    sgstRate: 9,
    igstRate: 18,
    cessRate: 0,
    effectiveFrom: new Date('2017-07-01'),
    effectiveTo: null,
  },
  {
    id: 'r-8504',
    hsnCode: '85043100',
    description: 'Transformers, small',
    cgstRate: 2.5,
    sgstRate: 2.5,
    igstRate: 5,
    cessRate: 0,
    effectiveFrom: new Date('2017-07-01'),
    effectiveTo: null,
  },
];

const rateLookup = makeRateLookup(RATES);

/** Valid GSTINs (checksum-correct) generated for these tests. */
const SELLER_GSTIN = '29AABCU9603R1ZJ';
const BUYER_KA_GSTIN = '29AAACI1195H1ZI';
const BUYER_MH_GSTIN = '27AAACI1195H1ZM';

const seller = { gstin: SELLER_GSTIN, stateCode: KARNATAKA, stateName: 'Karnataka' };

const INVOICE_DATE = new Date('2026-07-15');

function invoice(overrides: Partial<Parameters<typeof computeGstInvoice>[0]> = {}) {
  return computeGstInvoice({
    invoiceDate: INVOICE_DATE,
    seller,
    buyer: { gstin: BUYER_KA_GSTIN, stateCode: KARNATAKA, isSez: false, isExport: false },
    shipToStateCode: KARNATAKA,
    currency: 'INR',
    rateLookup,
    lines: [
      {
        lineNo: 1,
        mpn: 'STM32F407VGT6',
        description: 'ARM Cortex-M4 MCU',
        hsnCode: '85423100',
        quantity: 100,
        unitPrice: 1000,
      },
    ],
    ...overrides,
  });
}

// ── GSTIN validation ───────────────────────────────────────────────────────

describe('GSTIN validation', () => {
  it('accepts a checksum-valid GSTIN and extracts state code + PAN', () => {
    const r = validateGstin(SELLER_GSTIN);
    expect(r.valid).toBe(true);
    expect(r.stateCode).toBe('29');
    expect(r.pan).toBe('AABCU9603R');
  });

  it('rejects a GSTIN whose check character is wrong (a typo)', () => {
    // Same as SELLER_GSTIN but final character changed J → N.
    const r = validateGstin('29AABCU9603R1ZN');
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/check character/i);
  });

  it('rejects wrong length and malformed structure', () => {
    expect(validateGstin('29AABCU9603R1Z').valid).toBe(false);
    expect(validateGstin('AA29BCU9603R1ZM').valid).toBe(false);
    expect(validateGstin(null).valid).toBe(false);
  });
});

// ── Place of supply / treatment derivation ─────────────────────────────────

describe('treatment derivation', () => {
  it('same state → INTRA_STATE', () => {
    expect(
      deriveTreatment({ seller, buyer: { stateCode: KARNATAKA }, shipToStateCode: KARNATAKA })
        .treatment,
    ).toBe('INTRA_STATE');
  });

  it('different state → INTER_STATE', () => {
    expect(
      deriveTreatment({ seller, buyer: { stateCode: MAHARASHTRA }, shipToStateCode: MAHARASHTRA })
        .treatment,
    ).toBe('INTER_STATE');
  });

  it('SEZ buyer → ZERO_RATED_SEZ even when in the same state', () => {
    expect(
      deriveTreatment({
        seller,
        buyer: { stateCode: KARNATAKA, isSez: true },
        shipToStateCode: KARNATAKA,
      }).treatment,
    ).toBe('ZERO_RATED_SEZ');
  });

  it('export buyer → ZERO_RATED_EXPORT', () => {
    expect(
      deriveTreatment({
        seller,
        buyer: { stateCode: '96', isExport: true },
        shipToStateCode: '96',
      }).treatment,
    ).toBe('ZERO_RATED_EXPORT');
  });

  it('place of supply follows the ship-to state, not the billing state', () => {
    const r = deriveTreatment({
      seller,
      buyer: { stateCode: KARNATAKA },
      shipToStateCode: MAHARASHTRA,
    });
    expect(r.placeOfSupply).toBe(MAHARASHTRA);
    expect(r.treatment).toBe('INTER_STATE');
  });
});

// ── AC#24: intra-state splits CGST + SGST ──────────────────────────────────

describe('AC#24 — intra-state invoice splits CGST and SGST', () => {
  const r = invoice();

  it('applies CGST 9% and SGST 9%, and no IGST', () => {
    expect(r.treatment).toBe('INTRA_STATE');
    expect(r.taxableValue).toBe(toMinor(100_000));
    expect(r.cgstAmount).toBe(toMinor(9_000));
    expect(r.sgstAmount).toBe(toMinor(9_000));
    expect(r.igstAmount).toBe(0);
  });

  it('CGST and SGST are always equal on an intra-state supply', () => {
    expect(r.cgstAmount).toBe(r.sgstAmount);
  });

  it('total = taxable + tax', () => {
    expect(r.totalAmount).toBe(toMinor(118_000));
  });
});

// ── AC#24: inter-state applies IGST ────────────────────────────────────────

describe('AC#24 — inter-state invoice applies IGST only', () => {
  const r = invoice({
    buyer: { gstin: BUYER_MH_GSTIN, stateCode: MAHARASHTRA, isSez: false, isExport: false },
    shipToStateCode: MAHARASHTRA,
  });

  it('applies IGST 18% with no CGST/SGST', () => {
    expect(r.treatment).toBe('INTER_STATE');
    expect(r.igstAmount).toBe(toMinor(18_000));
    expect(r.cgstAmount).toBe(0);
    expect(r.sgstAmount).toBe(0);
  });

  it('collects the same total tax as the intra-state equivalent', () => {
    expect(r.totalTax).toBe(invoice().totalTax);
  });
});

// ── AC#24: SEZ and export are zero-rated ───────────────────────────────────

describe('AC#24 — SEZ and export are zero-rated with the LUT flag', () => {
  it('SEZ supply charges no tax but keeps the taxable value', () => {
    const r = invoice({
      buyer: { gstin: BUYER_KA_GSTIN, stateCode: KARNATAKA, isSez: true, isExport: false },
      lutApplied: true,
    });
    expect(r.treatment).toBe('ZERO_RATED_SEZ');
    expect(r.taxableValue).toBe(toMinor(100_000));
    expect(r.totalTax).toBe(0);
    expect(r.totalAmount).toBe(toMinor(100_000));
    expect(r.lutApplied).toBe(true);
    expect(r.explain.join(' ')).toMatch(/LUT/);
  });

  it('export supply charges no tax', () => {
    const r = invoice({
      buyer: { gstin: null, stateCode: '96', isSez: false, isExport: true },
      shipToStateCode: '96',
      lutApplied: true,
    });
    expect(r.treatment).toBe('ZERO_RATED_EXPORT');
    expect(r.totalTax).toBe(0);
  });

  it('zero-rated lines record 0% rates even though the HSN normally attracts 18%', () => {
    const r = invoice({
      buyer: { stateCode: KARNATAKA, isSez: true },
    });
    expect(r.lines[0].igstRate).toBe(0);
    expect(r.lines[0].cgstRate).toBe(0);
    expect(r.lines[0].explain.join(' ')).toMatch(/18%/); // explains what was waived
  });

  it('does not warn about a missing customer GSTIN on a zero-rated export', () => {
    const r = invoice({
      buyer: { gstin: null, stateCode: '96', isExport: true },
      shipToStateCode: '96',
    });
    expect(r.warnings.join(' ')).not.toMatch(/no GSTIN/i);
  });
});

// ── AC#24: multi-line, mixed-rate ──────────────────────────────────────────

describe('AC#24 — multi-line invoice with different HSN rates computes per line', () => {
  const r = invoice({
    buyer: { gstin: BUYER_MH_GSTIN, stateCode: MAHARASHTRA },
    shipToStateCode: MAHARASHTRA,
    lines: [
      {
        lineNo: 1,
        mpn: 'STM32F407VGT6',
        description: 'MCU',
        hsnCode: '85423100', // 18%
        quantity: 100,
        unitPrice: 1000,
      },
      {
        lineNo: 2,
        mpn: 'RC0603FR-0710KL',
        description: 'Resistor',
        hsnCode: '85332100', // 18%
        quantity: 5000,
        unitPrice: 0.85,
      },
      {
        lineNo: 3,
        mpn: 'TX-4711',
        description: 'Transformer',
        hsnCode: '85043100', // 5%
        quantity: 40,
        unitPrice: 250,
      },
    ],
  });

  it('taxes each line at its own rate', () => {
    expect(r.lines[0].igstRate).toBe(18);
    expect(r.lines[1].igstRate).toBe(18);
    expect(r.lines[2].igstRate).toBe(5);
  });

  it('computes each line total correctly', () => {
    expect(r.lines[0].taxableValue).toBe(toMinor(100_000));
    expect(r.lines[0].igstAmount).toBe(toMinor(18_000));
    expect(r.lines[1].taxableValue).toBe(toMinor(4_250)); // 5000 × 0.85
    expect(r.lines[1].igstAmount).toBe(toMinor(765));
    expect(r.lines[2].taxableValue).toBe(toMinor(10_000));
    expect(r.lines[2].igstAmount).toBe(toMinor(500));
  });

  it('invoice totals equal the sum of the lines exactly', () => {
    const lineTaxable = r.lines.reduce((a, l) => a + l.taxableValue, 0);
    const lineIgst = r.lines.reduce((a, l) => a + l.igstAmount, 0);
    expect(r.taxableValue).toBe(lineTaxable);
    expect(r.igstAmount).toBe(lineIgst);
    expect(r.totalBeforeRounding).toBe(lineTaxable + lineIgst);
  });

  it('a single blended rate would have given the wrong answer', () => {
    // Proof the engine is not applying one rate across the invoice.
    const blended = Math.round(r.taxableValue * 0.18);
    expect(r.igstAmount).not.toBe(blended);
  });
});

// ── AC#24: rounding ────────────────────────────────────────────────────────

describe('AC#24 — rounding matches the invoice total', () => {
  it('rounds the total to the nearest rupee and records the adjustment', () => {
    // 7 × 143.33 = 1003.31 taxable; IGST 18% = 180.5958 → 180.60; total 1183.91
    const r = invoice({
      buyer: { gstin: BUYER_MH_GSTIN, stateCode: MAHARASHTRA },
      shipToStateCode: MAHARASHTRA,
      lines: [
        {
          lineNo: 1,
          mpn: 'ODD-1',
          description: 'Odd priced part',
          hsnCode: '85423100',
          quantity: 7,
          unitPrice: 143.33,
        },
      ],
    });
    expect(r.taxableValue).toBe(100331);
    expect(r.igstAmount).toBe(18060);
    expect(r.totalBeforeRounding).toBe(118391);
    expect(r.totalAmount).toBe(118400);
    expect(r.roundingAdjustment).toBe(9);
  });

  it('total always equals totalBeforeRounding + roundingAdjustment', () => {
    const r = invoice({
      lines: [
        {
          lineNo: 1,
          mpn: 'X',
          description: 'x',
          hsnCode: '85332100',
          quantity: 3,
          unitPrice: 33.337,
        },
      ],
    });
    expect(r.totalAmount).toBe(r.totalBeforeRounding + r.roundingAdjustment);
  });

  it('can be disabled, leaving the exact figure', () => {
    const r = invoice({
      roundTotal: false,
      buyer: { gstin: BUYER_MH_GSTIN, stateCode: MAHARASHTRA },
      shipToStateCode: MAHARASHTRA,
      lines: [
        {
          lineNo: 1,
          mpn: 'ODD-1',
          description: 'Odd priced part',
          hsnCode: '85423100',
          quantity: 7,
          unitPrice: 143.33,
        },
      ],
    });
    expect(r.totalAmount).toBe(118391);
    expect(r.roundingAdjustment).toBe(0);
  });

  it('rounds half away from zero despite binary floating point', () => {
    // 2.675 * 100 is 267.49999999999997 in IEEE-754; the naive answer is 267.
    expect(roundHalfUp(2.675 * 100)).toBe(268);
    expect(toMinor(2.675)).toBe(268);
    expect(roundHalfUp(0.5)).toBe(1);
    expect(roundHalfUp(-0.5)).toBe(-1);
    expect(roundHalfUp(1.4999999999)).toBe(1);
  });
});

// ── Date-effective rate lookup ─────────────────────────────────────────────

describe('date-effective rate lookup — 18% is never hardcoded', () => {
  it('uses the historic 12% row for a 2019 invoice', () => {
    const r = invoice({
      invoiceDate: new Date('2019-06-01'),
      buyer: { gstin: BUYER_MH_GSTIN, stateCode: MAHARASHTRA },
      shipToStateCode: MAHARASHTRA,
    });
    expect(r.lines[0].igstRate).toBe(12);
    expect(r.igstAmount).toBe(toMinor(12_000));
    expect(r.lines[0].rateSourceId).toBe('r-8542-old');
  });

  it('uses the current 18% row for a 2026 invoice', () => {
    const r = invoice({
      buyer: { gstin: BUYER_MH_GSTIN, stateCode: MAHARASHTRA },
      shipToStateCode: MAHARASHTRA,
    });
    expect(r.lines[0].igstRate).toBe(18);
    expect(r.lines[0].rateSourceId).toBe('r-8542-current');
  });

  it('warns and charges zero when no rate exists for the HSN, rather than guessing', () => {
    const r = invoice({
      lines: [
        {
          lineNo: 1,
          mpn: 'UNKNOWN-1',
          description: 'Part with unmapped HSN',
          hsnCode: '99999999',
          quantity: 10,
          unitPrice: 100,
        },
      ],
    });
    expect(r.totalTax).toBe(0);
    expect(r.lines[0].rateSourceId).toBeNull();
    expect(r.warnings.join(' ')).toMatch(/No GST rate is on file for HSN 99999999/);
  });

  it('every taxed line records which rate row produced it, for traceability', () => {
    const r = invoice();
    expect(r.lines[0].rateSourceId).toBe('r-8542-current');
    expect(r.lines[0].explain.length).toBeGreaterThan(0);
  });
});

// ── AC#24: reverse charge on import of services ────────────────────────────

describe('AC#24 — reverse-charge self-invoice for a foreign service provider', () => {
  it('applies RCM to a foreign testing lab and nets to zero cash', () => {
    const r = computeReverseCharge({
      vendorName: 'Shenzhen Component Labs',
      vendorCountry: 'China',
      serviceType: 'TESTING',
      hsnSacCode: '998346',
      taxableValue: toMinor(200_000),
      igstRate: 18,
      invoiceDate: INVOICE_DATE,
    });
    expect(r.applicable).toBe(true);
    expect(r.igstAmount).toBe(toMinor(36_000));
    expect(r.liabilityBooked).toBe(r.creditClaimed);
    expect(r.netCashImpact).toBe(0);
  });

  it('does NOT apply RCM to an Indian lab — they charge GST themselves', () => {
    const r = computeReverseCharge({
      vendorName: 'Bengaluru Test House',
      vendorCountry: 'India',
      serviceType: 'TESTING',
      hsnSacCode: '998346',
      taxableValue: toMinor(200_000),
      igstRate: 18,
      invoiceDate: INVOICE_DATE,
    });
    expect(r.applicable).toBe(false);
    expect(r.igstAmount).toBe(0);
  });
});

// ── AC#24: credit note ─────────────────────────────────────────────────────

describe('AC#24 — a credit note correctly reverses tax', () => {
  const original = invoice({
    buyer: { gstin: BUYER_MH_GSTIN, stateCode: MAHARASHTRA },
    shipToStateCode: MAHARASHTRA,
  });

  it('fully reverses tax when the whole line is credited', () => {
    const cn = computeCreditNote({
      original,
      reversals: [{ lineNo: 1, quantity: 100 }],
      reason: 'RETURN',
    });
    expect(cn.taxableValue).toBe(original.taxableValue);
    expect(cn.igstAmount).toBe(original.igstAmount);
  });

  it('pro-rates correctly on a partial credit', () => {
    const cn = computeCreditNote({
      original,
      reversals: [{ lineNo: 1, quantity: 25 }],
      reason: 'SHORT_SHIPMENT',
    });
    expect(cn.taxableValue).toBe(toMinor(25_000));
    expect(cn.igstAmount).toBe(toMinor(4_500));
  });

  it('reverses at the ORIGINAL rate, not the rate in force today', () => {
    const oldInvoice = invoice({
      invoiceDate: new Date('2019-06-01'),
      buyer: { gstin: BUYER_MH_GSTIN, stateCode: MAHARASHTRA },
      shipToStateCode: MAHARASHTRA,
    });
    const cn = computeCreditNote({
      original: oldInvoice,
      reversals: [{ lineNo: 1, quantity: 100 }],
      reason: 'RETURN',
    });
    // 12%, not today's 18%.
    expect(cn.igstAmount).toBe(toMinor(12_000));
  });

  it('refuses to credit more than was invoiced', () => {
    const cn = computeCreditNote({
      original,
      reversals: [{ lineNo: 1, quantity: 500 }],
      reason: 'RETURN',
    });
    expect(cn.lines).toHaveLength(0);
    expect(cn.warnings.join(' ')).toMatch(/cannot credit 500/);
  });

  it('warns when the line is not on the original invoice', () => {
    const cn = computeCreditNote({
      original,
      reversals: [{ lineNo: 99, quantity: 1 }],
      reason: 'RETURN',
    });
    expect(cn.warnings.join(' ')).toMatch(/not on the original invoice/);
  });
});

// ── AC#26: landed cost inclusion rule ──────────────────────────────────────

describe('AC#26 — landed cost includes BCD+SWS and EXCLUDES creditable IGST', () => {
  const landed = computeLandedCost({
    buyValue: toMinor(1_000_000),
    dutyBcd: toMinor(100_000),
    dutySws: toMinor(10_000),
    dutyIgst: toMinor(199_800), // creditable
    dutyCess: 0,
    creditableGstOther: toMinor(9_000), // freight/testing/repack GST
    freightCost: toMinor(50_000),
    insuranceCost: toMinor(5_000),
    testingCost: toMinor(25_000),
    repackCost: toMinor(8_000),
    clearanceCost: toMinor(12_000),
    escrowFee: toMinor(6_000),
  });

  it('includes BCD and SWS', () => {
    const included = landed.components.filter((c) => c.included).map((c) => c.key);
    expect(included).toContain('dutyBcd');
    expect(included).toContain('dutySws');
  });

  it('EXCLUDES import IGST and other creditable GST', () => {
    const excluded = landed.components.filter((c) => !c.included).map((c) => c.key);
    expect(excluded).toContain('dutyIgst');
    expect(excluded).toContain('creditableGstOther');
  });

  it('lands on the correct total', () => {
    // 1,000,000 + 100,000 + 10,000 + 50,000 + 5,000 + 25,000 + 8,000 + 12,000 + 6,000
    expect(landed.landedCost).toBe(toMinor(1_216_000));
    expect(landed.creditableTaxes).toBe(toMinor(208_800));
    expect(landed.nonCreditableLevies).toBe(toMinor(110_000));
  });

  it('reports true margin above margin-before-credits, by exactly the credit value', () => {
    const m = computeMargin({ sellValue: toMinor(1_400_000), landed, marginFloorPct: 5 });
    expect(m.trueMargin).toBe(toMinor(184_000));
    expect(m.marginBeforeCredits).toBe(toMinor(-24_800));
    expect(m.creditBenefit).toBe(landed.creditableTaxes);
    expect(m.trueMarginPct).toBeCloseTo(13.14, 1);
  });

  it('shows the practical consequence: the wrong rule turns a profit into a loss', () => {
    const m = computeMargin({ sellValue: toMinor(1_400_000), landed });
    expect(m.trueMargin).toBeGreaterThan(0);
    expect(m.marginBeforeCredits).toBeLessThan(0);
  });

  it('flags an order below the configured margin floor', () => {
    const m = computeMargin({ sellValue: toMinor(1_250_000), landed, marginFloorPct: 5 });
    expect(m.trueMarginPct).toBeLessThan(5);
    expect(m.belowFloor).toBe(true);
  });
});

// ── Invoice presentation ───────────────────────────────────────────────────

describe('amount in words (Indian numbering)', () => {
  it('renders lakhs and crores', () => {
    expect(amountInWords(toMinor(118000))).toBe('Rupees One Lakh Eighteen Thousand only');
    expect(amountInWords(toMinor(10000000))).toBe('Rupees One Crore only');
  });

  it('includes paise when present', () => {
    expect(amountInWords(toMinor(1234.56))).toBe(
      'Rupees One Thousand Two Hundred Thirty Four and Paise Fifty Six only',
    );
  });

  it('handles zero', () => {
    expect(amountInWords(0)).toBe('Rupees Zero only');
  });
});

describe('engine warnings are advisory, never blocking', () => {
  it('still produces a full computation when the customer GSTIN is missing', () => {
    const r = invoice({ buyer: { gstin: null, stateCode: KARNATAKA } });
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.totalAmount).toBe(toMinor(118_000));
  });

  it('warns when a GSTIN state code contradicts the state on file', () => {
    const r = invoice({ buyer: { gstin: BUYER_MH_GSTIN, stateCode: KARNATAKA } });
    expect(r.warnings.join(' ')).toMatch(/state code 27 but their state on file is 29/);
  });
});
