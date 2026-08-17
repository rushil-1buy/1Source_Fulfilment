/**
 * The agent as a companion rather than an autopilot: what to do next, who it is
 * with, and the message to send them.
 *
 * WHAT THIS IS NOT. No model is called here. Every suggestion is derived from
 * the order's own state — the stage it sits on, the evidence fields still
 * blank, the documents still owed and the party that owes each one — and the
 * drafts are assembled from those same facts. That is a deliberate choice and
 * not a placeholder: a suggestion a desk cannot trace back to something true
 * about the order is a suggestion they will learn to ignore, and the first time
 * it invents a document reference in an email to a supplier is the last time
 * anybody uses it.
 *
 * WHAT IT IS FOR. The desk keeps the decision; the agent removes the lookup.
 * "Chase the supplier" is a reminder. "The commercial invoice is the only thing
 * still missing before the CHA can file, the supplier owes it, and here is the
 * mail quoting the purchase order number" is the work already done.
 *
 * Every draft is a DRAFT. It is shown for a person to read, edit and send, and
 * the UI says so — an agent that sends mail to a counterparty on its own
 * authority is a different product with a different risk profile.
 */

import { getStage, stageNextActionOwner, type StageContext } from './stages';
import { evidenceFor } from './stage-evidence';
import { STAKEHOLDER_META, type Stakeholder } from './enums';
import { stepBrief, type StepDocument } from './step-brief';
import { touchpointFor } from './human-touchpoints';

export type SuggestionKind =
  /** Something must be recorded before the gate will let the order move. */
  | 'RECORD'
  /** A document is owed by somebody outside this desk. */
  | 'CHASE'
  /** Everything is in; the step can be completed. */
  | 'ADVANCE'
  /** The next move belongs to another desk or party. */
  | 'HANDOVER'
  /** A person is genuinely required — the agent can prepare, not decide. */
  | 'DECIDE';

export interface AgentSuggestion {
  kind: SuggestionKind;
  /** The headline, phrased as the action. */
  title: string;
  /** Why this is the next thing, in terms of the order's own state. */
  because: string;
  /** Whose move it is. */
  owner: Stakeholder;
  ownerLabel: string;
  /** Ranked; lower is more urgent. */
  rank: number;
}

export interface AgentDraft {
  /** Who it goes to. */
  to: Stakeholder;
  toLabel: string;
  subject: string;
  body: string;
  /** What in the order this draft was assembled from. */
  basedOn: string;
}

export interface AgentBriefing {
  /** One sentence on where the order stands. */
  situation: string;
  suggestions: AgentSuggestion[];
  /** A message ready to be read, edited and sent — never sent by the agent. */
  draft: AgentDraft | null;
  /** The step after this one, so a desk can see where it is heading. */
  lookahead: string | null;
}

export interface GuidanceInput {
  stageId: string;
  ctx: StageContext;
  incoterms: { buy: string | null; sell: string | null };
  /** Evidence values already recorded for this stage. */
  recorded: Record<string, unknown>;
  /** Document ids already filed against this stage. */
  filed: string[];
  /** Order references, so a draft can quote something real. */
  refs: {
    alias: string;
    customerPo: string;
    supplierPo: string;
    customer: string;
    supplier: string;
  };
}

const KIND_RANK: Record<SuggestionKind, number> = {
  DECIDE: 0,
  RECORD: 1,
  CHASE: 2,
  ADVANCE: 3,
  HANDOVER: 4,
};

/** Blank, missing or empty-string values all count as not recorded. */
const isBlank = (v: unknown) => v === undefined || v === null || v === '';

/**
 * What the agent suggests, given where the order actually is.
 *
 * Ordered by what blocks what: a decision a person owes comes before data entry,
 * data entry before a chase, and "you can advance" only appears when nothing
 * else is outstanding — so the top line is always the thing genuinely in the way.
 */
