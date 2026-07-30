/**
 * COMPOSING THE GATES IN FRONT OF A STAGE ADVANCE.
 *
 * Advancing an order can require the operator to satisfy more than one thing
 * before the server will accept it:
 *
 *   · evidence — the stage being LEFT must have proof on file, or a written
 *     reason for going on without it
 *   · dual authorisation — the final escrow release needs a passed inspection
 *     and two different Finance approvers
 *
 * Each is collected in its own dialog, and either can be outstanding on its own.
 * That is where this went wrong once already: the two dialogs were chained, and
 * only whichever closed LAST passed its answer to the server. An operator who had
 * to satisfy both — waive the evidence, then pick two approvers — had their waiver
 * reason silently dropped, the server refused for missing evidence, the client
 * reopened the evidence form, and the order could never leave the stage. A gate
 * that cannot be passed is worse than one that refuses, because it looks like it
 * is working.
 *
 * So the decision lives here instead of in component state, as one pure function
 * over everything gathered so far. The invariant it exists to hold:
 *
 *     THE SUBMITTED REQUEST CARRIES EVERY ANSWER COLLECTED, NO MATTER WHICH
 *     GATE HAPPENED TO BE SATISFIED LAST.
 */

/** Minimum length of a reason for advancing without complete evidence. */
export const OVERRIDE_REASON_MIN = 8;

export interface AdvanceGateState {
  /** Evidence for the stage being left is fully recorded. */
  evidenceComplete: boolean;
  /** The target stage requires two Finance approvers (the final escrow release). */
  needsDualAuthorisation: boolean;
  /** Only meaningful when dual authorisation applies. */
  inspectionPassed?: boolean;
  /** What the operator gave for proceeding without complete evidence. */
  overrideReason?: string | null;
  /** Approvers ticked so far. */
  approverIds?: readonly string[];
}

/** What actually goes to the server. */
export interface AdvanceRequest {
  approverIds?: string[];
  evidenceOverrideReason?: string;
}

export type AdvanceStep =
  /** Open the evidence form — nothing on file and no reason to skip it. */
  | { kind: 'COLLECT_EVIDENCE' }
  /** Open the approver dialog. */
  | { kind: 'COLLECT_APPROVERS'; reason: 'NEEDS_APPROVERS' | 'INSPECTION_NOT_PASSED' }
  /** Everything is in hand. */
  | { kind: 'SUBMIT'; request: AdvanceRequest };

/** A reason counts only if it is long enough to mean something. */
export function isUsableOverrideReason(reason: string | null | undefined): boolean {
  return (reason ?? '').trim().length >= OVERRIDE_REASON_MIN;
}

/** Distinct approvers, since ticking one person twice is still one signature. */
export function distinctApprovers(ids: readonly string[] | undefined): string[] {
  return [...new Set(ids ?? [])];
}

/**
 * The next thing to do, given everything collected so far.
 *
 * Deliberately total: for any state it either names a gate still to satisfy or
 * returns the complete request. There is no arrangement of inputs that leaves the
 * operator with nowhere to go, which is the failure this replaced.
 */
export function nextAdvanceStep(state: AdvanceGateState): AdvanceStep {
  const reason = (state.overrideReason ?? '').trim();
  const waived = isUsableOverrideReason(reason);

  if (!state.evidenceComplete && !waived) return { kind: 'COLLECT_EVIDENCE' };

  if (state.needsDualAuthorisation) {
    if (state.inspectionPassed === false) {
      return { kind: 'COLLECT_APPROVERS', reason: 'INSPECTION_NOT_PASSED' };
    }
    if (distinctApprovers(state.approverIds).length < 2) {
      return { kind: 'COLLECT_APPROVERS', reason: 'NEEDS_APPROVERS' };
    }
  }

  return { kind: 'SUBMIT', request: buildAdvanceRequest(state) };
}

/**
 * The request for a state that has cleared its gates.
 *
 * Both answers travel together. Sending only the one whose dialog closed most
 * recently is precisely the bug this module exists to prevent.
 */
export function buildAdvanceRequest(state: AdvanceGateState): AdvanceRequest {
  const request: AdvanceRequest = {};
  if (state.needsDualAuthorisation) {
    request.approverIds = distinctApprovers(state.approverIds);
  }
  // Carried whenever the evidence was actually waived — never dropped because
  // some other gate was the last one the operator dealt with.
  const reason = (state.overrideReason ?? '').trim();
  if (!state.evidenceComplete && isUsableOverrideReason(reason)) {
    request.evidenceOverrideReason = reason;
  }
  return request;
}
