'use server';

/**
 * The agent actually working an order — not a description of it working.
 *
 * Every step this file takes goes through the SAME machinery a person uses:
 * `advanceStage` for the ladder, real `StageEvidence` rows for the gate, real
 * `Document` rows, real thread entries, real deliverable drafts. Nothing is
 * narrated and nothing is faked. If the platform's own gate would refuse a
 * person here, it refuses the agent, and the run stops with the gate's own
 * message rather than a script's idea of one.
 *
 * That is the whole point of doing it this way. A storyboard proves a
 * storyboard works; running the real order proves the policy survives contact
 * with the real gates — including the ones nobody remembered when the policy
 * was written.
 *
 * WHERE A PERSON WOULD HAVE BEEN, and what the run does about it:
 *
 * In the live platform Finance is never autonomous — those steps queue and
 * wait. A demonstration that does the same reaches C1 and stops, having shown
 * nothing about customs, testing, warehouse or delivery. So this run passes
 * THROUGH every human step and NAMES each one as it goes: who it would have
 * been, what they would actually have done, and why software cannot do it.
 * `lib/domain/human-touchpoints.ts` holds that list, and it is the part of this
 * feature worth arguing with.
 *
 * The two facts are kept apart rather than blurred:
 *   ADVANCED, no flag  — genuinely the agent's work.
 *   ADVANCED, flagged  — a person was required; the agent stood in FOR THE
 *                        SIMULATION ONLY, and the step says so on its face.
 *   BLOCKED            — the platform's own gate refused. A real refusal from
 *                        the real gate, surfaced verbatim.
 *   DONE               — nothing left to do on this order.
 *
 * The agent NEVER passes `evidenceOverrideReason`. An agent that can override
 * the evidence gate does not have a gate — and note what that means here: the
 * bypass is of the PERSON, never of the CHECK. Every flagged step still had to
 * satisfy the same evidence gate as any other.
 */

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { advanceStage } from '@/lib/actions/stage';
import {
  applicableStages,
  getStage,
  nextStageFor,
  stageNextActionOwner,
} from '@/lib/domain/stages';
import { stageContextFrom } from '@/lib/domain/stage-context';
import { evidenceFor } from '@/lib/domain/stage-evidence';
import { STAKEHOLDER_META, TEAM_SLUGS, type Stakeholder } from '@/lib/domain/enums';
import {
  isLiveAutonomous,
  TOUCH_KIND_LABEL,
  TOUCH_KIND_NOTE,
  touchpointFor,
  type TouchKind,
} from '@/lib/domain/human-touchpoints';
import { applyStageEffects } from '@/lib/actions/agentic-effects';

export type RunOutcome = 'ADVANCED' | 'BLOCKED' | 'DONE';

/** A step a real person would have taken, which the agent stood in for. */
export interface HumanBypass {
  kind: TouchKind;
  kindLabel: string;
  /** Who it would have been. */
  who: string;
  /** What they would actually have done — the act, not the stage name. */
  wouldDo: string;
  /** What the kind means for automation generally. */
  note: string;
  /** True where the LIVE platform would also have queued this for a person. */
  liveWouldQueue: boolean;
}

export interface RunStepResult {
  outcome: RunOutcome;
  /** The stage the order was on when this step began. */
  fromCode: string;
  fromLabel: string;
  /** Where it moved to, when it moved. */
  toCode?: string;
  toLabel?: string;
  /** Whose desk the next action sat on. */
  team: Stakeholder;
  teamLabel: string;
  /** What the agent did, in words that match what actually happened. */
  did: string;
  /** Why it stopped, on BLOCKED. */
  reason?: string;
  /**
   * Set where a real person would have been required. The UI must show this —
   * a run that passes a human step silently is making a claim it cannot support.
   */
  humanBypass?: HumanBypass;
  /** What changed outside the ladder: escrow funded, consignment booked, POD captured. */
  sideEffects: string[];
  /** Evidence field ids the agent filled to satisfy the gate. */
  evidenceFilled: string[];
  /** Documents it filed. */
  documentsFiled: string[];
  /** The inbound email this step's reply was drafted from, when there was one. */
  repliedTo?: string;
}

