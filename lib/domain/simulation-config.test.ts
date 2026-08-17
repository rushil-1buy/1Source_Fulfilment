/**
 * The reset boundary.
 *
 * A reset that could reach a seeded or hand-raised order is not a reset, it is
 * data loss waiting for a demo — and the cascade rules mean one wrong id would
 * take a whole order history with it. The prefix is the entire boundary, so it
 * is worth a test that does not depend on the database.
 */

import { describe, expect, it } from 'vitest';
import { SIM_PREFIX } from './simulation-config';

/** The same predicate the reset uses: Prisma's `startsWith` on the alias. */
const wouldDelete = (alias: string) => alias.startsWith(SIM_PREFIX);

describe('what a reset may delete', () => {
  it('deletes what it created', () => {
    for (const a of ['SIM-001', 'SIM-002', 'SIM-999']) expect(wouldDelete(a), a).toBe(true);
  });

  it('never reaches a seeded or hand-raised order', () => {
    // These are the aliases the seed and the create-order flow produce. If a
    // reset ever matched one of them the demo would eat the demonstration data.
    for (const a of ['WO-2026-0101', 'WO-2026-0116', 'AGENTIC-DEMO', 'DEMO-INBOUND', 'DEMO-OUTBOUND'])
      expect(wouldDelete(a), a).toBe(false);
  });

  it('is not fooled by an alias that merely contains the prefix', () => {
    // startsWith, not includes — 'WO-SIM-001' is somebody else's order.
    expect(wouldDelete('WO-SIM-001')).toBe(false);
    expect(wouldDelete('NOTSIM-001')).toBe(false);
  });

  it('keeps the prefix distinctive enough to be a boundary at all', () => {
    expect(SIM_PREFIX.length).toBeGreaterThan(2);
    expect(SIM_PREFIX.endsWith('-')).toBe(true);
  });
});
