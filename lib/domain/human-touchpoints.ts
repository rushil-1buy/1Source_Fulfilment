/**
 * Where a real person would be standing, and what the agent did instead.
 *
 * A simulation that runs an order end to end without saying anything about
 * this is quietly making a claim it cannot support: that the whole trade is
 * automatable. It is not. Somebody physically opens the carton. Somebody with
 * a licence signs the customs entry. Somebody in Finance authorises money
 * leaving the company. The demonstration is only honest if it runs THROUGH
 * those steps — a run that stops at the first one shows nothing about the
 * ninety per cent that follows — and NAMES each one as it passes.
 *
 * So this module is the list of the steps the agent is standing in for. It is
 * the thing a reviewer should argue with: if a step is on this list, ask
 * whether the person is really needed; if a step is missing from it, ask what
 * the agent quietly did on its own.
 *
 * FINANCE IS ON THIS LIST, NOT EXEMPTED FROM IT. In the live platform Finance
 * is never autonomous — those steps queue for a person and wait. In the
 * simulation they are passed through, flagged and counted, because a
 * walkthrough that halts at C1 never reaches customs, testing, or delivery. The
 * flag is what keeps the two facts from being confused.
 */

import type { Stakeholder } from './enums';

/**
 * Why the person is there. The kind matters more than the count — "eleven
 * human steps" says nothing, "four of them are somebody physically handling
 * goods" says what could and could not ever be automated.
 */
export type TouchKind =
  /** Money leaving or being committed. Authorisation, not data entry. */
  | 'MONEY'
  /** Somebody's hands on the goods — receiving, counting, inspecting, packing. */
  | 'PHYSICAL'
  /** A licensed filing made under a named person's credentials. */
  | 'REGULATORY'
  /** A commercial decision with consequences: accept, reject, renegotiate. */
  | 'JUDGEMENT'
  /** An external party has to act; no amount of automation on our side moves it. */
  | 'COUNTERPARTY';

export interface HumanTouchpoint {
  kind: TouchKind;
  /** Who it would be, in the words the desk uses. */
  who: string;
  /** What that person would actually do — the specific act, not the stage name. */
  wouldDo: string;
}

export const TOUCH_KIND_LABEL: Record<TouchKind, string> = {
  MONEY: 'Money authorisation',
  PHYSICAL: 'Physical handling',
  REGULATORY: 'Licensed filing',
  JUDGEMENT: 'Commercial judgement',
  COUNTERPARTY: 'External party',
};

/**
 * What each kind means for automation, stated once so the UI does not have to
 * invent a sentence per badge.
 */
export const TOUCH_KIND_NOTE: Record<TouchKind, string> = {
  MONEY:
    'In the live platform this step queues for Finance and waits. It is bypassed here only so the run can reach the steps beyond it.',
  PHYSICAL:
    'No software can do this one. The agent can only record what the person on the floor reports.',
  REGULATORY:
    'Filed under a licensed person’s own credentials. The agent may prepare the entry; it cannot sign it.',
  JUDGEMENT:
    'A decision with commercial consequences. The agent can lay out the options and what each costs; choosing is a person’s.',
  COUNTERPARTY:
    'Waiting on somebody outside 1BUY. The agent chases and records; it cannot act for them.',
};

/**
 * The touchpoints, by stage id.
 *
 * Stages absent from this map are genuinely the agent's: reading mail,
 * reconciling a document against the order, moving the ladder when the
 * evidence is in. Those are the ones worth automating, and the map exists so
 * the difference is visible rather than asserted.
 */