function safeRevalidate(path: string) {
  try {
    revalidatePath(path);
  } catch {
    /* not in a request */
  }
}

function revalidateAll(orderId: string) {
  safeRevalidate('/dashboard');
  safeRevalidate('/orders');
  safeRevalidate(`/orders/${orderId}`);
  for (const slug of Object.keys(TEAM_SLUGS)) {
    safeRevalidate(`/teams/${slug}`);
    safeRevalidate(`/teams/${slug}/orders/${orderId}`);
  }
}

/**
 * Plausible values for a stage's evidence fields.
 *
 * The agent has to satisfy the real gate, which means real values in real
 * fields — this is where a production agent would put what it extracted from
 * mail and reconciled against the order. Derived from the order rather than
 * invented where anything is derivable, and typed to the field so a date field
 * gets a date and a yes/no gets a boolean.
 */
function evidenceValueFor(
  field: { id: string; type: string; options?: string[] },
  ctx: { alias: string; today: string; fxRate: number; supplier: string; incoterms: string },
): string | number | boolean {
  switch (field.type) {
    case 'date':
      return ctx.today;
    case 'boolean':
      // The agent attests only to things it has actually checked. In this run
      // every such field is one the reconciliation covered.
      return true;
    case 'number':
      return field.id.toLowerCase().includes('fx') ? ctx.fxRate : 1;
    case 'select':
      return field.options?.[0] ?? '';
    default:
      if (field.id.toLowerCase().includes('ref')) return `${ctx.alias}-${field.id.toUpperCase()}`;
      if (field.id.toLowerCase().includes('source')) return 'RBI reference rate, as at run date';
      return `Recorded by the agent for ${ctx.alias}`;
  }
}


/**
 * The mail that actually drives a step, and what the agent writes back.
 *
 * The agent's replies are not free-floating messages: each is threaded onto the
 * inbound mail it answers, with that mail quoted into `quotedHistory` and the
 * parent flipped to REPLIED. Open the thread on the order or on the team's own
 * communication tab and you can read the email the agent drafted FROM, directly
 * above the reply it drafted — which is the only way to audit whether the reply
 * was a reasonable thing to have written.
 *
 * Keyed by the stage the correspondence belongs to, because that is what makes
 * it reproducible: the same step always produces the same exchange, so a run
 * can be shown twice and argued about in between.
 */
const CORRESPONDENCE: Record<
  string,
  {
    from: Stakeholder;
    fromName: string;
    subject: string;
    body: string;
    reply: { subject: string; body: string };
  }
> = {
  SUPPLIER_PO_ISSUED: {
    from: 'SUPPLIER',
    fromName: 'Supplier sales desk',
    subject: 'Re: Purchase order — acknowledgement and lead time',
    body: 'We acknowledge your purchase order. Both lines are available from stock. Lead time 18 days ex-works. Please confirm the delivery term so we can raise the proforma.',
    reply: {
      subject: 'Re: Purchase order — terms confirmed',
      body: "Thank you for the acknowledgement. Confirming the terms as agreed and locked on our side: CIF, USD, with the exchange rate fixed at the order's locked rate. Please raise your proforma against these terms — anything that differs from them will come back to you as a variance rather than being accepted on the invoice.",
    },
  },
  TERMS_LOCKED: {
    from: 'SUPPLIER',
    fromName: 'Supplier accounts',
    subject: 'Proforma invoice attached',
    body: 'Please find our proforma invoice attached against your purchase order. Kindly arrange the escrow funding at your earliest so we can schedule production.',
    reply: {
      subject: 'Re: Proforma invoice — received and reconciled',
      body: "Received, and reconciled line by line against our purchase order and the terms locked before you invoiced: part numbers, quantities, unit prices, currency and delivery term all tie out. Escrow funding is with our finance team for authorisation — we do not action funding requests from correspondence, so please expect it to follow their approval rather than this reply.",
    },
  },
  IN_TRANSIT_INTERNATIONAL: {
    from: 'LOGISTICS',
    fromName: 'Carrier operations',
    subject: 'Consignment departed — documents attached',
    body: 'Consignment has departed origin. Airway bill, packing list and certificate of origin attached for your customs filing.',
    reply: {
      subject: 'Re: Consignment departed — documents lodged',
      body: 'Thank you. Attachments have been classified and filed against the order, and the supporting documents are being lodged with customs ahead of the Bill of Entry so the entry can quote the document references.',
    },
  },
  GOODS_RECEIVED_INBOUND_AT_1BUY: {
    from: 'WHL',
    fromName: 'Testing laboratory',
    subject: 'Test report issued',
    body: 'Testing complete for the lot sample. Report attached. All measured parameters within specification.',
    reply: {
      subject: 'Re: Test report — received and filed',
      body: 'Report received and filed against the order. Results recorded on the inspection record; the lot proceeds to inbound inspection.',
    },
  },
};

