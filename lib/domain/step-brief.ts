/**
 * Everything a desk needs to know about one step, assembled in one place.
 *
 * A step tile that names only its owner answers the easy question. The ones
 * that matter on a live order are harder and are spread across three other
 * modules: who is actually responsible HERE (which on a moving-goods step is
 * decided by the delivery term, not by the org chart), what paperwork this step
 * PRODUCES, and what paperwork it is WAITING ON from somebody else. A desk that
 * cannot separate the last two chases its own documents.
 *
 * So this module joins the stage ladder, the Incoterm rules and the document
 * flow map into a single brief per step, and answers:
 *
 *   RESPONSIBLE — who owns this step, and why it is them. On the legs and the
 *                 customs steps the "why" is the delivery term in its own
 *                 words, because that is what actually decides it.
 *   CREATES     — the documents produced here, by the party responsible.
 *   RECEIVES    — the documents this step needs FROM someone else, each with
 *                 the party that owes it.
 *   LIABILITY   — on the goods-moving steps, who carries cost and risk.
 *
 * Nothing here reads the database. It is the shape of the step, not its state,
 * so it is a pure function of the stage and the order's context — which is what
 * lets it be tested exhaustively rather than checked by eye on one order.
 */

import { getStage, stageNextActionOwner, stageOwner, type StageContext } from './stages';
import { evidenceFor } from './stage-evidence';
import { docFlowFor } from './document-flow';
import {
  incotermFor,
  responsibilities,
  type IncotermDef,
  type TermParty,
  type TermResponsibility,
} from './incoterms';
import { STAKEHOLDER_META, type Stakeholder } from './enums';

// ─────────────────────────────────────────────────────────────────────────────
// Who is responsible
// ─────────────────────────────────────────────────────────────────────────────

export interface StepResponsibility {
  /**
   * The party who BEARS this step — whose cost it is and who answers for it.
   *
   * Distinct from whoever physically performs it, and the two come apart on
   * exactly the steps that matter. A carrier flies the consignment and a
   * licensed agent signs the customs entry, but on FOB the obligation is ours
   * and on DDP the same two parties are doing the same work for the supplier.
   * Naming the executor as "responsible" would tell a desk that the leg is
   * somebody else's problem on a term where it is entirely theirs.
   */
  entity: Stakeholder;
  /** Their name, as the desks say it. */
  label: string;
  /** Why it is them — the delivery term's own words where the term decides. */
  because: string;
  /** Who physically performs it, when that is not the party bearing it. */
  executedBy?: Stakeholder;
  executedByLabel?: string;
  /**
   * Set on the steps a delivery term governs. Naming the term makes the answer
   * checkable against the contract instead of taken on trust.
   */
  term?: { code: string; side: 'BUY' | 'SELL'; carries: string };
}

/**
 * Which side of the trade a step is governed by, where a term governs it.
 *
 * The import leg and everything at the border read the term we BOUGHT on; the
 * outbound leg reads the one we SOLD on, where the roles invert because on that
 * contract we are the seller. Reading the wrong side inverts every answer, and
 * it is the mistake that puts a desk on a leg somebody else already paid for.
 */
interface TermGoverned {
  side: 'BUY' | 'SELL';
  aspect: 'CARRIAGE' | 'IMPORT' | 'EXPORT';
  /** The desk that carries it when the term puts it on us. */
  ourDesk: Stakeholder;
}

