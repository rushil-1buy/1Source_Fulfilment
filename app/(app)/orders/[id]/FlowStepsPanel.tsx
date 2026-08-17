'use client';

/**
 * THE WHOLE FLOW, OPENED OUT — every stage, its sub-steps and its paperwork.
 *
 * The rail shows where the order IS. The stage history shows where it has BEEN.
 * Neither shows what each step actually consists of, so answering "what happens
 * at customs clearance, and what paper comes out of it" meant opening the stage,
 * then the evidence tab, then the documents tab, and holding three screens in
 * your head.
 *
 * This is that answer in one place: each stage expands to its sub-tasks, with the
 * documents attached to it listed against it — and the documents are the real
 * uploaded ones, not the schema's list of what ought to exist. A stage showing
 * "Bill of Entry — not yet attached" is telling you something true; a list that
 * only ever shows what is required tells you nothing you did not already know.
 *
 * Manual steps requested for this order appear in position, marked as requested,
 * approved or rejected, so a lengthened flow is visible here rather than only on
 * the rail.
 */

import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronRight,
  Circle,
  ClipboardList,
  FileText,
  FileUp,
  ListChecks,
  Paperclip,
  UserPlus,
  TriangleAlert,
} from 'lucide-react';
import {
  PHASE_DEFS,
  applicableStages,
  resolveRailAnchor,
  stageApplies,
  type StageContext,
  stageOwner,
  stageNextActionOwner,
} from '@/lib/domain/stages';
import { evidenceFor } from '@/lib/domain/stage-evidence';
import { subTaskProgress, subTaskStates, type SubTaskKind } from '@/lib/domain/stage-tasks';
import { STAKEHOLDER_META, type Stakeholder } from '@/lib/domain/enums';
import { stageLiability } from '@/lib/domain/stage-liability';
import { stepBrief } from '@/lib/domain/step-brief';
import { agentBriefing } from '@/lib/domain/agent-guidance';
import {
  AgentCompanionBlock,
  ResponsibleBlock,
  StepDocumentsBlock,
  type FiledDoc,
} from '@/components/flow/StepBriefBlocks';
import { Panel, PanelHeader } from '@/components/ui/Layout';
import { Chip, StakeholderBadge } from '@/components/ui/Badges';
import { cn, formatDate } from '@/lib/utils';
import type { ManualStep } from '@/components/flow/FlowRail';

const KIND_ICON: Record<SubTaskKind, typeof FileUp> = {
  DOCUMENT: FileUp,
  ACTION: ListChecks,
  CAPTURE: ClipboardList,
};

export interface FlowDocument {
  id: string;
  docType: string;
  title: string;
  fileName: string;
  stageId: string | null;
  createdAt: string;
  /* Carried so a document can be OPENED from the step it belongs to, rather
     than sending a desk to the register to find the thing they are reading
     about. The sheet needs all of it. */
  uploadedBy?: string;
  version?: number;
  sizeBytes?: number;
  bodyText?: string | null;
}

export interface FlowEvidence {
  stageId: string;
  values: Record<string, unknown>;
  documents: { docType: string }[];
}

