/**
 * The order-level Profit & Loss, drafted for Finance.
 *
 * WHAT MAKES THIS DIFFERENT FROM THE MARGIN PANEL. The margin panel answers
 * "are we making money on this?" continuously and read-only. The P&L is a
 * document: a statement Finance signs, as at a date, that says what this order
 * earned. It has to survive being read six months later by somebody who was not
 * there — so it carries the workings, not just the answer.
 *
 * THE ONE RULE THIS FILE EXISTS TO ENFORCE. Creditable taxes are NOT a cost.
 * IGST paid at import comes back as Input Tax Credit; expensing it understates
 * margin, sometimes enough to kill a deal that was actually fine. The computed
 * draft therefore states the true margin AND what the margin would look like if
 * the credits were wrongly expensed, side by side, so the difference is
 * impossible to miss and equally impossible to book twice.
 *
 * Every figure here is computed from the order. Nothing is invented, estimated
 * or inferred by a language model — a P&L assembled from plausible-looking
 * numbers is the single worst artefact this platform could produce. Finance can
 * override any figure, and the override is recorded as an override.
 */

import { fromMinor } from '@/lib/domain/money';
import type { CheckResult, DeliverableDef, DeliverableInput, DeliverableValues } from './types';

const SECTIONS = [
  {
    key: 'header',
    label: 'Statement',
    note: 'What this statement covers and as at when.',
  },
  {
    key: 'revenue',
    label: 'Revenue',
    note: 'What the customer owes us for the goods, excluding the GST we collect on the government’s behalf.',
  },
  {
    key: 'cost',
    label: 'Cost of goods, landed',
    note: 'Everything it cost to put the goods in the customer’s hands. Recoverable taxes are excluded here and shown separately below.',
  },
  {
    key: 'credits',
    label: 'Recoverable taxes',
    note: 'Paid out, then claimed back as Input Tax Credit. Real cash timing, but not a cost of the order.',
  },
  {
    key: 'result',
    label: 'Result',
    note: 'The bottom line, and the same line computed the wrong way so the difference is visible.',
  },
  {
    key: 'signoff',
    label: 'Sign-off',
  },
];