export function agentBriefing(input: GuidanceInput): AgentBriefing {
  const { stageId, ctx, incoterms, recorded, filed, refs } = input;
  const stage = getStage(stageId);
  const brief = stepBrief(stageId, ctx, incoterms);
  const spec = evidenceFor(stageId);

  const missingFields = (spec?.fields ?? []).filter(
    (f) => f.required !== false && isBlank(recorded[f.id]),
  );
  const filedSet = new Set(filed);
  const missingDocs = [...brief.creates, ...brief.receives].filter(
    (d) => d.required && !filedSet.has(d.id),
  );
  const owedByOthers = missingDocs.filter((d) => d.provider !== brief.responsibility.entity);
  const owedByUs = missingDocs.filter((d) => d.provider === brief.responsibility.entity);

  const suggestions: AgentSuggestion[] = [];
  const add = (s: Omit<AgentSuggestion, 'rank' | 'ownerLabel'>) =>
    suggestions.push({
      ...s,
      ownerLabel: STAKEHOLDER_META[s.owner].label,
      rank: KIND_RANK[s.kind],
    });

  // ── A person is genuinely required here ──────────────────────────────────
  const touch = touchpointFor(stageId);
  if (touch) {
    add({
      kind: 'DECIDE',
      title: `${touch.who} has to take this one`,
      because: `${touch.wouldDo} The agent can prepare everything around it; the decision is not ours to make.`,
      owner: brief.responsibility.entity,
    });
  }

  // ── Ours to produce ──────────────────────────────────────────────────────
  for (const d of owedByUs) {
    add({
      kind: 'RECORD',
      title: `Produce the ${d.label.toLowerCase()}`,
      because: `${d.why} It is ours to raise, and the step will not close without it.`,
      owner: d.provider,
    });
  }

  // ── Somebody else owes us something ──────────────────────────────────────
  for (const d of owedByOthers) {
    add({
      kind: 'CHASE',
      title: `Chase ${STAKEHOLDER_META[d.provider].short} for the ${d.label.toLowerCase()}`,
      because: `${d.why} It is theirs to provide and nothing here moves until it arrives.`,
      owner: d.provider,
    });
  }

  // ── Evidence still blank ─────────────────────────────────────────────────
  if (missingFields.length > 0) {
    add({
      kind: 'RECORD',
      title:
        missingFields.length === 1
          ? `Record "${missingFields[0].label}"`
          : `Record ${missingFields.length} outstanding details`,
      because:
        missingFields.length === 1
          ? 'It is the only field the gate is still waiting on for this step.'
          : `The gate is waiting on: ${missingFields.map((f) => f.label).join(', ')}.`,
      owner: brief.responsibility.entity,
    });
  }

  // ── Nothing outstanding ──────────────────────────────────────────────────
  if (missingFields.length === 0 && missingDocs.length === 0 && !touch) {
    add({
      kind: 'ADVANCE',
      title: `Complete ${stage.code} and move the order on`,
      because: 'Every field the gate asks for is recorded and every required document is filed.',
      owner: brief.responsibility.entity,
    });
  }

  // ── Whose move is next ───────────────────────────────────────────────────
  const nextOwner = stageNextActionOwner(stage, ctx);
  if (nextOwner !== brief.responsibility.entity) {
    add({
      kind: 'HANDOVER',
      title: `Then it is ${STAKEHOLDER_META[nextOwner].short}'s move`,
      because: stage.nextAction,
      owner: nextOwner,
    });
  }

  suggestions.sort((a, b) => a.rank - b.rank);

  return {
    situation: situationLine(stageId, brief.responsibility.label, missingFields.length, missingDocs.length),
    suggestions,
    draft: draftFor(owedByOthers[0] ?? null, refs, stage.code, stage.label),
    lookahead: stage.nextAction,
  };
}

function situationLine(
  stageId: string,
  responsible: string,
  fieldsMissing: number,
  docsMissing: number,
): string {
  const stage = getStage(stageId);
  if (fieldsMissing === 0 && docsMissing === 0)
    return `${stage.code} ${stage.label} is with ${responsible}, and everything it needs is in.`;
  const bits: string[] = [];
  if (docsMissing > 0)
    bits.push(`${docsMissing} document${docsMissing === 1 ? '' : 's'} still outstanding`);
  if (fieldsMissing > 0)
    bits.push(`${fieldsMissing} detail${fieldsMissing === 1 ? '' : 's'} not yet recorded`);
  return `${stage.code} ${stage.label} is with ${responsible}, with ${bits.join(' and ')}.`;
}

/**
 * A message chasing whoever owes the first missing document.
 *
 * Quotes the order's real references, because a chase that does not identify
 * the order is a chase the recipient has to answer with a question. Returns
 * null when nothing is owed by anybody outside — the agent offering to draft a
 * mail nobody needs to send is the behaviour that gets a feature switched off.
 */
function draftFor(
  doc: StepDocument | null,
  refs: GuidanceInput['refs'],
  code: string,
  label: string,
): AgentDraft | null {
  if (!doc) return null;

  const external = doc.provider === 'SUPPLIER' || doc.provider === 'CUSTOMER';
  const ref = doc.provider === 'CUSTOMER' ? refs.customerPo : refs.supplierPo;
  const them = doc.provider === 'CUSTOMER' ? refs.customer : refs.supplier;

  const subject = external
    ? `${refs.alias} — ${doc.label} outstanding against ${ref}`
    : `${refs.alias} — ${doc.label} needed to close ${code}`;

  const body = external
    ? `Dear ${them},

We are holding order ${refs.alias} at ${code} — ${label} — pending your ${doc.label.toLowerCase()}.

${doc.why}

Please send it against ${ref} at your earliest. If it has already gone out, the reference it was sent under would let us match it on our side.

Kind regards,
1BUY Fulfilment`
    : `${doc.label} is outstanding on ${refs.alias} at ${code} — ${label}.

${doc.why}

It sits with ${STAKEHOLDER_META[doc.provider].label}. Order references: customer ${refs.customerPo}, supplier ${refs.supplierPo}.`;

  return {
    to: doc.provider,
    toLabel: STAKEHOLDER_META[doc.provider].label,
    subject,
    body,
    basedOn: `Assembled from the order's own references and the ${doc.label.toLowerCase()} being unfiled at ${code}. Nothing in it was invented — read it before it goes.`,
  };
}
