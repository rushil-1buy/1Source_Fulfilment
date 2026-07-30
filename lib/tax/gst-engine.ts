/**
 * THE GST ENGINE (master prompt §11A.5a).
 *
 * This is the one module where "looks right in the UI" is not acceptable
 * evidence. It is pure, deterministic, has no external dependency, and is
 * covered by a table of unit tests (see gst-engine.test.ts).
 *
 * Design rules enforced here:
 *  * Rates come from a DATE-EFFECTIVE lookup. 18% is never hardcoded.
 *  * All arithmetic is in integer minor units with explicit half-up rounding.
 *  * Every computed figure carries an `explain` trail so the UI can answer
 *    "why is this number what it is" in one click.
 */

import { pctOf, roundHalfUp, roundToMajorUnit, toMinor, amountInWords } from '../domain/money';
import type { TaxTreatment } from '../domain/enums';

// ── Rate lookup ─────────────────────────────────────────────────────────────

export interface HsnRateRow {
  id: string;
  hsnCode: string;
  description: string;
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
  cessRate: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

export type RateLookup = (hsnCode: string, on: Date) => HsnRateRow | null;

/** Build a date-effective lookup over a rate table. */
export function makeRateLookup(rows: HsnRateRow[]): RateLookup {
  return (hsnCode, on) => {
    const candidates = rows
      .filter((r) => r.hsnCode === hsnCode)
      .filter((r) => r.effectiveFrom <= on && (r.effectiveTo === null || r.effectiveTo >= on))
      .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());
    return candidates[0] ?? null;
  };
}

// ── GSTIN validation ────────────────────────────────────────────────────────

const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const CODE_POINTS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export interface GstinValidation {
  valid: boolean;
  stateCode?: string;
  pan?: string;
  errors: string[];
}

/**
 * Format + checksum validation. The 15th character is a Luhn-mod-36 check
 * digit over the first 14, so a typo is caught locally without an API call.
 */
export function validateGstin(gstin: string | null | undefined): GstinValidation {
  const errors: string[] = [];
  if (!gstin) return { valid: false, errors: ['GSTIN is missing.'] };
  const value = gstin.trim().toUpperCase();

  if (value.length !== 15) {
    errors.push(`A GSTIN must be exactly 15 characters — this one has ${value.length}.`);
    return { valid: false, errors };
  }
  if (!GSTIN_PATTERN.test(value)) {
    errors.push(
      'The GSTIN is not in the correct format (2-digit state code, 10-character PAN, entity code, "Z", then a check character).',
    );
    return { valid: false, errors };
  }
  if (!checksumOk(value)) {
    errors.push('The GSTIN check character does not match — it looks like a typo.');
    return { valid: false, stateCode: value.slice(0, 2), pan: value.slice(2, 12), errors };
  }
  return { valid: true, stateCode: value.slice(0, 2), pan: value.slice(2, 12), errors: [] };
}

function checksumOk(gstin: string): boolean {
  let factor = 2;
  let sum = 0;
  for (let i = 13; i >= 0; i--) {
    const codePointValue = CODE_POINTS.indexOf(gstin[i]);
    if (codePointValue < 0) return false;
    let digit = factor * codePointValue;
    factor = factor === 2 ? 1 : 2;
    digit = Math.floor(digit / 36) + (digit % 36);
    sum += digit;
  }
  const check = (36 - (sum % 36)) % 36;
  return CODE_POINTS[check] === gstin[14];
}

// ── Place of supply & treatment ─────────────────────────────────────────────

export interface PartyForTax {
  gstin?: string | null;
  stateCode: string;
  stateName?: string;
  isSez?: boolean;
  isExport?: boolean;
}

export interface TreatmentResult {
  treatment: TaxTreatment;
  placeOfSupply: string;
  explain: string;
}

/**
 * Place of supply for goods is the state the goods are delivered to. The
 * treatment then follows from comparing it with the seller's registration.
 */
