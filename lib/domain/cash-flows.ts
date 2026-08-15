/**
 * The order's cash ledger — rupees actually moving, not goods.
 *
 * The P&L is a statement signed at the END of the flow; this is what Finance
 * watches WHILE the order runs: what has left the bank, what is committed and
 * will leave, and what is expected back. Every row is keyed to the stage that
 * makes the money move, so the ledger updates itself as the order advances —
 * no figure here is typed in, and none is guessed.
 *
 * PAID vs COMMITTED vs EXPECTED is the whole point. Duty that has been
 * assessed and paid is gone; freight on a shipment that has dispatched is
 * committed but still in the bank; the customer's settlement is expected until
 * G5 actually completes. Collapsing those three into one number is how a
 * healthy-looking order runs out of cash mid-flow.
 */

import type { DeliverableInput } from './deliverables/types';

export type CashStatus = 'PAID' | 'COMMITTED' | 'EXPECTED';

export interface CashRow {
  key: string;
  label: string;
  direction: 'OUT' | 'IN';
  amount: number;
  status: CashStatus;
  /** Which step makes (or made) the money move — shown so the row explains itself. */
  movesAt: string;
  /** One line of context: recoverability, method, partial releases. */
  note?: string;
}

export interface CashPosition {
  rows: CashRow[];
  /** Cash that has actually left the bank. */
  paidOut: number;
  /** Cash that has actually arrived. */
  paidIn: number;
  /** paidIn − paidOut: negative while we are funding the order, by design. */
  netCash: number;
  /** Still to go out once committed/expected rows land. */
  committedOut: number;
  /** Still to come in. */
  expectedIn: number;
  /** Where the P&L should land when everything settles — the margin engine's figure. */
  projectedMargin: number;
}

const comp = (i: DeliverableInput, key: string) =>
  i.costComponents.find((c) => c.key === key)?.amount ?? 0;

/**
 * Classifies every cash movement on the order.
 *
 * Stage choices are deliberate and worth stating: freight is treated as paid on
 * arrival (carrier invoices settle against delivery of the leg), testing when
 * the lab reaches a verdict, clearance when customs clears — each the point the
 * counterparty's invoice becomes payable, not when the work merely starts.
 */
