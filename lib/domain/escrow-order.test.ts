/**
 * Escrow is an ORDER placed with a provider, not an account opened.
 *
 * What happens at C1 is that an order is lodged with the escrow provider
 * carrying the agreed terms between 1BUY and the supplier: the amount held, the
 * currency, and the conditions that release it. From that point the trade is a
 * placed order against those terms, and every later step is measured against
 * them.
 *
 * The distinction is worth a test because the weaker framing — "account opened"
 * — invites people to treat the terms as a formality to be settled later, and
 * later is exactly when they get settled badly.
 */

import { describe, expect, it } from 'vitest';
import { getStage } from './stages';
import { evidenceFor } from './stage-evidence';
import { docFlowFor } from './document-flow';

describe('placing the order on escrow', () => {
  const stage = getStage('ESCROW_ACCOUNT_OPENED');

  it('describes the step as an order placed, carrying terms', () => {
    const text = `${stage.label} ${stage.description}`.toLowerCase();
    expect(text).toContain('order');
    expect(text).toContain('terms');
  });

  it('names what the terms actually fix', () => {
    // Amount, currency and the release condition — the three a dispute turns on.
    const d = stage.description.toLowerCase();
    expect(d).toMatch(/amount/);
    expect(d).toMatch(/currenc/);
    expect(d).toMatch(/releas/);
  });

  it('requires the release conditions to be recorded, not merely attached', () => {
    // A term nobody can quote without opening a PDF is a term nobody checks.
    const field = evidenceFor('ESCROW_ACCOUNT_OPENED')?.fields.find(
      (f) => f.id === 'releaseConditions',
    );
    expect(field).toBeTruthy();
    expect(field?.required).toBe(true);
  });

  it('will not let the step close without the order and its schedule', () => {
    const doc = evidenceFor('ESCROW_ACCOUNT_OPENED')?.documents[0];
    expect(doc?.required).toBe(true);
    expect(doc?.label.toLowerCase()).toContain('terms');
  });

  it('puts the schedule in front of the desks that negotiated and pay on it', () => {
    const flow = docFlowFor('escrowAgreement')!;
    expect(flow.provider).toBe('ESCROW');
    expect(flow.requiredBy).toContain('ONE_BUY_FINANCE');
    expect(flow.requiredBy).toContain('ONE_BUY_SOURCING');
    expect(flow.requiredBy).toContain('SUPPLIER');
  });

  it('leaves the funding as a separate, later step', () => {
    // Placing the order and funding it are different acts; collapsing them
    // would let an unfunded escrow look like a secured one.
    expect(stage.next).toContain('ESCROW_FUNDED');
    expect(getStage('ESCROW_FUNDED').code).toBe('C2');
  });
});
