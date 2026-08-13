/**
 * DELIVERY TERMS — Incoterms® 2020, read from 1BUY's position in the middle.
 *
 * Every order has TWO sets of delivery terms, and the gap between them is the
 * whole business:
 *
 *   supplier → 1BUY   what we buy on   (usually FOB or CIF)
 *   1BUY → customer   what we sell on  (usually DDP)
 *
 * Everything between the two points is ours to arrange, insure, clear and pay
 * for. Buy FOB and sell DDP and that is: ocean freight, marine insurance, import
 * clearance, Basic Customs Duty, Social Welfare Surcharge, IGST and delivery to
 * the customer's door. Read the codes the wrong way round and the quote is short
 * by the entire cost of the middle.
 *
 * Three things this module exists to answer, per term:
 *   who is responsible   — carriage, insurance, export and import clearance
 *   what it implies      — where delivery happens and where risk actually passes
 *   how to treat it      — which costs land on us, and which are already in the
 *                          price we are quoted
 *
 * India-specific notes are marked and matter: customs value here is CIF-based,
 * so buying FOB means freight and insurance get added to the assessable value
 * before duty is worked out, whether or not we bought them separately.
 */

/** The eleven official Incoterms® 2020 rules, plus one domestic Indian term. */
export const INCOTERMS = [
  'EXW',
  'FCA',
  'FAS',
  'FOB',
  'CFR',
  'CIF',
  'CPT',
  'CIP',
  'DAP',
  'DPU',
  'DDP',
  'FOR',
] as const;
export type IncotermCode = (typeof INCOTERMS)[number];

/** Who carries an obligation. `SHARED` means it genuinely splits. */
export type TermParty = 'SELLER' | 'BUYER' | 'SHARED' | 'NONE';

export interface IncotermDef {
  code: IncotermCode;
  name: string;
  plainName: string;
  /**
   * ANY  — usable for road, rail, air, sea or multimodal
   * SEA  — sea and inland waterway only; wrong for air freight
   * DOM  — not an Incoterm at all; an Indian domestic convention
   */
  mode: 'ANY' | 'SEA' | 'DOM';
  /** Where the seller has done their job. */
  deliveryPoint: string;
  /**
   * Where risk passes from seller to buyer. On the C-terms this is NOT where the
   * seller's cost obligation ends, which is the single most expensive
   * misunderstanding in the list.
   */
  riskTransfersAt: string;
  /** Who arranges and pays the main carriage, and how far. */
  carriage: { party: TermParty; note: string };
  /**
   * Who bears cargo insurance. `mandatory` is true only where the rule itself
   * obliges the seller to buy cover — everywhere else it is a commercial choice,
   * and an uninsured leg is a real exposure rather than a saving.
   */
  insurance: { party: TermParty; mandatory: boolean; note: string };
  exportClearance: TermParty;
  /** Who is importer of record and pays duty and import taxes. */
  importClearance: TermParty;
  /** What the term means in practice, in plain words. */
  implies: string;
  /** The trap, where there is one. Null when the term is unremarkable. */
  watchOut: string | null;
  /** What buying on this term means for us specifically. */
  whenWeBuy: string;
  /** What selling on this term commits us to. */
  whenWeSell: string;
  /**
   * Landed-cost components we should expect to incur ourselves when we buy on
   * this term — keys match lib/tax/landed-cost.ts.
   */
  weExpectToPay: string[];
  /** Components already inside the supplier's quoted price on this term. */
  alreadyInThePrice: string[];
}

const PARTY_LABEL: Record<TermParty, string> = {
  SELLER: 'Supplier',
  BUYER: '1BUY',
  SHARED: 'Split',
  NONE: 'Not applicable',
};

export function partyLabel(p: TermParty): string {
  return PARTY_LABEL[p];
}

/** From the customer's side of the same order, the parties are named differently. */
export function sellSideLabel(p: TermParty): string {
  if (p === 'SELLER') return '1BUY';
  if (p === 'BUYER') return 'Customer';
  return PARTY_LABEL[p];
}

