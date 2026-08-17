import { describe, expect, it } from 'vitest';
import { agentBriefing, type GuidanceInput } from './agent-guidance';
import type { StageContext } from './stages';

const ctx: StageContext = {
  paymentMethod: 'ESCROW',
  testingRequired: true,
  testScope: 'LOT_SAMPLE',
  incoterms: 'FOB',
};

const refs = {
  alias: 'WO-2026-0101',
  customerPo: 'CPO-ACME-0042',
  supplierPo: 'PO-1B-0107',
  customer: 'ACME Electronics Private Limited',
  supplier: 'Nexus Components Pte Ltd',
};

const at = (stageId: string, over: Partial<GuidanceInput> = {}): GuidanceInput => ({
  stageId,
  ctx,
  incoterms: { buy: 'FOB', sell: 'DDP' },
  recorded: {},
  filed: [],
  refs,
  ...over,
});

describe('what the agent suggests next', () => {
  it('leads with the decision when a person is genuinely required', () => {
    // Ranked above data entry: filling in fields around a decision nobody has
    // taken is work that may have to be undone.
    const b = agentBriefing(at('INSPECTION_PASSED'));
    expect(b.suggestions[0].kind).toBe('DECIDE');
  });

  it('names the party that owes a document rather than saying "chase them"', () => {
    const b = agentBriefing(at('GOODS_RECEIVED_INBOUND_AT_1BUY'));
    const chase = b.suggestions.find((s) => s.kind === 'CHASE');
    if (chase) {
      expect(chase.title).toMatch(/Chase \S/);
      expect(chase.because.length).toBeGreaterThan(30);
    }
  });

  it('only offers to advance when nothing at all is outstanding', () => {
    const blocked = agentBriefing(at('WORK_ORDER_ACTIVE'));
    expect(blocked.suggestions.some((s) => s.kind === 'ADVANCE')).toBe(false);

    // Fill every required field and file every required document.
    const spec = at('WORK_ORDER_ACTIVE');
    const recorded: Record<string, unknown> = {};
    for (const s of blocked.suggestions) void s;
    const full = agentBriefing({
      ...spec,
      recorded: { ...recorded, ...allFieldsFor('WORK_ORDER_ACTIVE') },
      filed: allDocsFor('WORK_ORDER_ACTIVE'),
    });
    expect(full.suggestions.some((s) => s.kind === 'ADVANCE')).toBe(true);
  });

  it('always says whose move comes after this one', () => {
    const b = agentBriefing(at('SUPPLIER_PO_ISSUED'));
    expect(b.lookahead).toBeTruthy();
    expect(b.lookahead!.length).toBeGreaterThan(10);
  });

  it('describes the situation in terms of what is actually missing', () => {
    const b = agentBriefing(at('ESCROW_ACCOUNT_OPENED'));
    expect(b.situation).toMatch(/outstanding|not yet recorded/);
    const done = agentBriefing(
      at('ESCROW_ACCOUNT_OPENED', {
        recorded: allFieldsFor('ESCROW_ACCOUNT_OPENED'),
        filed: allDocsFor('ESCROW_ACCOUNT_OPENED'),
      }),
    );
    expect(done.situation).toMatch(/everything it needs is in/);
  });

  it('ranks so the top line is the thing genuinely in the way', () => {
    const b = agentBriefing(at('CUSTOMS_ENTRY_FILED_ICEGATE'));
    for (let i = 1; i < b.suggestions.length; i++)
      expect(b.suggestions[i - 1].rank).toBeLessThanOrEqual(b.suggestions[i].rank);
  });
});

describe('the draft it offers', () => {
  it('quotes the order’s real references, never an invented one', () => {
    const b = agentBriefing(at('GOODS_RECEIVED_INBOUND_AT_1BUY'));
    if (b.draft) {
      const text = `${b.draft.subject} ${b.draft.body}`;
      expect(text).toContain(refs.alias);
      // Whichever counterparty it is addressed to, its own order number appears.
      expect(text.includes(refs.supplierPo) || text.includes(refs.customerPo)).toBe(true);
    }
  });

  it('offers nothing when nobody outside owes anything', () => {
    // An agent offering to draft a mail nobody needs to send is the behaviour
    // that gets a feature switched off.
    const b = agentBriefing(
      at('WORK_ORDER_ACTIVE', {
        recorded: allFieldsFor('WORK_ORDER_ACTIVE'),
        filed: allDocsFor('WORK_ORDER_ACTIVE'),
      }),
    );
    expect(b.draft).toBeNull();
  });

  it('says what it was assembled from, so it can be checked', () => {
    const b = agentBriefing(at('GOODS_RECEIVED_INBOUND_AT_1BUY'));
    if (b.draft) {
      expect(b.draft.basedOn).toMatch(/invented|assembled/i);
      expect(b.draft.body.length).toBeGreaterThan(80);
    }
  });

  it('addresses a counterparty differently from an internal desk', () => {
    const external = agentBriefing(at('SUPPLIER_PI_RECEIVED'));
    if (external.draft && (external.draft.to === 'SUPPLIER' || external.draft.to === 'CUSTOMER')) {
      expect(external.draft.body).toMatch(/^Dear /);
      expect(external.draft.body).toMatch(/Kind regards/);
    }
  });
});

// ── helpers ─────────────────────────────────────────────────────────────────

import { evidenceFor } from './stage-evidence';

function allFieldsFor(stageId: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of evidenceFor(stageId)?.fields ?? []) out[f.id] = 'recorded';
  return out;
}

function allDocsFor(stageId: string): string[] {
  return (evidenceFor(stageId)?.documents ?? []).map((d) => d.id);
}
