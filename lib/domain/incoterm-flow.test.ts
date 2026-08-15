/**
 * THE INBOUND LEG IS DERIVED FROM THE TERM WE BOUGHT ON.
 *
 * Before this, every order walked the same seven Phase E stages regardless of
 * Incoterm — which meant the flow rail printed "1BUY" against "Duty assessed and
 * paid" on a DDP order, where the supplier is importer of record and the duty is
 * already inside their price. A stage's owner is a statement about who carries
 * the obligation, so stating it wrongly is worse than not stating it.
 *
 * These tests pin the three shapes that actually differ:
 *   EXW — we clear export at origin, so there is an extra step before dispatch
 *   DDP — the supplier is importer of record, so our customs stages fall away
 *   FOR — a domestic movement, so there is no border and no customs at all
 */

import { describe, expect, it } from 'vitest';
import {
  applicableStages,
  getStage,
  stageApplies,
  stageOwner,
  stageNextActionOwner,
  STAGE_DEFS,
  type StageContext,
} from './stages';
import {
  STAKEHOLDERS,
  STAKEHOLDER_META,
  INTERNAL_STAKEHOLDERS,
  EXTERNAL_STAKEHOLDERS,
  isOneBuy,
} from './enums';
import { inboundChain, incotermGlossary } from './incoterms';
import { stageLiability, MAPPED_STAGE_IDS } from './stage-liability';

const ctx = (incoterms: string, over: Partial<StageContext> = {}): StageContext => ({
  paymentMethod: 'ESCROW',
  testingRequired: false,
  testScope: null,
  incoterms,
  ...over,
});

const ids = (c: StageContext) => applicableStages(c).filter((s) => stageApplies(s, c)).map((s) => s.id);

const EXPORT = 'EXPORT_CLEARED_AT_ORIGIN';
const AGENT = 'BORDER_ARRIVAL_WHA_ENGAGED';
const ENTRY = 'CUSTOMS_ENTRY_FILED_ICEGATE';
const DUTY = 'DUTY_ASSESSED_AND_PAID';
const CLEARED = 'CUSTOMS_CLEARED';
const TRANSIT = 'IN_TRANSIT_INTERNATIONAL';

