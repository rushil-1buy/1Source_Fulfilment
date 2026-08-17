import { describe, expect, it } from 'vitest';
import {
  STAGES_WITH_ACTIONS,
  TESTING_STANDARDS,
  orphanedActionFields,
  subTaskProgress,
  subTaskStates,
  subTasksFor,
} from './stage-tasks';
import { STAGE_DEFS, applicableStages } from './stages';
import { evidenceFor } from './stage-evidence';

describe('ordering — documents lead every stage', () => {
  it('puts every document task before any other kind', () => {
    for (const stage of STAGE_DEFS) {
      const kinds = subTasksFor(stage.id).map((t) => t.kind);
      const lastDoc = kinds.lastIndexOf('DOCUMENT');
      const firstOther = kinds.findIndex((k) => k !== 'DOCUMENT');
      if (lastDoc === -1 || firstOther === -1) continue;
      expect(lastDoc, `${stage.code} ${stage.id}`).toBeLessThan(firstOther);
    }
  });

  it('lists one row per expected document', () => {
    const tasks = subTasksFor('CUSTOMER_PO_RECEIVED');
    const docs = tasks.filter((t) => t.kind === 'DOCUMENT');
    expect(docs).toHaveLength(evidenceFor('CUSTOMER_PO_RECEIVED')!.documents.length);
    expect(docs[0].label).toMatch(/^Upload — /);
  });

  it('collapses the figures into a single row rather than one per field', () => {
    // Eight ticks for eight boxes on one form is the form again, not a checklist.
    const capture = subTasksFor('INSPECTION_PASSED').filter((t) => t.kind === 'CAPTURE');
    expect(capture).toHaveLength(1);
    expect(capture[0].label).toMatch(/7 fields/);
  });
});

describe('every stage has something to show', () => {
  it('produces at least one sub-task for each stage on a normal order', () => {
    const ladder = applicableStages({
      paymentMethod: 'ESCROW',
      testingRequired: true,
      testScope: 'LOT_SAMPLE',
      incoterms: 'CIF',
    });
    for (const s of ladder) {
      expect(subTasksFor(s.id).length, `${s.code} ${s.label}`).toBeGreaterThan(0);
    }
  });

  it('never references an evidence field that does not exist', () => {
    // The guard that caught fourteen wrong field names the first time.
    expect(orphanedActionFields()).toEqual([]);
  });

  it('declares actions for a substantial share of the ladder', () => {
    expect(STAGES_WITH_ACTIONS.length).toBeGreaterThan(25);
  });
});

describe('escrow — the account and the order are their own steps', () => {
  const tasks = subTasksFor('ESCROW_ACCOUNT_OPENED');

  it('has a step for creating the account with the provider', () => {
    const t = tasks.find((x) => x.id === 'action:create-escrow-account')!;
    expect(t).toBeTruthy();
    expect(t.label).toMatch(/Create the escrow account/i);
    expect(t.required).toBe(true);
    expect(t.owner).toBe('ESCROW');
  });

  it('has a step for placing the escrow order and its release conditions', () => {
    const t = tasks.find((x) => x.id === 'action:place-escrow-order')!;
    expect(t).toBeTruthy();
    expect(t.label).toMatch(/Place the escrow order/i);
    expect(t.detail).toMatch(/release conditions|before money moves|inspection/i);
    expect(t.required).toBe(true);
  });

  it('still leads with the document that carries the terms', () => {
    expect(tasks[0].kind).toBe('DOCUMENT');
    // Renamed when C1 became "an order placed on escrow": the attachment is the
    // order and its schedule of terms, not merely an agreement to open one.
    expect(tasks[0].label).toMatch(/escrow order and terms/i);
  });
});