export const HUMAN_TOUCHPOINTS: Record<string, HumanTouchpoint> = {
  // ── A. Demand capture ────────────────────────────────────────────────────
  PI_ISSUED_TO_CUSTOMER: {
    kind: 'JUDGEMENT',
    who: 'Sourcing lead',
    wouldDo:
      'Price the order and commit 1BUY to it. The margin on the proforma is the margin on the trade — it is signed, not calculated.',
  },
  PI_ACCEPTED_BY_CUSTOMER: {
    kind: 'COUNTERPARTY',
    who: 'The customer',
    wouldDo: 'Accept the proforma. Nothing on our side moves this; it arrives when they send it.',
  },

  // ── B. Sourcing & commitment ─────────────────────────────────────────────
  TERMS_LOCKED: {
    kind: 'JUDGEMENT',
    who: 'Sourcing lead',
    wouldDo:
      'Agree the delivery term, the payment method and the lead time with the supplier. These are negotiated, and every downstream liability follows from them.',
  },
  SUPPLIER_PI_RECEIVED: {
    kind: 'COUNTERPARTY',
    who: 'The supplier',
    wouldDo: 'Issue their proforma against our purchase order.',
  },

  // ── C. Financial arming ──────────────────────────────────────────────────
  ESCROW_ACCOUNT_OPENED: {
    kind: 'MONEY',
    who: '1BUY Finance',
    wouldDo:
      'Appoint the escrow provider and open the account. Choosing who holds the money is not a clerical act.',
  },
  ESCROW_FUNDED: {
    kind: 'MONEY',
    who: '1BUY Finance',
    wouldDo:
      'Transfer the agreed amount into escrow, so the provider can confirm the hold to the supplier.',
  },
  ESCROW_PARTIAL_RELEASE_FOR_TESTING: {
    kind: 'MONEY',
    who: '1BUY Finance',
    wouldDo:
      'Release a tranche before goods are received — rare, and only where the terms and conditions provide for it.',
  },
  ADVANCE_PAYMENT_TO_SUPPLIER: {
    kind: 'MONEY',
    who: '1BUY Finance',
    wouldDo: 'Pay the supplier in advance of shipment, against the agreed proforma.',
  },
  CREDIT_TERMS_CONFIRMED: {
    kind: 'COUNTERPARTY',
    who: 'The supplier',
    wouldDo: 'Confirm the credit line and the days allowed.',
  },

  // ── D. Quality assurance ─────────────────────────────────────────────────
  PARTS_RECEIVED_AT_WHL: {
    kind: 'PHYSICAL',
    who: 'Testing laboratory',
    wouldDo: 'Take the parts in, count them and log them against the test request.',
  },
  TESTING_IN_PROGRESS: {
    kind: 'PHYSICAL',
    who: 'Testing laboratory',
    wouldDo: 'Run the electrical and authenticity tests on the bench.',
  },
  TEST_PASSED: {
    kind: 'JUDGEMENT',
    who: 'Testing laboratory',
    wouldDo: 'Sign the certificate. A pass is an opinion a laboratory puts its name to.',
  },
  TEST_FAILED: {
    kind: 'JUDGEMENT',
    who: '1BUY Inspection and Testing',
    wouldDo:
      'Decide what a failure means for this order: reject the lot, accept a concession, re-test a wider sample, or go back to the supplier.',
  },

  // ── E. Logistics & customs ───────────────────────────────────────────────
  FULL_SHIPMENT_DISPATCHED_BY_SUPPLIER: {
    kind: 'COUNTERPARTY',
    who: 'The supplier',
    wouldDo: 'Hand the consignment to the carrier and release the documents.',
  },
  BORDER_ARRIVAL_WHA_ENGAGED: {
    kind: 'COUNTERPARTY',
    who: 'Customs House Agent (CHA)',
    wouldDo: 'Take the file at the port and confirm they hold a complete document set.',
  },
  CUSTOMS_ENTRY_FILED_ICEGATE: {
    kind: 'REGULATORY',
    who: 'Customs House Agent (CHA)',
    wouldDo:
      'File the bill of entry under their own licence. The declaration is a legal statement made by a named person.',
  },
  DUTY_ASSESSED_AND_PAID: {
    kind: 'MONEY',
    who: '1BUY Finance',
    wouldDo: 'Pay the assessed duty to Customs so the consignment can be released.',
  },
  GOODS_RECEIVED_INBOUND_AT_1BUY: {
    kind: 'PHYSICAL',
    who: '1BUY Inbound',
    wouldDo: 'Receive the consignment at the dock, check the cartons and book them in.',
  },

  // ── F. Warehouse ─────────────────────────────────────────────────────────
  INBOUND_INSPECTION_IN_PROGRESS: {
    kind: 'PHYSICAL',
    who: '1BUY Inspection and Testing',
    wouldDo: 'Open the cartons, count against the packing list and check moisture-barrier seals.',
  },
  INSPECTION_PASSED: {
    kind: 'JUDGEMENT',
    who: '1BUY Inspection and Testing',
    wouldDo:
      'Accept the goods. This is the moment 1BUY stops being able to reject them, which is why a person signs it.',
  },
  ESCROW_FINAL_RELEASE_AUTHORISED: {
    kind: 'MONEY',
    who: 'Two different 1BUY Finance approvers',
    wouldDo:
      'Authorise the release of held funds now the goods are received and accepted — and it takes TWO of them, because one person releasing the full balance alone is exactly what that control exists to prevent. The single largest irreversible act in the flow.',
  },
  REBRAND_AND_REPACK_IN_PROGRESS: {
    kind: 'PHYSICAL',
    who: '1BUY Outbound',
    wouldDo: 'Re-label, repack to the customer’s specification and palletise.',
  },
  READY_FOR_OUTBOUND: {
    kind: 'PHYSICAL',
    who: '1BUY Inspection and Testing',
    wouldDo: 'Final check of the packed consignment before it is released to the carrier.',
  },

  // ── G. Outbound ──────────────────────────────────────────────────────────
  OUTBOUND_BOOKED: {
    kind: 'MONEY',
    who: '1BUY Finance',
    wouldDo: 'Raise the tax invoice and generate the IRN and e-way bill against it.',
  },
  DELIVERED: {
    kind: 'COUNTERPARTY',
    who: 'The customer',
    wouldDo:
      'Receive the consignment, check it against the packing list and sign the delivery receipt.',
  },
  CUSTOMER_INVOICED_AND_SETTLED: {
    kind: 'MONEY',
    who: '1BUY Finance',
    wouldDo: 'Reconcile the customer’s payment against the invoice and close the receivable.',
  },
  ORDER_CLOSED: {
    kind: 'MONEY',
    who: '1BUY Finance',
    wouldDo: 'Sign off the final margin and close the order.',
  },
};

