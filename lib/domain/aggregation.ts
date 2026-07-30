/**
 * DEMAND AGGREGATION — the pooling arithmetic.
 *
 * Pure functions only, so the numbers that decide whether a consolidation is
 * worth doing can be tested without a database. The actions in
 * lib/actions/aggregation.ts do the writing; everything quantitative lives here.
 *
 * The one rule that must never bend: a customer line can only contribute what it
 * has left. `quantity` on the line is what the customer ordered; some of it may
 * already be allocated to an earlier supplier order through POLinkMapping. Pooling
 * the full quantity again would promise the same pieces to two suppliers and
 * over-buy, which is the exact failure aggregation is supposed to prevent.
 */

import { roundHalfUp } from '@/lib/domain/money';

/** One customer line offered up as candidate demand. */
export interface DemandCandidate {
  customerPoLineId: string;
  customerPoId: string;
  customerPoNumber: string;
  customerName: string;
  /** Delivery date the customer was promised, if any. */
  requestedDate: string | null;
  lineNo: number;
  mpn: string;
  manufacturer: string;
  description: string;
  hsnCode: string;
  /** What the customer ordered. */
  orderedQty: number;
  /** Already committed to a supplier order. */
  allocatedQty: number;
  /** What is genuinely still available to pool. */
  availableQty: number;
  /** Sell price per piece, INR major units. */
  sellUnitPrice: number;
  /** Cheapest buy price seen for this MPN on a past order, supplier currency. */
  lastBuyUnitPrice: number | null;
  testingRequired: boolean;
  uom: string;
}

/** A part in the pool, with the demand rolled up across customers. */
export interface PooledPart {
  mpn: string;
  manufacturer: string;
  description: string;
  hsnCode: string;
  /** Combined quantity across every contributing customer line. */
  pooledQty: number;
  /** How many distinct customer orders contribute to this part. */
  customerPoCount: number;
  /** How many separate lines contribute. */
  lineCount: number;
  /** Negotiated bulk price per piece, or null until entered. */
  buyUnitPrice: number | null;
  /** What we would have paid per piece without pooling. */
  baselineUnitPrice: number | null;
  /** Combined spend at the bulk price. */
  pooledSpend: number | null;
  /** What the same pieces would have cost at the baseline price. */
  baselineSpend: number | null;
  /** baselineSpend − pooledSpend. Positive means pooling saved money. */
  saving: number | null;
  savingPct: number | null;
  testingRequired: boolean;
  contributions: PartContribution[];
}

export interface PartContribution {
  customerPoLineId: string;
  customerPoId: string;
  customerPoNumber: string;
  customerName: string;
  quantity: number;
  sellUnitPrice: number;
  /** This customer's share of the pooled quantity. */
  sharePct: number;
  requestedDate: string | null;
}

export interface PoolSummary {
  parts: PooledPart[];
  /** Distinct customer orders in the pool. */
  customerPoCount: number;
  /** Distinct customers — two orders from one customer is still one relationship. */
  customerCount: number;
  totalUnits: number;
  /** Sum of pooledSpend where a price has been entered, supplier currency major. */
  pooledSpend: number;
  baselineSpend: number;
  saving: number;
  savingPct: number;
  /** Parts still waiting for a negotiated price. */
  partsWithoutPrice: string[];
  /**
   * The earliest date any contributing customer was promised. The bulk order has
   * to beat this, not the average — one late customer is a late order.
   */
  earliestRequiredBy: string | null;
}

/** A line about to be added to a pool, before it is written. */
export interface PoolInput {
  candidate: DemandCandidate;
  quantity: number;
}

/**
 * Rolls contributions up by MPN.
 *
 * `prices` supplies the negotiated bulk price per MPN; anything missing leaves
 * that part's money figures null rather than guessing, because a saving computed
 * from an assumed price is worse than no saving figure at all.
 */
