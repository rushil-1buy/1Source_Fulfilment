import { describe, expect, it } from 'vitest';
import {
  OVERRIDE_REASON_MIN,
  buildAdvanceRequest,
  distinctApprovers,
  isUsableOverrideReason,
  nextAdvanceStep,
  type AdvanceGateState,
} from './advance-gate';

const REASON = 'Signed inspection report is with the warehouse; proceeding on the QC lead verbal pass.';
const APPROVERS = ['u-akash', 'u-ankit'];

/** The plain case: nothing outstanding, no dual authorisation. */
const base: AdvanceGateState = {
  evidenceComplete: true,
  needsDualAuthorisation: false,
};

describe('isUsableOverrideReason', () => {
  it('rejects blank and token reasons', () => {
    for (const r of [undefined, null, '', '   ', 'ok', 'x', 'later']) {
      expect(isUsableOverrideReason(r), String(r)).toBe(false);
    }
  });

  it('accepts a reason of at least the minimum length, ignoring surrounding space', () => {
    expect(isUsableOverrideReason('a'.repeat(OVERRIDE_REASON_MIN))).toBe(true);
    expect(isUsableOverrideReason(`   ${'a'.repeat(OVERRIDE_REASON_MIN)}   `)).toBe(true);
    expect(isUsableOverrideReason('a'.repeat(OVERRIDE_REASON_MIN - 1))).toBe(false);
  });
});

describe('distinctApprovers — ticking one person twice is still one signature', () => {
  it('collapses duplicates', () => {
    expect(distinctApprovers(['a', 'a', 'b'])).toEqual(['a', 'b']);
  });
  it('handles nothing', () => {
    expect(distinctApprovers(undefined)).toEqual([]);
  });
});

