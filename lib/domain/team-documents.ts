/**
 * The documents a desk is answerable for producing, across the whole order.
 *
 * The step tiles already say what each STEP produces. This is the other cut:
 * everything on this order that is THIS desk's to write, gathered in one place,
 * because a desk asking "what do I owe on this order" should not have to open
 * eleven steps to find out.
 *
 * A document is here when the flow map names this desk as its provider and the
 * step that calls for it is on the order's own ladder. Both halves matter: the
 * first keeps another desk's paperwork off the list, and the second keeps off
 * documents from phases this order never runs — offering to draft a test report
 * on an order with no testing is offering to invent one.
 */

import { applicableStages, getStage, type StageContext } from './stages';
import { evidenceFor } from './stage-evidence';
import { docFlowFor } from './document-flow';
import { STAKEHOLDER_META, type Stakeholder } from './enums';

/** Where a document stands between being drafted and being sent. */
export type DocReviewStatus = 'FILED' | 'DRAFT' | 'APPROVED' | 'SENT';

export interface ProducibleDoc {
  /** The evidence gate's id — what a generated document is filed under. */
  id: string;
  label: string;
  /** The step that calls for it. */
  stageId: string;
  stageCode: string;
  stageLabel: string;
  /** Whether the gate will refuse the step without it. */
  required: boolean;
  /** Why it exists, in terms of who is blocked without it. */
  why: string;
  /** The parties it goes to once approved. */
  recipients: Stakeholder[];
  recipientLabels: string[];
  /** True where nobody outside this desk is waiting — there is nobody to send to. */
  internalOnly: boolean;
}

/**
 * Everything `team` is answerable for producing on this order.
 *
 * Ordered by the ladder so the list reads in the sequence the desk will
 * actually need them, rather than alphabetically or by whatever the evidence
 * spec happened to declare first.
 */
export function producibleDocuments(team: Stakeholder, ctx: StageContext): ProducibleDoc[] {
  const out: ProducibleDoc[] = [];

  for (const stage of applicableStages(ctx)) {
    for (const d of evidenceFor(stage.id)?.documents ?? []) {
      const flow = docFlowFor(d.id);
      if (flow?.provider !== team) continue;

      // Somebody outside this desk. Our own other teams count as recipients —
      // Finance genuinely waits on Inbound's goods receipt note — but the desk
      // that wrote it does not need it sent to itself.
      const recipients = flow.requiredBy.filter((r) => r !== team);

      out.push({
        id: d.id,
        label: d.label,
        stageId: stage.id,
        stageCode: stage.code,
        stageLabel: stage.label,
        required: d.required ?? false,
        why: flow.why,
        recipients,
        recipientLabels: recipients.map((r) => STAKEHOLDER_META[r].label),
        internalOnly: recipients.length === 0,
      });
    }
  }

  return out;
}

/**
 * Whether a desk may generate a given document on this order.
 *
 * Checked server-side before anything is written. The UI only offers what this
 * returns true for, and that is exactly why the action re-asks: a control that
 * is merely hidden is not a rule.
 */
export function mayProduce(team: Stakeholder, docId: string, ctx: StageContext): boolean {
  return producibleDocuments(team, ctx).some((d) => d.id === docId);
}

/** The step a producible document belongs to, or null if the desk cannot produce it. */
export function stageForDocument(
  team: Stakeholder,
  docId: string,
  ctx: StageContext,
): string | null {
  return producibleDocuments(team, ctx).find((d) => d.id === docId)?.stageId ?? null;
}

/**
 * What the desk should do next with a document in a given state.
 *
 * Stated once here rather than in the component, so the button and the server
 * action cannot disagree about whether something is sendable.
 */
export function nextActionFor(
  status: DocReviewStatus,
  internalOnly: boolean,
): 'GENERATE' | 'APPROVE' | 'SEND' | 'DONE' {
  if (status === 'DRAFT') return 'APPROVE';
  if (status === 'APPROVED') return internalOnly ? 'DONE' : 'SEND';
  if (status === 'SENT') return 'DONE';
  // FILED covers a document that arrived some other way — from the agent, from
  // a counterparty, from the seed. It is already on the order and there is
  // nothing for this desk to draft.
  return 'GENERATE';
}

/** The label a step's own name reads better as, on a list spanning the order. */
export const documentStepLabel = (stageId: string): string => {
  const s = getStage(stageId);
  return `${s.code} ${s.label}`;
};
