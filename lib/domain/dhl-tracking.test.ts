import { describe, expect, it } from 'vitest';
import {
  DHL_CODES,
  dhlCode,
  eventForCode,
  readTracking,
  stagesToAdvance,
  type DhlEvent,
} from './dhl-tracking';
import { inboundEvent } from './inbound-events';
import { STAGE_DEFS } from './stages';

/** The inbound stretch of the ladder, in order. */
const LADDER = [
  'FULL_SHIPMENT_DISPATCHED_BY_SUPPLIER',
  'IN_TRANSIT_INTERNATIONAL',
  'BORDER_ARRIVAL_WHA_ENGAGED',
  'CUSTOMS_ENTRY_FILED_ICEGATE',
  'DUTY_ASSESSED_AND_PAID',
  'CUSTOMS_CLEARED',
  'GOODS_RECEIVED_INBOUND_AT_1BUY',
];

const ev = (code: string, hoursAgo: number, extra: Partial<DhlEvent> = {}): DhlEvent => ({
  code,
  timestamp: new Date(Date.UTC(2026, 7, 17, 12) - hoursAgo * 3600_000).toISOString(),
  description: code,
  location: 'Somewhere',
  ...extra,
});

describe('the code map is internally sound', () => {
  it('only points at stages that exist', () => {
    const ids = new Set(STAGE_DEFS.map((s) => s.id));
    for (const c of DHL_CODES) {
      if (c.impliesStage) expect(ids, c.code).toContain(c.impliesStage);
    }
  });

  it('only raises events the platform actually has', () => {
    for (const c of DHL_CODES) {
      if (c.raisesEvent) expect(inboundEvent(c.raisesEvent), c.code).toBeTruthy();
    }
  });

  it('explains every code in a desk’s words', () => {
    for (const c of DHL_CODES) expect(c.meaning.length, c.code).toBeGreaterThan(15);
  });

  it('has no duplicate codes', () => {
    const codes = DHL_CODES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('an unrecognised code', () => {
  it('is recorded rather than dropped or guessed at', () => {
    /*
     * The Express code set is large and varies by lane; codes turn up that are
     * in no published list. A tracking history with a gap is worse than one
     * with an unexplained line, because only the second makes somebody look.
     */
    const m = dhlCode('ZZ');
    expect(m.confidence).toBe('UNKNOWN');
    expect(m.impliesStage).toBeNull();
    expect(m.raisesEvent).toBeNull();
    expect(m.meaning).toMatch(/does not recognise/i);
  });

  it('is surfaced by a feed reading, not swallowed', () => {
    const r = readTracking([ev('PU', 40), ev('ZZ', 20)], LADDER);
    expect(r.unrecognised).toEqual(['ZZ']);
  });

  it('is case-insensitive on the ones we do know', () => {
    expect(dhlCode('pu').code).toBe('PU');
    expect(dhlCode('pu').confidence).not.toBe('UNKNOWN');
  });
});

describe('what a feed implies', () => {
  it('reads a normal journey through to delivery', () => {
    const r = readTracking(
      [ev('PU', 72), ev('DF', 60), ev('AR', 30), ev('CR', 10), ev('OK', 2)],
      LADDER,
    );
    expect(r.impliedStage).toBe('GOODS_RECEIVED_INBOUND_AT_1BUY');
    expect(r.finished).toBe(true);
  });

  it('does not treat a carrier clearance scan as our customs entry', () => {
    /*
     * The one worth being strict about. DHL processing a clearance is not us
     * filing a Bill of Entry — on a self-cleared consignment our own agent
     * files it. Ticking that step off a carrier scan would mark work nobody did
     * and skip the evidence the entry needs.
     */
    const r = readTracking([ev('PU', 40), ev('AR', 20), ev('CC', 10)], LADDER);
    expect(r.impliedStage).toBe('BORDER_ARRIVAL_WHA_ENGAGED');
    expect(r.impliedStage).not.toBe('CUSTOMS_ENTRY_FILED_ICEGATE');
  });

  it('follows the consignment backwards when it goes backwards', () => {
    // A shipment returned to origin is not still "arrived at destination".
    // Taking the furthest-along code would report it as progressing.
    const r = readTracking([ev('AR', 30), ev('RT', 5)], LADDER);
    expect(r.events).toContain('CONSIGNMENT_UNTRACED');
    expect(r.finished).toBe(true);
  });

  it('raises a customs query from the code that means one', () => {
    const r = readTracking([ev('AR', 20), ev('CM', 5)], LADDER);
    expect(r.events).toContain('CUSTOMS_QUERY');
  });

  it('starts the demurrage clock when customs hold it', () => {
    const r = readTracking([ev('AR', 20), ev('CD', 5)], LADDER);
    expect(r.events).toContain('DEMURRAGE_ACCRUING');
  });

  it('deduplicates a repeated problem code', () => {
    const r = readTracking([ev('CD', 20), ev('CD', 10), ev('HL', 5)], LADDER);
    expect(r.events.filter((e) => e === 'DEMURRAGE_ACCRUING')).toHaveLength(1);
  });

  it('reads an empty feed as implying nothing', () => {
    expect(readTracking([], LADDER)).toEqual({
      impliedStage: null,
      events: [],
      unrecognised: [],
      finished: false,
    });
  });

  it('resolves a code straight to its event definition', () => {
    expect(eventForCode('TD')?.id).toBe('DAMAGE_IN_TRANSIT');
    expect(eventForCode('PU')).toBeNull();
  });
});

describe('tracking only ever moves an order forward', () => {
  it('lists the steps between here and where tracking says it is', () => {
    expect(stagesToAdvance(LADDER, 'IN_TRANSIT_INTERNATIONAL', 'CUSTOMS_CLEARED')).toEqual([
      'BORDER_ARRIVAL_WHA_ENGAGED',
      'CUSTOMS_ENTRY_FILED_ICEGATE',
      'DUTY_ASSESSED_AND_PAID',
      'CUSTOMS_CLEARED',
    ]);
  });

  it('never drags an order back', () => {
    /*
     * Feeds arrive out of order, and a late scan for a step already passed must
     * not rewind the order — which is exactly what "set the stage to whatever
     * tracking says" would do.
     */
    expect(stagesToAdvance(LADDER, 'CUSTOMS_CLEARED', 'IN_TRANSIT_INTERNATIONAL')).toEqual([]);
    expect(stagesToAdvance(LADDER, 'CUSTOMS_CLEARED', 'CUSTOMS_CLEARED')).toEqual([]);
  });

  it('does nothing when tracking implies no stage at all', () => {
    expect(stagesToAdvance(LADDER, 'IN_TRANSIT_INTERNATIONAL', null)).toEqual([]);
  });
});
