/**
 * Who produces each document, and who cannot work without it.
 *
 * WHY THIS IS A MAP AND NOT A COLUMN. `Document.uploadedBy` records who
 * happened to attach the file — often us, filing something a counterparty sent.
 * That is not the same as who is ANSWERABLE for producing it, and it says
 * nothing at all about who is waiting on it. A chased document is chased from
 * the party that owes it to the party that needs it, and neither of those is
 * knowable from an upload record.
 *
 * The practical value is the second column. "The certificate of origin is
 * missing" is a fact; "the certificate of origin is missing and the CHA cannot
 * file the Bill of Entry without it" is a reason to pick up the phone.
 *
 * KEYS ARE NORMALISED because three subsystems name documents differently:
 * the seeded and generated documents use SCREAMING_SNAKE types, the evidence
 * gate uses its own camelCase ids, and approved team deliverables file under
 * their deliverable kind. Rather than force one vocabulary on all three — which
 * would mean a migration for a labelling feature — lookup folds them together.
 */

import type { Stakeholder } from './enums';

export interface DocFlow {
  /** The party answerable for producing it. */
  provider: Stakeholder;
  /** Parties whose work is blocked without it. */
  requiredBy: Stakeholder[];
  /** One line on what it is needed FOR — the reason a chase is justified. */
  why: string;
}

/**
 * The document register of the trade, keyed by normalised document type.
 *
 * Written from the flow rather than from the schema: each entry answers "if
 * this is late, who is stuck and why", which is the question the register
 * exists to make answerable.
 */