export const INCOTERM_DEFS: Record<IncotermCode, IncotermDef> = {
  EXW: {
    code: 'EXW',
    name: 'Ex Works',
    plainName: 'We collect from their door',
    mode: 'ANY',
    deliveryPoint: "At the supplier's own premises, goods not loaded",
    riskTransfersAt: "The supplier's premises, before loading",
    carriage: { party: 'BUYER', note: 'We arrange and pay everything from their door onwards.' },
    insurance: {
      party: 'BUYER',
      mandatory: false,
      note: 'Nothing is insured unless we insure it. Cover should start at their loading bay.',
    },
    exportClearance: 'BUYER',
    importClearance: 'BUYER',
    implies:
      'The supplier does the least of any term: they make the goods available and nothing more. Loading, export clearance, carriage, insurance, import clearance and duty are all ours.',
    watchOut:
      'We are named as exporter in the supplier\'s country, which we usually cannot be as a foreign entity. In practice most "EXW" deals quietly become FCA, with the supplier handling export clearance. Agree that explicitly rather than discovering it at the port.',
    whenWeBuy:
      'The cheapest headline price and the most work. Every cost from their door is ours and must be in the quote.',
    whenWeSell:
      'The customer collects from us. We would be quoting only the goods — appropriate for a domestic buyer with their own transport, and rare.',
    weExpectToPay: ['freightCost', 'insuranceCost', 'clearanceCost', 'dutyBcd', 'dutySws', 'dutyIgst'],
    alreadyInThePrice: [],
  },

  FCA: {
    code: 'FCA',
    name: 'Free Carrier',
    plainName: 'They hand it to our carrier',
    mode: 'ANY',
    deliveryPoint: 'Handed to the carrier we nominate, at the named place, export cleared',
    riskTransfersAt: 'The moment our nominated carrier takes charge',
    carriage: { party: 'BUYER', note: 'We book the main carriage; they get the goods to it.' },
    insurance: {
      party: 'BUYER',
      mandatory: false,
      note: 'Ours from the handover point. Nothing is covered unless we arrange it.',
    },
    exportClearance: 'SELLER',
    importClearance: 'BUYER',
    implies:
      'The supplier delivers to our carrier and clears the goods for export. We pay the main carriage and everything after it. The workable version of EXW for a cross-border purchase.',
    watchOut:
      'The named place has to be precise. "FCA Penang" and "FCA Penang Airport" put the cost of getting to the airport on different parties.',
    whenWeBuy:
      'Good visibility and control of the freight, and we know the export paperwork is their problem. Freight, insurance, duty and clearance are all ours.',
    whenWeSell:
      'We would deliver to the customer\'s nominated carrier and stop there. Uncommon for us — customers on DDP expect the door.',
    weExpectToPay: ['freightCost', 'insuranceCost', 'clearanceCost', 'dutyBcd', 'dutySws', 'dutyIgst'],
    alreadyInThePrice: [],
  },

  FAS: {
    code: 'FAS',
    name: 'Free Alongside Ship',
    plainName: 'They put it on the quay next to the ship',
    mode: 'SEA',
    deliveryPoint: 'Alongside the vessel at the named port of shipment',
    riskTransfersAt: 'Once placed alongside the ship',
    carriage: { party: 'BUYER', note: 'We book the ocean carriage and pay loading onwards.' },
    insurance: { party: 'BUYER', mandatory: false, note: 'Ours from the quayside.' },
    exportClearance: 'SELLER',
    importClearance: 'BUYER',
    implies:
      'The supplier gets the goods to the quay; loading them onto the vessel is already our cost. Sea and inland waterway only.',
    watchOut:
      'Never use this for air or courier freight — there is no ship to be alongside. For electronics it is almost always the wrong choice; FCA covers the same intent for any mode.',
    whenWeBuy: 'Rare for components. Loading, freight, insurance and all import costs are ours.',
    whenWeSell: 'Not applicable to how we sell.',
    weExpectToPay: ['freightCost', 'insuranceCost', 'clearanceCost', 'dutyBcd', 'dutySws', 'dutyIgst'],
    alreadyInThePrice: [],
  },

  FOB: {
    code: 'FOB',
    name: 'Free On Board',
    plainName: 'They load it onto the ship, then it is ours',
    mode: 'SEA',
    deliveryPoint: 'On board the vessel at the named port of shipment',
    riskTransfersAt: 'Once the goods are on board',
    carriage: {
      party: 'BUYER',
      note: 'We book and pay the ocean freight from the port of shipment.',
    },
    insurance: {
      party: 'BUYER',
      mandatory: false,
      note: 'Ours from the moment it is on board. If we do not buy marine cover, the whole voyage is uninsured.',
    },
    exportClearance: 'SELLER',
    importClearance: 'BUYER',
    implies:
      'The supplier gets the goods loaded and export cleared; from that point the voyage, the insurance, the import clearance and every Indian levy are ours.',
    watchOut:
      'INDIA: customs value is CIF-based, so freight and insurance are added to the FOB price to arrive at the assessable value before duty. If the actual figures cannot be evidenced, Rule 10(2) of the Customs Valuation Rules applies notional amounts — 20% of FOB for freight and 1.125% of FOB for insurance. Buying FOB and failing to insure therefore costs duty on notional insurance we never bought.',
    whenWeBuy:
      'Our most common buying term. Budget for ocean freight, marine insurance, clearance, BCD, SWS and IGST on top of the supplier price.',
    whenWeSell:
      'We would stop at the loading port and the customer would carry the rest. We do not sell this way.',
    weExpectToPay: ['freightCost', 'insuranceCost', 'clearanceCost', 'dutyBcd', 'dutySws', 'dutyIgst'],
    alreadyInThePrice: [],
  },

  CFR: {
    code: 'CFR',
    name: 'Cost and Freight',
    plainName: 'They pay the freight, we carry the risk',
    mode: 'SEA',
    deliveryPoint: 'On board the vessel at the port of shipment',
    riskTransfersAt: 'On board at the port of shipment — NOT at the destination',
    carriage: {
      party: 'SELLER',
      note: 'They pay the ocean freight to the named destination port.',
    },
    insurance: {
      party: 'BUYER',
      mandatory: false,
      note: 'Nobody is obliged to insure. The supplier has no reason to, and the risk is ours the whole way.',
    },
    exportClearance: 'SELLER',
    importClearance: 'BUYER',
    implies:
      'The supplier pays to get the goods to the destination port. But risk passed to us back at the loading port, so a loss at sea is our loss on a voyage they paid for.',
    watchOut:
      'The cost point and the risk point are in different countries. This is the classic Incoterms trap: under CFR an uninsured sinking is entirely our loss even though the freight was on their invoice. Always buy marine cover on a C-term, or negotiate CIF.',
    whenWeBuy:
      'Freight is inside the price, so the landed cost looks lower — but insurance is still ours and must be bought.',
    whenWeSell: 'Not how we sell.',
    weExpectToPay: ['insuranceCost', 'clearanceCost', 'dutyBcd', 'dutySws', 'dutyIgst'],
    alreadyInThePrice: ['freightCost'],
  },

  CIF: {
    code: 'CIF',
    name: 'Cost, Insurance and Freight',
    plainName: 'They pay freight and minimum insurance to the port',
    mode: 'SEA',
    deliveryPoint: 'On board the vessel at the port of shipment',
    riskTransfersAt: 'On board at the port of shipment — NOT at the destination',
    carriage: { party: 'SELLER', note: 'They pay ocean freight to the named destination port.' },
    insurance: {
      party: 'SELLER',
      mandatory: true,
      note: 'They must insure, but only to Institute Cargo Clauses (C) — the narrowest cover — at 110% of the contract value.',
    },
    exportClearance: 'SELLER',
    importClearance: 'BUYER',
    implies:
      'Freight and a minimum level of marine insurance are inside the supplier price. Import clearance, duty and delivery from the port are still ours.',
    watchOut:
      'Clauses (C) is a named-perils cover: it does NOT pay for water damage, theft or handling damage in the ordinary case. For high-value semiconductors that is thin. Either specify Clauses (A) in the contract, or take our own top-up cover. Also note the claim is theirs to make but the loss is ours to bear, which makes recovery slow.',
    whenWeBuy:
      'A tidier single price, and a real but limited insurance benefit. Still budget clearance, BCD, SWS, IGST and inland delivery.',
    whenWeSell: 'Not how we sell.',
    weExpectToPay: ['clearanceCost', 'dutyBcd', 'dutySws', 'dutyIgst'],
    alreadyInThePrice: ['freightCost', 'insuranceCost'],
  },

  CPT: {
    code: 'CPT',
    name: 'Carriage Paid To',
    plainName: 'They pay carriage to a named place, we carry the risk',
    mode: 'ANY',
    deliveryPoint: 'Handed to the first carrier',
    riskTransfersAt: 'At the first carrier — NOT at the named destination',
    carriage: { party: 'SELLER', note: 'They pay carriage all the way to the named place.' },
    insurance: {
      party: 'BUYER',
      mandatory: false,
      note: 'Not required of either party, and the risk is ours from the first carrier.',
    },
    exportClearance: 'SELLER',
    importClearance: 'BUYER',
    implies:
      'The any-mode version of CFR. They pay the carriage to the named place; risk passed to us as soon as the first carrier took the goods.',
    watchOut:
      'Same cost-versus-risk split as CFR, so the same answer: insure it ourselves.',
    whenWeBuy: 'Carriage is in the price. Insurance, clearance and all import levies are ours.',
    whenWeSell: 'Not how we sell.',
    weExpectToPay: ['insuranceCost', 'clearanceCost', 'dutyBcd', 'dutySws', 'dutyIgst'],
    alreadyInThePrice: ['freightCost'],
  },

  CIP: {
    code: 'CIP',
    name: 'Carriage and Insurance Paid To',
    plainName: 'They pay carriage and full insurance to a named place',
    mode: 'ANY',
    deliveryPoint: 'Handed to the first carrier',
    riskTransfersAt: 'At the first carrier — NOT at the named destination',
    carriage: { party: 'SELLER', note: 'They pay carriage to the named place.' },
    insurance: {
      party: 'SELLER',
      mandatory: true,
      note: 'They must insure to Institute Cargo Clauses (A) — all-risks — at 110% of value. This is the widest cover any Incoterm obliges.',
    },
    exportClearance: 'SELLER',
    importClearance: 'BUYER',
    implies:
      'The strongest term for us short of a D-term: carriage and all-risks insurance are the supplier\'s, for any mode of transport. Import clearance and duty remain ours.',
    watchOut:
      'Risk still passes at the first carrier, so we are the ones claiming under a policy someone else bought. Ask for the certificate up front, not after a loss.',
    whenWeBuy:
      'Better than CIF on the same voyage because the cover is all-risks rather than named-perils. Clearance, BCD, SWS and IGST are still ours.',
    whenWeSell: 'Not how we sell.',
    weExpectToPay: ['clearanceCost', 'dutyBcd', 'dutySws', 'dutyIgst'],
    alreadyInThePrice: ['freightCost', 'insuranceCost'],
  },

  DAP: {
    code: 'DAP',
    name: 'Delivered At Place',
    plainName: 'They deliver to the address, we clear customs',
    mode: 'ANY',
    deliveryPoint: 'At the named place, ready for unloading, import duty NOT paid',
    riskTransfersAt: 'At the named place on arrival',
    carriage: { party: 'SELLER', note: 'They pay carriage all the way to the named address.' },
    insurance: {
      party: 'SELLER',
      mandatory: false,
      note: 'Not obliged, but they carry the risk to the door, so they normally insure their own exposure. That policy is theirs, not ours.',
    },
    exportClearance: 'SELLER',
    importClearance: 'BUYER',
    implies:
      'The supplier gets the goods to our address and carries the risk the whole way. We are still the importer of record: clearance, BCD, SWS and IGST are ours.',
    watchOut:
      'The split at the border is the thing to hold on to. DAP means they cannot walk away mid-voyage, but it does not make them the importer — the Bill of Entry is still in our name and the duty is still our cash.',
    whenWeBuy:
      'Low logistics effort, risk with the supplier until arrival. Budget clearance and all Indian levies only.',
    whenWeSell:
      'We deliver to the customer\'s site but they clear and pay duty. Only sensible for a customer who imports in their own name.',
    weExpectToPay: ['clearanceCost', 'dutyBcd', 'dutySws', 'dutyIgst'],
    alreadyInThePrice: ['freightCost', 'insuranceCost'],
  },

  DPU: {
    code: 'DPU',
    name: 'Delivered at Place Unloaded',
    plainName: 'They deliver and unload, we clear customs',
    mode: 'ANY',
    deliveryPoint: 'At the named place, unloaded, import duty NOT paid',
    riskTransfersAt: 'Once unloaded at the named place',
    carriage: { party: 'SELLER', note: 'They pay carriage to the named place and unload.' },
    insurance: {
      party: 'SELLER',
      mandatory: false,
      note: 'Not obliged, but their risk runs until unloading, so they usually cover it.',
    },
    exportClearance: 'SELLER',
    importClearance: 'BUYER',
    implies:
      'DAP plus unloading. The only Incoterm where the seller is responsible for taking the goods off the vehicle.',
    watchOut:
      'Only agree it if the supplier can actually unload at the site — if the address has no dock or forklift, the obligation is theoretical and someone will argue about it on the day.',
    whenWeBuy: 'As DAP, with unloading included. Clearance and all Indian levies are ours.',
    whenWeSell: 'We would deliver and unload; the customer clears. Rare.',
    weExpectToPay: ['clearanceCost', 'dutyBcd', 'dutySws', 'dutyIgst'],
    alreadyInThePrice: ['freightCost', 'insuranceCost'],
  },

  DDP: {
    code: 'DDP',
    name: 'Delivered Duty Paid',
    plainName: 'Everything to the door, duty included',
    mode: 'ANY',
    deliveryPoint: 'At the named place, import cleared and duty paid',
    riskTransfersAt: 'At the named place on arrival',
    carriage: { party: 'SELLER', note: 'They pay carriage all the way to the door.' },
    insurance: {
      party: 'SELLER',
      mandatory: false,
      note: 'Not obliged, but they carry risk to the door, so cover is normally theirs.',
    },
    exportClearance: 'SELLER',
    importClearance: 'SELLER',
    implies:
      'The maximum obligation on the seller: carriage, risk, import clearance and every import tax, delivered to the buyer\'s door. The buyer receives goods and nothing else to do.',
    watchOut:
      'INDIA: a foreign supplier normally cannot be the importer of record without an Indian IEC and GST registration. "DDP" from an overseas supplier therefore usually means they pay a broker while the Bill of Entry is still filed in the Indian buyer\'s name — the duty is recorded against us and the IGST credit accrues to us, whoever actually funded it. Confirm who is on the Bill of Entry before treating the duty as somebody else\'s cost.',
    whenWeBuy:
      'Nothing further to budget — freight, insurance, clearance and duty are all inside the price. Verify the importer-of-record point above before believing it.',
    whenWeSell:
      'How we sell to customers, and the reason the business exists. We absorb freight, insurance, clearance, BCD, SWS and IGST, and the customer sees one delivered price.',
    weExpectToPay: [],
    alreadyInThePrice: ['freightCost', 'insuranceCost', 'clearanceCost', 'dutyBcd', 'dutySws', 'dutyIgst'],
  },

  FOR: {
    code: 'FOR',
    name: 'Free On Road / Rail (Indian domestic convention)',
    plainName: 'Domestic delivery, freight included',
    mode: 'DOM',
    deliveryPoint: "At the buyer's premises within India",
    riskTransfersAt: 'On delivery at the buyer’s premises',
    carriage: { party: 'SELLER', note: 'Freight to our premises is inside the price.' },
    insurance: {
      party: 'SELLER',
      mandatory: false,
      note: 'Transit cover is usually the supplier’s, but it is a matter of contract, not of rule.',
    },
    exportClearance: 'NONE',
    importClearance: 'NONE',
    implies:
      'A domestic Indian term, not an Incoterm. Goods move within India, so there is no import: no Bill of Entry, no BCD, no SWS. GST is charged on the supplier\'s invoice and is creditable to us in the normal way.',
    watchOut:
      'Because it is not an Incoterm it has no agreed definition, so what "FOR" covers varies by supplier. Write the delivery point and who insures transit into the purchase order rather than relying on the abbreviation.',
    whenWeBuy:
      'No customs cost at all. The GST on the supplier invoice is creditable, so it is not part of landed cost — the same rule as import IGST.',
    whenWeSell: 'A domestic sale delivered to the customer. GST applies; no customs.',
    weExpectToPay: [],
    alreadyInThePrice: ['freightCost', 'insuranceCost'],
  },
};