describe('testing — the standards are on the instruction, not in a policy file', () => {
  it('cites the authentication standard on the scope step', () => {
    const scope = subTasksFor('TEST_SCOPE_CONFIRMED').find((t) => t.id === 'action:agree-scope')!;
    expect(scope.standard).toBe(TESTING_STANDARDS.authentication);
    expect(scope.standard).toMatch(/AS6171/);
  });

  it('cites the ASTM analytical methods on the material and X-ray steps', () => {
    const tasks = subTasksFor('TEST_SCOPE_CONFIRMED');
    const material = tasks.find((t) => t.id === 'action:method-material')!;
    const xray = tasks.find((t) => t.id === 'action:method-xray')!;
    // ASTM is the method underneath the measurement; AS6171 is the verdict on top.
    expect(material.standard).toContain('ASTM E1508');
    expect(material.standard).toContain('ASTM B568');
    expect(xray.standard).toBe('ASTM E1742');
  });

  it('cites the visual protocol where parts are first looked at', () => {
    const visual = subTasksFor('PARTS_RECEIVED_AT_WHL').find(
      (t) => t.id === 'action:external-visual',
    )!;
    expect(visual.standard).toBe(TESTING_STANDARDS.visual);
  });

  it('carries a standard on at least one step of every testing stage', () => {
    for (const id of ['PARTS_RECEIVED_AT_WHL', 'TEST_SCOPE_CONFIRMED', 'TESTING_IN_PROGRESS', 'TEST_PASSED']) {
      expect(subTasksFor(id).some((t) => t.standard), id).toBe(true);
    }
  });
});

describe('state is derived from the record, never self-reported', () => {
  const stageId = 'ESCROW_ACCOUNT_OPENED';

  it('marks nothing done on an untouched stage', () => {
    const states = subTaskStates(stageId, {}, []);
    expect(states.every((s) => !s.done)).toBe(true);
    expect(subTaskProgress(states).done).toBe(0);
  });

  it('ticks a document task only when that document is attached', () => {
    const before = subTaskStates(stageId, {}, []);
    const after = subTaskStates(stageId, {}, ['escrowAgreement']);
    expect(before.find((s) => s.id === 'doc:escrowAgreement')!.done).toBe(false);
    expect(after.find((s) => s.id === 'doc:escrowAgreement')!.done).toBe(true);
  });

  it('ticks an action from the field that records it happening', () => {
    const states = subTaskStates(stageId, { escrowRef: 'ESC-2026-0001' }, []);
    expect(states.find((s) => s.id === 'action:create-escrow-account')!.done).toBe(true);
    expect(states.find((s) => s.id === 'action:place-escrow-order')!.done).toBe(false);
  });

  it('treats a false checkbox as not done', () => {
    const off = subTaskStates('CUSTOMER_PO_RECEIVED', { termsRead: false }, []);
    const on = subTaskStates('CUSTOMER_PO_RECEIVED', { termsRead: true }, []);
    expect(off.find((s) => s.id === 'action:read-terms')!.done).toBe(false);
    expect(on.find((s) => s.id === 'action:read-terms')!.done).toBe(true);
  });

  it('names the fields still missing on the capture row', () => {
    const states = subTaskStates(stageId, { escrowRef: 'X' }, []);
    const capture = states.find((s) => s.kind === 'CAPTURE')!;
    expect(capture.done).toBe(false);
    expect(capture.outstanding).toContain('Escrow provider');
    expect(capture.outstanding).not.toContain('Escrow reference');
  });

  it('completes the capture row once every required field is filled', () => {
    const states = subTaskStates(
      stageId,
      {
        escrowRef: 'X',
        provider: 'Y',
        openedOn: '2026-07-30',
        // Required since C1 became a placed order: the conditions that release
        // the money are the terms the whole arrangement turns on.
        releaseConditions: 'Goods received and accepted at 1BUY.',
      },
      [],
    );
    const capture = states.find((s) => s.kind === 'CAPTURE')!;
    expect(capture.done).toBe(true);
    expect(capture.outstanding).toEqual([]);
  });

  it('counts required outstanding separately from total outstanding', () => {
    const p = subTaskProgress(subTaskStates(stageId, {}, []));
    expect(p.total).toBeGreaterThan(p.requiredOutstanding);
    expect(p.requiredOutstanding).toBeGreaterThan(0);
  });
});
