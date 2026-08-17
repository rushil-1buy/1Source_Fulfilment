/**
 * What actually happens to a consignment between the supplier's dock and ours.
 *
 * The ladder describes the happy path: dispatched, in transit, entry filed,
 * duty paid, cleared, received. Real inbound legs spend most of their attention
 * on the things BETWEEN those steps — a flight rolled, an appraiser querying
 * the value, an examination ordered, demurrage running, a carton short on
 * arrival. None of those are stages, and treating each as a full exception
 * (which stops the order and demands a route) would stop an order for a
 * two-day flight delay.
 *
 * So this is the third category the platform was missing: an EVENT. Something
 * that happened, that has to be recorded, that usually costs money, and that
 * somebody specific bears — but that does not necessarily stop anything.
 *
 * THE PART WORTH ARGUING WITH IS WHO BEARS IT. Almost every entry here is
 * answered differently depending on the delivery term, and the answer is money.
 * A delay before the named place on FOB is the supplier's problem; the same
 * delay one hour later is ours. Demurrage on DDP is theirs; on FOB it is a cost
 * that lands on our margin. Getting this wrong is not a display bug, it is
 * absorbing somebody else's cost — so the bearer is derived from the term
 * rather than typed by whoever logged the event.
 *
 * Nothing here reads the database. It is the shape of an event, not its
 * occurrence.
 */

import { incotermFor } from './incoterms';
import type { ExceptionType, Stakeholder } from './enums';

/** What an event does to the flow. */
export type EventEffect =
  /** Recorded; the order carries on. Most events are this. */
  | 'RUNS_ALONGSIDE'
  /** The order cannot advance past its current step until it is answered. */
  | 'HOLDS'
  /** Serious enough that it becomes a full exception with routes out. */
  | 'ESCALATES';

/**
 * Which side of the delivery term decides who bears an event.
 *
 * BEFORE_DELIVERY — anything up to the term's named place. The seller's, on
 *                   every term except EXW.
 * CARRIAGE        — the main leg: whoever bought the freight.
 * IMPORT          — clearance, duty and anything the border does: the importer
 *                   of record.
 * ON_ARRIVAL      — at our dock. Ours, whatever the term, but the CLAIM may run
 *                   back to the supplier or the carrier.
 * OURS            — nothing to do with the term.
 */
export type BearerBasis = 'BEFORE_DELIVERY' | 'CARRIAGE' | 'IMPORT' | 'ON_ARRIVAL' | 'OURS';

export interface InboundEventDef {
  id: string;
  label: string;
  /** What it is, in the words a desk would use. */
  what: string;
  /** The stages it can legitimately be raised at. */
  stages: string[];
  effect: EventEffect;
  /** How the bearer is decided. */
  basis: BearerBasis;
  /** What it typically costs us, named rather than quantified. */
  costNote: string;
  /** What the desk has to do about it. */
  action: string;
  /** Evidence that should be filed with it, where there is any. */
  evidence?: string;
  /** The exception it becomes, for the ones that escalate. */
  escalatesTo?: ExceptionType;
  /** True where the clock is running and delay itself costs money. */
  accrues?: boolean;
}

/**
 * The catalogue.
 *
 * Grouped by where on the leg they happen, because that is how a desk thinks
 * about them: things in the air, things at the border, things on the dock.
 */
