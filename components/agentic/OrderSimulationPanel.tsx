'use client';

/**
 * The simulation, driven from the order itself.
 *
 * The console on /agentic is where an order is configured; this is where it is
 * READ. Somebody shown the helicopter view of a simulated order should be able
 * to run it, reset it, and walk it end to end without going back to another
 * screen to press the buttons — the order is the thing being demonstrated, so
 * the controls belong on it.
 *
 * THE WALKTHROUGH IS THE POINT. A closed order is thirty-five steps of history
 * that a viewer has no way into: the rail says everything is green and the tabs
 * say everything is filed, which tells them the flow worked without ever
 * showing them what it did. Stepping through it one stage at a time — who bore
 * it, what it produced, what it was waiting on, what the agent stood in for —
 * is the difference between a screen that proves the order finished and one
 * that explains how.
 *
 * Rendered only on SIM- orders. A desk working a real order does not need a
 * tour of it, and controls that could reset something live have no business on
 * the same screen.
 */

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  Crosshair,
  Flag,
  Play,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { runAgenticStep, type RunStepResult } from '@/lib/actions/agentic-run';
import { resetSimulations } from '@/lib/actions/simulation';
import { applicableStages, PHASE_DEFS, type StageContext } from '@/lib/domain/stages';
import { stepBrief } from '@/lib/domain/step-brief';
import { STAKEHOLDER_META } from '@/lib/domain/enums';
import { Button, KeyValue, Panel, PanelHeader, SectionLabel } from '@/components/ui/Layout';
import { Chip, StakeholderBadge } from '@/components/ui/Badges';
import { cn, formatDateTime } from '@/lib/utils';

export interface SimStageDoc {
  id: string;
  docType: string;
  title: string;
  stageId: string | null;
  createdAt: string;
}