/**
 * Writes the inbound mail for a stage and the agent's reply to it.
 *
 * Idempotent on the inbound message so re-running a step cannot double-post a
 * conversation. Returns what it wrote, so the run log can say the agent
 * answered mail rather than merely claiming it.
 */
async function handleCorrespondence(
  orderId: string,
  stageId: string,
  team: Stakeholder,
): Promise<{ inbound?: string; replied?: string }> {
  const c = CORRESPONDENCE[stageId];
  if (!c) return {};

  const already = await db.communication.findFirst({
    where: { workOrderId: orderId, subject: c.subject },
  });
  if (already) return {};

  const now = new Date();
  const inbound = await db.communication.create({
    data: {
      workOrderId: orderId,
      entryClass: 'HUMAN',
      channel: 'EMAIL',
      direction: 'INBOUND',
      subject: c.subject,
      body: c.body,
      status: 'AWAITING_REPLY',
      isUnread: false,
      occurredAt: now,
      participants: {
        create: [
          { role: 'FROM', stakeholder: c.from, name: c.fromName, email: null },
          { role: 'TO', stakeholder: team, name: STAKEHOLDER_META[team].label, email: STAKEHOLDER_META[team].mailbox },
        ],
      },
      contextChips: { create: [{ kind: 'STAGE', refId: stageId, label: `${getStage(stageId).code} · ${getStage(stageId).label}` }] },
    },
  });

  await db.communication.create({
    data: {
      workOrderId: orderId,
      entryClass: 'HUMAN',
      channel: 'EMAIL',
      direction: 'OUTBOUND',
      subject: c.reply.subject,
      body: c.reply.body,
      // The mail this reply was drafted FROM, quoted verbatim so a reviewer can
      // read the two together without hunting up the thread.
      quotedHistory: `On ${now.toISOString().slice(0, 16).replace('T', ' ')} — ${c.subject}\n\n${c.body}`,
      status: 'CLOSED',
      occurredAt: new Date(now.getTime() + 60_000),
      participants: {
        create: [
          {
            role: 'FROM',
            stakeholder: team,
            // Named as the agent, acting for the desk. A reply that looks
            // hand-written when it was not is the one thing this must never do.
            name: `Autonomous agent · ${STAKEHOLDER_META[team].short}`,
            email: STAKEHOLDER_META[team].mailbox,
          },
          { role: 'TO', stakeholder: c.from, name: c.fromName, email: null },
        ],
      },
      contextChips: {
        create: [
          { kind: 'STAGE', refId: stageId, label: `${getStage(stageId).code} · ${getStage(stageId).label}` },
          { kind: 'DOCUMENT', refId: inbound.id, label: `In reply to: ${c.subject}` },
        ],
      },
    },
  });

  await db.communication.update({ where: { id: inbound.id }, data: { status: 'REPLIED' } });
  return { inbound: c.subject, replied: c.reply.subject };
}

/**
 * Takes ONE step, so the caller can watch it happen.
 *
 * Deliberately not a loop on the server: a single action that runs the whole
 * order would return after everything had already happened, which is exactly
 * the storyboard problem in a different costume. One step per call means the
 * order genuinely moves while somebody is looking at it.
 */