export function deriveTreatment(params: {
  seller: PartyForTax;
  buyer: PartyForTax;
  shipToStateCode: string;
  lutApplied?: boolean;
}): TreatmentResult {
  const { seller, buyer, shipToStateCode, lutApplied } = params;
  const placeOfSupply = shipToStateCode;

  if (buyer.isExport) {
    return {
      treatment: 'ZERO_RATED_EXPORT',
      placeOfSupply,
      explain: `Export supply — zero-rated, no GST charged${
        lutApplied ? ' (supplied under LUT, so no tax paid upfront)' : ' (tax paid and refund claimed, as no LUT is on file)'
      }.`,
    };
  }
  if (buyer.isSez) {
    return {
      treatment: 'ZERO_RATED_SEZ',
      placeOfSupply,
      explain: `Supply to an SEZ unit — treated as zero-rated, no GST charged${
        lutApplied ? ' (supplied under LUT)' : ''
      }.`,
    };
  }
  if (placeOfSupply === seller.stateCode) {
    return {
      treatment: 'INTRA_STATE',
      placeOfSupply,
      explain: `Place of supply (${placeOfSupply}) is the same state we are registered in (${seller.stateCode}), so the tax splits into CGST and SGST.`,
    };
  }
  return {
    treatment: 'INTER_STATE',
    placeOfSupply,
    explain: `Place of supply (${placeOfSupply}) is a different state from our registration (${seller.stateCode}), so a single IGST applies.`,
  };
}

// ── Invoice computation ─────────────────────────────────────────────────────

export interface GstLineInput {
  lineNo: number;
  mpn: string;
  description: string;
  hsnCode: string;
  quantity: number;
  uom?: string;
  /** Major units, up to 4 decimals. Converted to minor units immediately. */
  unitPrice: number;
  /** Optional line discount, already in minor units. */
  discountMinor?: number;
}

export interface GstInvoiceInput {
  invoiceDate: Date;
  seller: PartyForTax;
  buyer: PartyForTax;
  shipToStateCode: string;
  lines: GstLineInput[];
  currency?: string;
  lutApplied?: boolean;
  reverseCharge?: boolean;
  /** Round the invoice total to the nearest whole rupee. Default true. */
  roundTotal?: boolean;
  rateLookup: RateLookup;
}

export interface GstLineComputation {
  lineNo: number;
  mpn: string;
  description: string;
  hsnCode: string;
  quantity: number;
  uom: string;
  unitPrice: number;
  taxableValue: number;
  cgstRate: number;
  cgstAmount: number;
  sgstRate: number;
  sgstAmount: number;
  igstRate: number;
  igstAmount: number;
  cessRate: number;
  cessAmount: number;
  lineTotal: number;
  rateSourceId: string | null;
  explain: string[];
}

export interface GstComputation {
  treatment: TaxTreatment;
  placeOfSupply: string;
  currency: string;
  reverseCharge: boolean;
  lutApplied: boolean;
  lines: GstLineComputation[];
  taxableValue: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  cessAmount: number;
  totalTax: number;
  totalBeforeRounding: number;
  roundingAdjustment: number;
  totalAmount: number;
  amountInWords: string;
  explain: string[];
  warnings: string[];
}