const FIELDS = [
  // ── Statement ────────────────────────────────────────────────────────────
  { key: 'statementFor', label: 'Statement for', kind: 'text' as const, section: 'header', help: 'The order this P&L covers.', required: true },
  { key: 'customer', label: 'Customer', kind: 'text' as const, section: 'header', help: 'Who bought the goods.' },
  { key: 'supplier', label: 'Supplier', kind: 'text' as const, section: 'header', help: 'Who we bought them from.' },
  { key: 'asAtStage', label: 'As at stage', kind: 'text' as const, section: 'header', help: 'Where the order stood when these figures were taken. Costs landing after this point are not in them.' },
  { key: 'asAtDate', label: 'As at date', kind: 'date' as const, section: 'header', help: 'The date of the statement.' },
  { key: 'fxRate', label: 'FX rate used', kind: 'number' as const, section: 'header', help: 'The locked rate the supplier’s currency was converted at. Re-stating it here means the sums can be checked without opening the order.' },

  // ── Revenue ──────────────────────────────────────────────────────────────
  { key: 'sellValue', label: 'Invoiced to customer (ex-GST)', plainLabel: 'What the customer pays us', kind: 'money' as const, section: 'revenue', help: 'Goods value only. Output GST is excluded because it is collected for the government, not earned.' },
  { key: 'otherIncome', label: 'Other income', kind: 'money' as const, section: 'revenue', help: 'Anything else billed on this order — expediting, special packing. Usually nil.' },
  { key: 'netRevenue', label: 'Net revenue', kind: 'money' as const, section: 'revenue', derived: true, help: 'Invoiced plus other income.' },

  // ── Cost ─────────────────────────────────────────────────────────────────
  { key: 'buyValue', label: 'Supplier value (at locked FX)', plainLabel: 'What we pay the supplier', kind: 'money' as const, section: 'cost', help: 'The goods themselves, converted at the rate above.' },
  { key: 'freightCost', label: 'Freight & carriage', kind: 'money' as const, section: 'cost', help: 'Whatever we paid to move the goods. Depends on the delivery term — under CIF the supplier already carried it.' },
  { key: 'insuranceCost', label: 'Cargo insurance', kind: 'money' as const, section: 'cost', help: 'Cover we bought ourselves. Nil where the term obliged the supplier to insure.' },
  { key: 'dutyNonCreditable', label: 'Customs duty (non-creditable)', plainLabel: 'Import duty we cannot claim back', kind: 'money' as const, section: 'cost', help: 'BCD, social welfare surcharge and cess. Genuinely gone — unlike IGST, these are never refunded.' },
  { key: 'clearanceCost', label: 'Clearance & agent fees', kind: 'money' as const, section: 'cost', help: 'What the customs agent charged to clear the consignment.' },
  { key: 'testingCost', label: 'Testing & inspection', kind: 'money' as const, section: 'cost', help: 'Laboratory and inspection charges on this order.' },
  { key: 'repackCost', label: 'Rebrand & repack', kind: 'money' as const, section: 'cost', help: 'Warehouse handling, relabelling and repacking.' },
  { key: 'escrowFee', label: 'Escrow fee', kind: 'money' as const, section: 'cost', help: 'What the escrow provider charged to hold and release the funds.' },
  { key: 'otherCost', label: 'Other costs', kind: 'money' as const, section: 'cost', help: 'Anything not covered above. Use the note below to say what it is.' },
  { key: 'landedCost', label: 'Total landed cost', kind: 'money' as const, section: 'cost', derived: true, help: 'Everything above added up. This is the number margin is measured against.' },

  // ── Credits ──────────────────────────────────────────────────────────────
  { key: 'creditableTaxes', label: 'Input Tax Credit recoverable', plainLabel: 'Tax we get back', kind: 'money' as const, section: 'credits', help: 'Import IGST plus creditable GST on freight, testing and repack. Paid now, claimed back — which is why it is not in the cost above.' },
  { key: 'creditBenefit', label: 'What the credits are worth', kind: 'money' as const, section: 'credits', derived: true, help: 'The gap between the true margin and the margin you would report if you wrongly expensed the credits.' },

  // ── Result ───────────────────────────────────────────────────────────────
  { key: 'trueMargin', label: 'Gross margin', kind: 'money' as const, section: 'result', derived: true, help: 'Net revenue less landed cost. The figure that is actually true.' },
  { key: 'trueMarginPct', label: 'Gross margin %', kind: 'number' as const, section: 'result', derived: true, help: 'Margin as a percentage of net revenue.' },
  { key: 'marginBeforeCredits', label: 'Margin if credits were expensed', kind: 'money' as const, section: 'result', derived: true, help: 'The same order costed the wrong way. Shown only so the error is visible — never report this figure.' },
  { key: 'marginFloorPct', label: 'Margin floor %', kind: 'number' as const, section: 'result', help: 'The threshold this order was supposed to clear.' },

  // ── Sign-off ─────────────────────────────────────────────────────────────
  { key: 'notes', label: 'Finance notes', kind: 'longText' as const, section: 'signoff', help: 'Anything a later reader needs — what "other costs" were, why a figure was overridden, an accrual still to land.' },
  { key: 'preparedBy', label: 'Prepared by', kind: 'text' as const, section: 'signoff', help: 'Who put the statement together.', required: true },
];

/** Pulls a named cost component out of the landed-cost breakdown. */
const comp = (input: DeliverableInput, key: string): number =>
  input.costComponents.find((c) => c.key === key)?.amount ?? 0;