describe('nextAdvanceStep — one gate at a time', () => {
  it('submits straight away when nothing is outstanding', () => {
    const step = nextAdvanceStep(base);
    expect(step.kind).toBe('SUBMIT');
    if (step.kind === 'SUBMIT') expect(step.request).toEqual({});
  });

  it('asks for evidence when there is none and no reason to skip it', () => {
    expect(nextAdvanceStep({ ...base, evidenceComplete: false }).kind).toBe('COLLECT_EVIDENCE');
  });

  it('does not accept a token reason in place of evidence', () => {
    expect(nextAdvanceStep({ ...base, evidenceComplete: false, overrideReason: 'ok' }).kind).toBe(
      'COLLECT_EVIDENCE',
    );
  });

  it('asks for approvers when the target needs two', () => {
    const step = nextAdvanceStep({ ...base, needsDualAuthorisation: true, inspectionPassed: true });
    expect(step.kind).toBe('COLLECT_APPROVERS');
    if (step.kind === 'COLLECT_APPROVERS') expect(step.reason).toBe('NEEDS_APPROVERS');
  });

  it('asks again when only one approver is ticked', () => {
    expect(
      nextAdvanceStep({
        ...base,
        needsDualAuthorisation: true,
        inspectionPassed: true,
        approverIds: ['u-akash'],
      }).kind,
    ).toBe('COLLECT_APPROVERS');
  });

  it('does not count the same approver twice', () => {
    expect(
      nextAdvanceStep({
        ...base,
        needsDualAuthorisation: true,
        inspectionPassed: true,
        approverIds: ['u-akash', 'u-akash'],
      }).kind,
    ).toBe('COLLECT_APPROVERS');
  });

  it('names the inspection when that is what is blocking', () => {
    const step = nextAdvanceStep({
      ...base,
      needsDualAuthorisation: true,
      inspectionPassed: false,
      approverIds: APPROVERS,
    });
    expect(step.kind).toBe('COLLECT_APPROVERS');
    if (step.kind === 'COLLECT_APPROVERS') expect(step.reason).toBe('INSPECTION_NOT_PASSED');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The bug this module was written for
// ═══════════════════════════════════════════════════════════════════════════

describe('both gates outstanding at once — the waiver must survive the second gate', () => {
  /**
   * The exact sequence that used to trap an order at "Inspection passed": no
   * evidence on file, and a target stage that also wants two approvers. The
   * operator waived the evidence, the approver dialog opened, and the waiver was
   * thrown away — so the server refused for missing evidence and the client
   * reopened the evidence form. Round and round.
   */
  const bothOutstanding: AdvanceGateState = {
    evidenceComplete: false,
    needsDualAuthorisation: true,
    inspectionPassed: true,
  };

  it('asks for evidence first', () => {
    expect(nextAdvanceStep(bothOutstanding).kind).toBe('COLLECT_EVIDENCE');
  });

  it('moves on to the approvers once the evidence is waived', () => {
    const step = nextAdvanceStep({ ...bothOutstanding, overrideReason: REASON });
    expect(step.kind).toBe('COLLECT_APPROVERS');
  });

  it('sends BOTH the waiver and the approvers — this is the regression', () => {
    const step = nextAdvanceStep({
      ...bothOutstanding,
      overrideReason: REASON,
      approverIds: APPROVERS,
    });
    expect(step.kind).toBe('SUBMIT');
    if (step.kind !== 'SUBMIT') return;
    expect(step.request.approverIds).toEqual(APPROVERS);
    // The line that used to be missing. Without it the server refuses and the
    // operator is put back at the start of the loop.
    expect(step.request.evidenceOverrideReason).toBe(REASON.trim());
  });

  it('reaches a submittable state from either order of answering', () => {
    // Approvers first, then the waiver.
    const a = nextAdvanceStep({
      ...bothOutstanding,
      approverIds: APPROVERS,
      overrideReason: REASON,
    });
    // Waiver first, then approvers. Same state, same result — the point being
    // that nothing depends on which dialog the operator closed last.
    const b = nextAdvanceStep({
      ...bothOutstanding,
      overrideReason: REASON,
      approverIds: APPROVERS,
    });
    expect(a).toEqual(b);
    expect(a.kind).toBe('SUBMIT');
  });

  it('never leaves the operator with nowhere to go', () => {
    // Every combination of the four inputs resolves to a gate or a submission,
    // and any state that is not submittable names something still to collect.
    for (const evidenceComplete of [true, false]) {
      for (const needsDualAuthorisation of [true, false]) {
        for (const inspectionPassed of [true, false]) {
          for (const overrideReason of [undefined, REASON]) {
            for (const approverIds of [undefined, ['u-akash'], APPROVERS]) {
              const step = nextAdvanceStep({
                evidenceComplete,
                needsDualAuthorisation,
                inspectionPassed,
                overrideReason,
                approverIds,
              });
              expect(['COLLECT_EVIDENCE', 'COLLECT_APPROVERS', 'SUBMIT']).toContain(step.kind);
              // Whenever it submits, everything gathered is on the request.
              if (step.kind === 'SUBMIT') {
                if (!evidenceComplete) expect(step.request.evidenceOverrideReason).toBe(REASON);
                if (needsDualAuthorisation) expect(step.request.approverIds).toHaveLength(2);
              }
            }
          }
        }
      }
    }
  });
});

describe('buildAdvanceRequest — nothing spurious is sent', () => {
  it('omits approvers when the stage does not need them', () => {
    expect(buildAdvanceRequest({ ...base, approverIds: APPROVERS }).approverIds).toBeUndefined();
  });

  it('omits the waiver when the evidence is actually complete', () => {
    expect(
      buildAdvanceRequest({ ...base, overrideReason: REASON }).evidenceOverrideReason,
    ).toBeUndefined();
  });

  it('trims the reason it does send', () => {
    expect(
      buildAdvanceRequest({
        ...base,
        evidenceComplete: false,
        overrideReason: `  ${REASON}  `,
      }).evidenceOverrideReason,
    ).toBe(REASON);
  });
});