export const INBOUND_EVENTS: InboundEventDef[] = [
  // ── In transit ───────────────────────────────────────────────────────────
  {
    id: 'DEPARTURE_DELAYED',
    label: 'Departure delayed at origin',
    what: 'The consignment missed its booked departure and is waiting at the origin facility.',
    stages: ['FULL_SHIPMENT_DISPATCHED_BY_SUPPLIER', 'IN_TRANSIT_INTERNATIONAL'],
    effect: 'RUNS_ALONGSIDE',
    basis: 'BEFORE_DELIVERY',
    costNote:
      'No direct charge, but the promised delivery date moves and the customer has to be told before they ask.',
    action: 'Get a revised departure from the carrier and re-promise the customer against it.',
  },
  {
    id: 'ROLLED_TO_LATER_FLIGHT',
    label: 'Rolled to a later flight or vessel',
    what: 'The carrier offloaded the consignment and rebooked it, usually for capacity.',
    stages: ['IN_TRANSIT_INTERNATIONAL'],
    effect: 'RUNS_ALONGSIDE',
    basis: 'CARRIAGE',
    costNote:
      'Usually absorbed by the carrier, but the delay is real and any expedite to recover it is not.',
    action: 'Confirm the new routing and whether the carrier is covering the recovery.',
  },
  {
    id: 'REROUTED',
    label: 'Rerouted via another hub',
    what: 'The consignment is travelling by a different path than booked.',
    stages: ['IN_TRANSIT_INTERNATIONAL'],
    effect: 'RUNS_ALONGSIDE',
    basis: 'CARRIAGE',
    costNote: 'Watch for a changed port of entry — the customs filing follows the goods, not the plan.',
    action: 'Check the port of import on the entry still matches where the goods will land.',
  },
  {
    id: 'SPLIT_CONSIGNMENT',
    label: 'Split across more than one waybill',
    what: 'The supplier or carrier has broken the consignment into separate movements.',
    stages: ['FULL_SHIPMENT_DISPATCHED_BY_SUPPLIER', 'IN_TRANSIT_INTERNATIONAL'],
    effect: 'HOLDS',
    basis: 'CARRIAGE',
    costNote:
      'Each part needs its own entry and attracts its own clearance charges. Two entries against one invoice is a reconciliation the bank will ask about.',
    action:
      'Obtain a waybill and packing list per part, and decide whether to clear the first or wait and clear together.',
    evidence: 'A waybill and packing list for each movement',
  },
  {
    id: 'DAMAGE_IN_TRANSIT',
    label: 'Damage reported in transit',
    what: 'The carrier has reported the consignment damaged before it reached us.',
    stages: ['IN_TRANSIT_INTERNATIONAL', 'BORDER_ARRIVAL_WHA_ENGAGED'],
    effect: 'ESCALATES',
    basis: 'CARRIAGE',
    costNote:
      'Recoverable from the carrier or the cargo policy — but only against a claim raised inside the carrier’s notice period, which is short.',
    action: 'Raise the claim now; the window closes in days, not weeks.',
    evidence: 'Carrier damage report and photographs',
    escalatesTo: 'DAMAGED_INBOUND',
  },
  {
    id: 'CONSIGNMENT_UNTRACED',
    label: 'Consignment untraced',
    what: 'The carrier cannot locate the consignment against its waybill.',
    stages: ['IN_TRANSIT_INTERNATIONAL'],
    effect: 'ESCALATES',
    basis: 'CARRIAGE',
    costNote:
      'A total loss claim is capped by the waybill’s liability limit unless the value was declared for carriage, which it usually is not.',
    action: 'Open a trace with the carrier and put the supplier on notice for a replacement.',
    escalatesTo: 'DELIVERY_FAILURE',
  },

  // ── At the border ────────────────────────────────────────────────────────
  {
    id: 'DOCUMENT_DISCREPANCY',
    label: 'Documents disagree with each other',
    what:
      'The invoice, packing list and waybill do not tell the same story — a quantity, a value or a description differs.',
    stages: ['BORDER_ARRIVAL_WHA_ENGAGED', 'CUSTOMS_ENTRY_FILED_ICEGATE'],
    effect: 'HOLDS',
    basis: 'IMPORT',
    costNote:
      'Nothing directly, but the entry cannot be filed and every day it is not filed is a day of storage.',
    action: 'Get a corrected document from the supplier. Do not file an entry against papers that disagree.',
    evidence: 'The corrected document, and the original it replaces',
    accrues: true,
  },
  {
    id: 'CUSTOMS_QUERY',
    label: 'Query raised by the appraiser',
    what: 'Customs have asked a question on the entry and will not assess until it is answered.',
    stages: ['CUSTOMS_ENTRY_FILED_ICEGATE'],
    effect: 'HOLDS',
    basis: 'IMPORT',
    costNote: 'Storage and detention run while the query is open.',
    action: 'Answer through the agent, in writing, on the file. A verbal answer is not on the record.',
    evidence: 'The query and the reply lodged against the entry',
    escalatesTo: 'CUSTOMS_HOLD',
    accrues: true,
  },
  {
    id: 'EXAMINATION_ORDERED',
    label: 'Physical examination ordered',
    what: 'The consignment has been marked for examination rather than cleared on the documents.',
    stages: ['CUSTOMS_ENTRY_FILED_ICEGATE', 'DUTY_ASSESSED_AND_PAID'],
    effect: 'HOLDS',
    basis: 'IMPORT',
    costNote:
      'Examination charges, handling to and from the shed, and repacking — moisture-barrier bags opened at the port do not reseal themselves.',
    action:
      'Attend the examination through the agent and record the condition the goods were left in. An opened MSL bag is a testing problem later.',
    evidence: 'Examination report',
    accrues: true,
  },
  {
    id: 'CLASSIFICATION_DISPUTE',
    label: 'Classification challenged',
    what: 'Customs disagree with the HS code declared and propose one that attracts a different rate.',
    stages: ['CUSTOMS_ENTRY_FILED_ICEGATE', 'DUTY_ASSESSED_AND_PAID'],
    effect: 'HOLDS',
    basis: 'IMPORT',
    costNote:
      'The duty difference lands on the order, and on every future order for the same part unless it is argued now.',
    action:
      'Decide whether to accept the reclassification or contest it. Accepting quietly sets the precedent for this part.',
    evidence: 'Datasheet or technical write-up supporting the classification',
    escalatesTo: 'CUSTOMS_HOLD',
  },
  {
    id: 'VALUATION_LOADED',
    label: 'Assessable value loaded',
    what:
      'Customs have raised the value they assess duty on above the invoice, usually on a contemporaneous-import comparison.',
    stages: ['DUTY_ASSESSED_AND_PAID'],
    effect: 'HOLDS',
    basis: 'IMPORT',
    costNote:
      'Duty is charged on the loaded value, so the landed cost rises against a price already quoted to the customer.',
    action:
      'Accept and pay under protest, or contest with evidence of the transaction value. Paying without protest gives up the right to argue later.',
    evidence: 'The assessment order showing the loading',
    escalatesTo: 'CUSTOMS_HOLD',
  },
  {
    id: 'LICENCE_HOLD',
    label: 'Held for a licence or compliance requirement',
    what:
      'The goods need a registration or clearance — BIS, WPC, or a restricted-item authorisation — that is not on file.',
    stages: ['BORDER_ARRIVAL_WHA_ENGAGED', 'CUSTOMS_ENTRY_FILED_ICEGATE'],
    effect: 'ESCALATES',
    basis: 'IMPORT',
    costNote:
      'Storage runs, and if the requirement cannot be met the consignment is re-exported or abandoned — the whole buy value.',
    action: 'Establish whether the requirement can be met at all before spending money on storage.',
    escalatesTo: 'CUSTOMS_HOLD',
    accrues: true,
  },
  {
    id: 'DEMURRAGE_ACCRUING',
    label: 'Demurrage or detention accruing',
    what: 'Free time has expired and the port or carrier is charging by the day.',
    stages: [
      'BORDER_ARRIVAL_WHA_ENGAGED',
      'CUSTOMS_ENTRY_FILED_ICEGATE',
      'DUTY_ASSESSED_AND_PAID',
      'CUSTOMS_CLEARED',
    ],
    effect: 'RUNS_ALONGSIDE',
    basis: 'IMPORT',
    costNote:
      'Charged per day per container or per kilo, and it compounds. It is the cost that turns a profitable order into a loss while everyone waits for somebody else.',
    action: 'Record the daily rate and the date free time expired, so the number is known rather than discovered.',
    accrues: true,
  },
  {
    id: 'DUTY_ABOVE_ESTIMATE',
    label: 'Duty assessed above estimate',
    what: 'The assessed duty exceeds what the landed cost was built on.',
    stages: ['DUTY_ASSESSED_AND_PAID'],
    effect: 'RUNS_ALONGSIDE',
    basis: 'IMPORT',
    costNote:
      'Straight off the margin, unless the customer contract allows a duty pass-through — most do not.',
    action: 'Re-run the landed cost and check the order is still above the margin floor.',
    evidence: 'The assessment showing the duty charged',
  },
  {
    id: 'PROVISIONAL_ASSESSMENT',
    label: 'Assessed provisionally against a bond',
    what:
      'Customs have released the goods on a provisional basis pending a final assessment, secured by a bond.',
    stages: ['DUTY_ASSESSED_AND_PAID', 'CUSTOMS_CLEARED'],
    effect: 'RUNS_ALONGSIDE',
    basis: 'IMPORT',
    costNote:
      'The final assessment may demand more duty months later, against an order long since closed and paid out.',
    action:
      'Flag the order as provisionally assessed so its margin is not treated as final until the bond is discharged.',
    evidence: 'Bond and provisional assessment order',
  },
  {
    id: 'DETAINED_OR_SEIZED',
    label: 'Consignment detained or seized',
    what: 'Customs have taken the goods out of circulation pending an investigation.',
    stages: ['CUSTOMS_ENTRY_FILED_ICEGATE', 'DUTY_ASSESSED_AND_PAID', 'CUSTOMS_CLEARED'],
    effect: 'ESCALATES',
    basis: 'IMPORT',
    costNote:
      'Assume the goods are unavailable for this order. Re-source for the customer and treat recovery as a separate matter.',
    action: 'Tell the customer today. A detention that surfaces at the promised delivery date is two failures.',
    escalatesTo: 'CUSTOMS_HOLD',
    accrues: true,
  },

  // ── On our dock ──────────────────────────────────────────────────────────
  {
    id: 'SHORT_RECEIPT',
    label: 'Short against the packing list',
    what: 'Fewer pieces arrived than the packing list declares.',
    stages: ['GOODS_RECEIVED_INBOUND_AT_1BUY'],
    effect: 'ESCALATES',
    basis: 'ON_ARRIVAL',
    costNote:
      'Recoverable from the supplier if the seals were intact, from the carrier if they were not. Which one depends on evidence gathered in the first hour.',
    action:
      'Photograph the seals before opening anything, then count against the list carton by carton.',
    evidence: 'Seal photographs and a counted discrepancy note',
    escalatesTo: 'SHORT_SHIPMENT',
  },
  {
    id: 'EXCESS_RECEIPT',
    label: 'More received than ordered',
    what: 'The consignment holds more than the purchase order called for.',
    stages: ['GOODS_RECEIVED_INBOUND_AT_1BUY'],
    effect: 'HOLDS',
    basis: 'ON_ARRIVAL',
    costNote:
      'Duty was paid on what was declared. An excess is either a supplier error to be returned or a quantity to be invoiced — it is never simply stock.',
    action: 'Decide with sourcing whether to keep and pay for it or return it, before it enters stock.',
    evidence: 'Counted receipt showing the excess',
  },
  {
    id: 'DAMAGE_ON_ARRIVAL',
    label: 'Damage found on arrival',
    what: 'The goods or their packaging are damaged when the cartons are opened.',
    stages: ['GOODS_RECEIVED_INBOUND_AT_1BUY', 'INBOUND_INSPECTION_IN_PROGRESS'],
    effect: 'ESCALATES',
    basis: 'ON_ARRIVAL',
    costNote:
      'The claim runs to the carrier or the cargo policy, and both need the goods kept as found until inspected.',
    action: 'Do not repack. Photograph in place and raise the claim before the carrier’s window closes.',
    evidence: 'Photographs as found, and the delivery receipt noting the damage',
    escalatesTo: 'DAMAGED_INBOUND',
  },
  {
    id: 'WRONG_PARTS',
    label: 'Wrong part received',
    what: 'The part numbers received do not match the order.',
    stages: ['GOODS_RECEIVED_INBOUND_AT_1BUY', 'INBOUND_INSPECTION_IN_PROGRESS'],
    effect: 'ESCALATES',
    basis: 'ON_ARRIVAL',
    costNote:
      'The order cannot be fulfilled from this consignment. Duty has been paid on goods we did not buy, and reclaiming it means re-export.',
    action: 'Quarantine the lot and put the supplier on notice the same day.',
    evidence: 'Photographs of the part marking against the order',
    escalatesTo: 'SHORT_SHIPMENT',
  },
  {
    id: 'MSL_BREACH',
    label: 'Moisture barrier compromised',
    what:
      'The moisture-barrier bag was opened, punctured, or the humidity indicator card reads out of specification.',
    stages: ['GOODS_RECEIVED_INBOUND_AT_1BUY', 'INBOUND_INSPECTION_IN_PROGRESS'],
    effect: 'HOLDS',
    basis: 'ON_ARRIVAL',
    costNote:
      'Baking the parts costs time and shortens their floor life. Shipping them without baking risks popcorning at the customer’s reflow oven, which is a field failure with our name on it.',
    action:
      'Bake to the manufacturer’s schedule and record it, or reject the lot. Do not ship on the assumption it will be fine.',
    evidence: 'Photograph of the indicator card, and the bake record if baked',
  },
  {
    id: 'LATE_AGAINST_PROMISE',
    label: 'Late against the promised date',
    what: 'The consignment arrived after the date given to the customer.',
    stages: ['GOODS_RECEIVED_INBOUND_AT_1BUY'],
    effect: 'RUNS_ALONGSIDE',
    basis: 'OURS',
    costNote:
      'Liquidated damages where the customer contract provides for them, and the relationship where it does not.',
    action: 'Re-promise in writing and check whether the contract carries a penalty clause.',
    escalatesTo: 'SUPPLIER_DELAY',
  },
];