/** Tolerant lookup — the column is a free-form string. */
export function incotermFor(code: string | null | undefined): IncotermDef | null {
  if (!code) return null;
  const key = code.trim().toUpperCase() as IncotermCode;
  return INCOTERM_DEFS[key] ?? null;
}

export interface TermResponsibility {
  key: string;
  label: string;
  /** Who carries it, named from the reader's side of the deal. */
  party: string;
  detail: string;
  /** True when the rule itself compels it, rather than it being negotiable. */
  obligatory?: boolean;
  /** Set when nobody is obliged and the exposure is real. */
  warning?: string | null;
}

/**
 * The four responsibilities, resolved for one side of the order.
 *
 * `side` decides how the parties are named: on the buy side "seller" is the
 * supplier, on the sell side "seller" is us. Getting that wrong would invert
 * every answer, which is why the naming is done here rather than at each call.
 */
export function responsibilities(def: IncotermDef, side: 'BUY' | 'SELL'): TermResponsibility[] {
  const name = side === 'BUY' ? partyLabel : sellSideLabel;
  const domestic = def.mode === 'DOM';

  /**
   * The notes on IncotermDef are written from OUR side of a purchase — "they
   * pay the ocean freight" means the supplier does. Replayed unchanged on the
   * sell side they contradict the party beside them: the row would read
   * "1BUY — they pay carriage all the way to the door", which is two different
   * answers in one line. So the outbound leg gets its own sentence, derived
   * from who carries it rather than from prose authored for the other leg.
   */
  const sellNote = (party: TermParty, kind: 'carriage' | 'insurance') => {
    const ours = party === 'SELLER';
    if (kind === 'carriage') {
      return ours
        ? 'We arrange and pay the carriage to the delivery point. It is inside the price we quoted, not a separate charge.'
        : 'The customer arranges and pays the carriage onward from the delivery point.';
    }
    return ours
      ? 'Ours to carry as far as the delivery point. Where the term does not compel cover, an uninsured leg is our exposure and not the customer’s.'
      : 'The customer’s to arrange, from the point risk passes to them.';
  };

  const rows: TermResponsibility[] = [
    {
      key: 'carriage',
      label: 'Freight & carriage',
      party: name(def.carriage.party),
      detail: side === 'BUY' ? def.carriage.note : sellNote(def.carriage.party, 'carriage'),
    },
    {
      key: 'insurance',
      label: 'Cargo insurance',
      party: name(def.insurance.party),
      detail: side === 'BUY' ? def.insurance.note : sellNote(def.insurance.party, 'insurance'),
      obligatory: def.insurance.mandatory,
      /**
       * The warning belongs on the inbound leg only. On the outbound leg we are
       * the seller carrying the risk to the customer's door, which is a position
       * we chose rather than a gap somebody left. Repeating the same alarm on
       * both cards would make neither of them worth reading.
       */
      warning:
        side === 'BUY' && !def.insurance.mandatory && !domestic
          ? 'No party is obliged to insure under this term. An uninsured leg is an open exposure, not a saving.'
          : null,
    },
  ];

  /**
   * The outbound leg on a delivered term is a domestic movement — the goods are
   * already in India, cleared on the inbound leg. Showing a second "export
   * clearance" against it would invent a customs event that does not happen.
   */
  if (side === 'BUY' && !domestic) {
    rows.push({
      key: 'exportClearance',
      label: 'Export clearance',
      party: name(def.exportClearance),
      detail:
        'Filing the export declaration in the country of despatch and meeting its licensing rules.',
    });
  }

  rows.push({
    key: 'importClearance',
    label: side === 'BUY' ? 'Import clearance & duty' : 'Duty the customer sees',
    party: name(def.importClearance),
    detail:
      domestic
        ? 'Domestic movement — no Bill of Entry, no customs duty.'
        : side === 'BUY'
          ? 'Filing the Bill of Entry as importer of record, and paying Basic Customs Duty, Social Welfare Surcharge and IGST at import.'
          : def.importClearance === 'SELLER'
            ? 'Already cleared and paid on the inbound leg — the customer receives duty-paid goods and files nothing.'
            : 'The customer is importer of record on their own account and pays the duty themselves.',
  });

  return rows;
}

