/**
 * DHL Express tracking, translated into things this platform can act on.
 *
 * A tracking feed is a stream of two-letter codes against timestamps. On its
 * own that is a log; what an inbound desk needs is the three questions each
 * code answers — has the order moved on, has something gone wrong, and does
 * anybody have to do something about it.
 *
 * So each code maps to:
 *   MEANING  — what it says, in the words a desk uses rather than DHL's.
 *   STAGE    — the step it implies the order has reached, where it implies one.
 *   EVENT    — the inbound event it raises, where it means something went wrong.
 *
 * WHAT THIS IS NOT. It is not a claim to have implemented every code DHL emits.
 * The Express set is large, varies by product and lane, and codes appear that
 * are not in any published list. An unmapped code is therefore recorded as
 * itself and passed through — never guessed at, never silently dropped, and
 * never mistaken for "nothing happened". A tracking history with a gap in it is
 * worse than one with an unexplained line, because only the second one makes
 * somebody look.
 *
 * The stage mapping is deliberately conservative. Tracking says where the
 * consignment is; it does not say our paperwork is done. An arrival scan does
 * not file a customs entry, so it does not advance the order past the step that
 * files one — it advances to the step that WAITS on the entry, and the desk
 * still has to do the work.
 */

import type { InboundEventDef } from './inbound-events';
import { inboundEvent } from './inbound-events';

/** How confident the platform is about a code's meaning. */
export type CodeConfidence =
  /** Documented in the DHL Express status list and stable across lanes. */
  | 'DOCUMENTED'
  /** Seen in the wild and unambiguous, but not in the published list. */
  | 'OBSERVED'
  /** Not recognised. Recorded verbatim, acted on by nobody. */
  | 'UNKNOWN';

export interface DhlCodeMeaning {
  code: string;
  /** Plain reading, in a desk's words. */
  meaning: string;
  confidence: CodeConfidence;
  /**
   * The stage this code implies the consignment has reached.
   *
   * Null where the code says something about the consignment without moving
   * the order — a facility scan is real movement and no change of step.
   */
  impliesStage: string | null;
  /** The inbound event it raises, where the code reports a problem. */
  raisesEvent: string | null;
  /** True for the codes that end the tracking story one way or another. */
  terminal?: boolean;
}

/**
 * The map.
 *
 * Ordered as the consignment experiences them, not alphabetically, so the
 * sequence reads as a journey and a missing rung is visible.
 */
export const DHL_CODES: DhlCodeMeaning[] = [
  // ── Collection ───────────────────────────────────────────────────────────
  {
    code: 'SA',
    meaning: 'Shipment acknowledged — DHL has the booking but not yet the goods.',
    confidence: 'DOCUMENTED',
    impliesStage: null,
    raisesEvent: null,
  },
  {
    code: 'PU',
    meaning: 'Picked up from the shipper.',
    confidence: 'DOCUMENTED',
    // The goods have left the supplier. That IS the dispatch step.
    impliesStage: 'FULL_SHIPMENT_DISPATCHED_BY_SUPPLIER',
    raisesEvent: null,
  },
  {
    code: 'PL',
    meaning: 'Processed at the origin facility and moving through the network.',
    confidence: 'DOCUMENTED',
    impliesStage: null,
    raisesEvent: null,
  },

  // ── Line haul ────────────────────────────────────────────────────────────
  {
    code: 'DF',
    meaning: 'Departed the facility on the next leg.',
    confidence: 'DOCUMENTED',
    impliesStage: 'IN_TRANSIT_INTERNATIONAL',
    raisesEvent: null,
  },
  {
    code: 'AF',
    meaning: 'Arrived at a facility along the route.',
    confidence: 'DOCUMENTED',
    impliesStage: 'IN_TRANSIT_INTERNATIONAL',
    raisesEvent: null,
  },
  {
    code: 'AR',
    meaning: 'Arrival scan at the destination country.',
    confidence: 'DOCUMENTED',
    // At the border, and the file goes to the customs agent.
    impliesStage: 'BORDER_ARRIVAL_WHA_ENGAGED',
    raisesEvent: null,
  },
  {
    code: 'TR',
    meaning: 'In transit between facilities.',
    confidence: 'OBSERVED',
    impliesStage: 'IN_TRANSIT_INTERNATIONAL',
    raisesEvent: null,
  },

  // ── Customs ──────────────────────────────────────────────────────────────
  {
    code: 'CC',
    meaning: 'Customs clearance processing.',
    confidence: 'DOCUMENTED',
    /*
     * Deliberately does NOT advance to "entry filed".
     *
     * DHL processing a clearance is not us filing a Bill of Entry. On a
     * self-cleared consignment our own agent files it, and treating a carrier
     * scan as our filing would tick a step nobody performed and skip the
     * evidence the entry needs.
     */
    impliesStage: null,
    raisesEvent: null,
  },
  {
    code: 'CR',
    meaning: 'Released by customs.',
    confidence: 'DOCUMENTED',
    impliesStage: 'CUSTOMS_CLEARED',
    raisesEvent: null,
  },
  {
    code: 'CD',
    meaning: 'Clearance delayed — customs are holding it.',
    confidence: 'DOCUMENTED',
    impliesStage: null,
    // The clock starts here, which is the part that costs money.
    raisesEvent: 'DEMURRAGE_ACCRUING',
  },
  {
    code: 'CM',
    meaning: 'Customs want more information before they will clear it.',
    confidence: 'OBSERVED',
    impliesStage: null,
    raisesEvent: 'CUSTOMS_QUERY',
  },
  {
    code: 'BR',
    meaning: 'Broker notified — the customs agent has the file.',
    confidence: 'OBSERVED',
    impliesStage: 'BORDER_ARRIVAL_WHA_ENGAGED',
    raisesEvent: null,
  },

  // ── Delivery ─────────────────────────────────────────────────────────────
  {
    code: 'WC',
    meaning: 'With the delivery courier, out for delivery.',
    confidence: 'DOCUMENTED',
    impliesStage: null,
    raisesEvent: null,
  },
  {
    code: 'OK',
    meaning: 'Delivered to the consignee and signed for.',
    confidence: 'DOCUMENTED',
    // Delivered to OUR dock on the import leg. The goods are in.
    impliesStage: 'GOODS_RECEIVED_INBOUND_AT_1BUY',
    raisesEvent: null,
    terminal: true,
  },

  // ── Things going wrong ───────────────────────────────────────────────────
  {
    code: 'HL',
    meaning: 'On hold at a DHL facility — not moving, and the clock is running.',
    confidence: 'DOCUMENTED',
    impliesStage: null,
    raisesEvent: 'DEMURRAGE_ACCRUING',
  },
  {
    code: 'MC',
    meaning: 'Delivery attempted, nobody available.',
    confidence: 'OBSERVED',
    impliesStage: null,
    raisesEvent: null,
  },
  {
    code: 'BA',
    meaning: 'Bad address — DHL cannot deliver to what is on the waybill.',
    confidence: 'OBSERVED',
    impliesStage: null,
    raisesEvent: 'DOCUMENT_DISCREPANCY',
  },
  {
    code: 'TD',
    meaning: 'Damage reported in transit.',
    confidence: 'OBSERVED',
    impliesStage: null,
    raisesEvent: 'DAMAGE_IN_TRANSIT',
  },
  {
    code: 'UD',
    meaning: 'Undeliverable — DHL cannot complete the delivery.',
    confidence: 'OBSERVED',
    impliesStage: null,
    raisesEvent: 'CONSIGNMENT_UNTRACED',
    terminal: true,
  },
  {
    code: 'RT',
    meaning: 'Being returned to the shipper.',
    confidence: 'OBSERVED',
    impliesStage: null,
    raisesEvent: 'CONSIGNMENT_UNTRACED',
    terminal: true,
  },
];

