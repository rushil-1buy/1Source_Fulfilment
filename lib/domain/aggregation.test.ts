import { describe, expect, it } from 'vitest';
import {
  assessPool,
  poolDemand,
  poolIsFloatable,
  type DemandCandidate,
  type PoolInput,
} from './aggregation';

function candidate(over: Partial<DemandCandidate> = {}): DemandCandidate {
  return {
    customerPoLineId: 'l1',
    customerPoId: 'cpo1',
    customerPoNumber: 'CPO-ACME-0001',
    customerName: 'ACME Electronics Private Limited',
    requestedDate: '2026-12-01T00:00:00.000Z',
    lineNo: 1,
    mpn: 'STM32F407VGT6',
    manufacturer: 'STMicroelectronics',
    description: 'ARM Cortex-M4 MCU',
    hsnCode: '85423100',
    orderedQty: 1000,
    allocatedQty: 0,
    availableQty: 1000,
    sellUnitPrice: 985,
    lastBuyUnitPrice: 9.6,
    testingRequired: false,
    uom: 'PCS',
    ...over,
  };
}

const ok = { supplierChosen: true, hasRationale: true };

describe('poolDemand — consolidating the same part across customers', () => {
  it('sums one MPN across three customer orders into a single pooled line', () => {
    const inputs: PoolInput[] = [
      { candidate: candidate({ customerPoLineId: 'a', customerPoId: 'p1', customerPoNumber: 'CPO-A' }), quantity: 1200 },
      { candidate: candidate({ customerPoLineId: 'b', customerPoId: 'p2', customerPoNumber: 'CPO-B', customerName: 'Nova Systems Limited' }), quantity: 800 },
      { candidate: candidate({ customerPoLineId: 'c', customerPoId: 'p3', customerPoNumber: 'CPO-C', customerName: 'Zenith Devices' }), quantity: 3000 },
    ];
    const s = poolDemand(inputs, { STM32F407VGT6: { buyUnitPrice: 8.4 } });

    expect(s.parts).toHaveLength(1);
    expect(s.parts[0].pooledQty).toBe(5000);
    expect(s.parts[0].customerPoCount).toBe(3);
    expect(s.parts[0].lineCount).toBe(3);
    expect(s.customerPoCount).toBe(3);
    expect(s.customerCount).toBe(3);
    expect(s.totalUnits).toBe(5000);
  });

  it('keeps different parts separate and orders by pooled quantity', () => {
    const s = poolDemand([
      { candidate: candidate({ customerPoLineId: 'a', mpn: 'SMALL' }), quantity: 100 },
      { candidate: candidate({ customerPoLineId: 'b', mpn: 'BIG', customerPoId: 'p2' }), quantity: 9000 },
    ]);
    expect(s.parts.map((p) => p.mpn)).toEqual(['BIG', 'SMALL']);
  });

  it('reports each customer share of the pooled quantity, largest first', () => {
    const s = poolDemand([
      { candidate: candidate({ customerPoLineId: 'a', customerPoId: 'p1', customerPoNumber: 'CPO-A' }), quantity: 250 },
      { candidate: candidate({ customerPoLineId: 'b', customerPoId: 'p2', customerPoNumber: 'CPO-B' }), quantity: 750 },
    ]);
    const shares = s.parts[0].contributions;
    expect(shares[0].customerPoNumber).toBe('CPO-B');
    expect(shares[0].sharePct).toBeCloseTo(75, 6);
    expect(shares[1].sharePct).toBeCloseTo(25, 6);
  });

  it('takes the earliest promised date, not the average — one late customer is a late order', () => {
    const s = poolDemand([
      { candidate: candidate({ customerPoLineId: 'a', requestedDate: '2027-03-01T00:00:00.000Z' }), quantity: 10 },
      { candidate: candidate({ customerPoLineId: 'b', customerPoId: 'p2', requestedDate: '2026-09-15T00:00:00.000Z' }), quantity: 10 },
    ]);
    expect(s.earliestRequiredBy).toBe('2026-09-15T00:00:00.000Z');
  });
});