const TERM_GOVERNED: Record<string, TermGoverned> = {
  EXPORT_CLEARED_AT_ORIGIN: { side: 'BUY', aspect: 'EXPORT', ourDesk: 'ONE_BUY_INBOUND' },
  FULL_SHIPMENT_DISPATCHED_BY_SUPPLIER: { side: 'BUY', aspect: 'CARRIAGE', ourDesk: 'ONE_BUY_INBOUND' },
  IN_TRANSIT_INTERNATIONAL: { side: 'BUY', aspect: 'CARRIAGE', ourDesk: 'ONE_BUY_INBOUND' },
  BORDER_ARRIVAL_WHA_ENGAGED: { side: 'BUY', aspect: 'IMPORT', ourDesk: 'ONE_BUY_INBOUND' },
  CUSTOMS_ENTRY_FILED_ICEGATE: { side: 'BUY', aspect: 'IMPORT', ourDesk: 'ONE_BUY_INBOUND' },
  DUTY_ASSESSED_AND_PAID: { side: 'BUY', aspect: 'IMPORT', ourDesk: 'ONE_BUY_FINANCE' },
  CUSTOMS_CLEARED: { side: 'BUY', aspect: 'IMPORT', ourDesk: 'ONE_BUY_INBOUND' },
  GOODS_RECEIVED_INBOUND_AT_1BUY: { side: 'BUY', aspect: 'CARRIAGE', ourDesk: 'ONE_BUY_INBOUND' },
  OUTBOUND_BOOKED: { side: 'SELL', aspect: 'CARRIAGE', ourDesk: 'ONE_BUY_OUTBOUND' },
  OUT_FOR_DELIVERY: { side: 'SELL', aspect: 'CARRIAGE', ourDesk: 'ONE_BUY_OUTBOUND' },
  DELIVERED: { side: 'SELL', aspect: 'CARRIAGE', ourDesk: 'ONE_BUY_OUTBOUND' },
};

/** Whose the aspect is, under a given term. */
function partyFor(def: IncotermDef, aspect: 'CARRIAGE' | 'IMPORT' | 'EXPORT'): TermParty {
  if (aspect === 'CARRIAGE') return def.carriage.party;
  if (aspect === 'IMPORT') return def.importClearance;
  return def.exportClearance;
}

/**
 * Who is responsible for a step, and why.
 *
 * On a term-governed step the answer is derived rather than declared: the
 * ladder's own `owner` says which of our desks handles it, but whether it is
 * OURS AT ALL is the term's decision, and a tile that says "1BUY Inbound" on a
 * CIF import leg is telling a desk to arrange carriage the supplier has already
 * bought.
 */
export function stepResponsibility(
  stageId: string,
  ctx: StageContext,
  incoterms: { buy: string | null; sell: string | null },
): StepResponsibility {
  const stage = getStage(stageId);
  const owner = stageOwner(stage, ctx);
  const governed = TERM_GOVERNED[stageId];

  if (!governed) {
    return {
      entity: owner,
      label: STAKEHOLDER_META[owner].label,
      because: `${stage.label} is ${STAKEHOLDER_META[owner].short}'s step on this flow.`,
    };
  }

  const code = governed.side === 'BUY' ? incoterms.buy : incoterms.sell;
  const def = incotermFor(code);
  if (!def) {
    return {
      entity: owner,
      label: STAKEHOLDER_META[owner].label,
      because: `No delivery term is recorded on the ${governed.side === 'BUY' ? 'purchase' : 'customer'} order, so who carries this step cannot be derived from the contract.`,
    };
  }

  const party = partyFor(def, governed.aspect);
  /*
   * SELLER means the supplier on the buy side and US on the sell side; BUYER
   * means us on the buy side and the customer on the sell side. That inversion
   * is the whole reason this is a function rather than a lookup.
   */
  const ours = governed.side === 'BUY' ? party === 'BUYER' : party === 'SELLER';
  const counterparty: Stakeholder = governed.side === 'BUY' ? 'SUPPLIER' : 'CUSTOMER';
  // Ours means OUR DESK, not the ladder's owner — the ladder names the carrier
  // or the customs agent there, and they perform the step for whoever is
  // bearing it, which on the other term is the counterparty.
  const entity = ours ? governed.ourDesk : counterparty;

  const aspectWord =
    governed.aspect === 'CARRIAGE'
      ? 'the carriage'
      : governed.aspect === 'IMPORT'
        ? 'import clearance and duty'
        : 'export clearance';

  const carries =
    governed.aspect === 'CARRIAGE'
      ? def.carriage.note
      : governed.aspect === 'IMPORT'
        ? `Importer of record is the ${def.importClearance === 'BUYER' ? 'buyer' : 'seller'} under ${def.code}.`
        : `Export clearance sits with the ${def.exportClearance === 'SELLER' ? 'seller' : 'buyer'} under ${def.code}.`;

  return {
    entity,
    label: STAKEHOLDER_META[entity].label,
    // The ladder's owner is the party doing the work — carrier, customs agent —
    // surfaced separately so the tile can name both without conflating them.
    ...(owner !== entity
      ? { executedBy: owner, executedByLabel: STAKEHOLDER_META[owner].label }
      : {}),
    because: ours
      ? `${governed.side === 'BUY' ? 'Bought' : 'Sold'} on ${def.code}, which puts ${aspectWord} on us — so this step is ours.`
      : `${governed.side === 'BUY' ? 'Bought' : 'Sold'} on ${def.code}, which puts ${aspectWord} on ${STAKEHOLDER_META[counterparty].short.toLowerCase()}. We track it; we do not arrange it.`,
    term: { code: def.code, side: governed.side, carries },
  };
}