export interface TermGap {
  buy: IncotermDef;
  sell: IncotermDef;
  /**
   * Cost keys that fall to us because we buy on a term that stops short of the
   * one we sell on. This is the middle of the deal, and the part a quote misses.
   */
  oursToCarry: string[];
  /** One-line statement of the exposure between the two terms. */
  summary: string;
  /** True when either leg has nobody obliged to insure it. */
  insuranceGap: boolean;
  insuranceNote: string;
}

const COST_LABEL: Record<string, string> = {
  freightCost: 'Freight',
  insuranceCost: 'Cargo insurance',
  clearanceCost: 'Customs clearance & handling',
  dutyBcd: 'Basic Customs Duty',
  dutySws: 'Social Welfare Surcharge',
  dutyIgst: 'IGST at import',
};

export function costLabel(key: string): string {
  return COST_LABEL[key] ?? key;
}

/**
 * The gap between what we buy on and what we sell on.
 *
 * Anything the supplier does not cover, and the customer does not cover, is
 * ours. Stating it as a list is the point: on FOB in / DDP out that list is six
 * items long and is the entire reason the margin looks the way it does.
 */
export function termGap(buyCode: string, sellCode: string): TermGap | null {
  const buy = incotermFor(buyCode);
  const sell = incotermFor(sellCode);
  if (!buy || !sell) return null;

  // What the customer takes off our hands, versus what the supplier already did.
  const customerCovers = new Set(sell.weExpectToPay);
  const oursToCarry = buy.weExpectToPay.filter((k) => !customerCovers.has(k));

  const insuranceGap = !buy.insurance.mandatory && buy.mode !== 'DOM';

  return {
    buy,
    sell,
    oursToCarry,
    summary:
      oursToCarry.length === 0
        ? `We buy ${buy.code} and sell ${sell.code}, so nothing between the two falls to us — the supplier's price already covers everything the customer expects.`
        // Not lower-cased: BCD, SWS and IGST are acronyms and "igst at import"
        // reads as a typo rather than a levy.
        : `We buy ${buy.code} and sell ${sell.code}. Everything between those two points is ours — ${oursToCarry
            .map(costLabel)
            .join(', ')} — and all of it belongs in the quote before margin is read.`,
    insuranceGap,
    insuranceNote: insuranceGap
      ? `${buy.code} obliges nobody to insure the inbound leg, and we sell ${sell.code} — so we carry the goods to the customer's door on cover we have to arrange ourselves.`
      : `${buy.code} obliges the supplier to insure the inbound leg. Check the certificate covers the value and the perils we need, not just the minimum.`,
  };
}