export function OrderSimulationPanel({
  orderId,
  alias,
  ctx,
  currentStage,
  completedStageIds,
  status,
  documents,
  runLog,
  transitions,
}: {
  orderId: string;
  alias: string;
  ctx: StageContext;
  currentStage: string;
  completedStageIds: string[];
  status: string;
  documents: SimStageDoc[];
  /** The agent's own account of each step, where it ran. */
  runLog: RunStepResult[];
  /** The ladder's record, which exists whether the agent ran or a person did. */
  transitions: { toStage: string; actorLabel: string; reason: string | null; createdAt: string }[];
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [running, setRunning] = useState(false);

  const ladder = useMemo(() => applicableStages(ctx), [ctx]);
  const done = useMemo(() => new Set(completedStageIds), [completedStageIds]);
  const currentIdx = Math.max(
    0,
    ladder.findIndex((s) => s.id === currentStage),
  );

  /** Where the walkthrough is looking — starts on the order's own position. */
  const [cursor, setCursor] = useState(currentIdx);
  const stage = ladder[Math.min(cursor, ladder.length - 1)];

  const terms = { buy: ctx.incoterms ?? null, sell: ctx.sellIncoterms ?? null };
  const brief = useMemo(
    () => (stage ? stepBrief(stage.id, ctx, terms) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stage?.id, ctx, terms.buy, terms.sell],
  );

  const logByStage = useMemo(() => {
    const m = new Map<string, RunStepResult>();
    // Keyed on the stage the step STARTED from, which is the one it completed.
    for (const r of runLog) if (r.fromCode) m.set(r.fromCode, r);
    return m;
  }, [runLog]);

  const transitionInto = useMemo(() => {
    const m = new Map<string, (typeof transitions)[number]>();
    for (const t of transitions) if (!m.has(t.toStage)) m.set(t.toStage, t);
    return m;
  }, [transitions]);

  const docsHere = stage ? documents.filter((d) => d.stageId === stage.id) : [];
  const logHere = stage ? logByStage.get(stage.code) : undefined;
  const arrived = stage ? transitionInto.get(stage.id) : undefined;
  const isDone = stage ? done.has(stage.id) : false;
  const isCurrent = stage?.id === currentStage;
  const finished = status === 'CLOSED';

  // ── Running ───────────────────────────────────────────────────────────────

  const step = useCallback(
    () =>
      start(async () => {
        const res = await runAgenticStep(orderId);
        if (res.outcome === 'BLOCKED') {
          setRunning(false);
          toast.error(`Held at ${res.fromCode}`, { description: res.reason, duration: 9000 });
        } else if (res.outcome === 'DONE') {
          setRunning(false);
          toast.success('The order has reached the end of its flow.');
        } else {
          toast.success(`${res.fromCode} → ${res.toCode}`, {
            description: res.humanBypass
              ? `Human step — ${res.humanBypass.who} would have done this.`
              : res.did,
            duration: 4000,
          });
        }
        // The walkthrough follows the order as it moves, rather than stranding
        // the reader on the step it has just left.
          setCursor((c) => (c === currentIdx ? Math.min(c + 1, ladder.length - 1) : c));
          router.refresh();
        }),
    [orderId, router, currentIdx, ladder.length],
  );

  const reset = () =>
    start(async () => {
      const res = await resetSimulations();
      if (res.ok) {
        toast.success(res.message, { description: res.detail, duration: 8000 });
        // This order no longer exists, so staying on its page would 404 on the
        // next navigation. Back to the console, which is where a new one starts.
        router.push('/agentic');
      } else {
        toast.error(res.message, { description: res.detail });
      }
    });

  const runAll = () => {
    setRunning(true);
    step();
  };

  /*
   * Keep stepping while the operator has not paused.
   *
   * In an effect rather than during render: a side effect in a render body runs
   * on every re-render the compiler decides to do, which turns "run the flow"
   * into an unbounded loop of server actions against a live order.
   */
  useEffect(() => {
    if (!running || busy || finished) return;
    const t = setTimeout(step, 1200);
    return () => clearTimeout(t);
  }, [running, busy, finished, step, completedStageIds.length]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Panel>
      <PanelHeader
        title={`${alias} — simulated order`}
        description="A real work order raised from a chosen configuration. Run it, walk it, or clear it away and start again."
        actions={
          <Chip tone="accent" size="sm" icon={Bot}>
            Simulation
          </Chip>
        }
      />

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button
          variant="primary"
          icon={Play}
          onClick={runAll}
          disabled={busy || running || finished}
        >
          {finished
            ? 'Flow complete'
            : completedStageIds.length <= 1
              ? 'Start the simulation'
              : 'Continue the simulation'}
        </Button>
        <Button variant="secondary" onClick={step} disabled={busy || running || finished}>
          One step
        </Button>
        {running && (
          <Button variant="secondary" onClick={() => setRunning(false)}>
            Pause
          </Button>
        )}
        <Button variant="secondary" icon={RotateCcw} onClick={reset} disabled={busy}>
          Reset and start over
        </Button>
        <span className="text-fg-tertiary text-[11.5px] leading-relaxed">
          Reset deletes this order and everything written against it, then returns to the
          configuration screen. It only ever reaches orders the simulator created.
        </span>
      </div>

      {/* ── The walkthrough ──────────────────────────────────────────────── */}
      <div className="border-line-subtle mt-3 min-w-0 border-t pt-3">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <SectionLabel>Guided walkthrough</SectionLabel>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              variant="secondary"
              icon={ArrowLeft}
              onClick={() => setCursor((c) => Math.max(0, c - 1))}
              disabled={cursor === 0}
            >
              Back
            </Button>
            <Button
              variant="secondary"
              icon={Crosshair}
              onClick={() => setCursor(currentIdx)}
              disabled={cursor === currentIdx}
            >
              Where it is now
            </Button>
            <Button
              variant="secondary"
              icon={ArrowRight}
              onClick={() => setCursor((c) => Math.min(ladder.length - 1, c + 1))}
              disabled={cursor >= ladder.length - 1}
            >
              Next
            </Button>
          </div>
        </div>

        {/* Position, so the reader knows how far through they are. */}
        <div className="mt-2 flex min-w-0 items-center gap-2">
          <div className="bg-surface-3 h-1.5 min-w-0 flex-1 overflow-hidden rounded-full">
            <div
              className="bg-accent h-full rounded-full transition-[width]"
              style={{ width: `${((cursor + 1) / ladder.length) * 100}%` }}
            />
          </div>
          <span className="text-fg-tertiary tnum shrink-0 text-[11px]">
            Step {cursor + 1} of {ladder.length}
          </span>
        </div>

        {stage && brief && (
          <div className="bg-surface-2 border-line-subtle mt-2.5 min-w-0 rounded-[10px] border p-3">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-fg-tertiary shrink-0 font-mono text-[11px]">{stage.code}</span>
              <span className="text-fg min-w-0 flex-1 text-[13px] font-semibold">{stage.label}</span>
              {isCurrent ? (
                <Chip tone="accent" size="sm">
                  The order is here
                </Chip>
              ) : isDone ? (
                <Chip tone="success" size="sm" icon={Check}>
                  Done
                </Chip>
              ) : (
                <Chip tone="muted" size="sm">
                  Still ahead
                </Chip>
              )}
            </div>
            <p className="text-fg-tertiary mt-0.5 text-[10.5px] tracking-[0.04em] uppercase">
              Phase {stage.phase} · {PHASE_DEFS[stage.phase].label}
            </p>

            <p className="text-fg-secondary mt-2 text-[12.5px] leading-relaxed">
              {stage.description}
            </p>

            <div className="mt-2.5 grid min-w-0 gap-2.5 sm:grid-cols-2">
              <KeyValue label="Entity responsible">
                <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <StakeholderBadge stakeholder={brief.responsibility.entity} short />
                  {brief.responsibility.term && (
                    <Chip tone="neutral" size="sm">
                      {brief.responsibility.term.code}
                    </Chip>
                  )}
                </span>
              </KeyValue>
              <KeyValue label="Then it is with">
                <StakeholderBadge stakeholder={brief.nextOwner} short />
              </KeyValue>
            </div>

            {/* ── What actually happened here ──────────────────────────── */}
            <div className="border-line-subtle mt-2.5 border-t pt-2.5">
              <SectionLabel>What happened</SectionLabel>
              {isDone || isCurrent ? (
                <>
                  <p className="text-fg-secondary mt-1 text-[12px] leading-relaxed">
                    {logHere?.did ??
                      arrived?.reason ??
                      (arrived
                        ? `Recorded by ${arrived.actorLabel}.`
                        : 'The order reached this step; nothing further is recorded against it yet.')}
                  </p>
                  {arrived && (
                    <p className="text-fg-tertiary mt-1 text-[11px]">
                      {arrived.actorLabel} · {formatDateTime(arrived.createdAt)}
                    </p>
                  )}
                  {/*
                    The bypass, repeated here rather than left on the console.
                    Somebody reading the order months later has no access to the
                    run that produced it, and an unmarked step reads as ordinary
                    work by a person who was never there.
                  */}
                  {logHere?.humanBypass && (
                    <div className="bg-warning-subtle border-warning-border mt-2 min-w-0 rounded-[8px] border p-2">
                      <span className="text-warning flex items-center gap-1.5 text-[10.5px] font-semibold tracking-[0.04em] uppercase">
                        <Flag className="size-3 shrink-0" strokeWidth={2.2} aria-hidden />
                        {logHere.humanBypass.kindLabel} — bypassed for the simulation
                      </span>
                      <p className="text-fg mt-1 text-[11.5px] leading-relaxed">
                        <strong className="font-semibold">{logHere.humanBypass.who}</strong> would
                        have done this: {logHere.humanBypass.wouldDo}
                      </p>
                    </div>
                  )}
                  {logHere && logHere.sideEffects.length > 0 && (
                    <ul className="text-fg-secondary mt-1.5 flex min-w-0 flex-col gap-1 text-[11.5px]">
                      {logHere.sideEffects.map((e) => (
                        <li key={e} className="flex min-w-0 items-start gap-1.5">
                          <Check
                            className="text-success mt-0.5 size-3 shrink-0"
                            strokeWidth={2.4}
                            aria-hidden
                          />
                          <span className="min-w-0">{e}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <p className="text-fg-tertiary mt-1 text-[12px] leading-relaxed">
                  Not reached yet. When the order gets here: {stage.nextAction}
                </p>
              )}
            </div>

            {/* ── The paperwork of this step ────────────────────────────── */}
            <div className="border-line-subtle mt-2.5 border-t pt-2.5">
              <SectionLabel>Documents at this step</SectionLabel>
              {docsHere.length > 0 ? (
                <ul className="mt-1 flex min-w-0 flex-col gap-1">
                  {docsHere.map((d) => (
                    <li key={d.id} className="text-fg-secondary min-w-0 text-[11.5px]">
                      <span className="text-fg font-medium">{d.title}</span>
                      <span className="text-fg-tertiary"> · {formatDateTime(d.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-fg-tertiary mt-1 text-[11.5px] leading-relaxed">
                  {brief.creates.length + brief.receives.length === 0
                    ? 'This step files no paperwork of its own.'
                    : `Nothing filed here yet. Expected: ${[...brief.creates, ...brief.receives]
                        .map((d) => d.label)
                        .join(', ')}.`}
                </p>
              )}
              <p className="text-fg-tertiary mt-1.5 text-[11px] leading-relaxed">
                The Documents tab holds every one of them, with who produces it and who is blocked
                without it.
              </p>
            </div>

            {/* ── What comes next ──────────────────────────────────────── */}
            <div className="border-line-subtle mt-2.5 border-t pt-2.5">
              <SectionLabel>What comes next</SectionLabel>
              <p className="text-fg-secondary mt-1 flex items-start gap-1.5 text-[12px] leading-relaxed">
                <Sparkles className="text-accent-text mt-0.5 size-3.5 shrink-0" strokeWidth={2} aria-hidden />
                <span>
                  {stage.nextAction}{' '}
                  <span className="text-fg-tertiary">
                    That is {STAKEHOLDER_META[brief.nextOwner].short}&rsquo;s move.
                  </span>
                </span>
              </p>
              {cursor < ladder.length - 1 && (
                <p className="text-fg-tertiary mt-1 text-[11px] leading-relaxed">
                  Then: {ladder[cursor + 1].code} {ladder[cursor + 1].label}.
                </p>
              )}
            </div>
          </div>
        )}

        {/* The whole ladder as a strip, so a viewer can jump rather than page. */}
        <div className="mt-2.5 flex min-w-0 flex-wrap gap-1">
          {ladder.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setCursor(i)}
              title={`${s.code} ${s.label}`}
              aria-label={`${s.code} ${s.label}`}
              className={cn(
                'rounded-[5px] px-1.5 py-0.5 font-mono text-[9.5px] transition-colors',
                i === cursor
                  ? 'bg-accent text-accent-fg'
                  : s.id === currentStage
                    ? 'bg-accent-subtle text-accent-text'
                    : done.has(s.id)
                      ? 'bg-success-subtle text-success'
                      : 'bg-surface-3 text-fg-tertiary hover:bg-surface-2',
              )}
            >
              {s.code}
            </button>
          ))}
        </div>
      </div>
    </Panel>
  );
}
