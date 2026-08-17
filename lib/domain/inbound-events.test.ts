import { describe, expect, it } from 'vitest';
import {
  INBOUND_EVENTS,
  eventBearer,
  eventSummary,
  eventsForStage,
  holdingEvents,
  inboundEvent,
  eventBlockFor,
  type OpenEventRecord,
} from './inbound-events';
import { STAGE_DEFS } from './stages';
import { EXCEPTION_DEFS } from './exceptions';

describe('the catalogue is sound', () => {
  it('only names steps that exist on the ladder', () => {
    // An event raisable at a stage nobody reaches is an event nobody can raise.
    const ids = new Set(STAGE_DEFS.map((s) => s.id));
    for (const e of INBOUND_EVENTS) {
      for (const st of e.stages) expect(ids, `${e.id} → ${st}`).toContain(st);
    }
  });

  it('escalates only into exceptions the platform can actually route', () => {
    // An escalation to a type with no routes leaves the order stopped with no
    // way out, which is worse than not escalating at all.
    for (const e of INBOUND_EVENTS) {
      if (!e.escalatesTo) continue;
      const def = EXCEPTION_DEFS[e.escalatesTo];
      expect(def, e.id).toBeTruthy();
      expect(def.routes.length, e.id).toBeGreaterThan(0);
    }
  });

  it('says what it costs and what to do, on every one', () => {
    for (const e of INBOUND_EVENTS) {
      expect(e.costNote.length, e.id).toBeGreaterThan(40);
      expect(e.action.length, e.id).toBeGreaterThan(25);
      expect(e.what.length, e.id).toBeGreaterThan(30);
    }
  });

  it('has unique ids', () => {
    const ids = INBOUND_EVENTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('offers something at every step of the inbound leg', () => {
    // A step with no events is a step where nothing can be recorded, which on
    // an import leg is never true.
    for (const st of [
      'FULL_SHIPMENT_DISPATCHED_BY_SUPPLIER',
      'IN_TRANSIT_INTERNATIONAL',
      'BORDER_ARRIVAL_WHA_ENGAGED',
      'CUSTOMS_ENTRY_FILED_ICEGATE',
      'DUTY_ASSESSED_AND_PAID',
      'CUSTOMS_CLEARED',
      'GOODS_RECEIVED_INBOUND_AT_1BUY',
    ]) {
      expect(eventsForStage(st).length, st).toBeGreaterThan(0);
    }
  });

  it('asks for evidence wherever a claim depends on it', () => {
    // A damage or shortage claim without evidence gathered on the day is a
    // claim that will be refused.
    for (const id of ['SHORT_RECEIPT', 'DAMAGE_ON_ARRIVAL', 'DAMAGE_IN_TRANSIT', 'MSL_BREACH']) {
      expect(inboundEvent(id)?.evidence, id).toBeTruthy();
    }
  });
});

describe('who bears it follows the delivery term, not the person logging it', () => {
  it('puts a pre-delivery delay on the supplier — except on EXW', () => {
    const e = inboundEvent('DEPARTURE_DELAYED')!;
    expect(eventBearer(e, 'FOB').party).toBe('SUPPLIER');
    expect(eventBearer(e, 'CIF').party).toBe('SUPPLIER');
    // On EXW the goods are ours from their door, so the wait is ours.
    expect(eventBearer(e, 'EXW').ours).toBe(true);
  });

  it('follows the carriage contract on a transit event', () => {
    const e = inboundEvent('ROLLED_TO_LATER_FLIGHT')!;
    // We bought the freight on FOB, so the carrier answers to us.
    expect(eventBearer(e, 'FOB').ours).toBe(true);
    // On CIF the supplier bought it, so it is theirs.
    expect(eventBearer(e, 'CIF').party).toBe('SUPPLIER');
  });

  it('puts demurrage on whoever is importer of record', () => {
    /*
     * The one that costs real money. On FOB we clear and the daily charge is
     * ours; on DDP the supplier clears and it is theirs. Recording it against
     * the wrong party is absorbing somebody else's cost, and nobody notices
     * until the margin report.
     */
    const e = inboundEvent('DEMURRAGE_ACCRUING')!;
    expect(eventBearer(e, 'FOB').ours).toBe(true);
    expect(eventBearer(e, 'DDP').party).toBe('SUPPLIER');
  });

  it('keeps a dock event ours to handle, with the recovery route named', () => {
    const e = inboundEvent('SHORT_RECEIPT')!;
    const b = eventBearer(e, 'CIF');
    expect(b.ours).toBe(true);
    // Ours to deal with today; the claim may still run back to somebody.
    expect(b.recoverableFrom).toBeTruthy();
    expect(b.because).toMatch(/seal/i);
  });

  it('quotes the term as the reason, so the answer is checkable', () => {
    expect(eventBearer(inboundEvent('CUSTOMS_QUERY')!, 'FOB').because).toContain('FOB');
    expect(eventBearer(inboundEvent('DEPARTURE_DELAYED')!, 'CIF').because).toContain('CIF');
  });

  it('says so plainly when no term is recorded rather than guessing', () => {
    const b = eventBearer(inboundEvent('DEMURRAGE_ACCRUING')!, '');
    expect(b.because).toMatch(/no delivery term/i);
    // Defaults to ours, which is the safe direction: it makes somebody look.
    expect(b.ours).toBe(true);
  });
});

describe('the summary a list shows', () => {
  it('states the consequence, the bearer and whether the clock runs', () => {
    const s = eventSummary(inboundEvent('DEMURRAGE_ACCRUING')!, 'FOB');
    expect(s).toMatch(/carries on/i);
    expect(s).toMatch(/cost is ours/i);
    expect(s).toMatch(/clock is running/i);
  });

  it('says the order stops where it stops', () => {
    expect(eventSummary(inboundEvent('CUSTOMS_QUERY')!, 'FOB')).toMatch(/does not advance/i);
  });

  it('names the holding events so a gate can find them', () => {
    expect(holdingEvents()).toContain('CUSTOMS_QUERY');
    expect(holdingEvents()).not.toContain('DEMURRAGE_ACCRUING');
  });
});

/**
 * The gate that makes "holds the order" true.
 *
 * The panel told a desk that a customs query holds the order until answered,
 * and for a while nothing checked — the order advanced over an open query as if
 * it had been resolved. A claim the platform does not keep is worse than no
 * claim, because people act on it.
 *
 * The rule lives here rather than inline in the advance action so it can be
 * tested without a database, and so the action states what this returns instead
 * of carrying a second copy of the condition.
 */
describe('an open event that holds the order', () => {
  const rec = (over: Partial<OpenEventRecord> = {}): OpenEventRecord => ({
    id: 'r1',
    eventId: 'CUSTOMS_QUERY',
    stageId: 'CUSTOMS_ENTRY_FILED_ICEGATE',
    status: 'OPEN',
    effect: 'HOLDS',
    ...over,
  });

  it('blocks the step it was raised at', () => {
    const block = eventBlockFor([rec()], 'CUSTOMS_ENTRY_FILED_ICEGATE');
    expect(block).not.toBeNull();
    expect(block!.eventId).toBe('CUSTOMS_QUERY');
    expect(block!.message).toMatch(/Query raised by the appraiser/);
  });

  it('does not block once it is closed', () => {
    expect(eventBlockFor([rec({ status: 'RESOLVED' })], 'CUSTOMS_ENTRY_FILED_ICEGATE')).toBeNull();
  });

  it('does not block a step it was never raised at', () => {
    /*
     * An open query recorded at the border must not block the warehouse from
     * booking goods in three steps later. By then it is resolved or it has
     * become an exception; holding an unrelated step would be the platform
     * inventing a blocker.
     */
    expect(eventBlockFor([rec()], 'GOODS_RECEIVED_INBOUND_AT_1BUY')).toBeNull();
  });

  it('ignores events that only run alongside', () => {
    // Demurrage costs money every day and stops nothing. Blocking on it would
    // strand every order that ever overran its free time.
    expect(
      eventBlockFor([rec({ eventId: 'DEMURRAGE_ACCRUING', effect: 'RUNS_ALONGSIDE' })], 'CUSTOMS_ENTRY_FILED_ICEGATE'),
    ).toBeNull();
  });

  it('names every event in the way, not just the first', () => {
    const block = eventBlockFor(
      [rec(), rec({ id: 'r2', eventId: 'DOCUMENT_DISCREPANCY' })],
      'CUSTOMS_ENTRY_FILED_ICEGATE',
    );
    expect(block!.message).toMatch(/2 events/);
    expect(block!.detail).toMatch(/Query raised by the appraiser/);
    expect(block!.detail).toMatch(/Documents disagree/);
  });

  it('says it is not ours to waive', () => {
    // The evidence override exists for paperwork we choose to proceed without.
    // A third party holding the goods is not that, and the refusal says so.
    expect(eventBlockFor([rec()], 'CUSTOMS_ENTRY_FILED_ICEGATE')!.detail).toMatch(
      /not our paperwork to waive/i,
    );
  });

  it('returns nothing when there is nothing open', () => {
    expect(eventBlockFor([], 'CUSTOMS_ENTRY_FILED_ICEGATE')).toBeNull();
  });
});