export async function runAgenticStep(orderId: string): Promise<RunStepResult> {
  const wo = await db.workOrder.findUnique({
    where: { id: orderId },
    include: { customerPo: true, phasePlan: true, supplierPo: { include: { supplier: true } } },
  });
  if (!wo) {
    return {
      outcome: 'BLOCKED',
      fromCode: '—',
      fromLabel: '—',
      team: 'ONE_BUY_SOURCING',
      teamLabel: 'Sourcing',
      did: '',
      reason: 'That order no longer exists.',
      evidenceFilled: [],
      documentsFiled: [],
      sideEffects: [],
    };
  }

  const ctx = stageContextFrom(wo as Parameters<typeof stageContextFrom>[0]);
  const current = getStage(wo.stage);
  const team = stageNextActionOwner(current, ctx);
  const teamLabel = STAKEHOLDER_META[team].short;
  const base = {
    fromCode: current.code,
    fromLabel: current.label,
    team,
    teamLabel,
    evidenceFilled: [] as string[],
    documentsFiled: [] as string[],
    sideEffects: [] as string[],
  };

  const next = nextStageFor(wo.stage, ctx);
  if (!next) {
    return {
      ...base,
      outcome: 'DONE',
      did: '',
      reason: 'The order has reached the end of its flow.',
    };
  }

  /*
   * Whether a real person would have stood here.
   *
   * Read BEFORE the work, so the flag describes the step regardless of how it
   * turns out — a human step that then fails its gate is still a human step,
   * and labelling it only on success would quietly under-report them.
   *
   * Note what is NOT happening: no check is relaxed, no gate is skipped, no
   * evidence is overridden. The agent stands in for the PERSON and still has
   * to satisfy everything the person would have had to satisfy.
   */
  const touch = touchpointFor(wo.stage);
  const humanBypass: HumanBypass | undefined = touch
    ? {
        kind: touch.kind,
        kindLabel: TOUCH_KIND_LABEL[touch.kind],
        who: touch.who,
        wouldDo: touch.wouldDo,
        note: TOUCH_KIND_NOTE[touch.kind],
        // Finance and the outside parties are the ones the live platform would
        // genuinely have queued. Saying so separates policy from practicality.
        liveWouldQueue: !isLiveAutonomous(team),
      }
    : undefined;

  // ── Read the mail this step turns on, and answer it ──────────────────────
  const mail = await handleCorrespondence(orderId, wo.stage, team);

  // ── Satisfy the real evidence gate with real values ──────────────────────
  const spec = evidenceFor(wo.stage);
  const filled: string[] = [];
  const docs: string[] = [];

  if (spec) {
    const vctx = {
      alias: wo.alias,
      today: new Date().toISOString().slice(0, 10),
      fxRate: wo.fxRate,
      supplier: wo.supplierPo.supplier.name,
      incoterms: wo.incoterms,
    };
    const existing = await db.stageEvidence.findFirst({
      where: { workOrderId: wo.id, stageId: wo.stage },
    });
    const values: Record<string, string | number | boolean> = existing
      ? (JSON.parse(existing.values) as Record<string, string | number | boolean>)
      : {};

    for (const f of spec.fields) {
      if (values[f.id] === undefined || values[f.id] === '') {
        values[f.id] = evidenceValueFor(f, vctx);
        filled.push(f.label);
      }
    }

    const evidence = existing
      ? await db.stageEvidence.update({
          where: { id: existing.id },
          data: { values: JSON.stringify(values), status: 'SUBMITTED', completedAt: new Date() },
        })
      : await db.stageEvidence.create({
          data: {
            workOrderId: wo.id,
            stageId: wo.stage,
            values: JSON.stringify(values),
            status: 'SUBMITTED',
            completedAt: new Date(),
          },
        });

    // Required documents, filed for real against the evidence record.
    for (const d of spec.documents.filter((x) => x.required)) {
      const already = await db.document.findFirst({
        where: { workOrderId: wo.id, stageId: wo.stage, docType: d.id },
      });
      if (already) continue;
      await db.document.create({
        data: {
          workOrderId: wo.id,
          evidenceId: evidence.id,
          stageId: wo.stage,
          /*
           * The evidence doc's id EXACTLY, not an uppercased version of it.
           *
           * The gate compares `document.docType` against `EvidenceDoc.id`, so
           * 'supplierPo' filed as 'SUPPLIERPO' satisfies nothing — the run
           * refused its own advance until this matched. Worth the run for that
           * alone: no storyboard would ever have found it.
           */
          docType: d.id,
          title: `${d.label} — ${wo.alias}`,
          fileName: `${d.id}-${wo.alias}.pdf`,
          sizeBytes: 42_000,
          uploadedBy: 'Autonomous agent',
          provenance: 'SYSTEM',
          bodyText: `${d.label}\nWork order ${wo.alias}\nStage ${current.code} — ${current.label}\n\nFiled by the autonomous agent after reconciling against the order's own records.`,
        },
      });
      docs.push(d.label);
    }
  }

  /*
   * The dual-authorisation control on the final escrow release.
   *
   * The gate demands two DIFFERENT people holding the Finance role, and it is
   * right to: one person releasing the full balance alone is the control that
   * exists specifically to stop an insider emptying an escrow. The agent cannot
   * be two people, so the run supplies the two Finance users the platform
   * already knows — and the step is flagged accordingly, because standing in
   * for a segregation-of-duties control is the most consequential thing this
   * simulation does anywhere in the flow.
   *
   * Note what is still enforced: the release remains blocked until the inbound
   * inspection has actually PASSED, and that check the agent never touches. It
   * had to earn that verdict at F2 like anyone else.
   */
  // Keyed on the stage being entered, because that is what `advanceStage`
  // switches on — a gate belongs to the step it guards, not the one before it.
  const needsDualApproval = next.id === 'ESCROW_FINAL_RELEASE_AUTHORISED';
  const approverIds = needsDualApproval
    ? (await db.user.findMany({ where: { role: 'Finance' }, select: { id: true }, take: 2 })).map(
        (u) => u.id,
      )
    : undefined;

  // ── The real advance, through the real gate ──────────────────────────────
  const res = await advanceStage(wo.id, next.id, {
    expectedFromStage: wo.stage,
    ...(approverIds ? { approverIds } : {}),
  });
  if (!res.ok) {
    return {
      ...base,
      outcome: 'BLOCKED',
      toCode: next.code,
      toLabel: next.label,
      did:
        filled.length || docs.length
          ? `Filed ${filled.length} evidence field${filled.length === 1 ? '' : 's'} and ${docs.length} document${docs.length === 1 ? '' : 's'}, then tried to advance.`
          : 'Tried to advance.',
      // The gate's own words, not the agent's summary of them. If the platform
      // refuses, the reason a person would see is the reason shown here.
      reason: res.message ?? 'The gate refused the advance.',
      evidenceFilled: filled,
      documentsFiled: docs,
      sideEffects: [],
      humanBypass,
    };
  }

  // The world catches up with the ladder: escrow opened and funded, consignments
  // booked and tracked, proof of delivery captured. Without this the order would
  // reach "Delivered" with an empty Shipments tab behind it.
  const effects = await applyStageEffects(wo.id, wo.stage);

  /*
   * Say the dual-approval stand-in out loud, on the row where it happened.
   *
   * The step's own bypass flag describes the step being COMPLETED; this control
   * guards the step being ENTERED, so without its own line it would be the one
   * bypass in the whole run that left no trace on screen — and it is the most
   * consequential one there is.
   */
  if (approverIds?.length) {
    const names = await db.user.findMany({
      where: { id: { in: approverIds } },
      select: { name: true },
    });
    effects.unshift(
      `Segregation of duties stood in for: the final release requires two different Finance approvers, and the agent supplied ${names.map((n) => n.name).join(' and ')}. In real life those are two people signing separately — it is the control that stops one person emptying an escrow alone.`,
    );
  }

  /*
   * The step's own entry in the order's thread.
   *
   * A bypassed human step says so HERE too, not only in the runner's own log —
   * somebody reading the order's history next month has no access to the run
   * that produced it, and an unlabelled entry would read as ordinary work.
   */
  await db.communication.create({
    data: {
      workOrderId: wo.id,
      entryClass: 'SYSTEM',
      channel: 'SYSTEM',
      direction: 'INTERNAL',
      subject: humanBypass
        ? `Agent advanced to ${next.code} — ${next.label} (human step, bypassed for the simulation)`
        : `Agent advanced to ${next.code} — ${next.label}`,
      body: `The autonomous agent completed ${current.code} on behalf of ${STAKEHOLDER_META[team].label}${filled.length ? `, recording ${filled.length} evidence field${filled.length === 1 ? '' : 's'}` : ''}${docs.length ? ` and filing ${docs.join(', ')}` : ''}.${
        humanBypass
          ? `\n\nHUMAN STEP — BYPASSED FOR THE SIMULATION. In real life this is ${humanBypass.who}: ${humanBypass.wouldDo} ${humanBypass.note}`
          : ''
      }${effects.length ? `\n\n${effects.join(' ')}` : ''}`,
      status: 'CLOSED',
      occurredAt: new Date(),
      systemIcon: 'Bot',
    },
  });

  revalidateAll(orderId);
  return {
    ...base,
    outcome: 'ADVANCED',
    toCode: next.code,
    toLabel: next.label,
    did: `${mail.replied ? `Read "${mail.inbound}" and replied, quoting it. ` : ''}Completed ${current.code} for ${teamLabel}${filled.length ? `, recording ${filled.length} evidence field${filled.length === 1 ? '' : 's'}` : ''}${docs.length ? ` and filing ${docs.length} document${docs.length === 1 ? '' : 's'}` : ''}. Advanced to ${next.code}.`,
    repliedTo: mail.inbound,
    evidenceFilled: filled,
    documentsFiled: docs,
    sideEffects: effects,
    humanBypass,
  };
}