describe('EXW — the goods are ours at their door', () => {
  it('adds the origin export clearance step, which no other term needs', () => {
    expect(ids(ctx('EXW'))).toContain(EXPORT);
  });

  it('leaves it out of every term where the supplier clears export', () => {
    for (const term of ['FOB', 'CIF', 'CFR', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP', 'FCA', 'FAS']) {
      expect(ids(ctx(term)), term).not.toContain(EXPORT);
    }
  });

  it('still runs the whole import leg — export being ours does not change who imports', () => {
    const flow = ids(ctx('EXW'));
    for (const s of [ENTRY, DUTY, CLEARED]) expect(flow).toContain(s);
  });
});

describe('DDP — the supplier is importer of record', () => {
  const ddp = ctx('DDP');

  it('drops the customs work that is not ours to do', () => {
    const flow = ids(ddp);
    for (const s of [AGENT, ENTRY, DUTY]) expect(flow, s).not.toContain(s);
  });

  it('keeps the release milestone, because it is what lets the goods travel to us', () => {
    expect(ids(ddp)).toContain(CLEARED);
  });

  it('names the supplier against release rather than our customs agent', () => {
    expect(stageOwner(getStage(CLEARED), ddp)).toBe('SUPPLIER');
    expect(stageOwner(getStage(CLEARED), ctx('FOB'))).toBe('CHA');
  });

  it('names the supplier against the international leg they contracted', () => {
    expect(stageOwner(getStage(TRANSIT), ddp)).toBe('SUPPLIER');
  });
});

describe('FOB — the common import shape', () => {
  const fob = ctx('FOB');

  it('runs every customs stage, all of them ours', () => {
    const flow = ids(fob);
    for (const s of [AGENT, ENTRY, DUTY, CLEARED]) expect(flow, s).toContain(s);
  });

  it('names us against the leg we booked', () => {
    expect(stageOwner(getStage(TRANSIT), fob)).toBe('LOGISTICS');
  });
});

describe('FOR — domestic, so there is no border', () => {
  const dom = ctx('FOR');

  it('has no international transit and no customs leg at all', () => {
    const flow = ids(dom);
    for (const s of [TRANSIT, AGENT, ENTRY, DUTY, CLEARED]) expect(flow, s).not.toContain(s);
  });

  it('still dispatches and still receives — the goods do move', () => {
    const flow = ids(dom);
    expect(flow).toContain('FULL_SHIPMENT_DISPATCHED_BY_SUPPLIER');
    expect(flow).toContain('GOODS_RECEIVED_INBOUND_AT_1BUY');
  });

  it('explains itself rather than silently omitting the steps', () => {
    const reason = getStage(ENTRY).notApplicableReason?.(dom) ?? '';
    expect(reason).toMatch(/domestic/i);
  });
});

describe('an unknown term degrades to the common import shape', () => {
  /**
   * A silently emptied Phase E is far worse than a slightly generous one: it
   * would let an order skip the customs gates entirely, with evidence never
   * asked for and duty never recorded.
   */
  it('keeps the full customs leg when the term is not recognised', () => {
    const flow = ids(ctx('NONSENSE'));
    for (const s of [AGENT, ENTRY, DUTY, CLEARED]) expect(flow, s).toContain(s);
  });

  it('does not invent the EXW-only export step', () => {
    expect(ids(ctx('NONSENSE'))).not.toContain(EXPORT);
  });
});

describe('the flow stays walkable on every term', () => {
  /**
   * The regression that matters: a term must never strand an order. Phase E has
   * to have at least a dispatch and a receipt, and every stage in the resolved
   * flow must be one the engine agrees applies.
   */
  it('leaves a dispatch and a receipt on all twelve terms', () => {
    for (const term of ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP', 'FOR']) {
      const flow = ids(ctx(term));
      expect(flow, term).toContain('FULL_SHIPMENT_DISPATCHED_BY_SUPPLIER');
      expect(flow, term).toContain('GOODS_RECEIVED_INBOUND_AT_1BUY');
    }
  });

  it('resolves an owner for every applicable stage on every term', () => {
    for (const term of ['EXW', 'FOB', 'CIF', 'DDP', 'FOR']) {
      const c = ctx(term);
      for (const stage of applicableStages(c)) {
        expect(stageOwner(stage, c), `${term} ${stage.code}`).toBeTruthy();
      }
    }
  });
});

describe('inboundChain — who actually handles the leg', () => {
  /**
   * The phase header used to print one fixed chain against every order. These
   * pin the three shapes where that string was simply untrue.
   */
  it('puts us first on EXW, because export clearance precedes any movement', () => {
    expect(inboundChain('EXW')).toMatch(/^1BUY \(export clearance\)/);
  });

  it('never claims our customs agent on DDP', () => {
    const chain = inboundChain('DDP');
    expect(chain).not.toMatch(/Customs Agent \(ours\)/);
    expect(chain).toMatch(/They clear import/);
  });

  it('says plainly that a domestic order has no customs', () => {
    expect(inboundChain('FOR')).toMatch(/domestic, no customs/);
  });

  it('names our own logistics partner only when we booked the carriage', () => {
    expect(inboundChain('FOB')).toMatch(/Logistics Partner \(ours\)/);
    expect(inboundChain('CIF')).toMatch(/Their carrier/);
  });

  it('falls back to the common import chain on an unknown term', () => {
    expect(inboundChain('NONSENSE')).toBe('Supplier → Logistics Partner → CHA');
    expect(inboundChain(null)).toBe('Supplier → Logistics Partner → CHA');
  });
});

describe('stageLiability — the obligation each step actually turns on', () => {
  it('shows only who clears import on the duty step, not all four obligations', () => {
    const l = stageLiability(DUTY, ctx('FOB'))!;
    expect(l.rows).toHaveLength(1);
    expect(l.rows[0].key).toBe('importClearance');
    expect(l.rows[0].party).toBe('1BUY');
  });

  it('flips that party on DDP, where the supplier is importer of record', () => {
    expect(stageLiability(CLEARED, ctx('DDP'))!.rows[0].party).toBe('Supplier');
    expect(stageLiability(CLEARED, ctx('FOB'))!.rows[0].party).toBe('1BUY');
  });

  it('pairs carriage with insurance on the international leg, where both are live', () => {
    const keys = stageLiability(TRANSIT, ctx('FOB'))!.rows.map((r) => r.key);
    expect(keys).toEqual(['carriage', 'insurance']);
  });

  it('surfaces the uninsured-leg warning where no party is obliged to cover it', () => {
    const ins = stageLiability(TRANSIT, ctx('FOB'))!.rows.find((r) => r.key === 'insurance')!;
    expect(ins.warning).toMatch(/uninsured/i);
  });

  it('states where risk passes on dispatch and transit, and nowhere else', () => {
    expect(stageLiability(TRANSIT, ctx('FOB'))!.riskNote).toBe('Once the goods are on board');
    expect(stageLiability(DUTY, ctx('FOB'))!.riskNote).toBeNull();
  });

  it('returns nothing for steps the Incoterm does not govern', () => {
    for (const id of ['CUSTOMER_PO_RECEIVED', 'ESCROW_FUNDED', 'INSPECTION_PASSED']) {
      expect(stageLiability(id, ctx('FOB')), id).toBeNull();
    }
  });

  it('returns nothing when the term is unrecognised, rather than an empty shell', () => {
    expect(stageLiability(DUTY, ctx('NONSENSE'))).toBeNull();
  });
});

describe('the five 1BUY teams are real, not decorative', () => {
  /**
   * A team defined in the enum but never assigned to a stage is a label nobody
   * can act on — it would show up in the owner picker and in filters while
   * owning no work. This is the guard that catches that.
   */
  it('gives every 1BUY team at least one stage to own', () => {
    const c = ctx('EXW');
    const owners = new Set(applicableStages(c).map((s) => stageOwner(s, c)));
    for (const team of STAKEHOLDERS.filter(isOneBuy)) {
      expect(owners.has(team), `${team} owns nothing`).toBe(true);
    }
  });

  it('puts the Customs Agent steps with Finance, who fund the duty', () => {
    const c = ctx('FOB');
    expect(stageOwner(getStage(DUTY), c)).toBe('ONE_BUY_FINANCE');
  });

  it('hands goods received to inbound and the inspection that follows to Inspection', () => {
    const c = ctx('FOB');
    const received = getStage('GOODS_RECEIVED_INBOUND_AT_1BUY');
    expect(stageOwner(received, c)).toBe('ONE_BUY_INBOUND');
    expect(stageNextActionOwner(received, c)).toBe('ONE_BUY_INSPECTION');
  });

  it('leaves no bare ONE_BUY anywhere in the ladder', () => {
    const c = ctx('EXW');
    for (const s of applicableStages(c)) {
      expect(stageOwner(s, c), s.code).not.toBe('ONE_BUY');
      expect(stageNextActionOwner(s, c), s.code).not.toBe('ONE_BUY');
    }
  });
});

describe('internal vs external is modelled, not guessed from the name', () => {
  it('has exactly the five 1BUY teams inside and the six counterparties outside', () => {
    expect(INTERNAL_STAKEHOLDERS).toEqual([
      'ONE_BUY_SOURCING',
      'ONE_BUY_FINANCE',
      'ONE_BUY_INBOUND',
      'ONE_BUY_OUTBOUND',
      'ONE_BUY_INSPECTION',
    ]);
    expect(EXTERNAL_STAKEHOLDERS).toEqual([
      'CUSTOMER',
      'SUPPLIER',
      'ESCROW',
      'WHL',
      'CHA',
      'LOGISTICS',
    ]);
  });

  it('names 1BUY on every internal team, even in the short form', () => {
    for (const s of INTERNAL_STAKEHOLDERS) {
      expect(STAKEHOLDER_META[s].short, s).toMatch(/^1BUY /);
      expect(STAKEHOLDER_META[s].label, s).toMatch(/^1BUY /);
    }
  });

  it('never claims 1BUY on an outside party', () => {
    for (const s of EXTERNAL_STAKEHOLDERS) {
      expect(STAKEHOLDER_META[s].short, s).not.toMatch(/1BUY/);
      expect(isOneBuy(s), s).toBe(false);
    }
  });

  it('keeps the customs agent outside — it is a counterparty Finance deals with', () => {
    expect(isOneBuy('CHA')).toBe(false);
    expect(EXTERNAL_STAKEHOLDERS).toContain('CHA');
  });
});

describe('the outbound leg reads the term we SOLD on', () => {
  /**
   * The inversion this guards: `responsibilities(def, 'BUY')` names the supplier
   * as seller, `'SELL'` names US. Feeding the outbound steps the buy-side view
   * would put the supplier's name against our own delivery obligations, which
   * looks entirely plausible on screen and is exactly backwards.
   */
  const sold = (sell: string) => ctx('FOB', { sellIncoterms: sell });

  it('resolves outbound against the sell term, not the buy term', () => {
    const l = stageLiability('OUT_FOR_DELIVERY', sold('DDP'))!;
    expect(l.side).toBe('SELL');
    expect(l.termCode).toBe('DDP');
  });

  it('keeps inbound on the buy term even when the two differ', () => {
    const l = stageLiability(DUTY, sold('DDP'))!;
    expect(l.side).toBe('BUY');
    expect(l.termCode).toBe('FOB');
  });

  it('puts the outbound carriage on us when we sell delivered', () => {
    const l = stageLiability('OUT_FOR_DELIVERY', sold('DDP'))!;
    expect(l.rows[0].key).toBe('carriage');
    expect(l.rows[0].party).toBe('1BUY');
  });

  it('puts it on the customer when we sell ex-works', () => {
    const l = stageLiability('OUT_FOR_DELIVERY', sold('EXW'))!;
    expect(l.rows[0].party).toBe('Customer');
  });

  it('states where risk leaves us on delivery', () => {
    expect(stageLiability('DELIVERED', sold('DDP'))!.riskNote).toBeTruthy();
  });

  it('says on the invoice step what duty the customer sees', () => {
    const keys = stageLiability('OUTBOUND_BOOKED', sold('DDP'))!.rows.map((r) => r.key);
    expect(keys).toContain('importClearance');
  });

  it('leaves the repack steps alone — they are our value-add, not a term', () => {
    for (const id of ['REBRAND_AND_REPACK_IN_PROGRESS', 'READY_FOR_OUTBOUND']) {
      expect(stageLiability(id, sold('DDP')), id).toBeNull();
    }
  });
});

describe('the prose agrees with the party beside it', () => {
  /**
   * The bug this pins: IncotermDef's notes are authored from the buy side, so
   * on the sell side the row read "1BUY — they pay carriage all the way to the
   * door". Two different answers in one line, and the wrong one is the sentence
   * people actually read.
   */
  it('never says "they pay" while naming us as the party', () => {
    for (const term of ['EXW', 'FOB', 'CIF', 'DAP', 'DDP', 'FOR']) {
      const l = stageLiability('OUT_FOR_DELIVERY', ctx('FOB', { sellIncoterms: term }));
      if (!l) continue;
      for (const r of l.rows) {
        if (r.party === '1BUY') expect(r.detail, `${term} ${r.key}`).not.toMatch(/\bthey\b/i);
      }
    }
  });

  it('speaks as us when the obligation is ours on the outbound leg', () => {
    const l = stageLiability('OUT_FOR_DELIVERY', ctx('FOB', { sellIncoterms: 'DDP' }))!;
    expect(l.rows[0].detail).toMatch(/^We arrange and pay/);
  });

  it('names the customer when the obligation is theirs', () => {
    const l = stageLiability('OUT_FOR_DELIVERY', ctx('FOB', { sellIncoterms: 'EXW' }))!;
    expect(l.rows[0].detail).toMatch(/^The customer arranges/);
  });

  it('leaves the inbound prose untouched', () => {
    const l = stageLiability(TRANSIT, ctx('FOB'))!;
    expect(l.rows[0].detail).toBe('We book and pay the ocean freight from the port of shipment.');
  });
});

describe('every mapped step is a real step', () => {
  /**
   * A typo in the obligation map is invisible: stageLiability returns a value
   * for the misspelled key, the tests pass, and the disclosure simply never
   * appears on the step it was meant for. This is the guard that catches it —
   * the same class of bug as the orphaned evidence field names.
   */
  it('maps no stage id the ladder does not have', () => {
    const real = new Set(STAGE_DEFS.map((s) => s.id));
    for (const id of MAPPED_STAGE_IDS) {
      expect(real.has(id), `${id} is not a stage`).toBe(true);
    }
  });
});

describe('incotermGlossary — the tooltip explains THIS term', () => {
  /**
   * The glossary's single "incoterms" entry explains what Incoterms are, which
   * is the right answer to "what is this field" and the wrong one to "what does
   * CIF mean for this order" — and it read identically on an EXW order and a
   * DDP one.
   */
  it('names the specific term, not the concept', () => {
    expect(incotermGlossary('CIF')!.term).toBe('CIF — Cost, Insurance and Freight');
    expect(incotermGlossary('EXW')!.term).toBe('EXW — Ex Works');
  });

  it('says something different for every term', () => {
    const seen = new Set(
      ['EXW', 'FOB', 'CIF', 'DAP', 'DDP', 'FOR'].map((c) => incotermGlossary(c)!.whatItIs),
    );
    expect(seen.size).toBe(6);
  });

  it('leads with the trap where the term has one', () => {
    // FOB's is the notional-insurance rule that costs duty on cover never bought.
    expect(incotermGlossary('FOB')!.whyItMatters).toMatch(/Rule 10\(2\)|notional/i);
  });

  it('gives the delivery point and where risk passes as the example', () => {
    const e = incotermGlossary('FOB')!;
    expect(e.example).toMatch(/^Delivered: /);
    expect(e.example).toMatch(/Risk passes: /);
  });

  it('returns null for an unknown code so the caller can fall back', () => {
    expect(incotermGlossary('NONSENSE')).toBeNull();
    expect(incotermGlossary(null)).toBeNull();
  });
});
