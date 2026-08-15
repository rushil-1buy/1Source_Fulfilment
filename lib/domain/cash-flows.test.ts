/**
 * The cash ledger's one job is to not lie about whether money has moved.
 *
 * Every test spoils or advances exactly one stage and asserts the affected row
 * flips state — because the failure mode here is silent: a row stuck on
 * EXPECTED after the cash left, or worse, PAID before it did.
 */

import { describe, expect, it } from 'vitest';
import { cashPosition } from './cash-flows';
import type { DeliverableInput } from './deliverables/types';

const base: DeliverableInput = {
  orderId: 'wo-1', alias: 'WO-1', soNumber: null, stage: 'IN_TRANSIT_INTERNATIONAL',
  stageLabel: 'In transit', incoterms: 'FOB', sellIncoterms: 'DDP', paymentMethod: 'ESCROW',
  buyCurrency: 'USD', fxRate: 83, customerName: 'Acme', customerGstin: null, customerAddress: 'BLR',
  supplierName: 'GCS', supplierCountry: 'SG', customerPoNumber: 'CPO-1', supplierPoNumber: 'PO-1',
  customerPiNumber: null, supplierPiNumber: null,
  sellValue: 1_000_000, buyValue: 600_000, landedCost: 750_000, creditableTaxes: 120_000,
  nonCreditableLevies: 40_000, trueMargin: 250_000, trueMarginPct: 25,
  marginBeforeCredits: 130_000, creditBenefit: 120_000, belowFloor: false,
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
  lines: [], totalQty: 0, lineCount: 0,
  escrowHeld: 600_000, escrowReleased: 180_000,
  inspection: null, shipment: null, customs: null, warehouseLocation: null,
  completedStageIds: ['TERMS_LOCKED', 'ESCROW_FUNDED', 'TEST_DISPATCH_BOOKED', 'FULL_SHIPMENT_DISPATCHED_BY_SUPPLIER'],
  today: '2026-08-15',
};

const row = (i: DeliverableInput, key: string) => cashPosition(i).rows.find((r) => r.key === key)!;

describe('cash ledger — states follow the stages', () => {
  it('marks escrow funding PAID once C2 completes: the cash has left the bank', () => {
    expect(row(base, 'supplier').status).toBe('PAID');
  });

  it('holds the supplier row at COMMITTED when terms are locked but escrow is not funded', () => {
    const i = { ...base, completedStageIds: ['TERMS_LOCKED'] };
    expect(row(i, 'supplier').status).toBe('COMMITTED');
  });

  it('keeps duty EXPECTED before filing, COMMITTED after filing, PAID after assessment', () => {
    expect(row(base, 'duty').status).toBe('EXPECTED');
    const filed = { ...base, completedStageIds: [...base.completedStageIds, 'CUSTOMS_ENTRY_FILED_ICEGATE'] };
    expect(row(filed, 'duty').status).toBe('COMMITTED');
    const paid = { ...filed, completedStageIds: [...filed.completedStageIds, 'DUTY_ASSESSED_AND_PAID'] };
    expect(row(paid, 'duty').status).toBe('PAID');
  });

  it('treats freight as committed once dispatched and paid only on arrival', () => {
    expect(row(base, 'freight').status).toBe('COMMITTED');
    const arrived = { ...base, completedStageIds: [...base.completedStageIds, 'GOODS_RECEIVED_INBOUND_AT_1BUY'] };
    expect(row(arrived, 'freight').status).toBe('PAID');
  });

  it('keeps the customer settlement EXPECTED until G5 actually completes', () => {
    expect(row(base, 'settlement').status).toBe('EXPECTED');
    const settled = { ...base, completedStageIds: [...base.completedStageIds, 'CUSTOMER_INVOICED_AND_SETTLED'] };
    expect(row(settled, 'settlement').status).toBe('PAID');
  });

  it('flags recoverable IGST separately from duty — cash out, but not a cost', () => {
    const r = row(base, 'igst');
    expect(r.note).toMatch(/Input Tax Credit/);
  });

  it('sums paid-out from PAID rows only — committed money is still in the bank', () => {
    const pos = cashPosition(base);
    expect(pos.paidOut).toBe(600_000); // only the escrow funding has actually moved
    expect(pos.netCash).toBe(-600_000);
    expect(pos.committedOut).toBeGreaterThan(0);
  });

  it('drops zero-amount rows rather than printing a ledger of noise', () => {
    const lean = { ...base, costComponents: base.costComponents.filter((c) => c.key !== 'repackCost') };
    expect(cashPosition(lean).rows.some((r) => r.key === 'repack')).toBe(false);
  });
});
