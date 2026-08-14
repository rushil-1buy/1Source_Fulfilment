/**
 * The documents each internal team is answerable for producing.
 *
 * THE SHAPE OF THE IDEA. A team's job on an order is not only to move it along
 * the ladder; it is to produce the paperwork that proves what happened. Finance
 * owes a P&L, inspection owes a report, outbound owes a packing list. Those
 * were previously things somebody typed up outside the platform, which meant
 * the order and the document could disagree and nobody would know.
 *
 * So the system drafts them, from the order's own data, at the point the
 * figures become real — and then STOPS, and waits for a person.
 *
 * WHY A DRAFT AND NOT A FILING. A generated document is a proposal about facts,
 * and some of those facts the system cannot know: whether an inspector accepted
 * a marginal reading, whether a freight quote was superseded by a call. Filing
 * automatically would put the system's guess into the audit trail wearing a
 * human's authority. Every deliverable therefore goes DRAFT → reviewed → and
 * only then APPROVED, and the checks below are what the reviewer is shown
 * before they commit.
 */

import type { Stakeholder } from '@/lib/domain/enums';

export const DELIVERABLE_KINDS = [
  'PNL',
  'ESCROW_RELEASE',
  'SOURCING_TERMS',
  'IMPORT_FILE',
  'INSPECTION_REPORT',
  'GRN_NOTE',
  'PACKING_LIST',
  'DELIVERY_NOTE',
] as const;

export type DeliverableKind = (typeof DELIVERABLE_KINDS)[number];

/**
 * SUPERSEDED rather than deleted.
 *
 * A later stage can make an approved P&L wrong — duty lands, freight is
 * re-quoted — and the honest response is a new version, not an edit to the one
 * somebody already signed. The old one stays readable so the change is visible.
 */
export type DeliverableStatus = 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'SUPERSEDED';

export type FieldKind = 'money' | 'number' | 'text' | 'longText' | 'date' | 'boolean';

export interface FieldSpec {
  key: string;
  label: string;
  /** Plain-English mode reads this instead. */
  plainLabel?: string;
  kind: FieldKind;
  /**
   * Computed from other fields and not typed over.
   *
   * A total that can be edited independently of its parts is a total that will
   * eventually disagree with them, and the disagreement will be invisible.
   */
  derived?: boolean;
  /** What this field means, shown under it. Every field has one — no exceptions. */
  help: string;
  section: string;
  /** Blocks approval when empty. */
  required?: boolean;
}

export interface CheckResult {
  key: string;
  label: string;
  /**
   * FAIL blocks approval outright. WARN can be approved over, but only with a
   * written reason — which is the difference between a judgement call and an
   * oversight, and the audit trail should be able to tell them apart.
   */
  status: 'PASS' | 'WARN' | 'FAIL';
  detail: string;
}

export type DeliverableValues = Record<string, string | number | boolean | null>;

/** Everything a generator is allowed to read. Narrowed deliberately: a generator
 *  that can reach the whole Prisma client will eventually query in a loop. */
export interface DeliverableInput {
  orderId: string;
  alias: string;
  soNumber: string | null;
  stage: string;
  stageLabel: string;
  incoterms: string;
  sellIncoterms: string | null;
  paymentMethod: string;
  buyCurrency: string;
  fxRate: number;

  customerName: string;
  customerGstin: string | null;
  customerAddress: string;
  supplierName: string;
  supplierCountry: string | null;

  customerPoNumber: string;
  supplierPoNumber: string;
  customerPiNumber: string | null;
  supplierPiNumber: string | null;

  /** Minor units throughout — see lib/domain/money.ts. */
  sellValue: number;
  buyValue: number;
  landedCost: number;
  creditableTaxes: number;
  nonCreditableLevies: number;
  trueMargin: number;
  trueMarginPct: number;
  marginBeforeCredits: number;
  creditBenefit: number;
  belowFloor: boolean;
  costComponents: { key: string; label: string; amount: number; included: boolean }[];

  lines: {
    mpn: string;
    description: string;
    qty: number;
    uom: string;
    hsnCode: string | null;
    unitSell: number;
    unitBuy: number;
  }[];

  totalQty: number;
  lineCount: number;

  escrowHeld: number;
  escrowReleased: number;

  inspection: {
    verdict: string | null;
    sampleSize: number | null;
    defectsFound: number | null;
    inspectedAt: string | null;
  } | null;

  shipment: {
    carrier: string | null;
    trackingRef: string | null;
    grossWeightKg: number | null;
    packageCount: number | null;
    dispatchedAt: string | null;
  } | null;

  customs: {
    beNumber: string | null;
    beDate: string | null;
    portCode: string | null;
    assessedValue: number | null;
  } | null;

  warehouseLocation: string | null;
  completedStageIds: string[];
  today: string;
}

export interface DeliverableSection {
  key: string;
  label: string;
  note?: string;
}

export interface DeliverableDef {
  kind: DeliverableKind;
  /** Whose liability this document is. */
  team: Stakeholder;
  label: string;
  plainLabel: string;
  /** One sentence: what this document is for and who reads it. */
  purpose: string;
  /**
   * The earliest stage at which the figures mean anything.
   *
   * Drafting a P&L before terms are locked produces a confident document full
   * of placeholders, which is worse than no document — somebody will read it.
   */
  readyFromStage: string;
  /** The stage by which it ought to be approved, used to flag it as overdue. */
  dueByStage: string;
  sections: DeliverableSection[];
  fields: FieldSpec[];
  compute(input: DeliverableInput): DeliverableValues;
  check(values: DeliverableValues, input: DeliverableInput): CheckResult[];
}

/** True when a check set contains anything that must block approval. */
export function hasBlockingFailure(checks: CheckResult[]): boolean {
  return checks.some((c) => c.status === 'FAIL');
}

/** True when approval needs a written reason rather than a bare click. */
export function needsReviewNote(checks: CheckResult[]): boolean {
  return checks.some((c) => c.status === 'WARN');
}