export function poolDemand(
  inputs: PoolInput[],
  prices: Record<string, { buyUnitPrice: number; baselineUnitPrice?: number | null }> = {},
): PoolSummary {
  const byMpn = new Map<string, PoolInput[]>();
  for (const i of inputs) {
    const list = byMpn.get(i.candidate.mpn) ?? [];
    list.push(i);
    byMpn.set(i.candidate.mpn, list);
  }

  const parts: PooledPart[] = [];
  for (const [mpn, group] of byMpn) {
    const first = group[0].candidate;
    const pooledQty = group.reduce((a, g) => a + g.quantity, 0);
    const price = prices[mpn];

    // Baseline: what we would have paid buying each customer's slice separately.
    // Falls back to the last price seen for the part when no explicit baseline
    // was entered — that is the honest comparator for "did pooling help".
    const baseline =
      price?.baselineUnitPrice ??
      (group.map((g) => g.candidate.lastBuyUnitPrice).find((p) => p != null) ?? null);

    const pooledSpend =
      price?.buyUnitPrice != null ? roundHalfUp(pooledQty * price.buyUnitPrice * 100) / 100 : null;
    const baselineSpend = baseline != null ? roundHalfUp(pooledQty * baseline * 100) / 100 : null;
    const saving =
      pooledSpend != null && baselineSpend != null
        ? roundHalfUp((baselineSpend - pooledSpend) * 100) / 100
        : null;

    const contributions: PartContribution[] = group
      .map((g) => ({
        customerPoLineId: g.candidate.customerPoLineId,
        customerPoId: g.candidate.customerPoId,
        customerPoNumber: g.candidate.customerPoNumber,
        customerName: g.candidate.customerName,
        quantity: g.quantity,
        sellUnitPrice: g.candidate.sellUnitPrice,
        sharePct: pooledQty > 0 ? (g.quantity / pooledQty) * 100 : 0,
        requestedDate: g.candidate.requestedDate,
      }))
      .sort((a, b) => b.quantity - a.quantity);

    parts.push({
      mpn,
      manufacturer: first.manufacturer,
      description: first.description,
      hsnCode: first.hsnCode,
      pooledQty,
      customerPoCount: new Set(group.map((g) => g.candidate.customerPoId)).size,
      lineCount: group.length,
      buyUnitPrice: price?.buyUnitPrice ?? null,
      baselineUnitPrice: baseline,
      pooledSpend,
      baselineSpend,
      saving,
      savingPct:
        saving != null && baselineSpend != null && baselineSpend > 0
          ? (saving / baselineSpend) * 100
          : null,
      testingRequired: group.some((g) => g.candidate.testingRequired),
      contributions,
    });
  }

  parts.sort((a, b) => b.pooledQty - a.pooledQty || a.mpn.localeCompare(b.mpn));

  const customerPoIds = new Set(inputs.map((i) => i.candidate.customerPoId));
  const customers = new Set(inputs.map((i) => i.candidate.customerName));
  const dates = inputs.map((i) => i.candidate.requestedDate).filter((d): d is string => Boolean(d));

  const pooledSpend = parts.reduce((a, p) => a + (p.pooledSpend ?? 0), 0);
  const baselineSpend = parts.reduce((a, p) => a + (p.baselineSpend ?? 0), 0);
  const saving = roundHalfUp((baselineSpend - pooledSpend) * 100) / 100;

  return {
    parts,
    customerPoCount: customerPoIds.size,
    customerCount: customers.size,
    totalUnits: parts.reduce((a, p) => a + p.pooledQty, 0),
    pooledSpend: roundHalfUp(pooledSpend * 100) / 100,
    baselineSpend: roundHalfUp(baselineSpend * 100) / 100,
    saving,
    savingPct: baselineSpend > 0 ? (saving / baselineSpend) * 100 : 0,
    partsWithoutPrice: parts.filter((p) => p.buyUnitPrice == null).map((p) => p.mpn),
    earliestRequiredBy: dates.length ? dates.sort()[0] : null,
  };
}

export interface PoolProblem {
  severity: 'BLOCKING' | 'WARNING';
  field?: string;
  message: string;
  detail?: string;
}

/**
 * Everything wrong with a pool, worst first.
 *
 * Split into blocking and advisory on purpose: a single-customer pool is unusual
 * but legal, whereas over-committing a customer line is never acceptable. Mixing
 * the two into one "invalid" flag would either block legitimate work or let a real
 * over-commitment through.
 */