export function computeGstInvoice(input: GstInvoiceInput): GstComputation {
  const currency = input.currency ?? 'INR';
  const warnings: string[] = [];
  const explain: string[] = [];

  const { treatment, placeOfSupply, explain: treatmentExplain } = deriveTreatment({
    seller: input.seller,
    buyer: input.buyer,
    shipToStateCode: input.shipToStateCode,
    lutApplied: input.lutApplied,
  });
  explain.push(treatmentExplain);

  const zeroRated = treatment === 'ZERO_RATED_SEZ' || treatment === 'ZERO_RATED_EXPORT';

  // Registration sanity checks — warnings, never blockers.
  const sellerCheck = validateGstin(input.seller.gstin);
  if (!sellerCheck.valid) {
    warnings.push(`Our own GSTIN looks wrong: ${sellerCheck.errors.join(' ')}`);
  } else if (sellerCheck.stateCode !== input.seller.stateCode) {
    warnings.push(
      `Our GSTIN starts with state code ${sellerCheck.stateCode} but our registered state is ${input.seller.stateCode}.`,
    );
  }
  if (!zeroRated) {
    const buyerCheck = validateGstin(input.buyer.gstin);
    if (!input.buyer.gstin) {
      warnings.push('The customer has no GSTIN on file — this will be treated as an unregistered (B2C) supply.');
    } else if (!buyerCheck.valid) {
      warnings.push(`The customer GSTIN looks wrong: ${buyerCheck.errors.join(' ')}`);
    } else if (buyerCheck.stateCode !== input.buyer.stateCode) {
      warnings.push(
        `The customer's GSTIN starts with state code ${buyerCheck.stateCode} but their state on file is ${input.buyer.stateCode}.`,
      );
    }
  }

  if (input.lines.length === 0) warnings.push('This invoice has no line items.');

  const lines: GstLineComputation[] = input.lines.map((line) => {
    const lineExplain: string[] = [];
    const gross = toMinor(line.quantity * line.unitPrice, currency);
    const discount = line.discountMinor ?? 0;
    const taxableValue = gross - discount;
    lineExplain.push(
      `${line.quantity} × ${line.unitPrice} = ${gross / 100} ${currency}${
        discount ? `, less discount ${discount / 100}` : ''
      } → taxable value ${taxableValue / 100}.`,
    );

    const rate = input.rateLookup(line.hsnCode, input.invoiceDate);
    if (!rate) {
      warnings.push(
        `No GST rate is on file for HSN ${line.hsnCode} as at ${input.invoiceDate.toISOString().slice(0, 10)} (line ${line.lineNo}). Tax has been computed as zero — fix the HSN rate master before issuing.`,
      );
      lineExplain.push(`No rate found for HSN ${line.hsnCode} on this date, so no tax was applied.`);
      return {
        lineNo: line.lineNo,
        mpn: line.mpn,
        description: line.description,
        hsnCode: line.hsnCode,
        quantity: line.quantity,
        uom: line.uom ?? 'PCS',
        unitPrice: line.unitPrice,
        taxableValue,
        cgstRate: 0,
        cgstAmount: 0,
        sgstRate: 0,
        sgstAmount: 0,
        igstRate: 0,
        igstAmount: 0,
        cessRate: 0,
        cessAmount: 0,
        lineTotal: taxableValue,
        rateSourceId: null,
        explain: lineExplain,
      };
    }

    let cgstRate = 0;
    let sgstRate = 0;
    let igstRate = 0;
    const cessRate = zeroRated ? 0 : rate.cessRate;

    if (zeroRated) {
      lineExplain.push(
        `Zero-rated supply, so no CGST/SGST/IGST is charged even though HSN ${line.hsnCode} normally attracts ${rate.igstRate}%.`,
      );
    } else if (treatment === 'INTRA_STATE') {
      cgstRate = rate.cgstRate;
      sgstRate = rate.sgstRate;
      lineExplain.push(
        `HSN ${line.hsnCode} (effective ${rate.effectiveFrom.toISOString().slice(0, 10)}): CGST ${cgstRate}% + SGST ${sgstRate}%.`,
      );
    } else {
      igstRate = rate.igstRate;
      lineExplain.push(
        `HSN ${line.hsnCode} (effective ${rate.effectiveFrom.toISOString().slice(0, 10)}): IGST ${igstRate}%.`,
      );
    }

    const cgstAmount = pctOf(taxableValue, cgstRate);
    const sgstAmount = pctOf(taxableValue, sgstRate);
    const igstAmount = pctOf(taxableValue, igstRate);
    const cessAmount = pctOf(taxableValue, cessRate);
    const lineTotal = taxableValue + cgstAmount + sgstAmount + igstAmount + cessAmount;

    return {
      lineNo: line.lineNo,
      mpn: line.mpn,
      description: line.description,
      hsnCode: line.hsnCode,
      quantity: line.quantity,
      uom: line.uom ?? 'PCS',
      unitPrice: line.unitPrice,
      taxableValue,
      cgstRate,
      cgstAmount,
      sgstRate,
      sgstAmount,
      igstRate,
      igstAmount,
      cessRate,
      cessAmount,
      lineTotal,
      rateSourceId: rate.id,
      explain: lineExplain,
    };
  });

  const sum = (pick: (l: GstLineComputation) => number) =>
    lines.reduce((acc, l) => acc + pick(l), 0);

  const taxableValue = sum((l) => l.taxableValue);
  const cgstAmount = sum((l) => l.cgstAmount);
  const sgstAmount = sum((l) => l.sgstAmount);
  const igstAmount = sum((l) => l.igstAmount);
  const cessAmount = sum((l) => l.cessAmount);
  const totalTax = cgstAmount + sgstAmount + igstAmount + cessAmount;
  const totalBeforeRounding = taxableValue + totalTax;

  const roundTotal = input.roundTotal !== false;
  const totalAmount = roundTotal
    ? roundToMajorUnit(totalBeforeRounding, currency)
    : totalBeforeRounding;
  const roundingAdjustment = totalAmount - totalBeforeRounding;

  explain.push(
    `Tax is computed line by line and then added up, so the invoice total always equals the sum of its lines.`,
  );
  if (roundingAdjustment !== 0) {
    explain.push(
      `The total was rounded to the nearest whole ${currency === 'INR' ? 'rupee' : 'unit'} — an adjustment of ${
        roundingAdjustment / 100
      }.`,
    );
  }
  if (input.reverseCharge) {
    explain.push('Marked as reverse charge — the recipient accounts for the tax, not us.');
  }

  return {
    treatment,
    placeOfSupply,
    currency,
    reverseCharge: input.reverseCharge ?? false,
    lutApplied: input.lutApplied ?? false,
    lines,
    taxableValue,
    cgstAmount,
    sgstAmount,
    igstAmount,
    cessAmount,
    totalTax,
    totalBeforeRounding,
    roundingAdjustment,
    totalAmount,
    amountInWords: amountInWords(totalAmount, currency),
    explain,
    warnings,
  };
}