const FLOW: Record<string, DocFlow> = {
  // ── Phase A/B: the commercial paper ──────────────────────────────────────
  customer_po: {
    provider: 'CUSTOMER',
    requiredBy: ['ONE_BUY_SOURCING', 'ONE_BUY_FINANCE'],
    why: 'The commitment every other document on this order is raised against.',
  },
  customer_pi: {
    provider: 'ONE_BUY_SOURCING',
    requiredBy: ['CUSTOMER', 'ONE_BUY_FINANCE'],
    why: 'Our priced offer. The customer accepts against it, and it fixes what we may invoice.',
  },
  supplier_po: {
    provider: 'ONE_BUY_SOURCING',
    requiredBy: ['SUPPLIER', 'ONE_BUY_FINANCE'],
    why: 'Our order to the supplier — the document their invoice is reconciled against.',
  },
  supplier_pi: {
    provider: 'SUPPLIER',
    requiredBy: ['ONE_BUY_SOURCING', 'ONE_BUY_FINANCE'],
    why: 'What the supplier is asking to be paid, and the bank details it is paid to.',
  },
  sourcing_terms: {
    provider: 'ONE_BUY_SOURCING',
    requiredBy: ['SUPPLIER', 'ONE_BUY_FINANCE'],
    why: 'The terms frozen before the supplier invoices — anything their invoice adds is a variance.',
  },

  // ── Phase C: money ───────────────────────────────────────────────────────
  escrow_agreement: {
    provider: 'ESCROW',
    // Sourcing too: they negotiated the terms this schedule records, and they
    // are the desk the supplier argues with when a release condition is disputed.
    requiredBy: ['ONE_BUY_FINANCE', 'ONE_BUY_SOURCING', 'SUPPLIER'],
    why: 'The order placed with the provider and the terms it carries — the amount held, the currency, and what has to be true before the supplier is paid.',
  },
  escrow_release: {
    provider: 'ONE_BUY_FINANCE',
    requiredBy: ['ESCROW'],
    why: 'The written authority the escrow provider needs before it moves money to the supplier.',
  },
  release_instruction: {
    provider: 'ONE_BUY_FINANCE',
    requiredBy: ['ESCROW'],
    why: 'The written authority the escrow provider needs before it moves money to the supplier.',
  },

  // ── Phase D: testing ─────────────────────────────────────────────────────
  test_request: {
    provider: 'ONE_BUY_INSPECTION',
    requiredBy: ['WHL', 'SUPPLIER'],
    why: 'Tells the laboratory which parts to test and against what specification.',
  },
  test_report: {
    provider: 'WHL',
    requiredBy: ['ONE_BUY_INSPECTION', 'ONE_BUY_FINANCE', 'CUSTOMER'],
    why: 'The verdict. Final payment to the supplier is gated on it.',
  },
  ncr: {
    provider: 'ONE_BUY_INSPECTION',
    requiredBy: ['SUPPLIER', 'ONE_BUY_SOURCING'],
    why: 'States what failed, so the supplier can answer it and sourcing can decide the route.',
  },

  // ── Phase E: the inbound leg and customs ─────────────────────────────────
  awb_label: {
    provider: 'LOGISTICS',
    requiredBy: ['ONE_BUY_INBOUND', 'CHA'],
    why: 'Tracks the consignment, and the Bill of Entry quotes it.',
  },
  packing_list: {
    provider: 'SUPPLIER',
    // Inspection counts against it and outbound repacks against it.
    requiredBy: ['CHA', 'ONE_BUY_INBOUND', 'ONE_BUY_INSPECTION', 'ONE_BUY_OUTBOUND', 'CUSTOMER'],
    why: 'What is in each carton. Customs assess against it and receiving counts against it.',
  },
  coo: {
    provider: 'SUPPLIER',
    // Inbound as well as the agent: the CHA files the entry, but Inbound is the
    // desk that has to be holding this before the file goes over, and a missing
    // origin certificate is chased by us, not by them.
    requiredBy: ['CHA', 'ONE_BUY_INBOUND'],
    why: 'Country of origin — decides the duty rate and any preferential treatment.',
  },
  boe: {
    provider: 'CHA',
    requiredBy: ['ONE_BUY_FINANCE', 'ONE_BUY_INBOUND'],
    why: 'The customs entry. Duty is assessed on it and the IGST credit is claimed against it.',
  },
  duty_challan: {
    provider: 'CHA',
    requiredBy: ['ONE_BUY_FINANCE'],
    why: 'Proof the duty was paid — required to claim the recoverable portion back.',
  },
  out_of_charge: {
    provider: 'CHA',
    requiredBy: ['ONE_BUY_INBOUND'],
    why: 'Customs releasing the consignment. Nothing moves out of the port without it.',
  },
  import_file: {
    provider: 'ONE_BUY_INBOUND',
    requiredBy: ['ONE_BUY_FINANCE'],
    why: 'The cover summarising how the consignment moved and cleared, with the costs it incurred.',
  },

  // ── Phase F: receipt, inspection, warehouse ──────────────────────────────
  grn: {
    provider: 'ONE_BUY_INBOUND',
    requiredBy: ['ONE_BUY_INSPECTION', 'ONE_BUY_FINANCE'],
    why: 'Confirms what physically arrived. Inspection works from it and payment waits on it.',
  },
  grn_note: {
    provider: 'ONE_BUY_INBOUND',
    requiredBy: ['ONE_BUY_INSPECTION', 'ONE_BUY_FINANCE'],
    why: 'Confirms what physically arrived. Inspection works from it and payment waits on it.',
  },
  inspection_report: {
    provider: 'ONE_BUY_INSPECTION',
    // Outbound may not repack or ship a lot that has not been accepted, so the
    // verdict has to be visible to them and not only to the desk that signed it.
    requiredBy: ['ONE_BUY_FINANCE', 'CUSTOMER', 'ONE_BUY_OUTBOUND'],
    why: 'The acceptance decision. The escrow release rests on it, and nothing is repacked before it.',
  },
  repack_sheet: {
    provider: 'ONE_BUY_INSPECTION',
    requiredBy: ['ONE_BUY_OUTBOUND'],
    why: 'What was relabelled and how it was repacked, so outbound ships what it thinks it is shipping.',
  },

  // ── Phase G: outbound and settlement ─────────────────────────────────────
  delivery_note: {
    provider: 'ONE_BUY_OUTBOUND',
    requiredBy: ['CUSTOMER', 'ONE_BUY_FINANCE'],
    why: 'Travels with the goods and comes back signed — the evidence the invoice rests on.',
  },
  pod: {
    provider: 'LOGISTICS',
    requiredBy: ['ONE_BUY_OUTBOUND', 'ONE_BUY_FINANCE', 'CUSTOMER'],
    why: 'Proof the customer received the goods. Without it a disputed invoice cannot be defended.',
  },
  tax_invoice: {
    provider: 'ONE_BUY_FINANCE',
    // Outbound is on this list because the invoice travels WITH the goods —
    // a consignment that leaves without it is a compliance problem, not a
    // paperwork one, so the desk loading the vehicle has to be able to see it.
    requiredBy: ['CUSTOMER', 'ONE_BUY_OUTBOUND'],
    why: 'What the customer pays against, what they claim input credit on, and what must travel with the consignment.',
  },
  credit_note: {
    provider: 'ONE_BUY_FINANCE',
    requiredBy: ['CUSTOMER'],
    why: 'Adjusts an invoice already issued — the customer needs it to correct their own books.',
  },
  pnl: {
    provider: 'ONE_BUY_FINANCE',
    requiredBy: [],
    why: 'Internal. What the order earned, signed once the customer has settled.',
  },

  /*
   * ── The evidence-gate documents ────────────────────────────────────────
   *
   * These are filed by the stage gate under its own camelCase ids. They were
   * absent here for as long as the register listed everything and the two
   * columns simply showed a dash — a cosmetic gap. The moment the register
   * became a filter, an unmapped type stopped being a dash and became a
   * document nobody could see. Nineteen of the gate's thirty-five ids were in
   * that state; a test below now fails if a new one joins them.
   */
  acceptance: {
    provider: 'CUSTOMER',
    requiredBy: ['ONE_BUY_SOURCING', 'ONE_BUY_FINANCE'],
    why: 'Their written acceptance of our proforma — what lets us commit to the supplier.',
  },
  quotes: {
    provider: 'ONE_BUY_SOURCING',
    requiredBy: ['ONE_BUY_FINANCE'],
    why: 'The comparison behind the supplier choice — what justifies the buy price on the margin.',
  },
  funding_proof: {
    provider: 'ESCROW',
    requiredBy: ['SUPPLIER', 'ONE_BUY_SOURCING', 'ONE_BUY_FINANCE'],
    why: 'The provider confirming the funds are held. The supplier ships against this, not against a promise.',
  },
  remittance: {
    provider: 'ONE_BUY_FINANCE',
    requiredBy: ['SUPPLIER'],
    why: 'Evidence the advance was sent, so the supplier releases the order into production.',
  },
  credit_confirmation: {
    provider: 'SUPPLIER',
    requiredBy: ['ONE_BUY_FINANCE', 'ONE_BUY_SOURCING'],
    why: 'Their written confirmation of the credit line and the days allowed.',
  },
  lab_receipt: {
    provider: 'WHL',
    requiredBy: ['ONE_BUY_INSPECTION'],
    why: 'The laboratory acknowledging what it received, counted against what was sent.',
  },
  scope_confirmation: {
    provider: 'ONE_BUY_INSPECTION',
    requiredBy: ['WHL'],
    why: 'What the laboratory is to test and against which specification — the report is only as good as this.',
  },
  photos: {
    provider: 'ONE_BUY_INSPECTION',
    requiredBy: ['ONE_BUY_SOURCING', 'SUPPLIER'],
    why: 'The condition evidence a claim against the supplier rests on.',
  },
  return_docs: {
    provider: 'WHL',
    requiredBy: ['ONE_BUY_INSPECTION', 'SUPPLIER'],
    why: 'Paperwork covering the tested samples going back, so the quantities reconcile.',
  },
  commercial_invoice: {
    provider: 'SUPPLIER',
    requiredBy: ['CHA', 'ONE_BUY_INBOUND', 'ONE_BUY_FINANCE'],
    why: 'The value customs assess duty on. An entry cannot be filed without it.',
  },
  handover: {
    provider: 'ONE_BUY_INBOUND',
    requiredBy: ['CHA'],
    why: 'Records which originals the agent holds — the answer when an entry stalls for a missing paper.',
  },
  final_remittance: {
    provider: 'ONE_BUY_FINANCE',
    requiredBy: ['SUPPLIER', 'ESCROW'],
    why: 'Evidence the balance reached the supplier, closing the escrow against the order.',
  },

  /*
   * ── Outward Remittance Message ─────────────────────────────────────────
   *
   * Issued by the authorised dealer bank when money actually leaves India for
   * the supplier. It is the bank's own message, not ours — which is why the
   * bank is a party in its own right rather than folded into Finance.
   *
   * WHY IT MATTERS, and it is not filing. Under FEMA the import payment and the
   * import itself have to be reconciled: the AD bank carries every outward
   * remittance in IDPMS and it stays open until the importer supplies the Bill
   * of Entry evidencing goods actually arrived against it. The liability for
   * that closure is 1BUY's, not the bank's and not the supplier's — an
   * unreconciled remittance is our compliance exposure, and a repeat one is how
   * an importer loses the ability to remit at all. So the ORM is the document
   * that pairs with the Bill of Entry, and both desks that hold half of that
   * pair need to see it.
   */
  orm: {
    provider: 'BANK',
    requiredBy: ['ONE_BUY_FINANCE', 'ONE_BUY_INBOUND'],
    why: 'The bank’s message evidencing money sent abroad. It stays open in IDPMS until we produce the Bill of Entry against it — reconciling the two is 1BUY’s obligation, not the bank’s.',
  },
  before_photos: {
    provider: 'ONE_BUY_OUTBOUND',
    requiredBy: ['ONE_BUY_INSPECTION'],
    why: 'The state of the goods as received, before anything was relabelled or repacked.',
  },
  after_photos: {
    provider: 'ONE_BUY_OUTBOUND',
    requiredBy: ['ONE_BUY_INSPECTION', 'CUSTOMER'],
    why: 'What the customer will actually open — the reference if they dispute the packing.',
  },
  eway_bill: {
    provider: 'ONE_BUY_FINANCE',
    requiredBy: ['ONE_BUY_OUTBOUND', 'LOGISTICS'],
    why: 'Goods of this value may not move on Indian roads without it. The carrier is stopped without one.',
  },
  bank_advice: {
    provider: 'ONE_BUY_FINANCE',
    requiredBy: [],
    why: 'The bank confirming the customer’s payment landed — what closes the receivable.',
  },
};