export function assessPool(
  inputs: PoolInput[],
  summary: PoolSummary,
  opts: { supplierChosen: boolean; hasRationale: boolean } = {
    supplierChosen: false,
    hasRationale: false,
  },
): PoolProblem[] {
  const problems: PoolProblem[] = [];

  if (inputs.length === 0) {
    problems.push({
      severity: 'BLOCKING',
      message: 'Nothing has been added to the pool yet.',
      detail: 'Pick customer order lines from the demand list to start consolidating.',
    });
    return problems;
  }

  for (const i of inputs) {
    if (i.quantity <= 0) {
      problems.push({
        severity: 'BLOCKING',
        field: i.candidate.customerPoLineId,
        message: `${i.candidate.mpn} on ${i.candidate.customerPoNumber} has no quantity.`,
      });
    } else if (i.quantity > i.candidate.availableQty) {
      problems.push({
        severity: 'BLOCKING',
        field: i.candidate.customerPoLineId,
        message: `${i.candidate.mpn} on ${i.candidate.customerPoNumber} is over-committed.`,
        detail: `${i.quantity.toLocaleString('en-IN')} pooled but only ${i.candidate.availableQty.toLocaleString(
          'en-IN',
        )} is unallocated on that line — the rest is already promised to another supplier order. Pooling it again would buy the same pieces twice.`,
      });
    }
  }

  if (!opts.supplierChosen) {
    problems.push({
      severity: 'BLOCKING',
      field: 'supplierId',
      message: 'No supplier chosen for the bulk order.',
      detail: 'Only suppliers on the Approved Vendor List can be selected.',
    });
  }

  if (!opts.hasRationale) {
    problems.push({
      severity: 'BLOCKING',
      field: 'rationale',
      message: 'Say why these orders are being pooled.',
      detail:
        'Different customers end up on one purchase order at one price. Somebody will ask why — this is the answer.',
    });
  }

  if (summary.partsWithoutPrice.length > 0) {
    problems.push({
      severity: 'BLOCKING',
      field: 'prices',
      message: `${summary.partsWithoutPrice.length} part${
        summary.partsWithoutPrice.length === 1 ? '' : 's'
      } have no negotiated price.`,
      detail: `${summary.partsWithoutPrice.join(', ')} — the bulk order cannot be raised without a price per part.`,
    });
  }

  if (summary.customerPoCount === 1) {
    problems.push({
      severity: 'WARNING',
      message: 'Only one customer order is in the pool.',
      detail:
        'That is a normal purchase order rather than an aggregation. It will work, but the volume benefit comes from combining orders — Create Purchase Order is the simpler route for a single one.',
    });
  }

  if (summary.saving < 0) {
    problems.push({
      severity: 'WARNING',
      message: 'The pooled price is worse than the baseline.',
      detail: `Pooling this way costs ${Math.abs(summary.saving).toFixed(2)} more than buying at the last price seen. Worth checking the negotiated figures before floating.`,
    });
  }

  /**
   * A pool is only useful if the earliest promise can still be met. Consolidating
   * adds negotiation time, so the customer with the tightest date is the one who
   * pays for it — and the average date hides exactly that.
   */
  if (summary.earliestRequiredBy && summary.customerPoCount > 1) {
    const earliest = new Date(summary.earliestRequiredBy);
    const daysLeft = Math.floor((earliest.getTime() - Date.now()) / 86_400_000);
    if (daysLeft < 0) {
      problems.push({
        severity: 'WARNING',
        message: 'A contributing customer order is already past its promised date.',
        detail: `The earliest date promised in this pool was ${earliest.toLocaleDateString('en-IN')}, ${Math.abs(daysLeft)} days ago. Consolidating adds negotiation time — confirm that customer can wait before pooling their line.`,
      });
    } else if (daysLeft < 21) {
      problems.push({
        severity: 'WARNING',
        message: `The tightest customer date in this pool is ${daysLeft} days away.`,
        detail: `Someone was promised delivery by ${earliest.toLocaleDateString('en-IN')}. A bulk order typically adds a week of negotiation before it is even placed — check that date is still reachable.`,
      });
    }
  }

  return problems.sort((a, b) => (a.severity === 'BLOCKING' ? -1 : 1) - (b.severity === 'BLOCKING' ? -1 : 1));
}

export function poolIsFloatable(problems: PoolProblem[]): boolean {
  return !problems.some((p) => p.severity === 'BLOCKING');
}
