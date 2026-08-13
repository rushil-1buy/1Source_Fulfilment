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
  type StageContext,
} from './stages';
import { STAKEHOLDERS, isOneBuy } from './enums';
import { inboundChain } from './incoterms';
import { stageLiability } from './stage-liability';

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
    expect(stageOwner(getStage(CLEARED), ctx('FOB'))).toBe('WHA');
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
    expect(inboundChain('NONSENSE')).toBe('Supplier → Logistics Partner → Customs Agent');
    expect(inboundChain(null)).toBe('Supplier → Logistics Partner → Customs Agent');
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
