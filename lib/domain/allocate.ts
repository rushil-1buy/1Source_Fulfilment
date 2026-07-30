/**
 * Splitting ONE supplier order across SEVERAL customer orders.
 *
 * The retroactive half of demand aggregation. A pool decides what to buy before
 * the order goes out; this decides who gets what after it already has — stock
 * bought ahead of demand, then claimed by two or three customer orders as they
 * arrive.
 *
 * The rule that must never bend: a supplier line can only be allocated as many
 * pieces as it holds. Allocation depletes it. Getting this wrong promises the
 * same physical stock to two customers, and unlike an over-buy it is not
 * discovered until one of them is short at delivery.
 *
 * Pure functions only, so the depletion arithmetic is testable without a
 * database.
 */

/** A line on the supplier order, and what it has left. */
export interface SupplierLineAvail {
  supplierPoLineId: string;
  mpn: string;
  manufacturer: string;
  description: string;
  quantity: number;
  /** Already allocated to some customer order. */
  allocatedQty: number;
  availableQty: number;
  unitPrice: number;
}

/** A customer order in the running, and the lines it wants. */
export interface ClaimingCustomerPo {
  customerPoId: string;
  poNumber: string;
  customer: string;
  poDate: string;
  requestedDate: string | null;
  /** Its own lines, with what each still needs. */
  lines: {
    customerPoLineId: string;
    mpn: string;
    orderedQty: number;
    /** Already covered by any supplier order. */
    coveredQty: number;
    outstandingQty: number;
    sellUnitPrice: number;
  }[];
}

/** One cell of the allocation matrix. */
export interface AllocationCell {
  customerPoId: string;
  customerPoLineId: string;
  supplierPoLineId: string;
  mpn: string;
  quantity: number;
  sellUnitPrice: number;
  buyUnitPrice: number;
  /** The most this cell could take, given the line's need and what is left. */
  maxQuantity: number;
}

export interface AllocationRow {
  supplierPoLineId: string;
  mpn: string;
  manufacturer: string;
  description: string;
  supplierQty: number;
  unitPrice: number;
  /** Sum of every cell on this row. */
  allocatedQty: number;
  /** supplierQty − allocatedQty. Positive means stock nobody has claimed. */
  unallocatedQty: number;
  /** Allocated beyond what the line holds — always a fault, never a state. */
  overAllocatedQty: number;
  cells: AllocationCell[];
}

export interface AllocationPlan {
  rows: AllocationRow[];
  /** Per customer order, what it gets. */
  perCustomer: {
    customerPoId: string;
    poNumber: string;
    customer: string;
    units: number;
    /** At the customer's own prices, minor units. */
    sellValue: number;
    /** At the supplier's prices, in the supplier's currency, major units. */
    buyValue: number;
    lineCount: number;
    /** Customer lines this order still has outstanding after the allocation. */
    stillShortLines: { mpn: string; shortQty: number }[];
  }[];
  totalUnits: number;
  totalSellValue: number;
  /** Stock on the supplier order that no customer order claims. */
  unallocatedUnits: number;
  problems: {
    severity: 'BLOCKING' | 'WARNING';
    message: string;
    detail?: string;
  }[];
}

/**
 * Greedy first-come allocation, in the order the customer orders are listed.
 *
 * First-come rather than pro-rata on purpose: the operator chose that order, and
 * splitting a part three ways when the first customer could have been shipped
 * complete helps nobody. They can override any cell afterwards.
 */
