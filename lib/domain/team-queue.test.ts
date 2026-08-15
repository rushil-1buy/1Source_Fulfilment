/**
 * The bucketing is the whole feature: get it wrong and a team either misses work
 * that is theirs or is shown work that is not. Both destroy trust in the queue,
 * and the second is the one that happens quietly.
 */

import { describe, expect, it } from 'vitest';
import { bucketFor, holdingUp, queuesFor, urgencyOf, waitingOn, type QueueInput } from './team-queue';

const row = (over: Partial<QueueInput> = {}): QueueInput => ({
  owner: 'SUPPLIER',
  nextActionOwner: 'SUPPLIER',
  nextStageOwner: null,
  slaStatus: 'ON_TRACK',
  isBlocked: false,
  status: 'ACTIVE',
  ...over,
});

describe('bucketFor — whose desk is it on', () => {
  it('is my work when the next action is mine, whoever owns the stage', () => {
    // The case that matters: the supplier owns the stage, but chasing them is
    // our job. Bucketing on `owner` alone would hide this from the team.
    const r = row({ owner: 'SUPPLIER', nextActionOwner: 'ONE_BUY_SOURCING' });
    expect(bucketFor(r, 'ONE_BUY_SOURCING')).toBe('NEEDS_ME');
  });

  it('is waiting when I own it but the ball is elsewhere', () => {
    const r = row({ owner: 'ONE_BUY_FINANCE', nextActionOwner: 'CHA' });
    expect(bucketFor(r, 'ONE_BUY_FINANCE')).toBe('WAITING');
  });

  it('is incoming when the step after this one is mine', () => {
    const r = row({ owner: 'CHA', nextActionOwner: 'CHA', nextStageOwner: 'ONE_BUY_INBOUND' });
    expect(bucketFor(r, 'ONE_BUY_INBOUND')).toBe('INCOMING');
  });

  it('is nothing to me when no part of it is mine', () => {
    expect(bucketFor(row(), 'ONE_BUY_FINANCE')).toBe('DONE_HERE');
  });

  it('never puts a closed or cancelled order on anyone’s desk', () => {
    for (const status of ['CLOSED', 'CANCELLED']) {
      const r = row({ owner: 'ONE_BUY_FINANCE', nextActionOwner: 'ONE_BUY_FINANCE', status });
      expect(bucketFor(r, 'ONE_BUY_FINANCE'), status).toBe('DONE_HERE');
    }
  });

  it('puts an order on exactly one team’s NEEDS_ME at a time', () => {
    const r = row({ owner: 'SUPPLIER', nextActionOwner: 'ONE_BUY_INSPECTION' });
    const teams: QueueInput['owner'][] = [
      'ONE_BUY_SOURCING',
      'ONE_BUY_FINANCE',
      'ONE_BUY_INBOUND',
      'ONE_BUY_OUTBOUND',
      'ONE_BUY_INSPECTION',
    ];
    const onDesk = teams.filter((t) => bucketFor(r, t) === 'NEEDS_ME');
    expect(onDesk).toEqual(['ONE_BUY_INSPECTION']);
  });
});

describe('urgencyOf — blocked outranks late', () => {
  it('puts a blocked order above a breached one', () => {
    expect(urgencyOf(row({ isBlocked: true }))).toBeLessThan(
      urgencyOf(row({ slaStatus: 'BREACHED' })),
    );
  });

  it('orders breached above at-risk above on-track', () => {
    expect(urgencyOf(row({ slaStatus: 'BREACHED' }))).toBeLessThan(
      urgencyOf(row({ slaStatus: 'AT_RISK' })),
    );
    expect(urgencyOf(row({ slaStatus: 'AT_RISK' }))).toBeLessThan(urgencyOf(row()));
  });
});

describe('queuesFor — the worklist is ranked, the rest is not', () => {
  const mine = (over: Partial<QueueInput> = {}) =>
    row({ nextActionOwner: 'ONE_BUY_FINANCE', ...over });

  it('ranks the work so the top item is always the one to open', () => {
    const q = queuesFor(
      [mine(), mine({ slaStatus: 'BREACHED' }), mine({ isBlocked: true }), mine({ slaStatus: 'AT_RISK' })],
      'ONE_BUY_FINANCE',
    );
    expect(q.needsMe.map(urgencyOf)).toEqual([0, 1, 2, 3]);
  });

  it('counts the late and the stopped rather than splitting the list', () => {
    const q = queuesFor(
      [mine(), mine({ slaStatus: 'BREACHED' }), mine({ isBlocked: true })],
      'ONE_BUY_FINANCE',
    );
    expect(q.needsMe).toHaveLength(3);
    expect(q.overdue).toBe(1);
    expect(q.blocked).toBe(1);
  });

  it('keeps the three queues disjoint', () => {
    const rows = [
      mine(),
      row({ owner: 'ONE_BUY_FINANCE', nextActionOwner: 'ESCROW' }),
      row({ nextStageOwner: 'ONE_BUY_FINANCE' }),
      row(),
    ];
    const q = queuesFor(rows, 'ONE_BUY_FINANCE');
    expect(q.needsMe).toHaveLength(1);
    expect(q.waiting).toHaveLength(1);
    expect(q.incoming).toHaveLength(1);
  });
});

describe('the handoff view — who is holding whom up', () => {
  it('names who we are waiting on, and for how many', () => {
    const rows = [
      row({ owner: 'ONE_BUY_INSPECTION', nextActionOwner: 'WHL' }),
      row({ owner: 'ONE_BUY_INSPECTION', nextActionOwner: 'WHL' }),
      row({ owner: 'ONE_BUY_INSPECTION', nextActionOwner: 'SUPPLIER' }),
    ];
    const w = waitingOn(rows, 'ONE_BUY_INSPECTION');
    expect(w.get('WHL')).toBe(2);
    expect(w.get('SUPPLIER')).toBe(1);
  });

  it('names who we are holding up — the mirror that changes priorities', () => {
    const rows = [
      row({ owner: 'CUSTOMER', nextActionOwner: 'ONE_BUY_OUTBOUND' }),
      row({ owner: 'CUSTOMER', nextActionOwner: 'ONE_BUY_OUTBOUND' }),
    ];
    expect(holdingUp(rows, 'ONE_BUY_OUTBOUND').get('CUSTOMER')).toBe(2);
  });

  it('does not claim to be holding ourselves up', () => {
    const rows = [row({ owner: 'ONE_BUY_OUTBOUND', nextActionOwner: 'ONE_BUY_OUTBOUND' })];
    expect(holdingUp(rows, 'ONE_BUY_OUTBOUND').size).toBe(0);
  });
});