const BY_CODE = new Map(DHL_CODES.map((c) => [c.code, c]));

/**
 * What a DHL code means to us.
 *
 * An unrecognised code returns an UNKNOWN meaning rather than null, so a caller
 * cannot accidentally treat "we do not know" as "nothing happened". The event
 * still gets recorded on the consignment; it simply moves nothing and raises
 * nothing on its own.
 */
export function dhlCode(code: string): DhlCodeMeaning {
  const known = BY_CODE.get(code.toUpperCase());
  if (known) return known;
  return {
    code: code.toUpperCase(),
    meaning: `DHL reported "${code}", which this platform does not recognise. Recorded as it came; check the tracking page before acting on it.`,
    confidence: 'UNKNOWN',
    impliesStage: null,
    raisesEvent: null,
  };
}

/** The inbound event a code raises, resolved to its definition. */
export function eventForCode(code: string): InboundEventDef | null {
  const id = dhlCode(code).raisesEvent;
  return id ? (inboundEvent(id) ?? null) : null;
}

export interface DhlEvent {
  code: string;
  timestamp: string;
  description: string;
  location: string;
}

export interface TrackingReading {
  /** The furthest stage the tracking implies, or null if none does. */
  impliedStage: string | null;
  /** Inbound events the feed calls for, deduplicated. */
  events: string[];
  /** Codes we do not recognise, so they can be surfaced rather than buried. */
  unrecognised: string[];
  /** True once a terminal code has been seen. */
  finished: boolean;
}

/**
 * Reads a whole tracking feed and says what it implies.
 *
 * Takes the LAST stage-implying code rather than the highest, because a
 * consignment genuinely moves backwards — a shipment returned to origin is
 * not still "arrived at destination", and taking the furthest-along code would
 * report a consignment as delivered after it had been sent back.
 */
export function readTracking(events: DhlEvent[], ladder: string[]): TrackingReading {
  const ordered = [...events].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  let impliedStage: string | null = null;
  const raised = new Set<string>();
  const unrecognised: string[] = [];
  let finished = false;

  for (const e of ordered) {
    const m = dhlCode(e.code);
    if (m.confidence === 'UNKNOWN') {
      unrecognised.push(m.code);
      continue;
    }
    if (m.impliesStage && ladder.includes(m.impliesStage)) impliedStage = m.impliesStage;
    if (m.raisesEvent) raised.add(m.raisesEvent);
    if (m.terminal) finished = true;
  }

  return { impliedStage, events: [...raised], unrecognised, finished };
}

/**
 * Whether the implied stage is actually ahead of where the order stands.
 *
 * Tracking can only ever move an order FORWARD. A late-arriving scan for a step
 * already passed must not drag the order back, which is what a naive "set the
 * stage to whatever tracking says" would do on any out-of-order feed.
 */
export function stagesToAdvance(
  ladder: string[],
  currentStage: string,
  impliedStage: string | null,
): string[] {
  if (!impliedStage) return [];
  const from = ladder.indexOf(currentStage);
  const to = ladder.indexOf(impliedStage);
  if (from < 0 || to <= from) return [];
  return ladder.slice(from + 1, to + 1);
}