export const PNL: DeliverableDef = {
  kind: 'PNL',
  team: 'ONE_BUY_FINANCE',
  label: 'Order Profit & Loss',
  plainLabel: 'What we made on this order',
  purpose:
    'The statement Finance signs for what this order earned — revenue, every landed cost, and the tax we get back kept separate from the tax we do not.',
  // Before terms are locked the buy price can still move, and a P&L drafted off
  // a price that changes is a document somebody will quote back at you.
  readyFromStage: 'TERMS_LOCKED',
  dueByStage: 'CUSTOMER_INVOICED_AND_SETTLED',
  sections: SECTIONS,
  fields: FIELDS,

  compute(input): DeliverableValues {
    const dutyNonCreditable = comp(input, 'dutyBcd') + comp(input, 'dutySws') + comp(input, 'dutyCess');
    const netRevenue = input.sellValue;

    return {
      statementFor: `${input.alias}${input.soNumber ? ` · ${input.soNumber}` : ''}`,
      customer: input.customerName,
      supplier: input.supplierName,
      asAtStage: input.stageLabel,
      asAtDate: input.today,
      fxRate: input.fxRate,

      sellValue: input.sellValue,
      otherIncome: 0,
      netRevenue,

      buyValue: input.buyValue,
      freightCost: comp(input, 'freightCost'),
      insuranceCost: comp(input, 'insuranceCost'),
      dutyNonCreditable,
      clearanceCost: comp(input, 'clearanceCost'),
      testingCost: comp(input, 'testingCost'),
      repackCost: comp(input, 'repackCost'),
      escrowFee: comp(input, 'escrowFee'),
      otherCost: 0,
      landedCost: input.landedCost,

      creditableTaxes: input.creditableTaxes,
      creditBenefit: input.creditBenefit,

      trueMargin: input.trueMargin,
      trueMarginPct: Number(input.trueMarginPct.toFixed(2)),
      marginBeforeCredits: input.marginBeforeCredits,
      marginFloorPct: 12,

      notes: '',
      preparedBy: '',
    };
  },

  check(values, input): CheckResult[] {
    const num = (k: string) => Number(values[k] ?? 0);
    const checks: CheckResult[] = [];

    /*
     * The parts must still add up to the total.
     *
     * Finance can override any line, including the total — so the total can be
     * made to disagree with its own components. That is legitimate (an accrual
     * not yet broken out) but it must never happen silently.
     */
    const costParts =
      num('buyValue') +
      num('freightCost') +
      num('insuranceCost') +
      num('dutyNonCreditable') +
      num('clearanceCost') +
      num('testingCost') +
      num('repackCost') +
      num('escrowFee') +
      num('otherCost');
    const drift = Math.abs(costParts - num('landedCost'));
    checks.push({
      key: 'costAddsUp',
      label: 'Cost lines add up to the total',
      status: drift === 0 ? 'PASS' : drift <= 100 ? 'WARN' : 'FAIL',
      detail:
        drift === 0
          ? 'Every cost line sums exactly to the landed cost.'
          : `The cost lines sum to ${fromMinor(costParts).toLocaleString('en-IN')} but the total says ${fromMinor(num('landedCost')).toLocaleString('en-IN')} — a difference of ${fromMinor(drift).toLocaleString('en-IN')}. Say why in the notes, or correct the lines.`,
    });

    // Margin must be revenue minus cost. If it is not, one of the three was
    // edited and the other two were not.
    const impliedMargin = num('netRevenue') - num('landedCost');
    const marginDrift = Math.abs(impliedMargin - num('trueMargin'));
    checks.push({
      key: 'marginConsistent',
      label: 'Margin equals revenue less landed cost',
      status: marginDrift === 0 ? 'PASS' : 'FAIL',
      detail:
        marginDrift === 0
          ? 'The bottom line follows from the figures above it.'
          : 'Revenue less landed cost does not equal the stated margin. Recompute before approving — a P&L whose own arithmetic fails cannot be signed.',
    });

    /*
     * The check this whole file exists for.
     *
     * If somebody "corrects" the P&L by subtracting recoverable tax as a cost,
     * the landed cost jumps by exactly the credit amount. Catching it here is
     * cheaper than catching it in a quarterly review.
     */
    const looksDoubleCounted =
      input.creditableTaxes > 0 && num('landedCost') >= input.landedCost + input.creditableTaxes - 100;
    checks.push({
      key: 'creditsNotExpensed',
      label: 'Recoverable tax is not being expensed',
      status: looksDoubleCounted ? 'FAIL' : 'PASS',
      detail: looksDoubleCounted
        ? 'The landed cost has grown by roughly the recoverable-tax amount, which is what happens when Input Tax Credit is booked as a cost. It comes back to us — it does not belong in cost.'
        : 'Recoverable tax is held outside cost, where it belongs.',
    });

    const pct = num('trueMarginPct');
    const floor = num('marginFloorPct');
    checks.push({
      key: 'aboveFloor',
      label: 'Margin clears the floor',
      status: pct >= floor ? 'PASS' : 'WARN',
      detail:
        pct >= floor
          ? `${pct.toFixed(1)}% against a ${floor}% floor.`
          : `${pct.toFixed(1)}% is under the ${floor}% floor. It can still be approved, but say why it was accepted.`,
    });

    // Costs that arrive late. Approving a P&L before duty lands produces a
    // statement that will be wrong within days.
    const dutyLanded = input.completedStageIds.includes('DUTY_ASSESSED_AND_PAID');
    checks.push({
      key: 'costsComplete',
      label: 'All expected costs have landed',
      status: dutyLanded ? 'PASS' : 'WARN',
      detail: dutyLanded
        ? 'Duty has been assessed and paid, so the import costs in this statement are final.'
        : 'Duty has not been assessed yet, so the import cost here is an estimate. This statement will need a new version once it lands.',
    });

    const preparedBy = String(values.preparedBy ?? '').trim();
    checks.push({
      key: 'signed',
      label: 'Prepared-by is filled in',
      status: preparedBy ? 'PASS' : 'FAIL',
      detail: preparedBy
        ? `Prepared by ${preparedBy}.`
        : 'A statement nobody is named on cannot be signed off.',
    });

    return checks;
  },
};