export const inboundEvent = (id: string): InboundEventDef | undefined =>
  INBOUND_EVENTS.find((e) => e.id === id);

/** The events that can legitimately be raised at a given step. */
export const eventsForStage = (stageId: string): InboundEventDef[] =>
  INBOUND_EVENTS.filter((e) => e.stages.includes(stageId));

// ─────────────────────────────────────────────────────────────────────────────
// Who bears it
// ─────────────────────────────────────────────────────────────────────────────

export interface EventBearer {
  /** Who carries the cost. */
  party: Stakeholder;
  label: string;
  /** Why, in the delivery term's own words where the term decides it. */
  because: string;
  /** True where the cost lands on our own margin. */
  ours: boolean;
  /** Set where the cost is ours to pay but recoverable from somebody. */
  recoverableFrom?: Stakeholder;
}

/**
 * Who bears an event, derived from the delivery term rather than typed.
 *
 * This is the whole point of the module. The same event has a different owner
 * on FOB and on DDP, and getting it wrong means quietly absorbing somebody
 * else's cost — which nobody notices until the margin report.
 *
 * ON_ARRIVAL events are always ours to HANDLE, because the goods are on our
 * dock. Whether they are ours to PAY FOR is a separate question, and the answer
 * is the claim: a short delivery under intact seals is the supplier's, one
 * under broken seals is the carrier's. Both are recorded as ours with a
 * recovery route, because an unclaimed recovery is a cost.
 */