/** The touchpoint for a stage, or null where the step is genuinely the agent's. */
export function touchpointFor(stageId: string): HumanTouchpoint | null {
  return HUMAN_TOUCHPOINTS[stageId] ?? null;
}

/** Whether a stage would have required a person. */
export const requiresHuman = (stageId: string): boolean => stageId in HUMAN_TOUCHPOINTS;

/**
 * Counts the touchpoints over a set of stages, by kind.
 *
 * The run summary uses this: "of 34 steps, 11 would have needed a person —
 * 5 physical, 4 money authorisations, 1 licensed filing, 1 judgement" says
 * something a total never could.
 */
export function summariseTouchpoints(stageIds: string[]): {
  total: number;
  byKind: { kind: TouchKind; label: string; count: number }[];
} {
  const counts = new Map<TouchKind, number>();
  for (const id of stageIds) {
    const t = HUMAN_TOUCHPOINTS[id];
    if (t) counts.set(t.kind, (counts.get(t.kind) ?? 0) + 1);
  }
  return {
    total: [...counts.values()].reduce((a, b) => a + b, 0),
    byKind: [...counts.entries()]
      .map(([kind, count]) => ({ kind, label: TOUCH_KIND_LABEL[kind], count }))
      .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind)),
  };
}

/**
 * Teams the agent may act for unsupervised in the LIVE platform.
 *
 * Kept separate from the touchpoint map on purpose: this is the production
 * policy and it does not change because a demonstration wants to keep moving.
 * The simulation reads it to label a step honestly, never to grant itself
 * permission.
 */
export const LIVE_AUTONOMOUS_TEAMS: Stakeholder[] = [
  'ONE_BUY_SOURCING',
  'ONE_BUY_INBOUND',
  'ONE_BUY_INSPECTION',
  'ONE_BUY_OUTBOUND',
];

export const isLiveAutonomous = (t: Stakeholder): boolean => LIVE_AUTONOMOUS_TEAMS.includes(t);