export function FlowStepsPanel({
  currentStage,
  ctx,
  completedStageIds,
  evidence,
  documents,
  manualSteps,
  orderAlias,
  refs,
  ownerFilter,
}: {
  currentStage: string;
  ctx: StageContext;
  completedStageIds: string[];
  evidence: FlowEvidence[];
  /** Every document on the order, so each stage can show its own. */
  documents: FlowDocument[];
  manualSteps: ManualStep[];
  /** Shown on an opened document's letterhead. */
  orderAlias: string;
  /** Quoted in any message the agent drafts, so a chase identifies the order. */
  refs: {
    customerPo: string;
    supplierPo: string;
    customer: string;
    supplier: string;
  };
  /**
   * Narrows the list to the steps ONE team touches — either accountable for it
   * or holding its next action.
   *
   * Used by the team workspaces. The panel is otherwise identical, deliberately:
   * a step has to read the same on a team's own page as it does on the order,
   * or the two become separate sources of truth and people start checking both.
   */
  ownerFilter?: Stakeholder;
}) {
  const { anchorStageId } = resolveRailAnchor(currentStage);
  const ladder = useMemo(() => {
    const all = applicableStages(ctx);
    if (!ownerFilter) return all;
    return all.filter(
      (s) => stageOwner(s, ctx) === ownerFilter || stageNextActionOwner(s, ctx) === ownerFilter,
    );
  }, [ctx, ownerFilter]);
  const done = useMemo(() => new Set(completedStageIds), [completedStageIds]);
  const evidenceByStage = useMemo(
    () => new Map(evidence.map((e) => [e.stageId, e])),
    [evidence],
  );

  /**
   * Documents grouped by the stage that produced them.
   *
   * Falls back to the document TYPE where nothing recorded a stage — older
   * uploads predate stage tagging, and dropping them entirely would make the
   * panel claim a stage has no paperwork when it plainly does.
   */
  const docsByStage = useMemo(() => {
    const byStage = new Map<string, FlowDocument[]>();
    const byType = new Map<string, FlowDocument[]>();
    for (const d of documents) {
      if (d.stageId) {
        byStage.set(d.stageId, [...(byStage.get(d.stageId) ?? []), d]);
      } else {
        byType.set(d.docType, [...(byType.get(d.docType) ?? []), d]);
      }
    }
    return { byStage, byType };
  }, [documents]);

  const manualByStage = useMemo(() => {
    const m = new Map<string, ManualStep[]>();
    for (const s of manualSteps) {
      m.set(s.afterStageId, [...(m.get(s.afterStageId) ?? []), s]);
    }
    for (const v of m.values()) v.sort((a, b) => a.sequence - b.sequence);
    return m;
  }, [manualSteps]);

  // Open on the stage the order is actually at — the one anybody came here for.
  const [open, setOpen] = useState<string | null>(anchorStageId);

  /**
   * Which stages start a phase, worked out up front.
   *
   * Was a `let` mutated inside the map, which is a mutation during render — it
   * happens to work until React re-orders or re-enters the render, at which point
   * the phase headings land on the wrong rows.
   */
  const phaseStarts = useMemo(() => {
    const starts = new Set<string>();
    let seen: string | null = null;
    for (const s of ladder) {
      if (s.phase !== seen) {
        starts.add(s.id);
        seen = s.phase;
      }
    }
    return starts;
  }, [ladder]);

  return (
    <Panel padded={false}>
      <div className="p-4 pb-3">
        <PanelHeader
          title="Every step, and what it produces"
          description="Each stage opened out into its sub-tasks and the documents filed against it. Ticks are derived from what is actually recorded, not from anyone marking their own homework."
        />
      </div>

      <ol className="border-line-subtle border-t">
        {ladder.map((stage) => {
          const applies = stageApplies(stage, ctx);
          const isCurrent = stage.id === anchorStageId;
          const isDone = done.has(stage.id);
          const ev = evidenceByStage.get(stage.id);
          const tasks = subTaskStates(
            stage.id,
            ev?.values ?? {},
            (ev?.documents ?? []).map((d) => d.docType),
            ctx,
          );
          const progress = subTaskProgress(tasks);
          const stageDocs = [
            ...(docsByStage.byStage.get(stage.id) ?? []),
            // Documents the evidence schema expects from THIS stage, matched by
            // type where the upload never recorded which stage it belonged to.
            ...(evidenceFor(stage.id)?.documents ?? []).flatMap(
              (d) => docsByStage.byType.get(d.id) ?? [],
            ),
          ];
          const manual = manualByStage.get(stage.id) ?? [];
          const isOpen = open === stage.id;

          /*
           * The brief is the shape of the step; the guidance is what to do
           * about it here and now.
           *
           * Both are pure functions of the stage and the order's state, so
           * computing them per row costs nothing worth memoising — and tying
           * them to the render keeps them honest: there is no cached briefing
           * to go stale against an order that has since moved.
           */
          const terms = { buy: ctx.incoterms ?? null, sell: ctx.sellIncoterms ?? null };
          const brief = stepBrief(stage.id, ctx, terms);
          const filedHere: FiledDoc[] = stageDocs.map((d) => ({
            id: d.id,
            docType: d.docType,
            title: d.title,
            fileName: d.fileName,
            createdAt: d.createdAt,
            uploadedBy: d.uploadedBy ?? 'Recorded on the order',
            version: d.version ?? 1,
            sizeBytes: d.sizeBytes ?? 0,
            bodyText: d.bodyText ?? null,
          }));

          // One phase heading, before its first stage.
          const showPhase = phaseStarts.has(stage.id);

          return (
            <li key={stage.id}>
              {showPhase && (
                <div className="bg-surface-inset border-line-subtle text-fg-tertiary border-y px-3 py-1.5 text-[10px] font-semibold tracking-[0.06em] uppercase sm:px-4">
                  Phase {stage.phase} · {PHASE_DEFS[stage.phase].label}
                </div>
              )}

              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : stage.id)}
                aria-expanded={isOpen}
                className={cn(
                  'hover:bg-surface-2 flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors sm:px-4',
                  isCurrent && 'bg-accent-subtle/50',
                  !applies && 'opacity-55',
                )}
              >
                <ChevronRight
                  className={cn(
                    'text-fg-tertiary mt-0.5 size-3.5 shrink-0 transition-transform',
                    isOpen && 'rotate-90',
                  )}
                  strokeWidth={2.5}
                  aria-hidden
                />
                <span
                  className={cn(
                    'tnum mt-px shrink-0 text-[10.5px] font-semibold',
                    isCurrent ? 'text-accent-text' : 'text-fg-tertiary',
                  )}
                >
                  {stage.code}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'block text-[12.5px] leading-snug',
                      !applies && 'line-through decoration-[1.5px]',
                      isCurrent ? 'text-fg font-semibold' : 'text-fg',
                    )}
                  >
                    {stage.label}
                  </span>
                  {/* The counts do the work at a glance; the detail is inside. */}
                  <span className="text-fg-tertiary mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px]">
                    <span>
                      {progress.done}/{progress.total} sub-task
                      {progress.total === 1 ? '' : 's'}
                    </span>
                    <span aria-hidden>·</span>
                    <span>
                      {stageDocs.length} document{stageDocs.length === 1 ? '' : 's'} filed
                    </span>
                    {manual.length > 0 && (
                      <>
                        <span aria-hidden>·</span>
                        <span className="text-accent-text">
                          {manual.length} added step{manual.length === 1 ? '' : 's'}
                        </span>
                      </>
                    )}
                  </span>
                </span>
                <span className="hidden shrink-0 items-center gap-1.5 sm:flex">
                  {isCurrent && (
                    <Chip tone="accent" size="sm">
                      Here
                    </Chip>
                  )}
                  {isDone && !isCurrent && (
                    <CheckCircle2 className="text-success size-4" strokeWidth={2.2} aria-label="Done" />
                  )}
                  <StakeholderBadge stakeholder={stageOwner(stage, ctx)} />
                </span>
              </button>

              {isOpen && (
                <div className="border-line-subtle bg-surface-2/40 border-t px-3 py-3 sm:px-4">
                  <p className="text-fg-secondary text-[12px] leading-relaxed">
                    {stage.description}
                  </p>
                  <p className="text-fg-tertiary mt-1 text-[11.5px] leading-relaxed">
                    <span className="font-medium">To leave this stage:</span> {stage.exitCriteria}
                  </p>

                  {/* ── Who bears this step, and why ──────────────────────── */}
                  <ResponsibleBlock brief={brief} />

                  {/* ── Who is liable, under the term that governs it ─────── */}
                  <StageLiabilityDisclosure stageId={stage.id} ctx={ctx} />

                  {/* ── Sub-tasks ─────────────────────────────────────────── */}
                  <div className="border-line-subtle bg-surface-1 mt-3 overflow-hidden rounded-[9px] border">
                    <div className="text-fg-tertiary border-line-subtle border-b px-2.5 py-1.5 text-[9.5px] font-semibold tracking-[0.05em] uppercase">
                      Sub-tasks
                    </div>
                    <ul className="divide-line-subtle/70 divide-y">
                      {tasks.map((t) => {
                        const Icon = KIND_ICON[t.kind];
                        return (
                          <li key={t.id} className="flex items-start gap-2 px-2.5 py-1.5">
                            {t.done ? (
                              <CheckCircle2
                                className="text-success mt-px size-3.5 shrink-0"
                                strokeWidth={2.4}
                                aria-label="Done"
                              />
                            ) : (
                              <Circle
                                className={cn(
                                  'mt-px size-3.5 shrink-0',
                                  t.required ? 'text-warning' : 'text-fg-tertiary',
                                )}
                                strokeWidth={2}
                                aria-label="Outstanding"
                              />
                            )}
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-baseline gap-x-1.5">
                                <Icon
                                  className="text-fg-tertiary mt-[3px] size-3 shrink-0"
                                  strokeWidth={2}
                                  aria-hidden
                                />
                                <span
                                  className={cn(
                                    'text-[11.5px] leading-snug',
                                    t.done ? 'text-fg-tertiary' : 'text-fg',
                                  )}
                                >
                                  {t.label}
                                </span>
                                {t.required && !t.done && (
                                  <span className="text-warning text-[9px] font-semibold tracking-wide uppercase">
                                    Required
                                  </span>
                                )}
                                {t.standard && (
                                  <span className="border-line-subtle text-fg-secondary tnum rounded border px-1 py-px text-[9px]">
                                    {t.standard}
                                  </span>
                                )}
                              </span>
                              <span className="text-fg-tertiary mt-0.5 block text-[10.5px] leading-relaxed">
                                {t.detail}
                              </span>
                            </span>
                            <span className="text-fg-tertiary hidden shrink-0 text-[10px] whitespace-nowrap sm:block">
                              {STAKEHOLDER_META[t.owner]?.short ?? t.owner}
                            </span>
                          </li>
                        );
                      })}
                      {tasks.length === 0 && (
                        <li className="text-fg-tertiary px-2.5 py-2 text-[11.5px]">
                          Nothing to record at this stage — it advances on the event itself.
                        </li>
                      )}
                    </ul>
                  </div>

                  {/* ── What this step makes, and what it waits on ─────────── */}
                  <StepDocumentsBlock brief={brief} filed={filedHere} orderAlias={orderAlias} />

                  {/*
                    ── The agent's read on it ───────────────────────────────

                    Only on the step the order is actually sitting on. Guidance
                    against a step already closed is history, and guidance
                    against one three phases away is speculation; both would
                    train people to scroll past the one place it is useful.
                  */}
                  {isCurrent && (
                    <AgentCompanionBlock
                      briefing={agentBriefing({
                        stageId: stage.id,
                        ctx,
                        incoterms: terms,
                        recorded: ev?.values ?? {},
                        filed: filedHere.map((f) => f.docType),
                        refs: { alias: orderAlias, ...refs },
                      })}
                    />
                  )}

                  {/* ── Steps added to this order ─────────────────────────── */}
                  {manual.length > 0 && (
                    <div className="border-accent-border bg-accent-subtle/40 mt-2.5 overflow-hidden rounded-[9px] border">
                      <div className="text-accent-text border-accent-border/60 flex items-center gap-1.5 border-b px-2.5 py-1.5 text-[9.5px] font-semibold tracking-[0.05em] uppercase">
                        <UserPlus className="size-3" strokeWidth={2} aria-hidden />
                        Added to this order
                      </div>
                      <ul className="divide-accent-border/40 divide-y">
                        {manual.map((m) => (
                          <li key={m.id} className="px-2.5 py-1.5">
                            <span className="flex flex-wrap items-center gap-1.5">
                              <span className="text-fg text-[11.5px] font-medium">{m.label}</span>
                              <Chip
                                tone={
                                  m.approval === 'APPROVED'
                                    ? 'success'
                                    : m.approval === 'REJECTED'
                                      ? 'danger'
                                      : 'warning'
                                }
                                size="sm"
                              >
                                {m.approval === 'APPROVED'
                                  ? 'Approved'
                                  : m.approval === 'REJECTED'
                                    ? 'Rejected'
                                    : 'Awaiting approval'}
                              </Chip>
                            </span>
                            <span className="text-fg-tertiary mt-0.5 block text-[10.5px] leading-relaxed">
                              {m.reason}
                            </span>
                            <span className="text-fg-tertiary mt-0.5 block text-[10px]">
                              Requested by {m.createdBy}
                              {m.decidedBy ? ` · decided by ${m.decidedBy}` : ''}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

/**
 * WHO IS LIABLE FOR THIS STEP, UNDER THE TERM WE BOUGHT ON.
 *
 * Collapsed by default and opened by clicking, for two reasons. Most steps are
 * worked without anyone needing to re-read the Incoterm, so open-by-default
 * would push the sub-tasks — the thing people came for — below the fold on every
 * one of them. And the operator who DOES need it is usually asking about one
 * specific step, which is exactly the one they are looking at.
 *
 * It names only the obligation this step turns on, not all four. See
 * lib/domain/stage-liability.ts for why.
 */
function StageLiabilityDisclosure({ stageId, ctx }: { stageId: string; ctx: StageContext }) {
  const [open, setOpen] = useState(false);
  const liability = stageLiability(stageId, ctx);
  // Steps the Incoterm does not govern get no control at all — an expander that
  // opens onto nothing is worse than no expander.
  if (!liability) return null;

  const ours = liability.rows.filter((r) => r.party === '1BUY').length;
  const summary =
    ours === liability.rows.length
      ? 'Ours'
      : ours === 0
        ? 'Theirs'
        : 'Split';

  return (
    <div className="border-line-subtle bg-surface-1 mt-3 overflow-hidden rounded-[9px] border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="hover:bg-surface-3 flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors"
      >
        <ChevronRight
          className={cn(
            'text-fg-tertiary size-3.5 shrink-0 transition-transform',
            open && 'rotate-90',
          )}
          strokeWidth={2}
          aria-hidden
        />
        <span className="text-fg-tertiary text-[9.5px] font-semibold tracking-[0.05em] uppercase">
          Who is liable
        </span>
        <span className="text-fg-tertiary ml-auto flex items-center gap-1.5 text-[10.5px]">
          <span className="font-mono">{liability.termCode}</span>
          <span
            className={cn(
              'rounded-[5px] px-1.5 py-0.5 font-medium',
              summary === 'Ours'
                ? 'bg-accent-subtle text-accent-text'
                : summary === 'Theirs'
                  ? 'bg-surface-3 text-fg-secondary'
                  : 'bg-warning-subtle text-warning',
            )}
          >
            {summary}
          </span>
        </span>
      </button>

      {open && (
        <div className="border-line-subtle space-y-2 border-t px-2.5 py-2">
          <p className="text-fg-tertiary text-[11px] leading-relaxed">
            {liability.side === 'BUY' ? 'Bought' : 'Sold'}{' '}
            <strong className="text-fg-secondary font-mono">{liability.termCode}</strong> —{' '}
            {liability.termPlain.toLowerCase()}.
          </p>

          {liability.rows.map((r) => (
            <div key={r.key} className="flex min-w-0 items-start gap-2">
              <span
                className={cn(
                  'mt-0.5 shrink-0 rounded-[5px] px-1.5 py-0.5 text-[10.5px] font-medium',
                  r.party === '1BUY'
                    ? 'bg-accent-subtle text-accent-text'
                    : 'bg-surface-3 text-fg-secondary',
                )}
              >
                {r.party}
              </span>
              <span className="min-w-0">
                <span className="text-fg text-[11.5px] font-medium">{r.label}</span>
                {r.obligatory && (
                  <span className="text-success ml-1.5 text-[10px]">required by the term</span>
                )}
                <span className="text-fg-tertiary block text-[11px] leading-relaxed">
                  {r.detail}
                </span>
                {r.warning && (
                  <span className="text-warning mt-0.5 flex items-start gap-1 text-[11px] leading-relaxed">
                    <TriangleAlert className="mt-0.5 size-3 shrink-0" strokeWidth={2} aria-hidden />
                    {r.warning}
                  </span>
                )}
              </span>
            </div>
          ))}

          {liability.riskNote && (
            <p className="text-fg-secondary border-line-subtle border-t pt-2 text-[11px] leading-relaxed">
              <strong className="text-fg font-medium">Risk transfers</strong> — {liability.riskNote}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