export function cashPosition(i: DeliverableInput): CashPosition {
  const done = new Set(i.completedStageIds);
  const has = (id: string) => done.has(id);
  const rows: CashRow[] = [];

  // ── Supplier payment: the method decides when cash leaves the BANK ────────
  if (i.paymentMethod === 'ESCROW') {
    const released = i.escrowReleased;
    rows.push({
      key: 'supplier',
      label: 'Supplier payment (via escrow)',
      direction: 'OUT',
      amount: i.buyValue,
      // Funding is the cash event: the money leaves our account at C2, however
      // long it then sits with the escrow provider before reaching the supplier.
      status: has('ESCROW_FUNDED') ? 'PAID' : has('TERMS_LOCKED') ? 'COMMITTED' : 'EXPECTED',
      movesAt: 'Escrow funded (C2)',
      note: has('ESCROW_FUNDED')
        ? released > 0
          ? `Out of our bank; escrow has passed on ${Math.round((released / Math.max(1, i.escrowHeld)) * 100)}% to the supplier so far.`
          : 'Out of our bank and held by the escrow provider — nothing released to the supplier yet.'
        : 'Leaves the bank when the escrow account is funded.',
    });
  } else if (i.paymentMethod === 'ADVANCE') {
    rows.push({
      key: 'supplier',
      label: 'Supplier payment (advance)',
      direction: 'OUT',
      amount: i.buyValue,
      status: has('ADVANCE_PAYMENT_TO_SUPPLIER') ? 'PAID' : has('TERMS_LOCKED') ? 'COMMITTED' : 'EXPECTED',
      movesAt: 'Advance paid (C1a)',
    });
  } else {
    rows.push({
      key: 'supplier',
      label: 'Supplier payment (on credit)',
      direction: 'OUT',
      amount: i.buyValue,
      status: has('SUPPLIER_PAID_IN_FULL') ? 'PAID' : has('TERMS_LOCKED') ? 'COMMITTED' : 'EXPECTED',
      movesAt: 'Supplier paid in full (F4)',
      note: 'Credit terms: the goods move before the cash does.',
    });
  }

  const push = (
    key: string,
    label: string,
    amount: number,
    paidWhen: string,
    movesAt: string,
    committedWhen?: string,
    note?: string,
  ) => {
    if (amount <= 0) return; // a zero row is noise, not information
    rows.push({
      key,
      label,
      direction: 'OUT',
      amount,
      status: has(paidWhen) ? 'PAID' : committedWhen && has(committedWhen) ? 'COMMITTED' : 'EXPECTED',
      movesAt,
      note,
    });
  };

  const duty = comp(i, 'dutyBcd') + comp(i, 'dutySws') + comp(i, 'dutyCess');
  push('duty', 'Customs duty (not recoverable)', duty, 'DUTY_ASSESSED_AND_PAID', 'Duty paid (E5)', 'CUSTOMS_ENTRY_FILED_ICEGATE');
  push(
    'igst',
    'Import IGST (recoverable)',
    comp(i, 'dutyIgst'),
    'DUTY_ASSESSED_AND_PAID',
    'Duty paid (E5)',
    'CUSTOMS_ENTRY_FILED_ICEGATE',
    'Real cash out now — comes back as Input Tax Credit, so it is not a cost.',
  );
  push(
    'freight',
    'Freight & insurance (ours)',
    comp(i, 'freightCost') + comp(i, 'insuranceCost'),
    'GOODS_RECEIVED_INBOUND_AT_1BUY',
    'Goods received (E7)',
    'FULL_SHIPMENT_DISPATCHED_BY_SUPPLIER',
    'Carrier invoices settle against arrival of the leg.',
  );
  push(
    'testing',
    'Testing & laboratory',
    comp(i, 'testingCost'),
    has('TEST_FAILED') ? 'TEST_FAILED' : 'TEST_PASSED',
    'Lab verdict (D5)',
    'TEST_DISPATCH_BOOKED',
  );
  push('clearance', 'Clearance & CHA fees', comp(i, 'clearanceCost'), 'CUSTOMS_CLEARED', 'Customs cleared (E6)', 'BORDER_ARRIVAL_WHA_ENGAGED');
  push('repack', 'Rebrand & repack', comp(i, 'repackCost'), 'READY_FOR_OUTBOUND', 'Ready for outbound (F6)', 'REBRAND_AND_REPACK_IN_PROGRESS');
  push('escrowFee', 'Escrow provider fee', comp(i, 'escrowFee'), 'SUPPLIER_PAID_IN_FULL', 'Final settlement (F4)', 'ESCROW_ACCOUNT_OPENED');

  // ── Inflows ────────────────────────────────────────────────────────────────
  rows.push({
    key: 'settlement',
    label: 'Customer settlement',
    direction: 'IN',
    amount: i.sellValue,
    status: has('CUSTOMER_INVOICED_AND_SETTLED') ? 'PAID' : has('DELIVERED') ? 'COMMITTED' : 'EXPECTED',
    movesAt: 'Payment settled (G5)',
    note: has('CUSTOMER_INVOICED_AND_SETTLED')
      ? undefined
      : has('DELIVERED')
        ? 'Delivered — the invoice is now collectable.'
        : 'Arrives once the goods are delivered and the invoice settles.',
  });
  if (comp(i, 'dutyIgst') > 0) {
    rows.push({
      key: 'itc',
      label: 'Input Tax Credit recovered',
      direction: 'IN',
      amount: i.creditableTaxes,
      status: 'EXPECTED',
      movesAt: 'Via the GST return',
      note: 'Offsets tax otherwise payable — recovered through the return cycle, not on this order’s timeline.',
    });
  }

  const paidOut = rows.filter((r) => r.direction === 'OUT' && r.status === 'PAID').reduce((a, r) => a + r.amount, 0);
  const paidIn = rows.filter((r) => r.direction === 'IN' && r.status === 'PAID').reduce((a, r) => a + r.amount, 0);
  const committedOut = rows
    .filter((r) => r.direction === 'OUT' && r.status !== 'PAID')
    .reduce((a, r) => a + r.amount, 0);
  const expectedIn = rows.filter((r) => r.direction === 'IN' && r.status !== 'PAID').reduce((a, r) => a + r.amount, 0);

  return {
    rows,
    paidOut,
    paidIn,
    netCash: paidIn - paidOut,
    committedOut,
    expectedIn,
    projectedMargin: i.trueMargin,
  };
}