// ── Credit notes ────────────────────────────────────────────────────────────

export interface CreditNoteInput {
  original: GstComputation;
  /** Which lines to reverse, and how much quantity of each. */
  reversals: { lineNo: number; quantity: number }[];
  reason: 'RETURN' | 'REJECTION' | 'PRICE_CORRECTION' | 'SHORT_SHIPMENT';
}

export interface CreditNoteComputation {
  taxableValue: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  cessAmount: number;
  totalAmount: number;
  lines: {
    lineNo: number;
    quantity: number;
    taxableValue: number;
    cgstAmount: number;
    sgstAmount: number;
    igstAmount: number;
    cessAmount: number;
  }[];
  explain: string[];
  warnings: string[];
}

/**
 * A credit note reverses tax at exactly the rates on the original invoice —
 * never at today's rates, because the supply happened when it happened.
 */
export function computeCreditNote(input: CreditNoteInput): CreditNoteComputation {
  const warnings: string[] = [];
  const explain: string[] = [
    'A credit note reverses tax using the rates on the original invoice, not the rates in force today.',
  ];
  const lines: CreditNoteComputation['lines'] = [];

  for (const rev of input.reversals) {
    const orig = input.original.lines.find((l) => l.lineNo === rev.lineNo);
    if (!orig) {
      warnings.push(`Line ${rev.lineNo} is not on the original invoice — skipped.`);
      continue;
    }
    if (rev.quantity > orig.quantity) {
      warnings.push(
        `Line ${rev.lineNo}: cannot credit ${rev.quantity} when only ${orig.quantity} was invoiced.`,
      );
      continue;
    }
    // Pro-rate the original taxable value so rounding follows the original.
    const proportion = rev.quantity / orig.quantity;
    const taxableValue = roundHalfUp(orig.taxableValue * proportion);
    const cgstAmount = pctOf(taxableValue, orig.cgstRate);
    const sgstAmount = pctOf(taxableValue, orig.sgstRate);
    const igstAmount = pctOf(taxableValue, orig.igstRate);
    const cessAmount = pctOf(taxableValue, orig.cessRate);
    lines.push({
      lineNo: rev.lineNo,
      quantity: rev.quantity,
      taxableValue,
      cgstAmount,
      sgstAmount,
      igstAmount,
      cessAmount,
    });
    explain.push(
      `Line ${rev.lineNo}: crediting ${rev.quantity} of ${orig.quantity} → taxable ${
        taxableValue / 100
      }, reversing tax at the original rates.`,
    );
  }

  const sum = (pick: (l: CreditNoteComputation['lines'][number]) => number) =>
    lines.reduce((a, l) => a + pick(l), 0);
  const taxableValue = sum((l) => l.taxableValue);
  const cgstAmount = sum((l) => l.cgstAmount);
  const sgstAmount = sum((l) => l.sgstAmount);
  const igstAmount = sum((l) => l.igstAmount);
  const cessAmount = sum((l) => l.cessAmount);

  return {
    taxableValue,
    cgstAmount,
    sgstAmount,
    igstAmount,
    cessAmount,
    totalAmount: taxableValue + cgstAmount + sgstAmount + igstAmount + cessAmount,
    lines,
    explain,
    warnings,
  };
}

