/**
 * THE STAGE LADDER — single source of truth (master prompt §2, §11).
 *
 * Everything derives from this file: the Flow Rail, stage tooltips, transition
 * validation, SLA ageing, the "next action" CTA, the audit trail and the demo
 * simulator. Adding or reordering a stage means editing THIS FILE ONLY.
 *
 * NOTE ON THE STAGE COUNT: §2 of the master prompt states "34 stages", but its
 * own phase tables sum to 36 happy-path stages plus one failure branch (D5b
 * TEST_FAILED). The tables are authoritative, so the code defines 36 + 1, plus
 * two payment-method alternates (advance / credit) that replace the escrow
 * stages when those methods are used. Never hardcode a stage count anywhere —
 * derive it from these arrays.
 */

import type { PaymentMethod, Stakeholder, TestScope } from './enums';

export const PHASES = ['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const;
export type PhaseId = (typeof PHASES)[number];

export interface PhaseDef {
  id: PhaseId;
  label: string;
  plainLabel: string;
  description: string;
  owner: string;
}

export const PHASE_DEFS: Record<PhaseId, PhaseDef> = {
  A: {
    id: 'A',
    label: 'Demand Capture',
    plainLabel: 'Getting the order',
    description: "The customer's order arrives and we quote it back to them.",
    owner: '1BUY Sales / Ops',
  },
  B: {
    id: 'B',
    label: 'Sourcing & Commitment',
    plainLabel: 'Buying the parts',
    description: 'We pick an approved supplier, order from them, and lock the terms.',
    owner: '1BUY Procurement',
  },
  C: {
    id: 'C',
    label: 'Financial Arming',
    plainLabel: 'Getting the money ready',
    description: 'Money is put in place so the supplier can safely start work.',
    owner: '1BUY Finance + Escrow',
  },
  D: {
    id: 'D',
    label: 'Quality Assurance',
    plainLabel: 'Testing the parts',
    description: 'An independent laboratory checks the parts before the full shipment moves.',
    owner: 'Supplier + Testing Laboratory',
  },
  E: {
    id: 'E',
    label: 'Logistics',
    // The plain label keeps naming customs. The phase covers E1–E7, which is the
    // shipment AND the customs entry, duty and clearance — so "Logistics" alone is
    // narrower than what the phase actually contains, and the second line is where
    // an operator finds that out.
    plainLabel: 'Shipping and customs',
    description: 'The goods travel to India and clear customs.',
    owner: 'Supplier → Logistics Partner → Customs Agent',
  },
  F: {
    id: 'F',
    label: 'Inspection & Settlement',
    plainLabel: 'Checking and paying',
    description: 'We inspect what arrived, then pay the supplier.',
    owner: '1BUY QC + Finance',
  },
  G: {
    id: 'G',
    label: 'Value-Add & Delivery',
    plainLabel: 'Repacking and delivering',
    description: 'We rebrand, repack, deliver to the customer and close the order.',
    owner: '1BUY Warehouse + Logistics',
  },
};

/**
 * One phase's place in a single order's flow.
 *
 * The types live here so StageContext can carry a plan without stages.ts having
 * to import from phase-plan.ts — all the policy (what may be moved, what dropping
 * a phase costs, validation) is in that file, which imports from this one. One
 * direction only.
 */
export interface PhasePlanEntry {
  phase: PhaseId;
  /** Removed from this order's flow. Its stages stay visible, struck through. */
  skipped: boolean;
}
/** Always all seven phases, in the order this order runs them. */
export type PhasePlan = PhasePlanEntry[];

/** Context the applicability predicates are evaluated against. */
export interface StageContext {
  paymentMethod: PaymentMethod;
  testingRequired: boolean;
  testScope?: TestScope | null;
  /**
   * Per-order phase reordering / curtailment. Absent or null means the ladder's
   * own order, which is what almost every order uses.
   */
  phasePlan?: PhasePlan | null;
}

/** Phase order for this context: the plan's if it has one, else the ladder's. */
export function contextPhaseOrder(ctx: StageContext): PhaseId[] {
  const plan = ctx.phasePlan;
  if (!plan?.length) return [...PHASES];
  const seen = new Set<PhaseId>();
  const out: PhaseId[] = [];
  for (const e of plan) {
    if (PHASES.includes(e.phase) && !seen.has(e.phase)) {
      seen.add(e.phase);
      out.push(e.phase);
    }
  }
  for (const p of PHASES) if (!seen.has(p)) out.push(p);
  return out;
}

/** True when the plan has taken this phase out of the order's flow. */
export function phaseCurtailed(ctx: StageContext, phase: PhaseId): boolean {
  return Boolean(ctx.phasePlan?.some((e) => e.phase === phase && e.skipped));
}

/**
 * How a non-applicable stage is presented.
 *  SKIPPED_VISIBLE — show struck-through with a "why" tooltip. Used where the
 *    operator genuinely needs to know the step did not happen (e.g. testing was
 *    not required on this order).
 *  HIDDEN — omit entirely. Used for mutually-exclusive variants, where showing
 *    the road not taken would be pure noise (e.g. "Advance payment made" on an
 *    escrow order).
 */
export type NotApplicableMode = 'SKIPPED_VISIBLE' | 'HIDDEN';

export interface StageDef {
  id: string;
  /** Human ladder reference from the master prompt, e.g. "E4". */
  code: string;
  phase: PhaseId;
  label: string;
  /** Plain-English label for Plain English mode (§8.2). */
  plainLabel: string;
  /** What happens here, written for a non-technical operator. */
  description: string;
  /** What has to be true to leave this stage. */
  exitCriteria: string;
  owner: Stakeholder;
  /** Expected time in this stage, in hours. Drives at-risk / breached (§4). */
  expectedHours: number;
  /** Artifacts this stage is meant to produce. */
  artifacts: string[];
  /** What has to happen next, and who does it. */
  nextAction: string;
  nextActionOwner: Stakeholder;
  /** Allowed onward stage ids. Empty = terminal. */
  next: string[];
  /** True for exception branches, which are not part of linear progress. */
  isExceptionBranch?: boolean;
  /**
   * For exception branches: the linear stage the order diverged from. The rail
   * anchors the blocked visual to that node, since the branch itself is not one
   * of the ladder positions.
   */
  branchesFrom?: string;
  /** Terminal success state. */
  isTerminal?: boolean;
  applies?: (ctx: StageContext) => boolean;
  notApplicableMode?: NotApplicableMode;
  /** Shown in the tooltip when the stage is skipped. */
  notApplicableReason?: (ctx: StageContext) => string;
}

const escrowOnly = (ctx: StageContext) => ctx.paymentMethod === 'ESCROW';
const advanceOnly = (ctx: StageContext) => ctx.paymentMethod === 'ADVANCE';
const creditOnly = (ctx: StageContext) => ctx.paymentMethod === 'CREDIT';
const testingOnly = (ctx: StageContext) => ctx.testingRequired;

const noTestingReason = () =>
  'No line item on this order requires testing, so the whole testing phase is skipped.';
const notEscrowReason = (ctx: StageContext) =>
  `This order is on ${ctx.paymentMethod.toLowerCase()} payment terms, not escrow, so no escrow account is involved.`;

export const STAGE_DEFS: StageDef[] = [
  // ── Phase A — Demand Capture ─────────────────────────────────────────────
  {
    id: 'CUSTOMER_PO_RECEIVED',
    code: 'A1',
    phase: 'A',
    label: 'Customer Purchase Order received',
    plainLabel: "Customer's order received",
    description:
      "The customer's purchase order has been entered into the system with every part and quantity.",
    exitCriteria: 'Purchase Order header and all part lines captured and validated.',
    owner: 'ONE_BUY',
    expectedHours: 4,
    artifacts: ['Customer Purchase Order document'],
    nextAction: 'Raise a Proforma Invoice for the customer.',
    nextActionOwner: 'ONE_BUY',
    next: ['PI_ISSUED_TO_CUSTOMER'],
  },
  {
    id: 'PI_ISSUED_TO_CUSTOMER',
    code: 'A2',
    phase: 'A',
    label: 'Proforma Invoice issued to customer',
    plainLabel: 'Price quote sent to customer',
    description: 'We have sent the customer our Proforma Invoice — our formal price and terms.',
    exitCriteria: 'Proforma Invoice issued, sent and timestamped.',
    owner: 'ONE_BUY',
    expectedHours: 8,
    artifacts: ['1BUY Proforma Invoice'],
    nextAction: 'Chase the customer to confirm the Proforma Invoice.',
    nextActionOwner: 'CUSTOMER',
    next: ['PI_ACCEPTED_BY_CUSTOMER'],
  },
  {
    id: 'PI_ACCEPTED_BY_CUSTOMER',
    code: 'A3',
    phase: 'A',
    label: 'Proforma Invoice accepted by customer',
    plainLabel: 'Customer agreed the quote',
    description: 'The customer has confirmed our Proforma Invoice, so we can commit to a supplier.',
    exitCriteria: 'Acceptance recorded with reference and date.',
    owner: 'CUSTOMER',
    expectedHours: 48,
    artifacts: ['Acceptance email or reference'],
    nextAction: 'Choose an approved supplier from the Approved Vendor List.',
    nextActionOwner: 'ONE_BUY',
    next: ['SUPPLIER_SELECTED_FROM_AVL'],
  },

  // ── Phase B — Sourcing & Commitment ──────────────────────────────────────
  {
    id: 'SUPPLIER_SELECTED_FROM_AVL',
    code: 'B1',
    phase: 'B',
    label: 'Supplier selected from Approved Vendor List',
    plainLabel: 'Approved supplier chosen',
    description:
      'A supplier has been picked from the Approved Vendor List. Only approved, unexpired vendors can be used.',
    exitCriteria: 'Approved Vendor List status is Approved and the approval has not expired.',
    owner: 'ONE_BUY',
    expectedHours: 8,
    artifacts: ['Approved Vendor List record snapshot'],
    nextAction: 'Issue our Purchase Order to the supplier.',
    nextActionOwner: 'ONE_BUY',
    next: ['SUPPLIER_PO_ISSUED'],
  },
  {
    id: 'SUPPLIER_PO_ISSUED',
    code: 'B2',
    phase: 'B',
    label: 'Supplier Purchase Order issued',
    plainLabel: 'Our order sent to supplier',
    description:
      "We have issued our Purchase Order to the supplier and linked it to the customer's order.",
    exitCriteria: "Purchase Order issued to supplier; line mapping to the customer's order complete.",
    owner: 'ONE_BUY',
    expectedHours: 8,
    artifacts: ['1BUY Purchase Order'],
    nextAction: "Wait for the supplier's Proforma Invoice, then record it.",
    nextActionOwner: 'SUPPLIER',
    next: ['SUPPLIER_PI_RECEIVED'],
  },
  {
    id: 'SUPPLIER_PI_RECEIVED',
    code: 'B3',
    phase: 'B',
    label: 'Supplier Proforma Invoice received',
    plainLabel: "Supplier's invoice received",
    description:
      "The supplier's Proforma Invoice is recorded and checked against our Purchase Order for price, quantity and lead time.",
    exitCriteria: 'Supplier Proforma Invoice captured; prices and lead times reconciled against the Purchase Order.',
    owner: 'SUPPLIER',
    expectedHours: 24,
    artifacts: ['Supplier Proforma Invoice', 'Variance report'],
    nextAction: 'Agree and lock the commercial terms.',
    nextActionOwner: 'ONE_BUY',
    next: ['TERMS_LOCKED'],
  },
  {
    id: 'TERMS_LOCKED',
    code: 'B4',
    phase: 'B',
    label: 'Terms locked',
    plainLabel: 'Terms agreed and frozen',
    description:
      'Payment method, testing requirement, delivery terms, currency and exchange rate are all agreed and frozen.',
    exitCriteria: 'Payment method, testing requirement, test scope, delivery terms, currency and exchange rate all locked.',
    owner: 'ONE_BUY',
    expectedHours: 12,
    artifacts: ['Terms sheet'],
    nextAction: 'Activate the internal work order.',
    nextActionOwner: 'ONE_BUY',
    next: ['WORK_ORDER_ACTIVE'],
  },
  {
    id: 'WORK_ORDER_ACTIVE',
    code: 'B5',
    phase: 'B',
    label: 'Work order active',
    plainLabel: 'Internal job opened',
    description:
      'The internal work order is live. From here the order is tracked as one job end to end.',
    exitCriteria: 'Work Order created and active.',
    owner: 'ONE_BUY',
    expectedHours: 2,
    artifacts: ['Work Order'],
    nextAction: 'Put the money in place for the supplier.',
    nextActionOwner: 'ONE_BUY',
    next: [
      'ESCROW_ACCOUNT_OPENED',
      'ADVANCE_PAYMENT_TO_SUPPLIER',
      'CREDIT_TERMS_CONFIRMED',
    ],
  },

  // ── Phase C — Financial Arming ───────────────────────────────────────────
  {
    id: 'ESCROW_ACCOUNT_OPENED',
    code: 'C1',
    phase: 'C',
    label: 'Escrow account opened',
    plainLabel: 'Neutral money account opened',
    description:
      'A neutral third party has opened an account to hold the money until both sides have done their part.',
    exitCriteria: 'Escrow reference generated and both parties onboarded.',
    owner: 'ESCROW',
    expectedHours: 24,
    artifacts: ['Escrow agreement'],
    nextAction: 'Fund the escrow account.',
    nextActionOwner: 'ONE_BUY',
    next: ['ESCROW_FUNDED'],
    applies: escrowOnly,
    notApplicableMode: 'HIDDEN',
    notApplicableReason: notEscrowReason,
  },
  {
    id: 'ESCROW_FUNDED',
    code: 'C2',
    phase: 'C',
    label: 'Escrow funded',
    plainLabel: 'Money placed in escrow',
    description: 'The money is now sitting with the escrow provider, confirmed and held.',
    exitCriteria: 'Full order value (or the agreed tranche) confirmed as held.',
    owner: 'ESCROW',
    expectedHours: 48,
    artifacts: ['Funding confirmation'],
    nextAction: 'Release the test-enablement tranche so the supplier can send parts for testing.',
    nextActionOwner: 'ONE_BUY',
    next: ['ESCROW_PARTIAL_RELEASE_FOR_TESTING', 'FULL_SHIPMENT_DISPATCHED_BY_SUPPLIER'],
    applies: escrowOnly,
    notApplicableMode: 'HIDDEN',
    notApplicableReason: notEscrowReason,
  },
  {
    id: 'ESCROW_PARTIAL_RELEASE_FOR_TESTING',
    code: 'C3',
    phase: 'C',
    label: 'Escrow partial release for testing',
    plainLabel: 'Part-payment released for testing',
    description:
      'A part-payment has been released so the supplier can afford to send parts to the testing lab.',
    exitCriteria: 'Tranche released and acknowledged by the supplier.',
    owner: 'ONE_BUY',
    expectedHours: 24,
    artifacts: ['Release instruction', 'Escrow receipt'],
    nextAction: 'Supplier books the courier to the testing lab.',
    nextActionOwner: 'SUPPLIER',
    next: ['TEST_DISPATCH_BOOKED'],
    applies: (ctx) => escrowOnly(ctx) && ctx.testingRequired,
    notApplicableMode: 'HIDDEN',
    notApplicableReason: (ctx) =>
      !escrowOnly(ctx) ? notEscrowReason(ctx) : noTestingReason(),
  },
  {
    id: 'ADVANCE_PAYMENT_TO_SUPPLIER',
    code: 'C1a',
    phase: 'C',
    label: 'Advance payment made',
    plainLabel: 'Supplier paid up front',
    description: 'The supplier has been paid in advance, as agreed in the terms.',
    exitCriteria: 'Payment confirmed and receipt on file.',
    owner: 'ONE_BUY',
    expectedHours: 24,
    artifacts: ['Payment advice', 'Bank receipt'],
    nextAction: 'Supplier begins fulfilment.',
    nextActionOwner: 'SUPPLIER',
    next: ['TEST_DISPATCH_BOOKED', 'FULL_SHIPMENT_DISPATCHED_BY_SUPPLIER'],
    applies: advanceOnly,
    notApplicableMode: 'HIDDEN',
    notApplicableReason: (ctx) =>
      `This order is on ${ctx.paymentMethod.toLowerCase()} terms, not advance payment.`,
  },
  {
    id: 'CREDIT_TERMS_CONFIRMED',
    code: 'C1c',
    phase: 'C',
    label: 'Credit terms confirmed',
    plainLabel: 'Pay-later terms confirmed',
    description:
      'The supplier has agreed to supply on credit. Payment falls due after delivery, on the agreed terms.',
    exitCriteria: 'Credit terms and due-date basis recorded.',
    owner: 'SUPPLIER',
    expectedHours: 24,
    artifacts: ['Credit terms confirmation'],
    nextAction: 'Supplier begins fulfilment.',
    nextActionOwner: 'SUPPLIER',
    next: ['TEST_DISPATCH_BOOKED', 'FULL_SHIPMENT_DISPATCHED_BY_SUPPLIER'],
    applies: creditOnly,
    notApplicableMode: 'HIDDEN',
    notApplicableReason: (ctx) =>
      `This order is on ${ctx.paymentMethod.toLowerCase()} terms, not credit.`,
  },

  // ── Phase D — Quality Assurance ──────────────────────────────────────────
  {
    id: 'TEST_DISPATCH_BOOKED',
    code: 'D1',
    phase: 'D',
    label: 'Test dispatch booked',
    plainLabel: 'Parts booked to the lab',
    description: 'The supplier has booked a courier to send parts to the testing lab.',
    exitCriteria: 'Carrier, tracking number and pickup all confirmed.',
    owner: 'SUPPLIER',
    expectedHours: 24,
    artifacts: ['Test-leg shipment (Leg 1)'],
    nextAction: 'Lab confirms it has received the parts.',
    nextActionOwner: 'WHL',
    next: ['PARTS_RECEIVED_AT_WHL'],
    applies: testingOnly,
    notApplicableMode: 'SKIPPED_VISIBLE',
    notApplicableReason: noTestingReason,
  },
  {
    id: 'PARTS_RECEIVED_AT_WHL',
    code: 'D2',
    phase: 'D',
    label: 'Parts received at Testing Laboratory',
    plainLabel: 'Lab received the parts',
    description: 'The testing lab has logged the parts in and checked the quantity against what was sent.',
    exitCriteria: 'Quantity received reconciled against quantity dispatched.',
    owner: 'WHL',
    expectedHours: 24,
    artifacts: ['Testing Laboratory goods-receipt note'],
    nextAction: 'Agree exactly what will be tested.',
    nextActionOwner: 'ONE_BUY',
    next: ['TEST_SCOPE_CONFIRMED'],
    applies: testingOnly,
    notApplicableMode: 'SKIPPED_VISIBLE',
    notApplicableReason: noTestingReason,
  },
  {
    id: 'TEST_SCOPE_CONFIRMED',
    code: 'D3',
    phase: 'D',
    label: 'Test scope confirmed',
    plainLabel: 'Testing plan agreed',
    description:
      'It is agreed whether a sample from the lot is tested or every piece is tested, and which checks are run.',
    exitCriteria: 'Scope, sample size, AQL and test parameters agreed.',
    owner: 'ONE_BUY',
    expectedHours: 12,
    artifacts: ['Test plan'],
    nextAction: 'Lab starts testing.',
    nextActionOwner: 'WHL',
    next: ['TESTING_IN_PROGRESS'],
    applies: testingOnly,
    notApplicableMode: 'SKIPPED_VISIBLE',
    notApplicableReason: noTestingReason,
  },
  {
    id: 'TESTING_IN_PROGRESS',
    code: 'D4',
    phase: 'D',
    label: 'Testing in progress',
    plainLabel: 'Testing under way',
    description: 'The lab is running the agreed checks on the parts.',
    exitCriteria: 'All specified tests executed and a verdict reached.',
    owner: 'WHL',
    expectedHours: 96,
    artifacts: ['Interim test logs'],
    nextAction: 'Await the signed test report and verdict.',
    nextActionOwner: 'WHL',
    next: ['TEST_PASSED', 'TEST_FAILED'],
    applies: testingOnly,
    notApplicableMode: 'SKIPPED_VISIBLE',
    notApplicableReason: noTestingReason,
  },
  {
    id: 'TEST_PASSED',
    code: 'D5a',
    phase: 'D',
    label: 'Test passed',
    plainLabel: 'Parts passed testing',
    description: 'The lab has signed off the parts as good.',
    exitCriteria: 'Signed test report issued with a PASS verdict.',
    owner: 'WHL',
    expectedHours: 12,
    artifacts: ['Test report (PASS)'],
    nextAction: 'Lab returns the parts to the supplier.',
    nextActionOwner: 'WHL',
    next: ['PARTS_RETURNED_TO_SUPPLIER'],
    applies: testingOnly,
    notApplicableMode: 'SKIPPED_VISIBLE',
    notApplicableReason: noTestingReason,
  },
  {
    id: 'TEST_FAILED',
    code: 'D5b',
    phase: 'D',
    label: 'Test failed',
    plainLabel: 'Parts failed testing',
    description:
      'The lab has failed the parts. The order is blocked until someone decides how to proceed.',
    exitCriteria: 'A resolution route is chosen and the exception is closed.',
    owner: 'ONE_BUY',
    expectedHours: 24,
    artifacts: ['Test report (FAIL)', 'Non-conformance report'],
    nextAction: 'Choose how to resolve the failure.',
    nextActionOwner: 'ONE_BUY',
    next: ['TEST_DISPATCH_BOOKED', 'TEST_SCOPE_CONFIRMED', 'PARTS_RETURNED_TO_SUPPLIER'],
    isExceptionBranch: true,
    branchesFrom: 'TESTING_IN_PROGRESS',
    applies: testingOnly,
    notApplicableMode: 'HIDDEN',
    notApplicableReason: noTestingReason,
  },
  {
    id: 'PARTS_RETURNED_TO_SUPPLIER',
    code: 'D6',
    phase: 'D',
    label: 'Parts returned to supplier',
    plainLabel: 'Parts sent back to supplier',
    description: 'The tested parts are on their way back to the supplier to join the full shipment.',
    exitCriteria: 'Supplier confirms receipt of the returned parts.',
    owner: 'WHL',
    expectedHours: 48,
    artifacts: ['Return shipment (Leg 2)'],
    nextAction: 'Supplier ships the full consignment to us.',
    nextActionOwner: 'SUPPLIER',
    next: ['FULL_SHIPMENT_DISPATCHED_BY_SUPPLIER'],
    applies: testingOnly,
    notApplicableMode: 'SKIPPED_VISIBLE',
    notApplicableReason: noTestingReason,
  },

  // ── Phase E — Logistics ──────────────────────────────────────────────────
  {
    id: 'FULL_SHIPMENT_DISPATCHED_BY_SUPPLIER',
    code: 'E1',
    phase: 'E',
    label: 'Full shipment dispatched by supplier',
    plainLabel: 'Supplier shipped everything',
    description: 'The supplier has shipped the whole consignment to us with all export paperwork.',
    exitCriteria: 'Carrier, Air Waybill or Bill of Lading, packing list, invoice and certificate of origin all issued.',
    owner: 'SUPPLIER',
    expectedHours: 24,
    artifacts: ['Import shipment (Leg 3)', 'Packing list', 'Certificate of origin'],
    nextAction: 'Track the shipment to the border.',
    nextActionOwner: 'LOGISTICS',
    next: ['IN_TRANSIT_INTERNATIONAL'],
  },
  {
    id: 'IN_TRANSIT_INTERNATIONAL',
    code: 'E2',
    phase: 'E',
    label: 'In transit (international)',
    plainLabel: 'On its way to India',
    description: 'The consignment has left the origin country and is travelling to India.',
    exitCriteria: 'Arrival at the destination port or airport.',
    owner: 'LOGISTICS',
    expectedHours: 120,
    artifacts: ['Tracking events'],
    nextAction: 'Engage the customs agent on arrival.',
    nextActionOwner: 'WHA',
    next: ['BORDER_ARRIVAL_WHA_ENGAGED'],
  },
  {
    id: 'BORDER_ARRIVAL_WHA_ENGAGED',
    code: 'E3',
    phase: 'E',
    label: 'Border arrival — Customs Agent engaged',
    plainLabel: 'Arrived at customs — agent engaged',
    description:
      'The goods have reached the border and our customs agent has taken over the paperwork.',
    exitCriteria: 'Customs Agent assigned and all documents handed over.',
    owner: 'WHA',
    expectedHours: 24,
    artifacts: ['Customs Agent engagement record'],
    nextAction: 'File the customs entry.',
    nextActionOwner: 'WHA',
    next: ['CUSTOMS_ENTRY_FILED_ICEGATE'],
  },
  {
    id: 'CUSTOMS_ENTRY_FILED_ICEGATE',
    code: 'E4',
    phase: 'E',
    label: 'Customs entry filed with Indian Customs',
    plainLabel: 'Customs form filed',
    description:
      'The customs agent has filed the Bill of Entry with Indian customs, and we track its status.',
    exitCriteria: 'Entry number and filing acknowledgement received.',
    owner: 'WHA',
    expectedHours: 24,
    artifacts: ['Bill of Entry', 'Supporting documents'],
    nextAction: 'Await assessment, then pay the duty.',
    nextActionOwner: 'WHA',
    next: ['DUTY_ASSESSED_AND_PAID'],
  },
  {
    id: 'DUTY_ASSESSED_AND_PAID',
    code: 'E5',
    phase: 'E',
    label: 'Duty assessed and paid',
    plainLabel: 'Import taxes worked out and paid',
    description:
      'Customs has calculated the duty and taxes, and we have paid them. Only part of this is a real cost — the IGST comes back to us as credit.',
    exitCriteria: 'Duty and taxes computed and paid, challan on file.',
    owner: 'ONE_BUY',
    expectedHours: 24,
    artifacts: ['Duty challan', 'Payment receipt'],
    nextAction: 'Await customs release.',
    nextActionOwner: 'WHA',
    next: ['CUSTOMS_CLEARED'],
  },
  {
    id: 'CUSTOMS_CLEARED',
    code: 'E6',
    phase: 'E',
    label: 'Customs cleared',
    plainLabel: 'Released by customs',
    description: 'Customs has released the goods. They can now travel to our premises.',
    exitCriteria: 'Out-of-charge / release confirmed.',
    owner: 'WHA',
    expectedHours: 24,
    artifacts: ['Out-of-charge document'],
    nextAction: 'Receive the goods at our warehouse.',
    nextActionOwner: 'ONE_BUY',
    next: ['GOODS_RECEIVED_INBOUND_AT_1BUY'],
  },
  {
    id: 'GOODS_RECEIVED_INBOUND_AT_1BUY',
    code: 'E7',
    phase: 'E',
    label: 'Goods received inbound at 1BUY',
    plainLabel: 'Goods arrived at our warehouse',
    description: 'The consignment has arrived with us and a goods-receipt note has been raised.',
    exitCriteria: 'Inbound goods-receipt note raised, quantity and cartons reconciled.',
    owner: 'ONE_BUY',
    expectedHours: 12,
    artifacts: ['Goods-receipt note'],
    nextAction: 'Start the inbound inspection.',
    nextActionOwner: 'ONE_BUY',
    next: ['INBOUND_INSPECTION_IN_PROGRESS'],
  },

  // ── Phase F — Inspection & Settlement ────────────────────────────────────
  {
    id: 'INBOUND_INSPECTION_IN_PROGRESS',
    code: 'F1',
    phase: 'F',
    label: 'Inbound inspection in progress',
    plainLabel: 'Checking what arrived',
    description:
      'We are checking count, condition, part numbers, date codes, packaging and paperwork, with photo evidence.',
    exitCriteria: 'Inspection checklist completed with evidence.',
    owner: 'ONE_BUY',
    expectedHours: 24,
    artifacts: ['Inspection report', 'Evidence photos'],
    nextAction: 'Sign off the inspection.',
    nextActionOwner: 'ONE_BUY',
    next: ['INSPECTION_PASSED'],
  },
  {
    id: 'INSPECTION_PASSED',
    code: 'F2',
    phase: 'F',
    label: 'Inspection passed',
    plainLabel: 'Goods checked and accepted',
    description:
      'Everything checked out. This is the gate that unlocks the final payment to the supplier.',
    exitCriteria: 'Signed off by an authorised inspector.',
    owner: 'ONE_BUY',
    expectedHours: 8,
    artifacts: ['Signed inspection report'],
    nextAction: 'Authorise the final payment to the supplier.',
    nextActionOwner: 'ONE_BUY',
    next: ['ESCROW_FINAL_RELEASE_AUTHORISED', 'SUPPLIER_PAID_IN_FULL'],
  },
  {
    id: 'ESCROW_FINAL_RELEASE_AUTHORISED',
    code: 'F3',
    phase: 'F',
    label: 'Escrow final release authorised',
    plainLabel: 'Final payment approved',
    description:
      'Two Finance approvers have instructed the escrow provider to release the remaining money to the supplier.',
    exitCriteria: 'Release instruction issued with two Finance authorisations.',
    owner: 'ONE_BUY',
    expectedHours: 12,
    artifacts: ['Release instruction'],
    nextAction: 'Await confirmation that the supplier has been paid.',
    nextActionOwner: 'ESCROW',
    next: ['SUPPLIER_PAID_IN_FULL'],
    applies: escrowOnly,
    notApplicableMode: 'HIDDEN',
    notApplicableReason: notEscrowReason,
  },
  {
    id: 'SUPPLIER_PAID_IN_FULL',
    code: 'F4',
    phase: 'F',
    label: 'Supplier paid in full',
    plainLabel: 'Supplier fully paid',
    description: 'The supplier has received the full amount owed.',
    exitCriteria: 'Payment confirmed; escrow balance zeroed where applicable.',
    owner: 'ESCROW',
    expectedHours: 24,
    artifacts: ['Payment confirmation'],
    nextAction: 'Start rebranding and repacking.',
    nextActionOwner: 'ONE_BUY',
    next: ['REBRAND_AND_REPACK_IN_PROGRESS'],
  },

  // ── Phase G — Value-Add & Delivery ───────────────────────────────────────
  {
    id: 'REBRAND_AND_REPACK_IN_PROGRESS',
    code: 'G1',
    phase: 'G',
    label: 'Rebrand and repack in progress',
    plainLabel: 'Relabelling and repacking',
    description:
      'We are applying 1BUY labelling and repacking the goods, capturing serials and before/after photos.',
    exitCriteria: 'Labelling, cartonisation, serial/lot capture and photos complete.',
    owner: 'ONE_BUY',
    expectedHours: 24,
    artifacts: ['Repack job sheet', 'Before/after photos'],
    nextAction: 'Pass repack QC and mark ready to ship.',
    nextActionOwner: 'ONE_BUY',
    next: ['READY_FOR_OUTBOUND'],
  },
  {
    id: 'READY_FOR_OUTBOUND',
    code: 'G2',
    phase: 'G',
    label: 'Ready for outbound',
    plainLabel: 'Ready to ship to customer',
    description: 'Repack QC has passed and the shipment is labelled and ready to go.',
    exitCriteria: 'Outbound packing list produced and 1BUY labels applied.',
    owner: 'ONE_BUY',
    expectedHours: 8,
    artifacts: ['Outbound packing list'],
    nextAction: 'Book the courier to the customer.',
    nextActionOwner: 'ONE_BUY',
    next: ['OUTBOUND_BOOKED'],
  },
  {
    id: 'OUTBOUND_BOOKED',
    code: 'G3',
    phase: 'G',
    label: 'Outbound booked & invoiced',
    plainLabel: 'Courier booked and bill raised',
    /**
     * The tax invoice is raised HERE, not after delivery.
     *
     * For a supply of goods the invoice must be issued before or at the time of
     * removal (CGST Act §31(1)(a)), and the e-way bill has to be generated
     * before movement begins and must reference that invoice (Rule 138). An
     * invoice raised after delivery would mean goods travelled with no invoice
     * and an e-way bill with nothing valid to point at.
     */
    description:
      'A courier is booked, and the tax invoice is raised so it travels with the goods. The law requires the invoice to exist before the goods leave us.',
    exitCriteria:
      'Carrier, tracking number and pickup confirmed; tax invoice raised and e-way bill generated.',
    owner: 'ONE_BUY',
    expectedHours: 8,
    artifacts: ['Outbound shipment (Leg 4)', 'Shipping label', 'Tax invoice', 'E-way bill'],
    nextAction: 'Track the delivery.',
    nextActionOwner: 'LOGISTICS',
    next: ['OUT_FOR_DELIVERY'],
  },
  {
    id: 'OUT_FOR_DELIVERY',
    code: 'G4',
    phase: 'G',
    label: 'Out for delivery',
    plainLabel: 'Out for delivery',
    description: 'The shipment has been dispatched and is on its way to the customer.',
    exitCriteria: 'Delivery attempted.',
    owner: 'LOGISTICS',
    expectedHours: 24,
    artifacts: ['Tracking events'],
    nextAction: 'Confirm the customer has received the goods.',
    nextActionOwner: 'LOGISTICS',
    next: ['DELIVERED'],
  },
  {
    id: 'DELIVERED',
    code: 'G5',
    phase: 'G',
    label: 'Delivered',
    plainLabel: 'Customer received the goods',
    description: 'The customer has taken delivery of the shipment.',
    exitCriteria: 'Receipt confirmed by the customer.',
    owner: 'CUSTOMER',
    expectedHours: 12,
    artifacts: ['Delivery confirmation'],
    nextAction: 'Capture and share the Proof of Delivery.',
    nextActionOwner: 'ONE_BUY',
    next: ['POD_ISSUED_TO_CUSTOMER'],
  },
  {
    id: 'POD_ISSUED_TO_CUSTOMER',
    code: 'G6',
    phase: 'G',
    label: 'Proof of Delivery issued to customer',
    plainLabel: 'Delivery proof sent',
    description: 'The signed Proof of Delivery is on file and has been shared with the customer.',
    exitCriteria: 'Signed or stamped Proof of Delivery on file and shared.',
    owner: 'ONE_BUY',
    expectedHours: 12,
    artifacts: ['Proof of Delivery'],
    nextAction: 'Raise the tax invoice and collect payment.',
    nextActionOwner: 'ONE_BUY',
    next: ['CUSTOMER_INVOICED_AND_SETTLED'],
  },
  {
    // The id keeps its original name so existing history stays valid, but the
    // invoice itself is now raised at G3. This stage is purely about the money
    // arriving.
    id: 'CUSTOMER_INVOICED_AND_SETTLED',
    code: 'G7',
    phase: 'G',
    label: 'Customer payment settled',
    plainLabel: 'Customer has paid',
    description:
      'The invoice raised at dispatch has been paid, or the credit clock has run its course and collection is reconciled.',
    exitCriteria: 'Payment received and reconciled, or credit terms discharged.',
    owner: 'ONE_BUY',
    expectedHours: 48,
    artifacts: ['Payment receipt', 'Collection reconciliation'],
    nextAction: 'Close the order.',
    nextActionOwner: 'ONE_BUY',
    next: ['ORDER_CLOSED'],
  },
  {
    id: 'ORDER_CLOSED',
    code: 'G8',
    phase: 'G',
    label: 'Order closed',
    plainLabel: 'Order complete',
    description:
      'Everything is discharged — goods, money and paperwork. The final margin is locked in.',
    exitCriteria: 'Financial, physical and documentary closure complete.',
    owner: 'ONE_BUY',
    expectedHours: 0,
    artifacts: ['Order closure summary'],
    nextAction: 'Nothing further — this order is complete.',
    nextActionOwner: 'ONE_BUY',
    next: [],
    isTerminal: true,
  },
];

// ── Derived lookups ────────────────────────────────────────────────────────

export const STAGE_BY_ID: Record<string, StageDef> = Object.fromEntries(
  STAGE_DEFS.map((s) => [s.id, s]),
);

export const STAGE_IDS = STAGE_DEFS.map((s) => s.id);

/** Linear progress stages — excludes exception branches. */
export const PROGRESS_STAGES = STAGE_DEFS.filter((s) => !s.isExceptionBranch);

export function getStage(id: string): StageDef {
  const s = STAGE_BY_ID[id];
  if (!s) throw new Error(`Unknown stage id: ${id}`);
  return s;
}

export function stageApplies(stage: StageDef, ctx: StageContext): boolean {
  // A phase taken out of this order's flow takes its stages with it. Checked
  // before the stage's own predicate so curtailment always wins.
  if (phaseCurtailed(ctx, stage.phase)) return false;
  return stage.applies ? stage.applies(ctx) : true;
}

/** Stages relevant to one order, in ladder order, with applicability resolved. */
export function applicableStages(ctx: StageContext): StageDef[] {
  const base = STAGE_DEFS.filter((s) => {
    if (s.isExceptionBranch) return false;
    // A curtailed phase keeps its stages on the rail, struck through. Dropping
    // them from the list would hide what was cut — the operator needs to see the
    // phase was removed, and needs somewhere to put it back from.
    if (phaseCurtailed(ctx, s.phase)) return true;
    if (stageApplies(s, ctx)) return true;
    return s.notApplicableMode === 'SKIPPED_VISIBLE';
  });

  if (!ctx.phasePlan?.length) return base;

  // Reorder by the plan's phase sequence, keeping the ladder's own order within
  // each phase. A stable sort on (phase rank, ladder index) does both.
  const rank = new Map(contextPhaseOrder(ctx).map((p, i) => [p, i]));
  return base
    .map((stage, i) => ({ stage, i, r: rank.get(stage.phase) ?? PHASES.indexOf(stage.phase) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.stage);
}

/**
 * Position in the MASTER ladder — fixed, and independent of any phase plan.
 *
 * Use this to ask "where does this stage sit in the standard flow". To ask "is
 * this stage before that one on THIS order", use ladderPosition, which follows
 * the order's own plan.
 */
export function stageIndex(stageId: string): number {
  return STAGE_DEFS.findIndex((s) => s.id === stageId);
}

/**
 * Position in one order's flow, honouring its phase plan.
 *
 * Returns -1 for a stage the order does not walk through at all. Everything that
 * compares two stages' order — completed-vs-upcoming on the rail, what comes
 * next, progress — has to go through this rather than stageIndex, or a reordered
 * order would paint the wrong nodes green.
 */
export function ladderPosition(stageId: string, ctx: StageContext): number {
  return applicableStages(ctx).findIndex((s) => s.id === stageId);
}

/** Progress 0–1 over the stages that actually apply to this order. */
export function progressFor(stageId: string, ctx: StageContext): number {
  const ladder = applicableStages(ctx).filter((s) => stageApplies(s, ctx));
  const current = getStage(stageId);
  if (current.isTerminal) return 1;
  const idx = ladder.findIndex((s) => s.id === stageId);
  if (idx < 0) {
    // Not on this order's path — an exception branch, or a stage inside a phase
    // the order no longer runs. Fall back to where it diverged from, measured in
    // the order's own sequence rather than the master ladder's, since a reordered
    // order's positions no longer agree with the master's.
    const { anchorStageId } = resolveRailAnchor(stageId);
    const anchorIdx = ladder.findIndex((s) => s.id === anchorStageId);
    if (anchorIdx >= 0) return ladder.length ? anchorIdx / (ladder.length - 1 || 1) : 0;
    const linear = stageIndex(stageId);
    const before = ladder.filter((s) => stageIndex(s.id) < linear).length;
    return ladder.length ? before / ladder.length : 0;
  }
  return ladder.length ? idx / (ladder.length - 1 || 1) : 0;
}

export type StageVisualState =
  | 'COMPLETED'
  | 'CURRENT'
  | 'BLOCKED'
  | 'AT_RISK'
  | 'UPCOMING'
  | 'SKIPPED';

export interface SlaAssessment {
  hoursInStage: number;
  expectedHours: number;
  /** ON_TRACK until expected, AT_RISK past it, BREACHED past 2x. */
  status: 'ON_TRACK' | 'AT_RISK' | 'BREACHED';
  overdueHours: number;
}

export function assessSla(
  stageId: string,
  stageEnteredAt: Date,
  now: Date = new Date(),
): SlaAssessment {
  const stage = getStage(stageId);
  const hoursInStage = Math.max(
    0,
    (now.getTime() - stageEnteredAt.getTime()) / (1000 * 60 * 60),
  );
  const expectedHours = stage.expectedHours;
  let status: SlaAssessment['status'] = 'ON_TRACK';
  if (expectedHours > 0) {
    if (hoursInStage > expectedHours * 2) status = 'BREACHED';
    else if (hoursInStage > expectedHours) status = 'AT_RISK';
  }
  return {
    hoursInStage,
    expectedHours,
    status,
    overdueHours: Math.max(0, hoursInStage - expectedHours),
  };
}

/**
 * Where the rail should anchor its "you are here" marker.
 *
 * Exception branches (e.g. TEST_FAILED) are not ladder positions, so the rail
 * anchors to the linear stage the order diverged from and paints it BLOCKED.
 * Without this, a blocked order would have no highlighted node at all.
 */
export function resolveRailAnchor(stageId: string): {
  anchorStageId: string;
  branch: StageDef | null;
} {
  const stage = STAGE_BY_ID[stageId];
  if (stage?.isExceptionBranch) {
    return { anchorStageId: stage.branchesFrom ?? stageId, branch: stage };
  }
  return { anchorStageId: stageId, branch: null };
}

/**
 * Visual state of every rail node for one order. Pure function — the rail is a
 * dumb renderer of this output.
 */
export function railStates(params: {
  currentStage: string;
  ctx: StageContext;
  isBlocked: boolean;
  stageEnteredAt: Date;
  completedStageIds: string[];
  now?: Date;
}): { stage: StageDef; state: StageVisualState; skipReason?: string }[] {
  const { currentStage, ctx, isBlocked, stageEnteredAt, completedStageIds } = params;
  const now = params.now ?? new Date();
  const completed = new Set(completedStageIds);
  const { anchorStageId, branch } = resolveRailAnchor(currentStage);
  const blocked = isBlocked || branch !== null;
  const sla = assessSla(anchorStageId, stageEnteredAt, now);

  // Positions are read off this order's own sequence, not the master ladder's.
  // With a phase plan in force the two disagree, and using the master's would
  // paint a phase that has been moved later as already done.
  const ladder = applicableStages(ctx);
  const posOf = new Map(ladder.map((s, i) => [s.id, i]));
  const currentPos = posOf.get(anchorStageId) ?? -1;

  return ladder.map((stage) => {
    const applies = stageApplies(stage, ctx);
    if (!applies) {
      return {
        stage,
        state: 'SKIPPED' as StageVisualState,
        skipReason: phaseCurtailed(ctx, stage.phase)
          ? `Phase ${stage.phase} — ${PHASE_DEFS[stage.phase].label} was taken out of this order's flow, so this step does not happen.`
          : (stage.notApplicableReason?.(ctx) ?? 'Not applicable to this order.'),
      };
    }
    if (stage.id === anchorStageId) {
      if (blocked) return { stage, state: 'BLOCKED' as StageVisualState };
      if (sla.status !== 'ON_TRACK') return { stage, state: 'AT_RISK' as StageVisualState };
      return { stage, state: 'CURRENT' as StageVisualState };
    }
    const pos = posOf.get(stage.id) ?? -1;
    if (completed.has(stage.id) || (currentPos >= 0 && pos >= 0 && pos < currentPos)) {
      return { stage, state: 'COMPLETED' as StageVisualState };
    }
    return { stage, state: 'UPCOMING' as StageVisualState };
  });
}

/** Phase-level rollup for the rail's collapsed view. */
export function phaseProgress(params: {
  currentStage: string;
  ctx: StageContext;
  isBlocked: boolean;
  stageEnteredAt: Date;
  completedStageIds: string[];
}): {
  phase: PhaseDef;
  done: number;
  total: number;
  state: StageVisualState;
  /** True when the plan took this phase out of the flow, as against a stage-level
   *  predicate having emptied it. The two look the same on the rail but mean
   *  different things: one was a decision on this order, the other follows from
   *  what the order is. */
  curtailed: boolean;
}[] {
  const states = railStates(params);
  // Walked in the order's own phase sequence, so the strip reads left to right in
  // the order the work actually happens.
  return contextPhaseOrder(params.ctx).map((pid) => {
    const inPhase = states.filter((s) => s.stage.phase === pid);
    const active = inPhase.filter((s) => s.state !== 'SKIPPED');
    const done = inPhase.filter((s) => s.state === 'COMPLETED').length;
    let state: StageVisualState = 'UPCOMING';
    if (inPhase.some((s) => s.state === 'BLOCKED')) state = 'BLOCKED';
    else if (inPhase.some((s) => s.state === 'AT_RISK')) state = 'AT_RISK';
    else if (inPhase.some((s) => s.state === 'CURRENT')) state = 'CURRENT';
    else if (active.length > 0 && done === active.length) state = 'COMPLETED';
    else if (active.length === 0) state = 'SKIPPED';
    return {
      phase: PHASE_DEFS[pid],
      done,
      total: active.length,
      state,
      curtailed: phaseCurtailed(params.ctx, pid),
    };
  });
}

/** Validate a proposed transition against the ladder. */
export function canTransition(
  from: string,
  to: string,
  ctx: StageContext,
): { ok: true } | { ok: false; reason: string } {
  const fromStage = STAGE_BY_ID[from];
  const toStage = STAGE_BY_ID[to];
  if (!fromStage) return { ok: false, reason: `Unknown current stage "${from}".` };
  if (!toStage) return { ok: false, reason: `Unknown target stage "${to}".` };
  if (!stageApplies(toStage, ctx)) {
    return {
      ok: false,
      reason:
        toStage.notApplicableReason?.(ctx) ??
        `${toStage.label} does not apply to this order.`,
    };
  }
  if (!fromStage.next.includes(to)) {
    // The `next` adjacency in STAGE_DEFS describes the master ladder. When an
    // order has reordered its phases, the legitimate onward step is often NOT in
    // that list — the last stage of C leads into E rather than D if D was moved
    // after E. So a plan makes the order's own sequence the second authority.
    const planned = ctx.phasePlan?.length
      ? applicableStages(ctx).filter((s) => stageApplies(s, ctx))
      : null;
    const fromPos = planned?.findIndex((s) => s.id === from) ?? -1;
    const adjacentUnderPlan = fromPos >= 0 && planned?.[fromPos + 1]?.id === to;
    if (!adjacentUnderPlan) {
      return {
        ok: false,
        reason: `${fromStage.label} cannot advance directly to ${toStage.label}.`,
      };
    }
  }
  return { ok: true };
}

/**
 * The next stage on the happy path, honouring applicability. Used by the demo
 * simulator and the "next action" CTA.
 */
export function nextStageFor(stageId: string, ctx: StageContext): StageDef | null {
  const ladder = applicableStages(ctx).filter((s) => stageApplies(s, ctx));

  // With a phase plan in force, the order's own sequence is the authority — not
  // the master ladder's `next` links, which still point at the standard flow. A
  // reordered order asked "what's next" via those links would be sent back into a
  // phase it has been re-planned to reach later, or into one it no longer runs.
  if (ctx.phasePlan?.length) {
    const idx = ladder.findIndex((s) => s.id === stageId);
    if (idx >= 0) return ladder[idx + 1] ?? null;
    // Off the sequence entirely (exception branch): resume from where it diverged.
    const { anchorStageId } = resolveRailAnchor(stageId);
    const anchorIdx = ladder.findIndex((s) => s.id === anchorStageId);
    return anchorIdx >= 0 ? (ladder[anchorIdx + 1] ?? null) : null;
  }

  const stage = getStage(stageId);
  for (const candidate of stage.next) {
    const next = STAGE_BY_ID[candidate];
    if (!next || next.isExceptionBranch) continue;
    if (stageApplies(next, ctx)) return next;
  }
  // Nothing directly applicable — walk forward down the ladder.
  const idx = ladder.findIndex((s) => s.id === stageId);
  if (idx >= 0 && idx + 1 < ladder.length) return ladder[idx + 1];
  return null;
}
