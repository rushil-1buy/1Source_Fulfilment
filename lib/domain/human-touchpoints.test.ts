import { describe, expect, it } from 'vitest';
import { STAGE_DEFS } from './stages';
import {
  HUMAN_TOUCHPOINTS,
  TOUCH_KIND_LABEL,
  TOUCH_KIND_NOTE,
  isLiveAutonomous,
  requiresHuman,
  summariseTouchpoints,
  touchpointFor,
} from './human-touchpoints';

describe('human touchpoints', () => {
  it('only names stages that exist on the ladder', () => {
    // A touchpoint against a stage id nobody can reach is a claim about a step
    // the run will never pass, so it would never be shown and never corrected.
    const ids = new Set(STAGE_DEFS.map((s) => s.id));
    for (const id of Object.keys(HUMAN_TOUCHPOINTS)) expect(ids, id).toContain(id);
  });

  it('every money step in the flow is accounted for', () => {
    // Finance owning a stage and that stage having no touchpoint would mean the
    // run passed a money step silently — the exact thing this module exists to
    // make impossible.
    const financeStages = STAGE_DEFS.filter(
      (s) => s.owner === 'ONE_BUY_FINANCE' && !s.isExceptionBranch,
    );
    for (const s of financeStages) expect(requiresHuman(s.id), `${s.code} ${s.id}`).toBe(true);
  });

  it('marks the physical steps as physical', () => {
    for (const id of [
      'GOODS_RECEIVED_INBOUND_AT_1BUY',
      'INBOUND_INSPECTION_IN_PROGRESS',
      'REBRAND_AND_REPACK_IN_PROGRESS',
      'PARTS_RECEIVED_AT_WHL',
    ]) {
      expect(touchpointFor(id)?.kind, id).toBe('PHYSICAL');
    }
  });

  it('treats the customs entry as a licensed filing, not clerical work', () => {
    expect(touchpointFor('CUSTOMS_ENTRY_FILED_ICEGATE')?.kind).toBe('REGULATORY');
  });

  it('leaves the genuinely automatable steps alone', () => {
    // If these ever acquire a touchpoint, the claim that the agent saves
    // anything needs re-examining.
    for (const id of ['CUSTOMER_PO_RECEIVED', 'SUPPLIER_PO_ISSUED', 'WORK_ORDER_ACTIVE'])
      expect(requiresHuman(id), id).toBe(false);
  });

  it('every touchpoint says who and what, not just that', () => {
    for (const [id, t] of Object.entries(HUMAN_TOUCHPOINTS)) {
      expect(t.who.length, id).toBeGreaterThan(3);
      // A "would do" that just restates the stage label teaches nobody anything.
      expect(t.wouldDo.length, id).toBeGreaterThan(30);
      expect(TOUCH_KIND_LABEL[t.kind], id).toBeTruthy();
      expect(TOUCH_KIND_NOTE[t.kind], id).toBeTruthy();
    }
  });

  it('summarises by kind, biggest first', () => {
    const s = summariseTouchpoints(Object.keys(HUMAN_TOUCHPOINTS));
    expect(s.total).toBe(Object.keys(HUMAN_TOUCHPOINTS).length);
    for (let i = 1; i < s.byKind.length; i++)
      expect(s.byKind[i - 1].count).toBeGreaterThanOrEqual(s.byKind[i].count);
  });

  it('counts nothing for a stage list with no touchpoints', () => {
    expect(summariseTouchpoints(['CUSTOMER_PO_RECEIVED', 'WORK_ORDER_ACTIVE'])).toEqual({
      total: 0,
      byKind: [],
    });
  });

  it('keeps Finance out of the live autonomous set', () => {
    // The simulation passes through Finance; the live policy must not.
    expect(isLiveAutonomous('ONE_BUY_FINANCE')).toBe(false);
    expect(isLiveAutonomous('ONE_BUY_SOURCING')).toBe(true);
  });
});
