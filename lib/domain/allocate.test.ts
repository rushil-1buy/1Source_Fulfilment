import { describe, expect, it } from 'vitest';
import {
  allocationIsValid,
  planAllocation,
  type ClaimingCustomerPo,
  type SupplierLineAvail,
} from './allocate';

function sline(over: Partial<SupplierLineAvail> = {}): SupplierLineAvail {
  const quantity = over.quantity ?? 10_000;
  const allocatedQty = over.allocatedQty ?? 0;
  return {
    supplierPoLineId: 'sl1',
    mpn: 'SN74HC595N',
    manufacturer: 'Texas Instruments',
    description: '8-bit shift register',
    quantity,
    allocatedQty,
    availableQty: over.availableQty ?? quantity - allocatedQty,
    unitPrice: 0.26,
    ...over,
  };
}

function cpo(
  id: string,
  poNumber: string,
  lines: { mpn: string; outstandingQty: number; sellUnitPrice?: number }[],
): ClaimingCustomerPo {
  return {
    customerPoId: id,
    poNumber,
    customer: `${poNumber} customer`,
    poDate: '2026-07-01T00:00:00.000Z',
    requestedDate: '2026-09-01T00:00:00.000Z',
    lines: lines.map((l, i) => ({
      customerPoLineId: `${id}-l${i + 1}`,
      mpn: l.mpn,
      orderedQty: l.outstandingQty,
      coveredQty: 0,
      outstandingQty: l.outstandingQty,
      sellUnitPrice: l.sellUnitPrice ?? 34,
    })),
  };
}

describe('planAllocation — one supplier order across several customer orders', () => {
  it('fills the customer orders in the listed order and depletes the supplier line', () => {
    const plan = planAllocation(
      [sline({ quantity: 10_000 })],
      [
        cpo('a', 'CPO-A', [{ mpn: 'SN74HC595N', outstandingQty: 6000 }]),
        cpo('b', 'CPO-B', [{ mpn: 'SN74HC595N', outstandingQty: 6000 }]),
      ],
    );
    const cells = plan.rows[0].cells;
    expect(cells.map((c) => c.quantity)).toEqual([6000, 4000]);
    expect(plan.rows[0].allocatedQty).toBe(10_000);
    expect(plan.rows[0].unallocatedQty).toBe(0);
    expect(plan.rows[0].overAllocatedQty).toBe(0);
  });

  it('never allocates more than the supplier line holds, however many claim it', () => {
    const plan = planAllocation(
      [sline({ quantity: 5000 })],
      [
        cpo('a', 'CPO-A', [{ mpn: 'SN74HC595N', outstandingQty: 4000 }]),
        cpo('b', 'CPO-B', [{ mpn: 'SN74HC595N', outstandingQty: 4000 }]),
        cpo('c', 'CPO-C', [{ mpn: 'SN74HC595N', outstandingQty: 4000 }]),
      ],
    );
    expect(plan.rows[0].cells.map((c) => c.quantity)).toEqual([4000, 1000, 0]);
    expect(plan.rows[0].allocatedQty).toBe(5000);
    expect(allocationIsValid(plan)).toBe(true);
  });

  it('respects what the supplier line has ALREADY committed elsewhere', () => {
    const plan = planAllocation(
      [sline({ quantity: 10_000, allocatedQty: 7000 })],
      [cpo('a', 'CPO-A', [{ mpn: 'SN74HC595N', outstandingQty: 9000 }])],
    );
    expect(plan.rows[0].supplierQty).toBe(3000);
    expect(plan.rows[0].cells[0].quantity).toBe(3000);
    expect(plan.perCustomer[0].stillShortLines).toEqual([{ mpn: 'SN74HC595N', shortQty: 6000 }]);
  });

  it('never allocates more than a customer line still needs', () => {
    const plan = planAllocation(
      [sline({ quantity: 10_000 })],
      [cpo('a', 'CPO-A', [{ mpn: 'SN74HC595N', outstandingQty: 400 }])],
    );
    expect(plan.rows[0].cells[0].quantity).toBe(400);
    expect(plan.rows[0].unallocatedQty).toBe(9600);
    expect(plan.unallocatedUnits).toBe(9600);
  });

  it('skips a customer order with no matching part rather than giving it an empty cell', () => {
    const plan = planAllocation(
      [sline({ mpn: 'SN74HC595N' })],
      [
        cpo('a', 'CPO-A', [{ mpn: 'SN74HC595N', outstandingQty: 100 }]),
        cpo('b', 'CPO-B', [{ mpn: 'IRF540N', outstandingQty: 100 }]),
      ],
    );
    expect(plan.rows[0].cells).toHaveLength(1);
    expect(plan.rows[0].cells[0].customerPoId).toBe('a');
    expect(plan.problems.some((p) => p.message.includes('would get nothing'))).toBe(true);
  });

  it('matches part numbers case-insensitively', () => {
    const plan = planAllocation(
      [sline({ mpn: 'sn74hc595n' })],
      [cpo('a', 'CPO-A', [{ mpn: 'SN74HC595N', outstandingQty: 500 }])],
    );
    expect(plan.rows[0].cells[0].quantity).toBe(500);
  });
});