describe('poolDemand — the saving that justifies pooling', () => {
  it('computes the saving against the last price seen when no baseline is given', () => {
    // 5,000 pieces: 9.60 each individually, 8.40 pooled.
    const s = poolDemand(
      [
        { candidate: candidate({ customerPoLineId: 'a', lastBuyUnitPrice: 9.6 }), quantity: 2000 },
        { candidate: candidate({ customerPoLineId: 'b', customerPoId: 'p2', lastBuyUnitPrice: 9.6 }), quantity: 3000 },
      ],
      { STM32F407VGT6: { buyUnitPrice: 8.4 } },
    );
    expect(s.pooledSpend).toBe(42000);
    expect(s.baselineSpend).toBe(48000);
    expect(s.saving).toBe(6000);
    expect(s.savingPct).toBeCloseTo(12.5, 6);
  });

  it('prefers an explicit baseline over the last price seen', () => {
    const s = poolDemand([{ candidate: candidate({ lastBuyUnitPrice: 9.6 }), quantity: 1000 }], {
      STM32F407VGT6: { buyUnitPrice: 8.4, baselineUnitPrice: 9.0 },
    });
    expect(s.baselineSpend).toBe(9000);
    expect(s.saving).toBe(600);
  });

  it('leaves money figures null rather than guessing when no price is entered', () => {
    const s = poolDemand([{ candidate: candidate(), quantity: 1000 }]);
    expect(s.parts[0].buyUnitPrice).toBeNull();
    expect(s.parts[0].pooledSpend).toBeNull();
    expect(s.parts[0].saving).toBeNull();
    expect(s.partsWithoutPrice).toEqual(['STM32F407VGT6']);
  });

  it('reports a negative saving honestly instead of clamping it at zero', () => {
    const s = poolDemand([{ candidate: candidate({ lastBuyUnitPrice: 8.0 }), quantity: 1000 }], {
      STM32F407VGT6: { buyUnitPrice: 8.5 },
    });
    expect(s.saving).toBe(-500);
  });

  it('rounds money to whole paise so a pooled spend never carries fractions', () => {
    const s = poolDemand([{ candidate: candidate(), quantity: 3 }], {
      STM32F407VGT6: { buyUnitPrice: 1.005 },
    });
    // 3 × 1.005 = 3.015 → 3.02 at whole-paise precision, half up.
    expect(s.pooledSpend).toBe(3.02);
  });
});

describe('assessPool — what must be true before a bulk order is floated', () => {
  it('blocks an empty pool', () => {
    const s = poolDemand([]);
    const p = assessPool([], s, ok);
    expect(poolIsFloatable(p)).toBe(false);
    expect(p[0].message).toMatch(/Nothing has been added/);
  });

  it('blocks a line pooled beyond what it has left unallocated', () => {
    // The customer ordered 1,000 and 700 is already promised elsewhere.
    const c = candidate({ orderedQty: 1000, allocatedQty: 700, availableQty: 300 });
    const inputs = [{ candidate: c, quantity: 500 }];
    const p = assessPool(inputs, poolDemand(inputs, { STM32F407VGT6: { buyUnitPrice: 8 } }), ok);
    expect(poolIsFloatable(p)).toBe(false);
    const over = p.find((x) => x.message.includes('over-committed'));
    expect(over?.detail).toMatch(/only 300 is unallocated/);
    expect(over?.detail).toMatch(/buy the same pieces twice/);
  });

  it('blocks a zero quantity', () => {
    const inputs = [{ candidate: candidate(), quantity: 0 }];
    const p = assessPool(inputs, poolDemand(inputs), ok);
    expect(p.some((x) => x.severity === 'BLOCKING' && x.message.includes('no quantity'))).toBe(true);
  });

  it('blocks a missing supplier, a missing reason and an unpriced part separately', () => {
    const inputs = [{ candidate: candidate(), quantity: 100 }];
    const p = assessPool(inputs, poolDemand(inputs), {
      supplierChosen: false,
      hasRationale: false,
    });
    expect(p.filter((x) => x.field === 'supplierId')).toHaveLength(1);
    expect(p.filter((x) => x.field === 'rationale')).toHaveLength(1);
    expect(p.filter((x) => x.field === 'prices')).toHaveLength(1);
    expect(poolIsFloatable(p)).toBe(false);
  });

  it('allows a valid two-customer pool', () => {
    const inputs = [
      { candidate: candidate({ customerPoLineId: 'a', customerPoId: 'p1' }), quantity: 500 },
      { candidate: candidate({ customerPoLineId: 'b', customerPoId: 'p2', customerPoNumber: 'CPO-B' }), quantity: 500 },
    ];
    const p = assessPool(inputs, poolDemand(inputs, { STM32F407VGT6: { buyUnitPrice: 8 } }), ok);
    expect(poolIsFloatable(p)).toBe(true);
  });

  it('warns but does not block on a single-customer pool', () => {
    const inputs = [{ candidate: candidate(), quantity: 500 }];
    const p = assessPool(inputs, poolDemand(inputs, { STM32F407VGT6: { buyUnitPrice: 8 } }), ok);
    expect(poolIsFloatable(p)).toBe(true);
    expect(p.some((x) => x.severity === 'WARNING' && x.message.includes('one customer order'))).toBe(
      true,
    );
  });

  it('warns when pooling would cost more than buying separately', () => {
    const inputs = [
      { candidate: candidate({ customerPoLineId: 'a', customerPoId: 'p1', lastBuyUnitPrice: 8 }), quantity: 500 },
      { candidate: candidate({ customerPoLineId: 'b', customerPoId: 'p2', lastBuyUnitPrice: 8 }), quantity: 500 },
    ];
    const p = assessPool(inputs, poolDemand(inputs, { STM32F407VGT6: { buyUnitPrice: 9 } }), ok);
    expect(poolIsFloatable(p)).toBe(true);
    expect(p.some((x) => x.message.includes('worse than the baseline'))).toBe(true);
  });

  it('puts blocking problems before warnings', () => {
    const inputs = [{ candidate: candidate({ availableQty: 10 }), quantity: 999 }];
    const p = assessPool(inputs, poolDemand(inputs), ok);
    expect(p[0].severity).toBe('BLOCKING');
  });
});
