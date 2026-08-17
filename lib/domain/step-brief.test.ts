import { describe, expect, it } from 'vitest';
import { stepBrief, stepDocuments, stepLiability, stepResponsibility } from './step-brief';
import type { StageContext } from './stages';

/** Bought on FOB (inbound ours), sold on DDP (outbound ours). */
const ctx: StageContext = {
  paymentMethod: 'ESCROW',
  testingRequired: true,
  testScope: 'LOT_SAMPLE',
  incoterms: 'FOB',
};
const FOB_DDP = { buy: 'FOB', sell: 'DDP' };
/** Bought on CIF (inbound theirs), sold on EXW (outbound theirs). */
const CIF_EXW = { buy: 'CIF', sell: 'EXW' };

describe('who is responsible for a step', () => {
  it('names the owning desk on a step no delivery term governs', () => {
    const r = stepResponsibility('WORK_ORDER_ACTIVE', ctx, FOB_DDP);
    expect(r.entity).toBe('ONE_BUY_SOURCING');
    expect(r.term).toBeUndefined();
  });

  it('makes the inbound leg ours on FOB and the supplier’s on CIF', () => {
    // The single most useful thing this module does: on CIF the supplier has
    // already bought the carriage, and telling Inbound to arrange it would have
    // them pay twice for a leg somebody else covered.
    expect(stepResponsibility('IN_TRANSIT_INTERNATIONAL', ctx, FOB_DDP).entity).toBe(
      'ONE_BUY_INBOUND',
    );
    expect(stepResponsibility('IN_TRANSIT_INTERNATIONAL', ctx, CIF_EXW).entity).toBe('SUPPLIER');
  });

  it('reads the SELL term on the outbound leg, where the roles invert', () => {
    // On the customer contract we are the seller, so SELLER means us.
    expect(stepResponsibility('OUT_FOR_DELIVERY', ctx, FOB_DDP).entity).toBe('ONE_BUY_OUTBOUND');
    expect(stepResponsibility('OUT_FOR_DELIVERY', ctx, CIF_EXW).entity).toBe('CUSTOMER');
  });

  it('quotes the term as the reason, so the answer is checkable', () => {
    const r = stepResponsibility('IN_TRANSIT_INTERNATIONAL', ctx, FOB_DDP);
    expect(r.term?.code).toBe('FOB');
    expect(r.term?.side).toBe('BUY');
    expect(r.because).toContain('FOB');
  });

  it('says so plainly when no term is recorded rather than guessing', () => {
    const r = stepResponsibility('IN_TRANSIT_INTERNATIONAL', ctx, { buy: null, sell: null });
    expect(r.because).toMatch(/no delivery term/i);
    expect(r.term).toBeUndefined();
  });

  it('puts import clearance on us when we buy on FOB and on them on DDP', () => {
    expect(stepResponsibility('CUSTOMS_ENTRY_FILED_ICEGATE', ctx, FOB_DDP).entity).toBe(
      'ONE_BUY_INBOUND',
    );
    expect(
      stepResponsibility('CUSTOMS_ENTRY_FILED_ICEGATE', ctx, { buy: 'DDP', sell: 'DDP' }).entity,
    ).toBe('SUPPLIER');
  });

  it('names the executor separately from the party bearing the step', () => {
    /*
     * The two come apart exactly where it matters. On FOB the entry is ours to
     * bear and the licensed agent files it for us; on DDP the same agent files
     * the same entry, for the supplier. Collapsing them would tell a desk the
     * customs position is somebody else's problem on the term where it is
     * entirely theirs.
     */
    const fob = stepResponsibility('CUSTOMS_ENTRY_FILED_ICEGATE', ctx, FOB_DDP);
    expect(fob.entity).toBe('ONE_BUY_INBOUND');
    expect(fob.executedBy).toBe('CHA');

    const transit = stepResponsibility('IN_TRANSIT_INTERNATIONAL', ctx, FOB_DDP);
    expect(transit.entity).toBe('ONE_BUY_INBOUND');
    expect(transit.executedBy).toBe('LOGISTICS');
  });

  it('leaves the executor unset where the bearer performs it themselves', () => {
    expect(stepResponsibility('WORK_ORDER_ACTIVE', ctx, FOB_DDP).executedBy).toBeUndefined();
  });
});