describe('planAllocation — overrides', () => {
  it('honours a manual quantity in place of the greedy default', () => {
    const plan = planAllocation(
      [sline({ quantity: 10_000 })],
      [
        cpo('a', 'CPO-A', [{ mpn: 'SN74HC595N', outstandingQty: 8000 }]),
        cpo('b', 'CPO-B', [{ mpn: 'SN74HC595N', outstandingQty: 8000 }]),
      ],
      { 'a:sl1': 5000 },
    );
    // Overriding the first down leaves more for the second.
    expect(plan.rows[0].cells.map((c) => c.quantity)).toEqual([5000, 5000]);
    expect(allocationIsValid(plan)).toBe(true);
  });

  it('blocks an override that over-allocates the supplier line', () => {
    const plan = planAllocation(
      [sline({ quantity: 5000 })],
      [
        cpo('a', 'CPO-A', [{ mpn: 'SN74HC595N', outstandingQty: 5000 }]),
        cpo('b', 'CPO-B', [{ mpn: 'SN74HC595N', outstandingQty: 5000 }]),
      ],
      { 'a:sl1': 5000, 'b:sl1': 3000 },
    );
    expect(plan.rows[0].overAllocatedQty).toBe(3000);
    expect(allocationIsValid(plan)).toBe(false);
    const p = plan.problems.find((x) => x.severity === 'BLOCKING');
    expect(p?.detail).toMatch(/3,000 too many/);
    expect(p?.detail).toMatch(/same stock to two customers/);
  });

  it('floors a fractional override — stock comes in whole pieces', () => {
    const plan = planAllocation(
      [sline({ quantity: 100 })],
      [cpo('a', 'CPO-A', [{ mpn: 'SN74HC595N', outstandingQty: 100 }])],
      { 'a:sl1': 12.7 },
    );
    expect(plan.rows[0].cells[0].quantity).toBe(12);
  });

  it('treats a negative override as zero', () => {
    const plan = planAllocation(
      [sline({ quantity: 100 })],
      [cpo('a', 'CPO-A', [{ mpn: 'SN74HC595N', outstandingQty: 100 }])],
      { 'a:sl1': -50 },
    );
    expect(plan.rows[0].cells[0].quantity).toBe(0);
  });
});

describe('planAllocation — what each customer ends up with', () => {
  it('values each customer at their OWN price, not the supplier price', () => {
    const plan = planAllocation(
      [sline({ quantity: 3000, unitPrice: 0.26 })],
      [
        cpo('a', 'CPO-A', [{ mpn: 'SN74HC595N', outstandingQty: 1000, sellUnitPrice: 34 }]),
        cpo('b', 'CPO-B', [{ mpn: 'SN74HC595N', outstandingQty: 2000, sellUnitPrice: 36 }]),
      ],
    );
    // Different customers, different prices for the same physical part.
    expect(plan.perCustomer[0].sellValue).toBe(1000 * 34 * 100);
    expect(plan.perCustomer[1].sellValue).toBe(2000 * 36 * 100);
    expect(plan.totalSellValue).toBe(1000 * 34 * 100 + 2000 * 36 * 100);
  });

  it('reports what each customer is still short after the allocation', () => {
    const plan = planAllocation(
      [sline({ quantity: 1000 })],
      [
        cpo('a', 'CPO-A', [{ mpn: 'SN74HC595N', outstandingQty: 700 }]),
        cpo('b', 'CPO-B', [{ mpn: 'SN74HC595N', outstandingQty: 900 }]),
      ],
    );
    expect(plan.perCustomer[0].stillShortLines).toEqual([]);
    expect(plan.perCustomer[1].stillShortLines).toEqual([{ mpn: 'SN74HC595N', shortQty: 600 }]);
  });

  it('handles several parts across several customers at once', () => {
    const plan = planAllocation(
      [
        sline({ supplierPoLineId: 'sl1', mpn: 'SN74HC595N', quantity: 5000, unitPrice: 0.26 }),
        sline({ supplierPoLineId: 'sl2', mpn: 'IRF540N', quantity: 2000, unitPrice: 0.7 }),
      ],
      [
        cpo('a', 'CPO-A', [
          { mpn: 'SN74HC595N', outstandingQty: 3000 },
          { mpn: 'IRF540N', outstandingQty: 1500 },
        ]),
        cpo('b', 'CPO-B', [{ mpn: 'SN74HC595N', outstandingQty: 4000 }]),
      ],
    );
    expect(plan.rows).toHaveLength(2);
    expect(plan.rows[0].cells.map((c) => c.quantity)).toEqual([3000, 2000]);
    expect(plan.rows[1].cells.map((c) => c.quantity)).toEqual([1500]);
    expect(plan.perCustomer[0].units).toBe(4500);
    expect(plan.perCustomer[1].units).toBe(2000);
    expect(plan.totalUnits).toBe(6500);
    expect(plan.unallocatedUnits).toBe(500);
  });

  it('blocks when nothing at all matches', () => {
    const plan = planAllocation(
      [sline({ mpn: 'SN74HC595N' })],
      [cpo('a', 'CPO-A', [{ mpn: 'NOTHING-LIKE-IT', outstandingQty: 100 }])],
    );
    expect(allocationIsValid(plan)).toBe(false);
    expect(plan.problems[0].message).toMatch(/No part on this supplier order matches/);
  });
});