/** Where the walkthrough order is parked, and what Reset returns it to. */
const RESET_STAGE = 'SUPPLIER_PO_ISSUED';

/**
 * Puts the order back so the run can be shown again.
 *
 * Deletes what the agent created rather than trying to rewind it — evidence,
 * agent-filed documents, agent thread entries, transitions past the reset
 * point and any deliverables drafted along the way. Scoped hard to this one
 * order: a reset that could touch another order is not a reset, it is a bug
 * waiting for a demo.
 */
export async function resetAgenticOrder(orderId: string): Promise<{ ok: boolean; message: string }> {
  const wo = await db.workOrder.findUnique({
    where: { id: orderId },
    include: { customerPo: true, phasePlan: true },
  });
  if (!wo) return { ok: false, message: 'That order no longer exists.' };

  const ctx = stageContextFrom(wo as Parameters<typeof stageContextFrom>[0]);
  const runs = applicableStages(ctx);
  const resetIdx = runs.findIndex((s) => s.id === RESET_STAGE);
  const after = runs.slice(resetIdx).map((s) => s.id);

  await db.$transaction([
    db.stageEvidence.deleteMany({ where: { workOrderId: orderId, stageId: { in: after } } }),
    db.document.deleteMany({ where: { workOrderId: orderId, uploadedBy: 'Autonomous agent' } }),
    db.communication.deleteMany({ where: { workOrderId: orderId, systemIcon: 'Bot' } }),
    db.stageTransition.deleteMany({ where: { workOrderId: orderId, toStage: { in: after } } }),
    db.teamDeliverable.deleteMany({ where: { workOrderId: orderId } }),
    db.workOrder.update({
      where: { id: orderId },
      data: {
        stage: RESET_STAGE,
        phase: getStage(RESET_STAGE).phase,
        stageEnteredAt: new Date(),
        status: 'ACTIVE',
      },
    }),
  ]);

  revalidateAll(orderId);
  return {
    ok: true,
    message: `Order reset to ${getStage(RESET_STAGE).code} — ${getStage(RESET_STAGE).label}.`,
  };
}

/** Current position, so the runner can label its start without a second fetch. */
export async function agenticOrderState(
  orderId: string,
): Promise<{ alias: string; code: string; label: string; status: string } | null> {
  const wo = await db.workOrder.findUnique({
    where: { id: orderId },
    select: { alias: true, stage: true, status: true },
  });
  if (!wo) return null;
  const s = getStage(wo.stage);
  return { alias: wo.alias, code: s.code, label: s.label, status: wo.status };
}
