/**
 * The walkthrough encodes a POLICY, so the policy is what gets tested.
 *
 * If somebody later adds a step that lets the agent move money, or drops the
 * reconciliation escalation because the demo runs smoother without it, these
 * fail. That is the point: the script is an argument about what is safe, and
 * an argument nobody checks stops being one.
 */

import { describe, expect, it } from 'vitest';
import { AGENTIC_SCRIPT, AUTONOMOUS_TEAMS, isAutonomousTeam, summarise } from './agentic-sim';

describe('autonomy policy', () => {
  it('never lets the agent act autonomously on a Finance step', () => {
    const financeSteps = AGENTIC_SCRIPT.filter((s) => s.team === 'ONE_BUY_FINANCE');
    expect(financeSteps.length).toBeGreaterThan(0);
    for (const s of financeSteps) expect(s.mode).not.toBe('AUTONOMOUS');
  });

  it('marks money steps HELD by policy, not ESCALATED by failure', () => {
    // The distinction matters: HELD means nothing is wrong, a person is simply
    // required. Collapsing them would make the policy look like a defect.
    const held = AGENTIC_SCRIPT.filter((s) => s.mode === 'HELD');
    expect(held.length).toBeGreaterThanOrEqual(4);
    for (const s of held) expect(s.team).toBe('ONE_BUY_FINANCE');
  });

  it('excludes Finance from the autonomous teams', () => {
    expect(AUTONOMOUS_TEAMS).not.toContain('ONE_BUY_FINANCE');
    expect(isAutonomousTeam('ONE_BUY_FINANCE')).toBe(false);
    expect(isAutonomousTeam('ONE_BUY_OUTBOUND')).toBe(true);
  });

  it('costs a person zero minutes on every step the agent handled', () => {
    for (const s of AGENTIC_SCRIPT.filter((x) => x.mode === 'AUTONOMOUS')) {
      expect(s.humanMinutes).toBe(0);
    }
  });

  it('costs a person real minutes on every step it did not', () => {
    for (const s of AGENTIC_SCRIPT.filter((x) => x.mode !== 'AUTONOMOUS')) {
      expect(s.humanMinutes).toBeGreaterThan(0);
    }
  });
});

describe('the two safety demonstrations', () => {
  it('refuses an instruction that arrived inside a counterparty email', () => {
    const refused = AGENTIC_SCRIPT.filter((s) => s.mode === 'REFUSED');
    expect(refused.length).toBeGreaterThan(0);
    expect(refused.some((s) => /evidence, not instruction/i.test(s.guard ?? ''))).toBe(true);
  });

  it('escalates rather than accepting a supplier figure that fails reconciliation', () => {
    const step = AGENTIC_SCRIPT.find((s) => s.id === 'pi-mismatch');
    expect(step?.mode).toBe('ESCALATED');
    expect(step?.guard).toMatch(/reconciled, never trusted/i);
  });

  it('gives every non-autonomous step a stated reason', () => {
    // A stop with no explanation is indistinguishable from a bug.
    for (const s of AGENTIC_SCRIPT.filter((x) => x.mode !== 'AUTONOMOUS')) {
      expect((s.guard ?? '').length + s.reasoned.length).toBeGreaterThan(40);
    }
  });
});

describe('summary', () => {
  it('accounts for every step in exactly one mode', () => {
    const s = summarise();
    expect(s.autonomous + s.held + s.escalated + s.refused).toBe(s.total);
  });

  it('shows the agent saving real attention without claiming it saves all of it', () => {
    const s = summarise();
    expect(s.humanMinutes).toBeGreaterThan(0); // never claims zero human involvement
    expect(s.humanMinutes).toBeLessThan(s.manualMinutes);
  });
});
