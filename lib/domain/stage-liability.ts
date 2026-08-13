/**
 * WHICH INCOTERM OBLIGATION BELONGS TO WHICH STEP.
 *
 * `responsibilities()` answers "who carries freight, insurance, export and
 * import" for the order as a whole. That is four answers, and showing all four
 * against every step makes the operator find the relevant one themselves — which
 * is the work the screen is supposed to do for them.
 *
 * So each step names only the obligation it actually turns on. Standing at
 * "Duty assessed and paid", the question is who is importer of record; freight
 * and insurance are settled by then and repeating them is noise.
 *
 * Lives in its own module because it is the one place that needs BOTH the ladder
 * and the Incoterm tables. stages.ts already imports incoterms.ts, so putting the
 * mapping in either of them would close a cycle.
 */

import { incotermFor, responsibilities, type TermResponsibility } from './incoterms';
import type { StageContext } from './stages';

/**
 * Responsibility keys each stage depends on, in the order they should read.
 *
 * Only Phase E appears. The other phases are not governed by the Incoterm — the
 * escrow, testing and inspection steps happen the same way on EXW and on DDP —
 * and inventing a liability line for them would imply a link that is not there.
 */
interface Obligation {
  /**
   * BUY reads the term we bought on and names the supplier as seller; SELL reads
   * the term we sold on and names US as seller. Passing the wrong side inverts
   * every party on the row, which is the one mistake here that looks plausible.
   */
  side: 'BUY' | 'SELL';
  keys: string[];
}

const STAGE_OBLIGATIONS: Record<string, Obligation> = {
  // ── Inbound: governed by the term we bought on ───────────────────────────
  EXPORT_CLEARED_AT_ORIGIN: { side: 'BUY', keys: ['exportClearance'] },
  FULL_SHIPMENT_DISPATCHED_BY_SUPPLIER: { side: 'BUY', keys: ['exportClearance', 'carriage'] },
  IN_TRANSIT_INTERNATIONAL: { side: 'BUY', keys: ['carriage', 'insurance'] },
  BORDER_ARRIVAL_WHA_ENGAGED: { side: 'BUY', keys: ['importClearance'] },
  CUSTOMS_ENTRY_FILED_ICEGATE: { side: 'BUY', keys: ['importClearance'] },
  DUTY_ASSESSED_AND_PAID: { side: 'BUY', keys: ['importClearance'] },
  CUSTOMS_CLEARED: { side: 'BUY', keys: ['importClearance'] },
  GOODS_RECEIVED_INBOUND_AT_1BUY: { side: 'BUY', keys: ['carriage'] },

  // ── Outbound: governed by the term we SOLD on ────────────────────────────
  // The repack and readiness steps are our own value-add and are not term
  // governed — the Incoterm starts biting once the goods move.
  OUTBOUND_BOOKED: { side: 'SELL', keys: ['carriage', 'insurance', 'importClearance'] },
  OUT_FOR_DELIVERY: { side: 'SELL', keys: ['carriage'] },
  DELIVERED: { side: 'SELL', keys: ['carriage'] },
};

export interface StageLiability {
  /**
   * Which leg this is. The UI says "Bought FOB" or "Sold DDP" from it — without
   * that word the reader cannot tell which of the two terms they are looking at,
   * and on an order bought FOB and sold DDP they are very different answers.
   */
  side: 'BUY' | 'SELL';
  /** The term this was resolved against, e.g. "FOB". */
  termCode: string;
  /** Plain-English gloss of the term, for readers who do not know the codes. */
  termPlain: string;
  /** Only the obligations this step turns on. Never empty when this is returned. */
  rows: TermResponsibility[];
  /**
   * Where risk passes, stated only on the steps where it is the actual question:
   * dispatch and the international leg. Elsewhere it is trivia.
   *
   * The raw phrase from the term, NOT a sentence. Across the twelve terms these
   * are sometimes a place ("The supplier's premises, before loading") and
   * sometimes a clause ("Once the goods are on board"), so no single sentence
   * template reads correctly for all of them. The caller labels it instead.
   */
  riskNote: string | null;
}

/**
 * The liability to show under one step, or null when the term does not govern it.
 *
 * Returns null rather than an empty shell so the caller can omit the whole
 * disclosure — an expander that opens onto nothing is worse than no expander.
 */
export function stageLiability(stageId: string, ctx: StageContext): StageLiability | null {
  const spec = STAGE_OBLIGATIONS[stageId];
  if (!spec?.keys.length) return null;

  const code = spec.side === 'BUY' ? ctx.incoterms : ctx.sellIncoterms;
  const def = incotermFor(code);
  if (!def) return null;

  const all = responsibilities(def, spec.side);
  const rows = spec.keys
    .map((k) => all.find((r) => r.key === k))
    .filter((r): r is TermResponsibility => Boolean(r));
  if (!rows.length) return null;

  /**
   * Risk is stated only where it is the live question: the moment the goods
   * start moving on each leg, and the moment they arrive on the customer's.
   * Everywhere else it is trivia the reader has to step over.
   */
  const showsRisk =
    stageId === 'FULL_SHIPMENT_DISPATCHED_BY_SUPPLIER' ||
    stageId === 'IN_TRANSIT_INTERNATIONAL' ||
    stageId === 'DELIVERED';

  return {
    side: spec.side,
    termCode: def.code,
    termPlain: def.plainName,
    rows,
    riskNote: showsRisk ? def.riskTransfersAt : null,
  };
}

/**
 * The stage ids this module claims to govern, for the guard in the tests.
 *
 * Exported only so a typo cannot hide: a misspelled key still returns a value
 * from stageLiability(), so nothing fails — the disclosure just never renders
 * on the step it was written for.
 */
export const MAPPED_STAGE_IDS = Object.keys(STAGE_OBLIGATIONS);
