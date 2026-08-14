/**
 * THE CHECKLIST FOR A STAGE — what actually has to be done to leave it.
 *
 * The ladder says where an order is. The evidence schema says what must be on
 * file. Neither, on its own, tells the person holding the order what to DO next
 * beyond a single sentence. This composes both into an ordered checklist, and —
 * critically — one whose ticks are DERIVED rather than stored:
 *
 *   · a document task is done when that document is attached
 *   · a capture task is done when its required fields are filled
 *   · an action task is done when the thing it names has actually happened,
 *     which is usually a field on the evidence record
 *
 * Nothing here is a separate to-do list a person maintains by hand. A checklist
 * you have to tick yourself drifts from reality within a week, and then it is
 * worse than nothing because it looks authoritative.
 *
 * ORDERING — DOCUMENTS FIRST, ALWAYS
 *
 * Uploads lead every stage. That is not a visual preference: the paperwork is the
 * thing that arrives from somebody else, so it is the item most likely to be
 * missing, the one with a lead time, and the one whose absence blocks the gate.
 * Chasing it first is the difference between finding out now and finding out at
 * the moment you try to advance.
 */

import { STAGE_EVIDENCE, evidenceFor, type EvidenceDoc, type EvidenceField } from './stage-evidence';
import { getStage, stageOwner, type StageContext, type StageDef } from './stages';
import type { Stakeholder } from './enums';

export type SubTaskKind =
  /** Attach a document. Always sorted first. */
  | 'DOCUMENT'
  /** Do something in the world — open an account, book a courier, place an order. */
  | 'ACTION'
  /** Record figures on the evidence form. */
  | 'CAPTURE';

export interface SubTask {
  id: string;
  kind: SubTaskKind;
  label: string;
  /** What it means and why it matters, for someone who does not do this daily. */
  detail: string;
  /** Who does it. Defaults to the stage's owner. */
  owner: Stakeholder;
  /** Blocks the gate. Derived from the evidence schema's own `required`. */
  required: boolean;
  /**
   * The standard this step is performed to, where one governs. Shown as a chip —
   * an operator sending parts to a laboratory needs the standard on the
   * instruction, not in a policy document nobody opens.
   */
  standard?: string;
}