export function eventBearer(def: InboundEventDef, buyIncoterms: string): EventBearer {
  const term = incotermFor(buyIncoterms);
  const ours = (because: string, recoverableFrom?: Stakeholder): EventBearer => ({
    party: 'ONE_BUY_INBOUND',
    label: '1BUY',
    because,
    ours: true,
    ...(recoverableFrom ? { recoverableFrom } : {}),
  });
  const theirs = (party: Stakeholder, label: string, because: string): EventBearer => ({
    party,
    label,
    because,
    ours: false,
  });

  if (!term) {
    return ours(
      'No delivery term is recorded on the purchase, so who bears this cannot be derived from the contract. Treat it as ours until the term is established.',
    );
  }

  switch (def.basis) {
    case 'OURS':
      return ours('This one is ours whatever the delivery term says.');

    case 'BEFORE_DELIVERY':
      // Everything up to the named place is the seller's, on every term but EXW.
      return term.code === 'EXW'
        ? ours(`Bought on EXW: the goods are ours from the supplier's door, so this is on us.`)
        : theirs(
            'SUPPLIER',
            'Supplier',
            `Bought on ${term.code}: the supplier has not delivered until ${term.deliveryPoint.toLowerCase()}, so anything before that is theirs.`,
          );

    case 'CARRIAGE':
      return term.carriage.party === 'BUYER'
        ? ours(
            `Bought on ${term.code}: we bought the carriage, so the carrier answers to us and this is ours to chase and to bear.`,
            'LOGISTICS',
          )
        : theirs(
            'SUPPLIER',
            'Supplier',
            `Bought on ${term.code}: ${term.carriage.note} The carriage contract is theirs, so this is too.`,
          );

    case 'IMPORT':
      return term.importClearance === 'BUYER'
        ? ours(
            `Bought on ${term.code}: we are importer of record, so clearance, duty and anything the border does land on us.`,
          )
        : theirs(
            'SUPPLIER',
            'Supplier',
            `Bought on ${term.code}: the supplier is importer of record and clears at their own cost, so this is theirs.`,
          );

    case 'ON_ARRIVAL':
      // Ours to handle. Where the recovery runs depends on the evidence, which
      // is why the note says what to gather rather than naming a party.
      return ours(
        'The goods are on our dock, so this is ours to deal with today. Whether it is ours to PAY for depends on the evidence: intact seals point at the supplier, broken ones at the carrier.',
        'SUPPLIER',
      );
  }
}