// ── Reverse charge (import of services) ─────────────────────────────────────

export interface ReverseChargeInput {
  vendorName: string;
  vendorCountry: string;
  serviceType: 'TESTING' | 'FREIGHT' | 'OTHER';
  hsnSacCode: string;
  taxableValue: number;
  igstRate: number;
  invoiceDate: Date;
}

export interface ReverseChargeComputation {
  applicable: boolean;
  taxableValue: number;
  igstRate: number;
  igstAmount: number;
  /** RCM books a liability AND an equal credit — net cash effect is nil. */
  liabilityBooked: number;
  creditClaimed: number;
  netCashImpact: number;
  explain: string[];
}

/**
 * Import of services (a foreign testing lab, a foreign freight agent) is taxed
 * under reverse charge: we raise a self-invoice, book the liability, and claim
 * the matching credit.
 */
export function computeReverseCharge(input: ReverseChargeInput): ReverseChargeComputation {
  const isImportOfService = input.vendorCountry.trim().toUpperCase() !== 'INDIA';
  if (!isImportOfService) {
    return {
      applicable: false,
      taxableValue: input.taxableValue,
      igstRate: 0,
      igstAmount: 0,
      liabilityBooked: 0,
      creditClaimed: 0,
      netCashImpact: 0,
      explain: [
        `${input.vendorName} is in India, so they charge GST on their own invoice. Reverse charge does not apply.`,
      ],
    };
  }
  const igstAmount = pctOf(input.taxableValue, input.igstRate);
  return {
    applicable: true,
    taxableValue: input.taxableValue,
    igstRate: input.igstRate,
    igstAmount,
    liabilityBooked: igstAmount,
    creditClaimed: igstAmount,
    netCashImpact: 0,
    explain: [
      `${input.vendorName} is in ${input.vendorCountry}, so this is an import of services and reverse charge applies.`,
      `We raise a self-invoice for ${input.taxableValue / 100} at IGST ${input.igstRate}% = ${
        igstAmount / 100
      }.`,
      'We book that as a liability and claim the same amount as input credit, so the net cash effect is nil.',
    ],
  };
}