/** A sub-task with its live state against one order's evidence. */
export interface SubTaskState extends SubTask {
  done: boolean;
  /** For CAPTURE rows: which fields are still empty. */
  outstanding?: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Standards
// ═══════════════════════════════════════════════════════════════════════════

/**
 * TESTING STANDARDS — what a lab instruction has to cite.
 *
 * Worth being precise about, because the numbers are not interchangeable and a
 * wrong one on a test instruction produces a report that proves nothing:
 *
 *   AS6171   SAE. THE authentication standard for suspect/counterfeit electrical,
 *            electronic and electromechanical parts. Risk-based; its slash sheets
 *            define each method (/3 XRF, /4 DPA, /5 X-ray, /6 acoustic microscopy,
 *            /7 electrical, /8 Raman, /9 FTIR). Since AS6081 Rev A (2023) removed
 *            its own criteria and now points here, this is the one that governs.
 *   AS6081   SAE. The distributor-facing standard — what a broker buying on the
 *            open market must do. Cites AS6171 for the test criteria.
 *   AS5553   SAE. The OEM-facing counterpart: avoidance, detection, mitigation
 *            and disposition inside a manufacturer's own supply chain.
 *   IDEA-STD-1010  Independent Distributors of Electronics Association. The
 *            visual-inspection protocol — remarking, resurfacing, repackaging.
 *
 * ASTM's place in this is the ANALYTICAL METHOD underneath a result, not the
 * authentication decision on top of it. A lab reporting elemental composition or
 * plating thickness cites ASTM for how the measurement was made; AS6171 says what
 * the measurement has to show. Both belong on the instruction, which is why both
 * appear below rather than one standing in for the other.
 */
export const TESTING_STANDARDS = {
  /** The authentication standard the verdict is given against. */
  authentication: 'SAE AS6171',
  /** Distributor-level obligation, for open-market purchases. */
  distributor: 'SAE AS6081 Rev A',
  /** Visual inspection protocol. */
  visual: 'IDEA-STD-1010',
  /** Elemental / material composition by SEM-EDS. */
  astmEds: 'ASTM E1508',
  /** Coating and lead-finish thickness by X-ray spectrometry. */
  astmXrf: 'ASTM B568',
  /** Radiographic (X-ray) examination practice. */
  astmXray: 'ASTM E1742',
  /** Commercial packaging, for the return leg. */
  astmPackaging: 'ASTM D3951',
  /** Moisture-sensitive device handling, for anything MSL-rated. */
  moisture: 'IPC/JEDEC J-STD-033',
  /** Solderability. */
  solderability: 'IPC/JEDEC J-STD-002',
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// The declared ACTION steps, per stage
// ═══════════════════════════════════════════════════════════════════════════

interface ActionSpec {
  id: string;
  label: string;
  detail: string;
  owner?: Stakeholder;
  required?: boolean;
  standard?: string;
  /**
   * The evidence field whose truthiness marks this done. Omitted where nothing on
   * the form corresponds, in which case the row is informational until the stage
   * itself is passed.
   */
  doneWhen?: string;
}

/**
 * Actions that are not "fill in a field" and not "attach a paper" — the physical
 * and commercial steps between them.
 */
const ACTIONS: Record<string, ActionSpec[]> = {
  // ── A · Demand capture ──────────────────────────────────────────────────
  CUSTOMER_PO_RECEIVED: [
    {
      id: 'read-terms',
      label: 'Read the customer’s terms and conditions',
      detail:
        'Look for penalty clauses, the delivery window, inspection rights and who bears freight. Cheaper to find now than after we have committed to a supplier.',
      doneWhen: 'termsRead',
      required: true,
    },
    {
      id: 'check-credit',
      label: 'Check the order against their credit limit',
      detail: 'A customer already at their limit is a decision for Finance, not for procurement.',
    },
  ],
  PI_ISSUED_TO_CUSTOMER: [
    {
      id: 'price-check',
      label: 'Check the quoted margin against the floor',
      detail: 'Anything under the margin floor needs sign-off before it leaves the building.',
    },
    { id: 'send-pi', label: 'Send the proforma to the customer', detail: 'Email or their portal, with the validity date stated.', doneWhen: 'sentOn' },
  ],
  PI_ACCEPTED_BY_CUSTOMER: [
    {
      id: 'capture-acceptance',
      label: 'Get the acceptance in writing',
      detail: 'A verbal yes is not an order. Email confirmation, a signed copy, or their PO referencing our proforma.',
      owner: 'CUSTOMER',
      required: true,
      doneWhen: 'acceptanceRef',
    },
  ],

  // ── B · Sourcing ────────────────────────────────────────────────────────
  SUPPLIER_SELECTED_FROM_AVL: [
    {
      id: 'avl-check',
      label: 'Confirm the supplier is on the Approved Vendor List',
      detail: 'Buying off-AVL is what puts counterfeit parts into the chain. If they are not on it, they get approved first or we source elsewhere.',
      required: true,
    },
    { id: 'compare-quotes', label: 'Compare at least two quotes where the value warrants it', detail: 'Price, lead time, and whether they hold genuine stock rather than a promise of it.' },
  ],
  SUPPLIER_PO_ISSUED: [
    { id: 'issue-po', label: 'Issue our purchase order to the supplier', detail: 'With part numbers, quantities, price, Incoterm and the required delivery date on it.', required: true, doneWhen: 'issuedOn' },
    { id: 'state-testing', label: 'State the testing requirement on the order', detail: 'If the lot is to be independently tested, the supplier must know before they ship — it changes where the parts go first.' },
  ],
  TERMS_LOCKED: [
    { id: 'agree-terms', label: 'Agree the final commercial terms', detail: 'Price, Incoterm, payment method and delivery date, all fixed. After this they are quoted, not negotiated.', required: true },
    { id: 'confirm-incoterm', label: 'Confirm who pays freight, insurance and duty', detail: 'The Incoterm decides it. Getting this wrong shows up as an unbudgeted cost at customs.' },
  ],
  SUPPLIER_PI_RECEIVED: [
    {
      id: 'reconcile-pi',
      label: 'Check their proforma line by line against our order',
      detail: 'Part number, quantity, unit price, delivery term. This is where a wrong price gets caught, before any money moves.',
      required: true,
      doneWhen: 'threeWayChecked',
    },
    { id: 'bank-details', label: 'Verify the bank details independently', detail: 'Call a known number, not one on the invoice. Payment-diversion fraud enters here.' },
  ],
  WORK_ORDER_ACTIVE: [
    { id: 'notify', label: 'Tell the supplier the order is live', detail: 'They should not start work on an order we have not activated.' },
  ],

  // ── C · Financial arming ────────────────────────────────────────────────
  ESCROW_ACCOUNT_OPENED: [
    {
      id: 'create-escrow-account',
      label: 'Create the escrow account with the provider',
      detail:
        'Open a dedicated account for this order with the neutral third party. It holds the money so the supplier knows it exists and the customer knows it has not been paid out yet.',
      owner: 'ESCROW',
      required: true,
      doneWhen: 'escrowRef',
    },
    {
      id: 'place-escrow-order',
      label: 'Place the escrow order and agree the release conditions',
      detail:
        'Register the amount, the currency and exactly what has to be true before money moves — inspection passed, two Finance approvers. The conditions are what make it escrow rather than a holding account.',
      owner: 'ONE_BUY_FINANCE',
      required: true,
      doneWhen: 'openedOn',
    },
    {
      id: 'share-reference',
      label: 'Give the supplier the escrow reference',
      detail: 'They will not start work against an arrangement they cannot see. Send the reference and the provider’s confirmation.',
      doneWhen: 'supplierInformed',
    },
  ],
  ESCROW_FUNDED: [
    { id: 'fund', label: 'Deposit the agreed amount into escrow', detail: 'Whoever funds it under the negotiated terms — supplier, us, or both — pays in against the reference.', owner: 'ESCROW', required: true, doneWhen: 'valueDate' },
    { id: 'confirm-funding', label: 'Get the provider’s confirmation of cleared funds', detail: 'Instructed is not the same as settled. Only cleared funds let the supplier start.', required: true },
  ],
  ESCROW_PARTIAL_RELEASE_FOR_TESTING: [
    { id: 'release-testing', label: 'Release the testing portion only', detail: 'Enough to pay the laboratory, no more. The balance stays held until the goods are inspected.', required: true, doneWhen: 'amountReleased' },
  ],
  ADVANCE_PAYMENT_TO_SUPPLIER: [
    { id: 'pay-advance', label: 'Make the advance payment', detail: 'Against the agreed schedule, to the bank details verified independently.', required: true, doneWhen: 'paidOn' },
  ],
  CREDIT_TERMS_CONFIRMED: [
    { id: 'confirm-credit', label: 'Get the credit terms confirmed in writing', detail: 'Days, start point, and what happens if we are late. Verbal credit is not credit.', owner: 'SUPPLIER', required: true },
  ],

  // ── D · Quality assurance ───────────────────────────────────────────────
  TEST_DISPATCH_BOOKED: [
    {
      id: 'book-test-dispatch',
      label: 'Book the sample dispatch to the laboratory',
      detail: 'The sample goes to the lab before the full lot moves, so a failure costs a courier rather than a container.',
      owner: 'SUPPLIER',
      required: true,
      doneWhen: 'awb',
    },
    {
      id: 'pack-msl',
      label: 'Pack to the moisture-sensitivity level on the part',
      detail: 'Dry-pack anything MSL-rated. Parts that absorb moisture in transit fail testing for a reason that has nothing to do with the supplier.',
      standard: TESTING_STANDARDS.moisture,
    },
  ],
  PARTS_RECEIVED_AT_WHL: [
    {
      id: 'lab-receipt',
      label: 'Laboratory confirms receipt and condition',
      detail: 'Quantity, packaging intact, date codes legible. A dispute about what arrived is unwinnable later.',
      owner: 'WHL',
      required: true,
      doneWhen: 'receivedOn',
    },
    {
      id: 'external-visual',
      label: 'External visual inspection on receipt',
      detail: 'Marking permanency, surface texture, lead condition and evidence of resurfacing or remarking — the first screen for a counterfeit.',
      owner: 'WHL',
      standard: TESTING_STANDARDS.visual,
    },
  ],
  TEST_SCOPE_CONFIRMED: [
    {
      id: 'agree-scope',
      label: 'Agree the test scope and the standard it is performed to',
      detail:
        'Which methods, on how many pieces, and against which standard. The verdict is only as good as the scope it was given, and a report with no standard on it proves nothing.',
      required: true,
      standard: TESTING_STANDARDS.authentication,
      doneWhen: 'scope',
    },
    {
      id: 'method-material',
      label: 'Include material and lead-finish analysis',
      detail:
        'Elemental composition by SEM-EDS and plating thickness by X-ray fluorescence. Catches a lead finish that does not match what the marking claims.',
      owner: 'WHL',
      standard: `${TESTING_STANDARDS.astmEds} · ${TESTING_STANDARDS.astmXrf}`,
    },
    {
      id: 'method-xray',
      label: 'Include radiographic examination',
      detail: 'X-ray of the die and bond wires against a known-good reference. An empty or wrong die shows here and nowhere else non-destructively.',
      owner: 'WHL',
      standard: TESTING_STANDARDS.astmXray,
    },
    {
      id: 'method-electrical',
      label: 'Include electrical parameter testing',
      detail: 'Against the manufacturer’s datasheet limits, at the temperatures the customer will actually run them at.',
      owner: 'WHL',
      standard: `${TESTING_STANDARDS.authentication} /7`,
    },
  ],
  TESTING_IN_PROGRESS: [
    {
      id: 'testing-underway',
      label: 'Laboratory testing under way',
      detail: 'Nothing for us to do but hold the shipment. Chase only if the promised report date passes.',
      owner: 'WHL',
      standard: TESTING_STANDARDS.authentication,
      doneWhen: 'startedOn',
    },
    { id: 'hold-shipment', label: 'Keep the full lot on hold until the verdict', detail: 'Shipping before the result is what makes a failed test expensive.' },
  ],
  TEST_PASSED: [
    {
      id: 'read-report',
      label: 'Read the report, not just the verdict',
      detail: 'A pass with observations is still a pass, but the observations are what the customer will ask about.',
      required: true,
      standard: TESTING_STANDARDS.authentication,
    },
    { id: 'file-report', label: 'File the report against the order', detail: 'It travels with the goods and supports the certificate of conformance.' , doneWhen: 'reportNumber' },
  ],
  PARTS_RETURNED_TO_SUPPLIER: [
    {
      id: 'return-samples',
      label: 'Return the tested samples to the supplier',
      detail: 'Packed to commercial standard so they arrive in the condition the report describes.',
      owner: 'WHL',
      standard: TESTING_STANDARDS.astmPackaging,
      doneWhen: 'returnedOn',
    },
  ],

  // ── E · Logistics ───────────────────────────────────────────────────────
  FULL_SHIPMENT_DISPATCHED_BY_SUPPLIER: [
    { id: 'dispatch', label: 'Supplier dispatches the full quantity', detail: 'Against the agreed Incoterm, with the airway bill raised.', owner: 'SUPPLIER', required: true, doneWhen: 'awb' },
    { id: 'check-docs', label: 'Check the shipping documents before the goods leave', detail: 'Commercial invoice, packing list and certificate of origin. A wrong HSN code here becomes a customs query later.', required: true },
  ],
  IN_TRANSIT_INTERNATIONAL: [
    { id: 'track', label: 'Track the shipment', detail: 'Watch for the arrival scan; that is what starts the customs clock.', owner: 'LOGISTICS', doneWhen: 'lastScanOn' },
  ],
  BORDER_ARRIVAL_WHA_ENGAGED: [
    { id: 'engage-cha', label: 'Engage the customs agent', detail: 'Hand them the full document set. Demurrage starts accruing from arrival, not from when we get round to it.', owner: 'WHA', required: true },
  ],
  CUSTOMS_ENTRY_FILED_ICEGATE: [
    { id: 'file-boe', label: 'File the Bill of Entry', detail: 'On ICEGATE, with the CIF value and HSN codes as declared.', owner: 'WHA', required: true, doneWhen: 'beNumber' },
  ],
  DUTY_ASSESSED_AND_PAID: [
    { id: 'check-assessment', label: 'Check the assessed duty against our estimate', detail: 'A large variance usually means a classification dispute, and disputing it after payment is much harder.', required: true },
    { id: 'pay-duty', label: 'Pay the duty', detail: 'BCD and Social Welfare Surcharge are real cost; import IGST is recoverable and must not be booked as cost.', required: true, doneWhen: 'paidOn' },
  ],
  CUSTOMS_CLEARED: [
    { id: 'get-ooc', label: 'Obtain the Out of Charge', detail: 'The customs release. Without it the goods do not leave the port.', owner: 'WHA', required: true, doneWhen: 'outOfChargeRef' },
  ],
  GOODS_RECEIVED_INBOUND_AT_1BUY: [
    { id: 'receive-goods', label: 'Receive the goods and raise the GRN', detail: 'Count against the packing list before signing anything.', required: true, doneWhen: 'receivedOn' },
    { id: 'check-damage', label: 'Check for transit damage before signing', detail: 'Note it on the carrier’s copy. An unnoted damage claim rarely succeeds.' },
  ],

  // ── F · Inspection & settlement ─────────────────────────────────────────
  INBOUND_INSPECTION_IN_PROGRESS: [
    {
      id: 'start-inspection',
      label: 'Start the inbound inspection',
      detail: 'Quantity, part numbers, date codes and marking against the order and the test report.',
      required: true,
      standard: TESTING_STANDARDS.visual,
    },
  ],
  INSPECTION_PASSED: [
    { id: 'pass-inspection', label: 'Sign off the inspection', detail: 'This is the gate that releases the final payment, so it carries more weight than any other stage.', required: true, doneWhen: 'reportNumber' },
    { id: 'record-shortfall', label: 'Record anything not accepted, with the reason', detail: 'Anything short or rejected has to be explained before money moves.' },
  ],
  ESCROW_FINAL_RELEASE_AUTHORISED: [
    { id: 'two-approvers', label: 'Get two different Finance approvers to authorise', detail: 'One person can never release the full balance alone. The system enforces it; this is the reminder that it needs arranging.', required: true },
    { id: 'instruct-release', label: 'Instruct the escrow provider to release', detail: 'Against the inspection report, for the remaining balance.', owner: 'ESCROW', required: true, doneWhen: 'amountReleased' },
  ],
  SUPPLIER_PAID_IN_FULL: [
    { id: 'confirm-payment', label: 'Confirm the supplier has the money', detail: 'Their acknowledgement closes the buy side of the order.', owner: 'ESCROW', required: true, doneWhen: 'supplierConfirmed' },
  ],

  // ── G · Value-add & delivery ────────────────────────────────────────────
  REBRAND_AND_REPACK_IN_PROGRESS: [
    { id: 'repack', label: 'Rebrand and repack to the customer’s specification', detail: 'Their labelling, their carton, their unit count.', required: true },
    { id: 'preserve-msl', label: 'Preserve moisture-barrier packaging where it applies', detail: 'Breaking a dry-pack and repacking without a desiccant and indicator card ruins the parts.', standard: TESTING_STANDARDS.moisture },
  ],
  READY_FOR_OUTBOUND: [
    { id: 'final-qc', label: 'Final check before it leaves', detail: 'Right parts, right count, right labels, right address.', required: true },
  ],
  OUTBOUND_BOOKED: [
    { id: 'raise-invoice', label: 'Raise the tax invoice', detail: 'With the correct place of supply — it decides CGST+SGST versus IGST, and a wrong one is a credit note and a reissue.', required: true, doneWhen: 'invoiceNumber' },
    { id: 'ewb', label: 'Generate the e-way bill where the value requires it', detail: 'Above the threshold the consignment cannot legally move without one.', doneWhen: 'ewayBillNumber' },
    { id: 'book-courier', label: 'Book the outbound carrier', detail: 'With the delivery window we promised the customer.', owner: 'LOGISTICS' },
  ],
  OUT_FOR_DELIVERY: [
    { id: 'track-outbound', label: 'Track to delivery', detail: 'The customer will ask; have the answer before they do.', owner: 'LOGISTICS' },
  ],
  DELIVERED: [
    { id: 'confirm-receipt', label: 'Customer confirms receipt', detail: 'Signed, with the name of whoever signed.', owner: 'CUSTOMER', required: true, doneWhen: 'deliveredOn' },
  ],
  POD_ISSUED_TO_CUSTOMER: [
    { id: 'issue-pod', label: 'Issue the proof of delivery', detail: 'Their evidence the order was completed, and ours if payment is later disputed.', required: true, doneWhen: 'podRef' },
  ],
  CUSTOMER_INVOICED_AND_SETTLED: [
    { id: 'collect', label: 'Collect payment against the invoice', detail: 'Chase from the due date, not from the date somebody notices.', required: true, doneWhen: 'receivedOn' },
  ],
  ORDER_CLOSED: [
    { id: 'reconcile', label: 'Reconcile the final margin against the quote', detail: 'What we actually made, against what we said we would. This is the number that improves the next quote.', required: true },
    { id: 'file-everything', label: 'Confirm every document is on file', detail: 'A closed order is an audit record. Gaps are found years later, by someone who cannot fill them.' },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// Composition
// ═══════════════════════════════════════════════════════════════════════════

function docTask(stage: StageDef, d: EvidenceDoc, owner: Stakeholder): SubTask {
  return {
    id: `doc:${d.id}`,
    kind: 'DOCUMENT',
    label: `Upload — ${d.label}`,
    detail: d.help,
    owner,
    required: Boolean(d.required),
  };
}

/**
 * The figures for a stage collapse into ONE row rather than one per field.
 *
 * Eight separate ticks for eight boxes on the same form is not a checklist, it is
 * the form again. The row names how many are outstanding and the form is one click
 * away.
 */
function captureTask(stage: StageDef, fields: EvidenceField[], owner: Stakeholder): SubTask | null {
  if (!fields.length) return null;
  const required = fields.filter((f) => f.required);
  return {
    id: 'capture:fields',
    kind: 'CAPTURE',
    label: `Record the details — ${fields.length} field${fields.length === 1 ? '' : 's'}`,
    detail: required.length
      ? `${required.map((f) => f.label).join(', ')} must be recorded before the order can move on.`
      : 'Recorded if known. None of these block the order.',
    owner,
    required: required.length > 0,
  };
}

/**
 * The full checklist for a stage, documents first.
 *
 * `ctx` is optional and only affects WHO each row is addressed to. Pass it
 * wherever an order is in hand: on the customs and carriage steps the Incoterm
 * decides whether the work is ours or the supplier's, and without it the rows
 * fall back to the stage's nominal owner.
 */
export function subTasksFor(stageId: string, ctx?: StageContext): SubTask[] {
  const stage = getStage(stageId);
  const owner = ctx ? stageOwner(stage, ctx) : stage.owner;
  const ev = evidenceFor(stageId);
  const actions = (ACTIONS[stageId] ?? []).map<SubTask>((a) => ({
    id: `action:${a.id}`,
    kind: 'ACTION',
    label: a.label,
    detail: a.detail,
    owner: a.owner ?? owner,
    required: Boolean(a.required),
    standard: a.standard,
  }));

  const docs = (ev?.documents ?? []).map((d) => docTask(stage, d, owner));
  const capture = captureTask(stage, ev?.fields ?? [], owner);

  // Documents, then the work, then the figures. See the header for why.
  return [...docs, ...actions, ...(capture ? [capture] : [])];
}

/**
 * The checklist with each row resolved against what is actually on file.
 *
 * `values` is the evidence record's saved values; `attachedDocIds` the documents
 * uploaded against the stage.
 */
export function subTaskStates(
  stageId: string,
  values: Record<string, unknown> = {},
  attachedDocIds: string[] = [],
  ctx?: StageContext,
): SubTaskState[] {
  const ev = evidenceFor(stageId);
  const attached = new Set(attachedDocIds);
  const filled = (id: string) => {
    const v = values[id];
    return v !== undefined && v !== null && v !== '' && v !== false;
  };

  const actionDone = new Map<string, string | undefined>(
    (ACTIONS[stageId] ?? []).map((a) => [`action:${a.id}`, a.doneWhen]),
  );

  return subTasksFor(stageId, ctx).map((task) => {
    if (task.kind === 'DOCUMENT') {
      return { ...task, done: attached.has(task.id.slice(4)) };
    }
    if (task.kind === 'ACTION') {
      const key = actionDone.get(task.id);
      // Without a corresponding field there is nothing to derive from, so the row
      // stays open rather than claiming a completion nobody recorded.
      return { ...task, done: key ? filled(key) : false };
    }
    const fields = ev?.fields ?? [];
    const outstanding = fields.filter((f) => f.required && !filled(f.id)).map((f) => f.label);
    return { ...task, done: outstanding.length === 0, outstanding };
  });
}

/** Headline numbers for the tile. */
export function subTaskProgress(states: SubTaskState[]): {
  done: number;
  total: number;
  requiredOutstanding: number;
} {
  return {
    done: states.filter((s) => s.done).length,
    total: states.length,
    requiredOutstanding: states.filter((s) => s.required && !s.done).length,
  };
}

/** Every stage that declares at least one action, for tests and the flow tab. */
export const STAGES_WITH_ACTIONS = Object.keys(ACTIONS);

/** Guards against an action pointing at an evidence field that does not exist. */
export function orphanedActionFields(): { stageId: string; actionId: string; field: string }[] {
  const out: { stageId: string; actionId: string; field: string }[] = [];
  for (const [stageId, actions] of Object.entries(ACTIONS)) {
    const ev = STAGE_EVIDENCE.find((e) => e.stageId === stageId);
    for (const a of actions) {
      if (!a.doneWhen) continue;
      if (!ev?.fields.some((f) => f.id === a.doneWhen)) {
        out.push({ stageId, actionId: a.id, field: a.doneWhen });
      }
    }
  }
  return out;
}