/**
 * A one-line summary of an event's consequence, for a list.
 *
 * Composed rather than stored so it cannot fall out of step with the effect and
 * the bearer it summarises.
 */
export function eventSummary(def: InboundEventDef, buyIncoterms: string): string {
  const bearer = eventBearer(def, buyIncoterms);
  const effect =
    def.effect === 'HOLDS'
      ? 'The order does not advance until this is answered.'
      : def.effect === 'ESCALATES'
        ? 'Serious enough to become an exception with routes out.'
        : 'Recorded; the order carries on.';
  const who = bearer.ours ? 'The cost is ours.' : `Borne by ${bearer.label}.`;
  return `${effect} ${who}${def.accrues ? ' The clock is running.' : ''}`;
}

/** Every event that holds the flow, for a gate that needs to know. */
export const holdingEvents = (): string[] =>
  INBOUND_EVENTS.filter((e) => e.effect === 'HOLDS').map((e) => e.id);

// ─────────────────────────────────────────────────────────────────────────────
// What an open event does to the advance gate
// ─────────────────────────────────────────────────────────────────────────────

export interface OpenEventRecord {
  id: string;
  eventId: string;
  stageId: string;
  status: string;
  effect: string;
}

export interface EventBlock {
  /** The refusal, as the gate should state it. */
  message: string;
  detail: string;
  /** The first event in the way, for `blockedBy`. */
  eventId: string;
}