/**
 * INDIA: what buying on this term means for the customs value.
 *
 * Assessable value is CIF-based whatever we actually bought, so an FOB purchase
 * has freight and insurance added back before duty is worked out. Where the real
 * figures cannot be evidenced, Rule 10(2) of the Customs Valuation Rules 2007
 * substitutes notional amounts, and duty is charged on those.
 */
export interface CustomsValuationNote {
  needsAddBack: boolean;
  notionalFreightPctOfFob: number | null;
  notionalInsurancePctOfFob: number | null;
  note: string;
}

export function customsValuation(def: IncotermDef): CustomsValuationNote {
  if (def.mode === 'DOM') {
    return {
      needsAddBack: false,
      notionalFreightPctOfFob: null,
      notionalInsurancePctOfFob: null,
      note: 'A domestic purchase — there is no import and no customs valuation. GST on the supplier invoice is creditable in the normal way.',
    };
  }
  const freightInPrice = def.alreadyInThePrice.includes('freightCost');
  const insuranceInPrice = def.alreadyInThePrice.includes('insuranceCost');

  if (freightInPrice && insuranceInPrice) {
    return {
      needsAddBack: false,
      notionalFreightPctOfFob: null,
      notionalInsurancePctOfFob: null,
      note: `${def.code} already includes freight and insurance, so the invoice value is effectively the CIF value that duty is assessed on. No add-back is needed — but the invoice must show the freight and insurance separately, or customs may reject the breakdown.`,
    };
  }

  const missing = [
    !freightInPrice ? 'freight' : null,
    !insuranceInPrice ? 'insurance' : null,
  ].filter(Boolean) as string[];

  return {
    needsAddBack: true,
    notionalFreightPctOfFob: freightInPrice ? null : 20,
    notionalInsurancePctOfFob: insuranceInPrice ? null : 1.125,
    note: `Customs value in India is CIF-based, so ${missing.join(' and ')} must be added to the ${def.code} price before duty is worked out. Where the actual amount cannot be evidenced, Rule 10(2) of the Customs Valuation Rules 2007 applies notional figures — ${
      !freightInPrice ? '20% of FOB for freight' : ''
    }${!freightInPrice && !insuranceInPrice ? ' and ' : ''}${
      !insuranceInPrice ? '1.125% of FOB for insurance' : ''
    }. Duty is then charged on that, whether or not we actually bought the cover.`,
  };
}