/**
 * Folds the three naming conventions onto one key.
 *
 * The evidence gate's ids are camelCase and mostly match a type once
 * decamelised — `supplierPo` → `supplier_po`. Where an evidence id has no
 * equivalent at all (`signedTerms`), the alias table below carries it, because
 * inventing a document type to make a lookup succeed would put a type in the
 * register that nothing else in the system knows about.
 */
const ALIASES: Record<string, string> = {
  signed_terms: 'sourcing_terms',
  ack: 'supplier_po',
  supplier_pi_doc: 'supplier_pi',
  // The gate names these differently from the seeded types. Same documents.
  outward_remittance_message: 'orm',
  orm_advice: 'orm',
  awb_doc: 'awb_label',
  bill_of_entry: 'boe',
  challan: 'duty_challan',
  grn_doc: 'grn',
};

export function normaliseDocType(raw: string): string {
  const key = raw
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
  return ALIASES[key] ?? key;
}

/** The flow for a document type, or null where we genuinely do not know. */
export function docFlowFor(rawType: string): DocFlow | null {
  return FLOW[normaliseDocType(rawType)] ?? null;
}

/** Every type the map covers — used by a test to catch a typo'd key. */
export const MAPPED_DOC_TYPES = Object.keys(FLOW);

// ═══════════════════════════════════════════════════════════════════════════
// Whose document is it
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Why a document is on a given desk's register.
 *
 * PROVIDES — they are answerable for producing it. If it is missing, the chase
 *            comes TO them.
 * REQUIRES — their work is blocked without it. If it is missing, the chase
 *            goes FROM them.
 *
 * The two are worth separating on screen because they imply opposite actions,
 * and a desk that cannot tell them apart chases its own paperwork.
 */
