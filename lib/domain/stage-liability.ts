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
const STAGE_OBLIGATIONS: Record<string, string[]> = {
  EXPORT_CLEARED_AT_ORIGIN: ['exportClearance'],
  FULL_SHIPMENT_DISPATCHED_BY_SUPPLIER: ['exportClearance', 'carriage'],
  IN_TRANSIT_INTERNATIONAL: ['carriage', 'insurance'],
  BORDER_ARRIVAL_WHA_ENGAGED: ['importClearance'],
  CUSTOMS_ENTRY_FILED_ICEGATE: ['importClearance'],
  DUTY_ASSESSED_AND_PAID: ['importClearance'],
  CUSTOMS_CLEARED: ['importClearance'],
  GOODS_RECEIVED_INBOUND_AT_1BUY: ['carriage'],
};

export interface StageLiability {
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
  const keys = STAGE_OBLIGATIONS[stageId];
  if (!keys?.length) return null;

  const def = incotermFor(ctx.incoterms);
  if (!def) return null;

  const all = responsibilities(def, 'BUY');
  const rows = keys.map((k) => all.find((r) => r.key === k)).filter((r): r is TermResponsibility => Boolean(r));
  if (!rows.length) return null;

  const showsRisk =
    stageId === 'FULL_SHIPMENT_DISPATCHED_BY_SUPPLIER' || stageId === 'IN_TRANSIT_INTERNATIONAL';

  return {
    termCode: def.code,
    termPlain: def.plainName,
    rows,
    riskNote: showsRisk ? def.riskTransfersAt : null,
  };
}