/** How each import levy is treated in landed cost. Mirrors lib/tax/landed-cost. */
export const LEVY_TREATMENT = [
  {
    key: 'dutyBcd',
    label: 'Basic Customs Duty (BCD)',
    creditable: false,
    treatment: 'A real cost. It is not creditable against GST, so it stays in landed cost and eats margin directly.',
  },
  {
    key: 'dutySws',
    label: 'Social Welfare Surcharge (SWS)',
    creditable: false,
    treatment: 'A real cost, charged at 10% of BCD. Not creditable, so it also stays in landed cost.',
  },
  {
    key: 'dutyIgst',
    label: 'IGST at import',
    creditable: true,
    treatment:
      'NOT a cost. It is recoverable as Input Tax Credit, so including it in landed cost would overstate cost and understate margin on every import.',
  },
  {
    key: 'freightCost',
    label: 'Freight',
    creditable: false,
    treatment:
      'A cost when it is ours to pay. The GST charged on a domestic freight invoice is creditable and is stripped out separately.',
  },
  {
    key: 'insuranceCost',
    label: 'Cargo insurance',
    creditable: false,
    treatment:
      'A cost when it is ours to buy. Note it is added to the customs value regardless, so skipping it does not avoid duty on it.',
  },
  {
    key: 'clearanceCost',
    label: 'Clearance & handling',
    creditable: false,
    treatment: 'A cost. The agent’s GST is creditable and handled with the other creditable taxes.',
  },
] as const;

/**
 * Who actually handles the inbound leg, end to end, under one buy-side term.
 *
 * The phase header used to print a fixed string — "Supplier → Logistics Partner
 * → Customs Agent" — against every order. On a DDP order that is simply untrue:
 * the supplier carries it to our door and no agent of ours is involved. On EXW
 * it understates our exposure, because export clearance at origin is ours before
 * the goods have moved at all.
 *
 * Returned as a chain rather than a sentence because that is how the handover
 * actually reads, and the arrows make the transfer points obvious.
 */
export function inboundChain(code: string | null | undefined): string {
  const def = incotermFor(code);
  if (!def) return 'Supplier → Logistics Partner → Customs Agent';
  if (def.mode === 'DOM') return 'Supplier → our warehouse (domestic, no customs)';

  const links: string[] = [];
  // Export clearance first, because on EXW it happens before anything moves.
  if (def.exportClearance === 'BUYER') links.push('1BUY (export clearance)');
  links.push('Supplier');
  links.push(def.carriage.party === 'BUYER' ? 'Logistics Partner (ours)' : 'Their carrier');
  if (def.importClearance === 'BUYER') links.push('Customs Agent (ours)');
  else links.push('They clear import');
  links.push('our warehouse');
  return links.join(' → ');
}