export function planAllocation(
  supplierLines: SupplierLineAvail[],
  customerPos: ClaimingCustomerPo[],
  /** Overrides keyed `${customerPoId}:${supplierPoLineId}`. */
  overrides: Record<string, number> = {},
): AllocationPlan {
  const rows: AllocationRow[] = [];

  for (const sl of supplierLines) {
    let remaining = sl.availableQty;
    const cells: AllocationCell[] = [];

    for (const cpo of customerPos) {
      const cl = cpo.lines.find((l) => l.mpn.toUpperCase() === sl.mpn.toUpperCase());
      if (!cl) continue;

      const key = `${cpo.customerPoId}:${sl.supplierPoLineId}`;
      const want = Math.max(0, cl.outstandingQty);
      // The cap is what this line still needs AND what the supplier line has
      // left after the customer orders ahead of it in the list.
      const cap = Math.min(want, Math.max(0, remaining));
      const qty = key in overrides ? Math.max(0, Math.floor(overrides[key])) : cap;

      cells.push({
        customerPoId: cpo.customerPoId,
        customerPoLineId: cl.customerPoLineId,
        supplierPoLineId: sl.supplierPoLineId,
        mpn: sl.mpn,
        quantity: qty,
        sellUnitPrice: cl.sellUnitPrice,
        buyUnitPrice: sl.unitPrice,
        // Reported against the untouched remainder so an override that is too
        // large still shows what the ceiling actually was.
        maxQuantity: cap,
      });
      remaining -= qty;
    }

    const allocatedQty = cells.reduce((a, c) => a + c.quantity, 0);
    rows.push({
      supplierPoLineId: sl.supplierPoLineId,
      mpn: sl.mpn,
      manufacturer: sl.manufacturer,
      description: sl.description,
      supplierQty: sl.availableQty,
      unitPrice: sl.unitPrice,
      allocatedQty,
      unallocatedQty: Math.max(0, sl.availableQty - allocatedQty),
      overAllocatedQty: Math.max(0, allocatedQty - sl.availableQty),
      cells,
    });
  }

  // ── Per customer ──────────────────────────────────────────────────────────
  /** Parts this supplier order actually carries. */
  const supplierMpns = new Set(supplierLines.map((l) => l.mpn.toUpperCase()));

  const perCustomer = customerPos.map((cpo) => {
    const mine = rows.flatMap((r) => r.cells.filter((c) => c.customerPoId === cpo.customerPoId && c.quantity > 0));
    const stillShortLines = cpo.lines
      // Only parts in play. Reporting a shortfall on a part this supplier order
      // never carried reads as a failure of the link rather than a fact about the
      // customer order, and there is nothing the operator could do about it here.
      .filter((l) => supplierMpns.has(l.mpn.toUpperCase()))
      .map((l) => {
        const got = mine
          .filter((c) => c.mpn.toUpperCase() === l.mpn.toUpperCase())
          .reduce((a, c) => a + c.quantity, 0);
        return { mpn: l.mpn, shortQty: Math.max(0, l.outstandingQty - got) };
      })
      .filter((x) => x.shortQty > 0);

    return {
      customerPoId: cpo.customerPoId,
      poNumber: cpo.poNumber,
      customer: cpo.customer,
      units: mine.reduce((a, c) => a + c.quantity, 0),
      sellValue: mine.reduce((a, c) => a + Math.round(c.quantity * c.sellUnitPrice * 100), 0),
      buyValue: mine.reduce((a, c) => a + c.quantity * c.buyUnitPrice, 0),
      lineCount: mine.length,
      stillShortLines,
    };
  });

  // ── What is wrong with it ─────────────────────────────────────────────────
  const problems: AllocationPlan['problems'] = [];

  for (const r of rows) {
    if (r.overAllocatedQty > 0) {
      problems.push({
        severity: 'BLOCKING',
        message: `${r.mpn} is allocated beyond what the order holds.`,
        detail: `${r.allocatedQty.toLocaleString('en-IN')} allocated against ${r.supplierQty.toLocaleString(
          'en-IN',
        )} available — ${r.overAllocatedQty.toLocaleString('en-IN')} too many. That would promise the same stock to two customers.`,
      });
    }
  }

  const claiming = perCustomer.filter((c) => c.units > 0);
  if (claiming.length === 0) {
    problems.push({
      severity: 'BLOCKING',
      message: 'No part on this supplier order matches any of the chosen customer orders.',
      detail:
        'Linking them would create work orders with nothing allocated. Check the part numbers, or pick different customer orders.',
    });
  }

  const emptyPicked = perCustomer.filter((c) => c.units === 0);
  if (emptyPicked.length > 0 && claiming.length > 0) {
    problems.push({
      severity: 'WARNING',
      message: `${emptyPicked.length} chosen customer order${emptyPicked.length === 1 ? '' : 's'} would get nothing.`,
      detail: `${emptyPicked
        .map((c) => c.poNumber)
        .join(', ')} — no matching part with quantity left. ${
        emptyPicked.length === 1 ? 'It' : 'They'
      } will be skipped rather than given an empty work order.`,
    });
  }

  const leftover = rows.reduce((a, r) => a + r.unallocatedQty, 0);
  if (leftover > 0) {
    problems.push({
      severity: 'WARNING',
      message: `${leftover.toLocaleString('en-IN')} units would stay unclaimed.`,
      detail:
        'Stock on this order that no chosen customer wants. It stays available to allocate to a later customer order — worth knowing rather than a problem.',
    });
  }

  return {
    rows,
    perCustomer,
    totalUnits: rows.reduce((a, r) => a + r.allocatedQty, 0),
    totalSellValue: perCustomer.reduce((a, c) => a + c.sellValue, 0),
    unallocatedUnits: leftover,
    problems: problems.sort(
      (a, b) => (a.severity === 'BLOCKING' ? -1 : 1) - (b.severity === 'BLOCKING' ? -1 : 1),
    ),
  };
}

export function allocationIsValid(plan: AllocationPlan): boolean {
  return !plan.problems.some((p) => p.severity === 'BLOCKING');
}
