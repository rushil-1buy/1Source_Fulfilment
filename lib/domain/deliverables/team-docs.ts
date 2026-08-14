/**
 * The documents the other four teams are answerable for.
 *
 * Finance's P&L lives in its own file because it carries real accounting rules.
 * These seven are simpler in arithmetic but the same in shape: drafted from the
 * order's own record, comprehensively fielded, checked, then held as a draft
 * until a person approves them.
 *
 * A NOTE ON THE FIELDS. Each of these mirrors a document that exists on paper in
 * the real trade — a packing list, a goods receipt note, a bill of entry
 * summary. The field sets are deliberately full rather than minimal: a packing
 * list missing gross weight is not a shorter packing list, it is one the carrier
 * will reject. Where the system genuinely cannot know a value it is left blank
 * for the team to fill, and the check tells them it is required — which is
 * honest, where a plausible default would not be.
 */

import type { CheckResult, DeliverableDef, DeliverableValues } from './types';

const f = (
  key: string,
  label: string,
  kind: 'money' | 'number' | 'text' | 'longText' | 'date' | 'boolean',
  section: string,
  help: string,
  opts: { required?: boolean; derived?: boolean; plainLabel?: string } = {},
) => ({ key, label, kind, section, help, ...opts });

/** Blank-but-required is the commonest failure, so it gets one helper. */
const required = (values: DeliverableValues, key: string, label: string, why: string): CheckResult => {
  const filled = String(values[key] ?? '').trim().length > 0;
  return {
    key: `req-${key}`,
    label,
    status: filled ? 'PASS' : 'FAIL',
    detail: filled ? `Recorded: ${String(values[key])}.` : why,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// 1BUY Sourcing — the terms sheet
// ─────────────────────────────────────────────────────────────────────────────

export const SOURCING_TERMS: DeliverableDef = {
  kind: 'SOURCING_TERMS',
  team: 'ONE_BUY_SOURCING',
  label: 'Supplier terms sheet',
  plainLabel: 'What we agreed with the supplier',
  purpose:
    'The record of exactly what was agreed with the supplier before they invoiced — the document the proforma invoice is later reconciled against.',
  readyFromStage: 'SUPPLIER_PO_ISSUED',
  dueByStage: 'TERMS_LOCKED',
  sections: [
    { key: 'parties', label: 'Parties and reference' },
    { key: 'commercial', label: 'Commercial terms', note: 'Everything frozen at B3. A supplier invoice disagreeing with any of these is a variance.' },
    { key: 'quality', label: 'Quality and testing' },
    { key: 'signoff', label: 'Sign-off' },
  ],
  fields: [
    f('supplier', 'Supplier', 'text', 'parties', 'Who we are buying from.', { required: true }),
    f('supplierPo', 'Our purchase order', 'text', 'parties', 'The PO these terms attach to.', { required: true }),
    f('customerRef', 'Against customer order', 'text', 'parties', 'The customer commitment this buy exists to serve.'),
    f('buyValue', 'Agreed order value', 'money', 'commercial', 'The price agreed, in the supplier’s currency converted at the locked rate.'),
    f('currency', 'Currency', 'text', 'commercial', 'What the supplier invoices in.'),
    f('fxRate', 'Exchange rate locked at', 'number', 'commercial', 'The rate the margin was calculated on. Locking it is what stops margin drifting with the market.'),
    f('incoterms', 'Delivery term', 'text', 'commercial', 'Which Incoterm, and therefore who pays for and carries the risk on each leg.', { required: true }),
    f('paymentMethod', 'Payment method', 'text', 'commercial', 'Advance, escrow or credit.'),
    f('leadTimeDays', 'Lead time (days)', 'number', 'commercial', 'Days from order to dispatch, as promised.'),
    f('testingRequired', 'Testing required', 'boolean', 'quality', 'Whether an independent laboratory must pass the goods before we release final payment.'),
    f('testScope', 'Test scope', 'text', 'quality', 'Lot sample or full batch.'),
    f('qualityStandard', 'Quality standard applied', 'text', 'quality', 'The specification the goods are accepted against.'),
    f('notes', 'Notes and exceptions', 'longText', 'signoff', 'Anything negotiated that is not covered by a field above.'),
    f('agreedBy', 'Agreed by', 'text', 'signoff', 'Who at 1BUY agreed these terms.', { required: true }),
  ],
  compute: (i): DeliverableValues => ({
    supplier: i.supplierName,
    supplierPo: i.supplierPoNumber,
    customerRef: i.customerPoNumber,
    buyValue: i.buyValue,
    currency: i.buyCurrency,
    fxRate: i.fxRate,
    incoterms: i.incoterms,
    paymentMethod: i.paymentMethod,
    leadTimeDays: 0,
    testingRequired: false,
    testScope: '',
    qualityStandard: '',
    notes: '',
    agreedBy: '',
  }),
  check: (v, i) => [
    required(v, 'incoterms', 'Delivery term is stated', 'Without an Incoterm nobody knows who pays for freight or carries the risk. It cannot be left blank.'),
    required(v, 'agreedBy', 'Agreed by is filled in', 'Terms nobody is named on cannot be enforced.'),
    {
      key: 'fx',
      label: 'Exchange rate is locked',
      status: Number(v.fxRate ?? 0) > 0 ? 'PASS' : 'FAIL',
      detail:
        Number(v.fxRate ?? 0) > 0
          ? `Locked at ${v.fxRate}.`
          : 'A rate of zero means the margin on this order cannot be calculated.',
    },
    {
      key: 'lead',
      label: 'Lead time is committed',
      status: Number(v.leadTimeDays ?? 0) > 0 ? 'PASS' : 'WARN',
      detail:
        Number(v.leadTimeDays ?? 0) > 0
          ? `${v.leadTimeDays} days to dispatch.`
          : 'No lead time agreed. The customer delivery date cannot be defended without one.',
    },
    {
      key: 'termMatch',
      label: 'Delivery term matches the order',
      status: String(v.incoterms ?? '') === i.incoterms ? 'PASS' : 'WARN',
      detail:
        String(v.incoterms ?? '') === i.incoterms
          ? `Both say ${i.incoterms}.`
          : `This sheet says ${v.incoterms} but the order is on ${i.incoterms}. One of them is wrong.`,
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// 1BUY Finance — the escrow release instruction
// ─────────────────────────────────────────────────────────────────────────────

export const ESCROW_RELEASE: DeliverableDef = {
  kind: 'ESCROW_RELEASE',
  team: 'ONE_BUY_FINANCE',
  label: 'Escrow release instruction',
  plainLabel: 'Instruction to pay the supplier',
  purpose:
    'The written instruction telling the escrow provider to release held funds to the supplier, and the evidence relied on to justify it.',
  readyFromStage: 'INSPECTION_PASSED',
  dueByStage: 'SUPPLIER_PAID_IN_FULL',
  sections: [
    { key: 'instruction', label: 'Instruction' },
    { key: 'basis', label: 'What this release is based on', note: 'Money leaving escrow needs a stated reason. These are the facts being relied on.' },
    { key: 'signoff', label: 'Authorisation' },
  ],
  fields: [
    f('beneficiary', 'Pay to', 'text', 'instruction', 'The supplier being paid.', { required: true }),
    f('amount', 'Amount to release', 'money', 'instruction', 'How much leaves escrow under this instruction.', { required: true }),
    f('heldBefore', 'Held in escrow before release', 'money', 'instruction', 'The balance this is being taken from.'),
    f('remainingAfter', 'Remaining after release', 'money', 'instruction', 'What stays held. Zero means this closes the escrow.', { derived: true }),
    f('againstOrder', 'Against order', 'text', 'instruction', 'The order the funds are held for.'),
    f('inspectionVerdict', 'Inspection verdict', 'text', 'basis', 'Whether the goods passed. A release against a failed inspection needs an explicit reason.'),
    f('inspectedOn', 'Inspected on', 'date', 'basis', 'When the goods were checked.'),
    f('goodsReceived', 'Goods received at 1BUY', 'boolean', 'basis', 'Whether the goods are physically with us.'),
    f('supplierInvoiceRef', 'Supplier invoice reference', 'text', 'basis', 'The invoice this payment settles.'),
    f('reason', 'Reason for release', 'longText', 'signoff', 'Why the money should move now, in words a reviewer can check.', { required: true }),
    f('authorisedBy', 'Authorised by', 'text', 'signoff', 'Finance approver. A final release needs two.', { required: true }),
  ],
  compute: (i): DeliverableValues => ({
    beneficiary: i.supplierName,
    amount: Math.max(0, i.escrowHeld - i.escrowReleased),
    heldBefore: i.escrowHeld,
    remainingAfter: 0,
    againstOrder: `${i.alias} · ${i.supplierPoNumber}`,
    inspectionVerdict: i.inspection?.verdict ?? '',
    inspectedOn: i.inspection?.inspectedAt ?? '',
    goodsReceived: i.completedStageIds.includes('GOODS_RECEIVED_INBOUND_AT_1BUY'),
    supplierInvoiceRef: i.supplierPiNumber ?? '',
    reason: '',
    authorisedBy: '',
  }),
  check: (v, i) => [
    required(v, 'reason', 'A reason is stated', 'Money leaving escrow without a written reason cannot be defended later.'),
    required(v, 'authorisedBy', 'An approver is named', 'An unauthorised release instruction is not an instruction.'),
    {
      key: 'notOverdrawn',
      label: 'Release does not exceed what is held',
      status: Number(v.amount ?? 0) <= i.escrowHeld - i.escrowReleased ? 'PASS' : 'FAIL',
      detail:
        Number(v.amount ?? 0) <= i.escrowHeld - i.escrowReleased
          ? 'The amount is within the held balance.'
          : 'This instruction releases more than escrow is holding. It would be rejected, and it should be.',
    },
    {
      key: 'inspectionPassed',
      label: 'Goods passed inspection',
      status: i.inspection?.verdict === 'PASSED' ? 'PASS' : 'WARN',
      detail:
        i.inspection?.verdict === 'PASSED'
          ? 'Inspection passed, so the goods are what we agreed to pay for.'
          : 'No passing inspection on record. Releasing now pays for goods nobody has confirmed are correct — say why if that is intended.',
    },
    {
      key: 'goodsHere',
      label: 'Goods are physically received',
      status: v.goodsReceived ? 'PASS' : 'WARN',
      detail: v.goodsReceived
        ? 'Goods are recorded as received inbound.'
        : 'Goods have not been recorded as received. Paying in full before they arrive removes our remaining leverage.',
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// 1BUY Logistics inbound — the import & clearance file
// ─────────────────────────────────────────────────────────────────────────────

export const IMPORT_FILE: DeliverableDef = {
  kind: 'IMPORT_FILE',
  team: 'ONE_BUY_INBOUND',
  label: 'Import & clearance file',
  plainLabel: 'The import paperwork summary',
  purpose:
    'The single sheet summarising how the consignment moved and how it cleared customs — the cover for the bill of entry and everything filed with it.',
  readyFromStage: 'FULL_SHIPMENT_DISPATCHED_BY_SUPPLIER',
  dueByStage: 'GOODS_RECEIVED_INBOUND_AT_1BUY',
  sections: [
    { key: 'consignment', label: 'Consignment' },
    { key: 'customs', label: 'Customs entry' },
    { key: 'costs', label: 'Costs incurred', note: 'What the inbound leg cost. These land in the P&L, so they have to be right.' },
    { key: 'signoff', label: 'Sign-off' },
  ],
  fields: [
    f('carrier', 'Carrier', 'text', 'consignment', 'Who moved the goods.', { required: true }),
    f('trackingRef', 'Airway bill / tracking reference', 'text', 'consignment', 'The reference the carrier tracks against.', { required: true }),
    f('incoterms', 'Delivery term', 'text', 'consignment', 'Decides which of these costs were ours to carry at all.'),
    f('originCountry', 'Country of origin', 'text', 'consignment', 'Where the goods shipped from. Drives duty rates and origin certification.'),
    f('packageCount', 'Number of packages', 'number', 'consignment', 'As handed over. Must match what arrives.'),
    f('grossWeightKg', 'Gross weight (kg)', 'number', 'consignment', 'Total weight including packing.'),
    f('dispatchedOn', 'Dispatched on', 'date', 'consignment', 'When it left the supplier.'),
    f('beNumber', 'Bill of entry number', 'text', 'customs', 'The customs entry number. Without it the consignment cannot be cleared.'),
    f('beDate', 'Bill of entry date', 'date', 'customs', 'When the entry was filed.'),
    f('portCode', 'Port of clearance', 'text', 'customs', 'Where it was assessed.'),
    f('assessedValue', 'Assessed value', 'money', 'customs', 'The value customs assessed duty on — not always our invoice value.'),
    f('dutyPaid', 'Duty paid (non-creditable)', 'money', 'costs', 'BCD, surcharge and cess. Never refunded, so a real cost.'),
    f('igstPaid', 'IGST paid (recoverable)', 'money', 'costs', 'Claimed back as Input Tax Credit. Recorded here but NOT a cost of the order.'),
    f('freightCost', 'Freight paid by us', 'money', 'costs', 'Nil where the term put carriage on the supplier.'),
    f('clearanceCost', 'Clearance and agent fees', 'money', 'costs', 'What the customs agent charged.'),
    f('discrepancies', 'Discrepancies on arrival', 'longText', 'signoff', 'Short shipment, damage, wrong count — anything that differs from the paperwork.'),
    f('filedBy', 'Filed by', 'text', 'signoff', 'Who put the file together.', { required: true }),
  ],
  compute: (i): DeliverableValues => {
    const comp = (k: string) => i.costComponents.find((c) => c.key === k)?.amount ?? 0;
    return {
      carrier: i.shipment?.carrier ?? '',
      trackingRef: i.shipment?.trackingRef ?? '',
      incoterms: i.incoterms,
      originCountry: i.supplierCountry ?? '',
      packageCount: i.shipment?.packageCount ?? 0,
      grossWeightKg: i.shipment?.grossWeightKg ?? 0,
      dispatchedOn: i.shipment?.dispatchedAt ?? '',
      beNumber: i.customs?.beNumber ?? '',
      beDate: i.customs?.beDate ?? '',
      portCode: i.customs?.portCode ?? '',
      assessedValue: i.customs?.assessedValue ?? 0,
      dutyPaid: comp('dutyBcd') + comp('dutySws') + comp('dutyCess'),
      igstPaid: comp('dutyIgst'),
      freightCost: comp('freightCost'),
      clearanceCost: comp('clearanceCost'),
      discrepancies: '',
      filedBy: '',
    };
  },
  check: (v, i) => [
    required(v, 'carrier', 'Carrier is named', 'A consignment with no named carrier cannot be traced or claimed against.'),
    required(v, 'trackingRef', 'Tracking reference is recorded', 'Without it nobody can prove where the goods are.'),
    required(v, 'filedBy', 'Filed by is completed', 'Somebody has to be answerable for this file.'),
    {
      key: 'beFiled',
      label: 'Bill of entry is recorded',
      status: String(v.beNumber ?? '').trim() ? 'PASS' : i.completedStageIds.includes('CUSTOMS_CLEARED') ? 'FAIL' : 'WARN',
      detail: String(v.beNumber ?? '').trim()
        ? `Entry ${v.beNumber}.`
        : i.completedStageIds.includes('CUSTOMS_CLEARED')
          ? 'The order is recorded as customs cleared but there is no bill of entry number. One of those two facts is wrong.'
          : 'Not filed yet. This file cannot be approved until the entry exists.',
    },
    {
      key: 'igstSeparate',
      label: 'Recoverable IGST is kept out of duty',
      status: Number(v.igstPaid ?? 0) === 0 || Number(v.dutyPaid ?? 0) !== Number(v.igstPaid ?? 0) ? 'PASS' : 'WARN',
      detail:
        'IGST comes back as Input Tax Credit and must stay in its own line — folding it into duty overstates the cost of the order and understates margin.',
    },
    {
      key: 'weight',
      label: 'Weight and package count are present',
      status: Number(v.grossWeightKg ?? 0) > 0 && Number(v.packageCount ?? 0) > 0 ? 'PASS' : 'WARN',
      detail:
        Number(v.grossWeightKg ?? 0) > 0 && Number(v.packageCount ?? 0) > 0
          ? `${v.packageCount} packages, ${v.grossWeightKg} kg.`
          : 'Missing weight or package count. Both are needed to check nothing was lost in transit.',
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// 1BUY Inspection — the inspection report and the goods receipt note
// ─────────────────────────────────────────────────────────────────────────────

export const INSPECTION_REPORT: DeliverableDef = {
  kind: 'INSPECTION_REPORT',
  team: 'ONE_BUY_INSPECTION',
  label: 'Inbound inspection report',
  plainLabel: 'What we found when we checked the goods',
  purpose:
    'The record of what was checked, what was found, and whether the goods were accepted — the document the final payment to the supplier rests on.',
  readyFromStage: 'GOODS_RECEIVED_INBOUND_AT_1BUY',
  dueByStage: 'INSPECTION_PASSED',
  sections: [
    { key: 'scope', label: 'What was inspected' },
    { key: 'findings', label: 'Findings' },
    { key: 'verdict', label: 'Verdict' },
  ],
  fields: [
    f('againstOrder', 'Against order', 'text', 'scope', 'The order these goods arrived on.'),
    f('receivedQty', 'Quantity received', 'number', 'scope', 'Total pieces received across all lines.'),
    f('sampleSize', 'Sample size inspected', 'number', 'scope', 'How many pieces were actually checked.', { required: true }),
    f('samplingBasis', 'Sampling basis', 'text', 'scope', 'The standard or rule the sample size came from, so the coverage can be judged.'),
    f('inspectedOn', 'Inspected on', 'date', 'scope', 'When the check was done.', { required: true }),
    f('inspector', 'Inspected by', 'text', 'scope', 'Who did it.', { required: true }),
    f('defectsFound', 'Defects found', 'number', 'findings', 'How many inspected pieces failed.'),
    f('defectRatePct', 'Defect rate %', 'number', 'findings', 'Defects as a share of the sample.', { derived: true }),
    f('markingsChecked', 'Part markings verified', 'boolean', 'findings', 'Whether markings match the ordered part. This is the counterfeit check.'),
    f('packagingIntact', 'Packaging intact', 'boolean', 'findings', 'Whether anything arrived damaged or opened.'),
    f('observations', 'Observations', 'longText', 'findings', 'What was seen, in enough detail to justify the verdict.'),
    f('verdict', 'Verdict', 'text', 'verdict', 'PASSED, FAILED or CONDITIONAL.', { required: true }),
    f('acceptedBy', 'Accepted by', 'text', 'verdict', 'Who signs off the verdict.', { required: true }),
  ],
  compute: (i): DeliverableValues => ({
    againstOrder: `${i.alias} · ${i.supplierPoNumber}`,
    receivedQty: i.totalQty,
    sampleSize: i.inspection?.sampleSize ?? 0,
    samplingBasis: '',
    inspectedOn: i.inspection?.inspectedAt ?? '',
    inspector: '',
    defectsFound: i.inspection?.defectsFound ?? 0,
    defectRatePct: 0,
    markingsChecked: false,
    packagingIntact: false,
    observations: '',
    verdict: i.inspection?.verdict ?? '',
    acceptedBy: '',
  }),
  check: (v) => {
    const sample = Number(v.sampleSize ?? 0);
    const defects = Number(v.defectsFound ?? 0);
    const rate = sample > 0 ? (defects / sample) * 100 : 0;
    return [
      required(v, 'verdict', 'A verdict is recorded', 'An inspection with no verdict decides nothing and cannot release payment.'),
      required(v, 'inspector', 'Inspector is named', 'An unsigned inspection is not evidence.'),
      required(v, 'acceptedBy', 'Accepted by is completed', 'Somebody has to own the decision.'),
      {
        key: 'sampled',
        label: 'A sample was actually inspected',
        status: sample > 0 ? 'PASS' : 'FAIL',
        detail: sample > 0 ? `${sample} pieces checked.` : 'A sample size of zero means nothing was inspected.',
      },
      {
        key: 'markings',
        label: 'Part markings were verified',
        status: v.markingsChecked ? 'PASS' : 'WARN',
        detail: v.markingsChecked
          ? 'Markings checked against the ordered part.'
          : 'Markings not verified. This is the check that catches counterfeit or substituted parts — skipping it is the single biggest risk on an electronics order.',
      },
      {
        key: 'defectRate',
        label: 'Defect rate is acceptable',
        status: rate === 0 ? 'PASS' : rate <= 2 ? 'WARN' : 'FAIL',
        detail:
          rate === 0
            ? 'No defects in the sample.'
            : `${rate.toFixed(1)}% of the sample failed. ${rate <= 2 ? 'Low, but say how it was dispositioned.' : 'Too high to pass without a non-conformance report and a decision on the lot.'}`,
      },
      {
        key: 'verdictMatchesFindings',
        label: 'Verdict is consistent with the findings',
        status: String(v.verdict).toUpperCase() === 'PASSED' && rate > 2 ? 'FAIL' : 'PASS',
        detail:
          String(v.verdict).toUpperCase() === 'PASSED' && rate > 2
            ? 'The report passes a lot with a defect rate above the threshold. Either the verdict or the findings needs to change.'
            : 'The verdict follows from what was found.',
      },
    ];
  },
};

export const GRN_NOTE: DeliverableDef = {
  kind: 'GRN_NOTE',
  team: 'ONE_BUY_INSPECTION',
  label: 'Goods receipt note',
  plainLabel: 'Confirmation the goods arrived',
  purpose:
    'The formal acknowledgement of what physically arrived, in what condition and where it was put away.',
  readyFromStage: 'GOODS_RECEIVED_INBOUND_AT_1BUY',
  dueByStage: 'READY_FOR_OUTBOUND',
  sections: [
    { key: 'receipt', label: 'Receipt' },
    { key: 'condition', label: 'Condition and storage' },
    { key: 'signoff', label: 'Sign-off' },
  ],
  fields: [
    f('againstOrder', 'Against order', 'text', 'receipt', 'The order these goods belong to.'),
    f('supplier', 'Received from', 'text', 'receipt', 'Who sent them.'),
    f('receivedOn', 'Received on', 'date', 'receipt', 'Date the goods physically arrived.', { required: true }),
    f('expectedQty', 'Quantity expected', 'number', 'receipt', 'What the paperwork said would arrive.'),
    f('receivedQty', 'Quantity received', 'number', 'receipt', 'What actually arrived.', { required: true }),
    f('shortfall', 'Shortfall', 'number', 'receipt', 'Expected less received. Anything other than zero needs an explanation.', { derived: true }),
    f('packagesReceived', 'Packages received', 'number', 'condition', 'Cartons or pallets counted in.'),
    f('conditionOnArrival', 'Condition on arrival', 'text', 'condition', 'Sound, damaged or partially damaged.', { required: true }),
    f('storageLocation', 'Put away at', 'text', 'condition', 'Where in the warehouse it went. Without this nobody can find it again.', { required: true }),
    f('remarks', 'Remarks', 'longText', 'signoff', 'Anything the next person handling this stock needs to know.'),
    f('receivedBy', 'Received by', 'text', 'signoff', 'Who booked it in.', { required: true }),
  ],
  compute: (i): DeliverableValues => ({
    againstOrder: `${i.alias} · ${i.supplierPoNumber}`,
    supplier: i.supplierName,
    receivedOn: i.completedStageIds.includes('GOODS_RECEIVED_INBOUND_AT_1BUY') ? i.today : '',
    expectedQty: i.totalQty,
    receivedQty: i.totalQty,
    shortfall: 0,
    packagesReceived: i.shipment?.packageCount ?? 0,
    conditionOnArrival: '',
    storageLocation: i.warehouseLocation ?? '',
    remarks: '',
    receivedBy: '',
  }),
  check: (v) => {
    const shortfall = Number(v.expectedQty ?? 0) - Number(v.receivedQty ?? 0);
    return [
      required(v, 'storageLocation', 'Storage location is recorded', 'Stock with no location is stock nobody can pick. This is the field that most often gets skipped and most often causes a scramble.'),
      required(v, 'conditionOnArrival', 'Condition is recorded', 'If damage is not recorded on receipt, the carrier claim window closes before anyone notices.'),
      required(v, 'receivedBy', 'Received by is completed', 'A receipt note nobody signed proves nothing.'),
      {
        key: 'quantityMatches',
        label: 'Quantity received matches what was expected',
        status: shortfall === 0 ? 'PASS' : 'WARN',
        detail:
          shortfall === 0
            ? 'Full quantity received.'
            : `${shortfall} pieces short of the expected quantity. Raise it with the supplier before approving — a shortfall accepted silently becomes a shortfall we paid for.`,
      },
    ];
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 1BUY Logistics outbound — the packing list and the delivery note
// ─────────────────────────────────────────────────────────────────────────────

export const PACKING_LIST: DeliverableDef = {
  kind: 'PACKING_LIST',
  team: 'ONE_BUY_OUTBOUND',
  label: 'Outbound packing list',
  plainLabel: 'What is in the boxes going out',
  purpose:
    'The itemised list of what is being shipped to the customer, in which packages — the document the carrier and the customer both check against.',
  readyFromStage: 'READY_FOR_OUTBOUND',
  dueByStage: 'OUT_FOR_DELIVERY',
  sections: [
    { key: 'consignee', label: 'Consignee' },
    { key: 'contents', label: 'Contents' },
    { key: 'packing', label: 'Packing' },
    { key: 'signoff', label: 'Sign-off' },
  ],
  fields: [
    f('consignee', 'Deliver to', 'text', 'consignee', 'The customer receiving the goods.', { required: true }),
    f('deliveryAddress', 'Delivery address', 'longText', 'consignee', 'Where it is actually going.', { required: true }),
    f('customerRef', 'Customer order reference', 'text', 'consignee', 'Their purchase order, so they can match it on receipt.'),
    f('soNumber', 'Our sales order', 'text', 'consignee', 'The sales order this dispatch fulfils.'),
    f('incoterms', 'Delivery term', 'text', 'consignee', 'The term we SOLD on — it decides who pays the outbound leg and where risk passes.'),
    f('lineCount', 'Number of line items', 'number', 'contents', 'How many distinct parts are in this consignment.'),
    f('totalQty', 'Total quantity', 'number', 'contents', 'Total pieces across all lines.'),
    f('contentsSummary', 'Contents', 'longText', 'contents', 'Part numbers and quantities, as they appear in the boxes.'),
    f('packageCount', 'Number of packages', 'number', 'packing', 'Cartons or pallets going out.', { required: true }),
    f('grossWeightKg', 'Gross weight (kg)', 'number', 'packing', 'Total weight including packing. The carrier bills on this.', { required: true }),
    f('dimensions', 'Package dimensions', 'text', 'packing', 'Needed for volumetric weight and vehicle planning.'),
    f('specialHandling', 'Special handling', 'text', 'packing', 'ESD, humidity, fragile — anything the handler must know.'),
    f('packedBy', 'Packed by', 'text', 'signoff', 'Who packed and checked it.', { required: true }),
  ],
  compute: (i): DeliverableValues => ({
    consignee: i.customerName,
    deliveryAddress: i.customerAddress,
    customerRef: i.customerPoNumber,
    soNumber: i.soNumber ?? '',
    incoterms: i.sellIncoterms ?? '',
    lineCount: i.lineCount,
    totalQty: i.totalQty,
    contentsSummary: i.lines.map((l) => `${l.mpn} — ${l.qty} ${l.uom}`).join('\n'),
    packageCount: 0,
    grossWeightKg: 0,
    dimensions: '',
    specialHandling: '',
    packedBy: '',
  }),
  check: (v, i) => [
    required(v, 'deliveryAddress', 'Delivery address is present', 'A consignment with no address does not leave the building.'),
    required(v, 'packedBy', 'Packed by is completed', 'Somebody has to be answerable for what is in the boxes.'),
    {
      key: 'packages',
      label: 'Package count and weight are recorded',
      status: Number(v.packageCount ?? 0) > 0 && Number(v.grossWeightKg ?? 0) > 0 ? 'PASS' : 'FAIL',
      detail:
        Number(v.packageCount ?? 0) > 0 && Number(v.grossWeightKg ?? 0) > 0
          ? `${v.packageCount} packages, ${v.grossWeightKg} kg.`
          : 'The carrier bills on weight and checks the package count on collection. A packing list without both will be refused.',
    },
    {
      key: 'contents',
      label: 'Contents are itemised',
      status: String(v.contentsSummary ?? '').trim() ? 'PASS' : 'FAIL',
      detail: String(v.contentsSummary ?? '').trim()
        ? 'Line items are listed.'
        : 'An empty contents list makes this document useless to the customer receiving it.',
    },
    {
      key: 'sellTerm',
      label: 'Delivery term is the one we sold on',
      status: !i.sellIncoterms || String(v.incoterms ?? '') === i.sellIncoterms ? 'PASS' : 'WARN',
      detail:
        !i.sellIncoterms || String(v.incoterms ?? '') === i.sellIncoterms
          ? 'Matches the term on the customer order.'
          : `This says ${v.incoterms} but we sold on ${i.sellIncoterms}. Using the buy term here is how the wrong party ends up paying for the outbound leg.`,
    },
  ],
};

export const DELIVERY_NOTE: DeliverableDef = {
  kind: 'DELIVERY_NOTE',
  team: 'ONE_BUY_OUTBOUND',
  label: 'Delivery note & proof of delivery',
  plainLabel: 'Proof the customer got it',
  purpose:
    'The note that travels with the goods and comes back signed — the evidence that delivery happened, which the customer invoice depends on.',
  readyFromStage: 'OUT_FOR_DELIVERY',
  dueByStage: 'POD_ISSUED_TO_CUSTOMER',
  sections: [
    { key: 'dispatch', label: 'Dispatch' },
    { key: 'delivery', label: 'Delivery' },
    { key: 'signoff', label: 'Sign-off' },
  ],
  fields: [
    f('consignee', 'Delivered to', 'text', 'dispatch', 'The customer.', { required: true }),
    f('deliveryAddress', 'Delivery address', 'longText', 'dispatch', 'Where it was sent.'),
    f('soNumber', 'Sales order', 'text', 'dispatch', 'The order being fulfilled.'),
    f('carrier', 'Carrier', 'text', 'dispatch', 'Who carried it.', { required: true }),
    f('trackingRef', 'Tracking reference', 'text', 'dispatch', 'The consignment note number.', { required: true }),
    f('dispatchedOn', 'Dispatched on', 'date', 'dispatch', 'When it left us.'),
    f('packageCount', 'Packages sent', 'number', 'dispatch', 'How many were handed to the carrier.'),
    f('deliveredOn', 'Delivered on', 'date', 'delivery', 'When the customer received it.', { required: true }),
    f('receivedByName', 'Received by (name)', 'text', 'delivery', 'Who signed for it at the customer.', { required: true }),
    f('conditionOnDelivery', 'Condition on delivery', 'text', 'delivery', 'Whether it arrived sound. Damage noted here is what supports a claim.'),
    f('shortOrDamaged', 'Anything short or damaged', 'longText', 'delivery', 'Details of any discrepancy the customer raised on receipt.'),
    f('issuedBy', 'Issued by', 'text', 'signoff', 'Who at 1BUY issued this note.', { required: true }),
  ],
  compute: (i): DeliverableValues => ({
    consignee: i.customerName,
    deliveryAddress: i.customerAddress,
    soNumber: i.soNumber ?? '',
    carrier: i.shipment?.carrier ?? '',
    trackingRef: i.shipment?.trackingRef ?? '',
    dispatchedOn: i.shipment?.dispatchedAt ?? '',
    packageCount: i.shipment?.packageCount ?? 0,
    deliveredOn: i.completedStageIds.includes('DELIVERED') ? i.today : '',
    receivedByName: '',
    conditionOnDelivery: '',
    shortOrDamaged: '',
    issuedBy: '',
  }),
  check: (v, i) => [
    required(v, 'trackingRef', 'Tracking reference is recorded', 'Without it there is no way to trace the consignment or support a claim.'),
    required(v, 'receivedByName', 'A named person signed for it', 'Proof of delivery with nobody named on it will not survive a dispute — and the customer invoice rests on this document.'),
    required(v, 'issuedBy', 'Issued by is completed', 'Somebody has to own the note.'),
    {
      key: 'deliveredDate',
      label: 'Delivery date is recorded',
      status: String(v.deliveredOn ?? '').trim() ? 'PASS' : 'FAIL',
      detail: String(v.deliveredOn ?? '').trim()
        ? `Delivered ${v.deliveredOn}.`
        : 'A proof of delivery with no delivery date proves nothing.',
    },
    {
      key: 'actuallyDelivered',
      label: 'The order is recorded as delivered',
      status: i.completedStageIds.includes('DELIVERED') ? 'PASS' : 'WARN',
      detail: i.completedStageIds.includes('DELIVERED')
        ? 'The ladder agrees the goods were delivered.'
        : 'The order has not reached the delivered step. Issuing proof of delivery before delivery is recorded means one of the two is wrong.',
    },
  ],
};
