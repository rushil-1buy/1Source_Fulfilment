/**
 * Money handling. Every stored amount is an INTEGER in minor units (paise /
 * cents). Floats are only ever an input carrier for unit prices (which can
 * carry 4 decimals for electronic components) and are converted to integer
 * minor units at the line level, so float error never accumulates.
 */

import { CURRENCY_META } from './enums';

export function minorPerMajor(currency: string): number {
  return CURRENCY_META[currency]?.minorPerMajor ?? 100;
}

/**
 * Round half away from zero, guarding against binary representation error.
 * `2.675 * 100` is `267.49999999999997` in IEEE-754; naive Math.round gives 267
 * where GST arithmetic expects 268. Normalising precision first fixes that.
 */
export function roundHalfUp(value: number): number {
  if (!Number.isFinite(value)) throw new Error(`roundHalfUp received ${value}`);
  const corrected = Number(value.toPrecision(12));
  const sign = corrected < 0 ? -1 : 1;
  return sign * Math.floor(Math.abs(corrected) + 0.5);
}

/** Major units (e.g. 1234.56) → minor units (123456). */
export function toMinor(major: number, currency = 'INR'): number {
  return roundHalfUp(major * minorPerMajor(currency));
}

/** Minor units (123456) → major units (1234.56). */
export function fromMinor(minor: number, currency = 'INR'): number {
  return minor / minorPerMajor(currency);
}

/** Apply a percentage to a minor-unit amount, returning minor units. */
export function pctOf(amountMinor: number, ratePct: number): number {
  return roundHalfUp((amountMinor * ratePct) / 100);
}

/** Round a minor-unit amount to the nearest whole major unit (nearest rupee). */
export function roundToMajorUnit(amountMinor: number, currency = 'INR'): number {
  const mpm = minorPerMajor(currency);
  return roundHalfUp(amountMinor / mpm) * mpm;
}

export interface FormatMoneyOptions {
  /** Show the ISO code, e.g. "USD 12,400.00". Default true. */
  withCode?: boolean;
  /** Show the symbol, e.g. "₹12,400.00". Default false. */
  withSymbol?: boolean;
  /** Compact form for tiles: ₹1.2 Cr / ₹4.5 L / $1.2M. Default false. */
  compact?: boolean;
  decimals?: number;
}

export function formatMoney(
  amountMinor: number,
  currency = 'INR',
  opts: FormatMoneyOptions = {},
): string {
  const { withCode = true, withSymbol = false, compact = false, decimals = 2 } = opts;
  const meta = CURRENCY_META[currency];
  const major = fromMinor(amountMinor, currency);

  if (compact) {
    const compacted = compactMajor(major, currency);
    return joinMoney(compacted, currency, { withCode, withSymbol, meta });
  }

  const body = new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(major);

  return joinMoney(body, currency, { withCode, withSymbol, meta });
}

function joinMoney(
  body: string,
  currency: string,
  o: { withCode: boolean; withSymbol: boolean; meta?: { symbol: string } },
): string {
  const sym = o.withSymbol && o.meta ? o.meta.symbol : '';
  const code = o.withCode ? `${currency} ` : '';
  return `${code}${sym}${body}`.trim();
}

/** Indian numbering for INR (lakh/crore), Western for everything else. */
function compactMajor(major: number, currency: string): string {
  const abs = Math.abs(major);
  const sign = major < 0 ? '-' : '';
  const fmt = (n: number) => n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2);
  if (currency === 'INR') {
    if (abs >= 1e7) return `${sign}${fmt(abs / 1e7)} Cr`;
    if (abs >= 1e5) return `${sign}${fmt(abs / 1e5)} L`;
    if (abs >= 1e3) return `${sign}${fmt(abs / 1e3)} K`;
  } else {
    if (abs >= 1e9) return `${sign}${fmt(abs / 1e9)}B`;
    if (abs >= 1e6) return `${sign}${fmt(abs / 1e6)}M`;
    if (abs >= 1e3) return `${sign}${fmt(abs / 1e3)}K`;
  }
  return `${sign}${abs.toFixed(2)}`;
}