export type DocRelation = 'PROVIDES' | 'REQUIRES';

export interface DocRelevance {
  relation: DocRelation;
  /** The one-line reason, phrased at the desk reading it. */
  note: string;
}

/**
 * Whether a document belongs on a desk's register, and why — null where it
 * does not concern them at all.
 *
 * A desk that provides AND requires a document is reported as PROVIDES: owing
 * it is the stronger obligation, and it is the one that puts the desk on the
 * hook if it is late.
 *
 * An unmapped type returns null rather than being waved through. Showing a
 * document to every desk because nobody recorded who it is for is how a scoped
 * register quietly stops being scoped — the caller can count what it hid and
 * say so, which is honest, where a silent pass-through is not.
 */
export function docRelevanceFor(rawType: string, team: Stakeholder): DocRelevance | null {
  const flow = docFlowFor(rawType);
  if (!flow) return null;

  if (flow.provider === team) {
    return {
      relation: 'PROVIDES',
      note: flow.requiredBy.length
        ? `Yours to produce. ${flow.why}`
        : `Yours to produce, and yours alone to use. ${flow.why}`,
    };
  }
  if (flow.requiredBy.includes(team)) {
    return { relation: 'REQUIRES', note: `You need this to work. ${flow.why}` };
  }
  return null;
}

/** Whether a document belongs on a desk's register at all. */
export const docConcernsTeam = (rawType: string, team: Stakeholder): boolean =>
  docRelevanceFor(rawType, team) !== null;
