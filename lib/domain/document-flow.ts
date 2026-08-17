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
    requiredBy: ['ONE_BUY_FINANCE', 'SUPPLIER'],
    why: 'The terms the funds are held under, and what releases them.',
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
    requiredBy: ['CHA', 'ONE_BUY_INBOUND', 'CUSTOMER'],
    why: 'What is in each carton. Customs assess against it and receiving counts against it.',
  },
  coo: {
    provider: 'SUPPLIER',
    requiredBy: ['CHA'],
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
    requiredBy: ['ONE_BUY_FINANCE', 'CUSTOMER'],
    why: 'The acceptance decision. The escrow release rests on it.',
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
    requiredBy: ['CUSTOMER'],
    why: 'What the customer pays against, and what they claim their own input credit on.',
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