/**
 * Whether an open event stops the order leaving `stageId`.
 *
 * Extracted from the advance gate so the rule can be tested without a database
 * and without driving three dialog steps in a browser. The action calls this
 * and states what it returns; there is no second copy of the condition.
 *
 * Only events raised AT the stage being left can hold it. An open query
 * recorded at the border does not block the warehouse from booking the goods in
 * three steps later — by then it is either resolved or it has become an
 * exception, and holding a step nobody raised it against would be the platform
 * inventing a blocker.
 */
export function eventBlockFor(records: OpenEventRecord[], stageId: string): EventBlock | null {
  const holding = records.filter(
    (r) => r.status === 'OPEN' && r.effect === 'HOLDS' && r.stageId === stageId,
  );
  if (holding.length === 0) return null;

  const names = holding.map((h) => inboundEvent(h.eventId)?.label ?? h.eventId);
  return {
    eventId: holding[0].eventId,
    message:
      holding.length === 1
        ? `${names[0]} is still open on this consignment.`
        : `${holding.length} events are still open on this consignment.`,
    detail: `${names.join(', ')}. ${
      holding.length === 1 ? 'It has to be' : 'They have to be'
    } answered and closed on the Logistics section before the order moves on — this is not our paperwork to waive, it is somebody else holding the goods.`,
  };
}