/**
 * Cost and risk on a step the goods are moving through, or null elsewhere.
 *
 * Only returned where a term actually governs the step — attaching a liability
 * table to "Escrow funded" would be filling space with something true but
 * irrelevant, and a tile that always shows the same block trains people to skip
 * it on the steps where it matters.
 */
export function stepLiability(
  stageId: string,
  incoterms: { buy: string | null; sell: string | null },
): { side: 'BUY' | 'SELL'; code: string; rows: TermResponsibility[] } | null {
  const governed = TERM_GOVERNED[stageId];
  if (!governed) return null;
  const code = governed.side === 'BUY' ? incoterms.buy : incoterms.sell;
  const def = incotermFor(code);
  if (!def) return null;
  return { side: governed.side, code: def.code, rows: responsibilities(def, governed.side) };
}

// ─────────────────────────────────────────────────────────────────────────────
// The paperwork of a step
// ─────────────────────────────────────────────────────────────────────────────

export interface StepDocument {
  /** The evidence gate's id, so filed documents can be matched to it. */
  id: string;
  label: string;
  /** The party answerable for producing it. */
  provider: Stakeholder;
  providerLabel: string;
  /** Parties whose work is blocked without it. */
  requiredBy: Stakeholder[];
  /** What it is needed FOR. */
  why: string;
  required: boolean;
}

/**
 * The documents of a step, split by who makes them.
 *
 * CREATES are produced by the party responsible for the step. RECEIVES arrive
 * from somebody else, and the tile names that somebody — because "the packing
 * list is missing" and "the packing list is missing and the supplier owes it"
 * are different amounts of information, and only the second one can be acted
 * on.
 *
 * Where the flow map has no entry the document still appears, under RECEIVES
 * with an unknown provider. Dropping it would hide a document the gate is
 * genuinely going to ask for.
 */
export function stepDocuments(
  stageId: string,
  responsible: Stakeholder,
): { creates: StepDocument[]; receives: StepDocument[] } {
  const spec = evidenceFor(stageId);
  const creates: StepDocument[] = [];
  const receives: StepDocument[] = [];

  for (const d of spec?.documents ?? []) {
    const flow = docFlowFor(d.id);
    const provider = flow?.provider ?? responsible;
    const doc: StepDocument = {
      id: d.id,
      label: d.label,
      provider,
      providerLabel: STAKEHOLDER_META[provider].label,
      requiredBy: flow?.requiredBy ?? [],
      why: flow?.why ?? 'Filed against this step as evidence that it was completed.',
      required: d.required ?? false,
    };
    if (provider === responsible) creates.push(doc);
    else receives.push(doc);
  }

  return { creates, receives };
}

// ─────────────────────────────────────────────────────────────────────────────
// The whole brief
// ─────────────────────────────────────────────────────────────────────────────

export interface StepBrief {
  stageId: string;
  code: string;
  label: string;
  responsibility: StepResponsibility;
  creates: StepDocument[];
  receives: StepDocument[];
  liability: ReturnType<typeof stepLiability>;
  /** Who has to move once this step is done. */
  nextOwner: Stakeholder;
  nextAction: string;
}

export function stepBrief(
  stageId: string,
  ctx: StageContext,
  incoterms: { buy: string | null; sell: string | null },
): StepBrief {
  const stage = getStage(stageId);
  const responsibility = stepResponsibility(stageId, ctx, incoterms);
  const { creates, receives } = stepDocuments(stageId, responsibility.entity);
  return {
    stageId,
    code: stage.code,
    label: stage.label,
    responsibility,
    creates,
    receives,
    liability: stepLiability(stageId, incoterms),
    nextOwner: stageNextActionOwner(stage, ctx),
    nextAction: stage.nextAction,
  };
}