/** Percentage with a consistent 1-decimal presentation. */
export function formatPct(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`;
}

/** Convert a foreign-currency minor amount into base currency minor units. */
export function convertMinor(
  amountMinor: number,
  fxRate: number,
  fromCurrency: string,
  toCurrency: string,
): number {
  const majors = fromMinor(amountMinor, fromCurrency);
  return toMinor(majors * fxRate, toCurrency);
}

/**
 * Amount in words, picking the right numbering system for the currency.
 *
 * INR uses Indian numbering (lakh / crore) — correct on a domestic tax invoice.
 * Everything else uses international numbering (thousand / million), which is
 * what a supplier expects to see on a USD purchase order or proforma.
 */
export function amountInWordsAuto(
  amountMinor: number,
  currency = 'INR',
  currencyLabel?: string,
): string {
  if (currency === 'INR') return amountInWords(amountMinor, currency);
  return amountInWordsIntl(amountMinor, currencyLabel ?? currency);
}

/**
 * International numbering, matching the wording convention used on the existing
 * supplier PO / proforma documents:
 *   "USD Forty Two Thousand, Four Hundred and Forty Two and Cent Forty Only"
 */
export function amountInWordsIntl(amountMinor: number, currencyLabel = 'USD'): string {
  const abs = Math.abs(amountMinor);
  const major = Math.floor(abs / 100);
  const minor = abs % 100;
  let out = `${currencyLabel} ${internationalWords(major)}`;
  if (minor > 0) out += ` and Cent ${internationalWords(minor)}`;
  return `${out} Only`;
}

function threeDigitWords(n: number): string {
  let s = '';
  if (n >= 100) {
    s += `${ONES[Math.floor(n / 100)]} Hundred`;
    n %= 100;
    if (n) s += ' and ';
  }
  if (n >= 20) {
    s += TENS[Math.floor(n / 10)];
    if (n % 10) s += ` ${ONES[n % 10]}`;
  } else if (n > 0) {
    s += ONES[n];
  }
  return s.trim();
}

export function internationalWords(n: number): string {
  n = Math.floor(n);
  if (n === 0) return 'Zero';
  const groups: [string, number][] = [
    ['Billion', 1e9],
    ['Million', 1e6],
    ['Thousand', 1e3],
    ['', 1],
  ];
  const parts: string[] = [];
  for (const [label, val] of groups) {
    const chunk = Math.floor(n / val);
    if (chunk > 0) {
      parts.push(threeDigitWords(chunk) + (label ? ` ${label}` : ''));
      n %= val;
    }
  }
  return parts.join(', ');
}

/** Number → Indian-English words, for the "amount in words" invoice field. */
export function amountInWords(amountMinor: number, currency = 'INR'): string {
  const meta = CURRENCY_META[currency];
  const major = Math.floor(Math.abs(amountMinor) / minorPerMajor(currency));
  const minor = Math.abs(amountMinor) % minorPerMajor(currency);
  const unit = currency === 'INR' ? 'Rupees' : currency;
  const sub = currency === 'INR' ? 'Paise' : 'Cents';
  const head = `${unit} ${indianWords(major)}`;
  const tail = minor > 0 ? ` and ${sub} ${indianWords(minor)}` : '';
  void meta;
  return `${head}${tail} only`.replace(/\s+/g, ' ');
}

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return `${TENS[t]}${o ? ` ${ONES[o]}` : ''}`;
}

function indianWords(n: number): string {
  if (n === 0) return 'Zero';
  const parts: string[] = [];
  const crore = Math.floor(n / 1e7);
  n %= 1e7;
  const lakh = Math.floor(n / 1e5);
  n %= 1e5;
  const thousand = Math.floor(n / 1e3);
  n %= 1e3;
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  if (crore) parts.push(`${indianWords(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (hundred) parts.push(`${ONES[hundred]} Hundred`);
  if (rest) parts.push(twoDigits(rest));
  return parts.join(' ');
}