describe('cost and risk on a step', () => {
  it('is offered only where a delivery term governs the step', () => {
    expect(stepLiability('IN_TRANSIT_INTERNATIONAL', FOB_DDP)).not.toBeNull();
    // Attaching a liability table to a money step would be true but irrelevant,
    // and a block that always appears is a block people learn to skip.
    expect(stepLiability('ESCROW_FUNDED', FOB_DDP)).toBeNull();
  });

  it('reads the buy term inbound and the sell term outbound', () => {
    expect(stepLiability('IN_TRANSIT_INTERNATIONAL', FOB_DDP)?.code).toBe('FOB');
    expect(stepLiability('OUT_FOR_DELIVERY', FOB_DDP)?.code).toBe('DDP');
  });

  it('answers with the four responsibilities, not a sentence', () => {
    const rows = stepLiability('IN_TRANSIT_INTERNATIONAL', FOB_DDP)!.rows;
    expect(rows.length).toBeGreaterThan(2);
    for (const r of rows) expect(r.party.length).toBeGreaterThan(0);
  });
});

describe('the paperwork of a step', () => {
  it('splits what we make from what we are waiting on', () => {
    // At the border the agent files the entry and we are waiting on it.
    const { creates, receives } = stepDocuments('CUSTOMS_ENTRY_FILED_ICEGATE', 'CHA');
    expect(creates.length).toBeGreaterThan(0);
    for (const d of creates) expect(d.provider).toBe('CHA');
    for (const d of receives) expect(d.provider).not.toBe('CHA');
  });

  it('names who owes each received document', () => {
    const { receives } = stepDocuments('GOODS_RECEIVED_INBOUND_AT_1BUY', 'ONE_BUY_INBOUND');
    for (const d of receives) {
      expect(d.providerLabel.length).toBeGreaterThan(2);
      // "It is missing" is a fact; "and X owes it, for Y" is actionable.
      expect(d.why.length).toBeGreaterThan(20);
    }
  });

  it('keeps a document the flow map does not know rather than dropping it', () => {
    // Hiding it would hide something the gate is still going to demand.
    const all = stepDocuments('CUSTOMER_PO_RECEIVED', 'ONE_BUY_SOURCING');
    const ids = [...all.creates, ...all.receives].map((d) => d.id);
    expect(ids.length).toBeGreaterThan(0);
  });

  it('never lists the same document as both created and received', () => {
    for (const id of [
      'CUSTOMER_PO_RECEIVED',
      'SUPPLIER_PO_ISSUED',
      'ESCROW_ACCOUNT_OPENED',
      'CUSTOMS_ENTRY_FILED_ICEGATE',
      'GOODS_RECEIVED_INBOUND_AT_1BUY',
      'OUTBOUND_BOOKED',
    ]) {
      const { creates, receives } = stepDocuments(id, 'ONE_BUY_SOURCING');
      const overlap = creates.filter((c) => receives.some((r) => r.id === c.id));
      expect(overlap, id).toEqual([]);
    }
  });
});

describe('the whole brief', () => {
  it('assembles responsibility, paperwork and liability in one object', () => {
    const b = stepBrief('IN_TRANSIT_INTERNATIONAL', ctx, FOB_DDP);
    expect(b.code).toBe('E2');
    expect(b.responsibility.entity).toBe('ONE_BUY_INBOUND');
    expect(b.liability).not.toBeNull();
    expect(b.nextOwner.length).toBeGreaterThan(0);
    expect(b.nextAction.length).toBeGreaterThan(10);
  });

  it('holds up on the escrow step, where the terms are the point', () => {
    const b = stepBrief('ESCROW_ACCOUNT_OPENED', ctx, FOB_DDP);
    expect(b.responsibility.entity).toBe('ESCROW');
    // The order and its schedule of terms come FROM the provider.
    expect(b.creates.map((d) => d.id)).toContain('escrowAgreement');
  });
});
