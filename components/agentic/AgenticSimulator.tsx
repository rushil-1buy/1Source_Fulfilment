'use client';

/**
 * Press play and watch the autonomous flow run, step by step.
 *
 * Played back rather than dumped as a list, deliberately. The argument this
 * screen makes is not "here are sixteen steps" — it is "watch how far it gets
 * on its own, and watch where it stops." That only lands if the stops arrive
 * as events, in sequence, with the reason attached. A static table shows the
 * same information and persuades nobody.
 *
 * The four modes are visually distinct because they mean genuinely different
 * things, and the most common failure of a demo like this is letting "a person
 * is required here by policy" look like "something went wrong."
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bot,
  Hand,
  Pause,
  Play,
  RotateCcw,
  ShieldAlert,
  ShieldX,
  UserCheck,
} from 'lucide-react';
import {
  AGENTIC_SCRIPT,
  summarise,
  type AgentMode,
  type AgentStepSim,
} from '@/lib/domain/agentic-sim';
import { Button, KeyValue, Panel, PanelHeader } from '@/components/ui/Layout';
import { Chip, StakeholderBadge } from '@/components/ui/Badges';
import { cn } from '@/lib/utils';

const MODE_META: Record<
  AgentMode,
  { label: string; tone: 'success' | 'accent' | 'warning' | 'danger'; icon: typeof Bot; blurb: string }
> = {
  AUTONOMOUS: {
    label: 'Agent acted',
    tone: 'success',
    icon: Bot,
    blurb: 'Handled end to end. Nobody was interrupted.',
  },
  HELD: {
    label: 'Held for Finance',
    tone: 'accent',
    icon: UserCheck,
    blurb: 'A person is required here by policy — not because a check failed.',
  },
  ESCALATED: {
    label: 'Escalated',
    tone: 'warning',
    icon: Hand,
    blurb: 'The agent could have acted; the checks said stop.',
  },
  REFUSED: {
    label: 'Refused',
    tone: 'danger',
    icon: ShieldX,
    blurb: 'Asked to do something outside its authority.',
  },
};

export function AgenticSimulator({
  steps = AGENTIC_SCRIPT,
  orderAlias,
}: {
  steps?: AgentStepSim[];
  orderAlias: string;
}) {
  /** How many steps have played. 0 = not started, steps.length = finished. */
  const [done, setDone] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveRef = useRef<HTMLDivElement>(null);

  const finished = done >= steps.length;

  /*
   * One timeout per step, cleared on every change.
   *
   * An interval would drift out of step with the per-step dwell times, which
   * are not uniform on purpose — the moments where the agent stops are given
   * longer to sit on screen than the ones where it simply works.
   */
  useEffect(() => {
    if (!playing || finished) return;
    timer.current = setTimeout(() => {
      const next = done + 1;
      setDone(next);
      // Stopping HERE rather than in a follow-up effect. Setting state
      // synchronously inside an effect that reacts to that same state is how
      // you get cascading renders; the timeout already runs outside render.
      if (next >= steps.length) setPlaying(false);
    }, steps[done]?.dwellMs ?? 1200);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [playing, done, finished, steps]);

  // Keep the newest step in view while playing, but never fight the user's own
  // scrolling once it has stopped.
  useEffect(() => {
    if (playing && liveRef.current) {
      liveRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [done, playing]);

  const reset = useCallback(() => {
    setPlaying(false);
    setDone(0);
  }, []);

  const shown = steps.slice(0, done);
  const summary = summarise(steps);
  const shownSummary = summarise(shown);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Panel>
        <PanelHeader
          title="Autonomous fulfilment — walkthrough"
          description={`What the agent would do on ${orderAlias}, end to end, and where it would stop. No model is called and no order is advanced: this plays the policy so it can be argued with before any of it is switched on.`}
          actions={
            <Chip tone="muted" size="sm" icon={Bot}>
              Simulation
            </Chip>
          }
        />

        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {!finished ? (
            <Button
              variant="primary"
              icon={playing ? Pause : Play}
              onClick={() => setPlaying((p) => !p)}
            >
              {playing ? 'Pause' : done === 0 ? 'Simulate the agentic flow' : 'Resume'}
            </Button>
          ) : (
            <Button variant="primary" icon={RotateCcw} onClick={reset}>
              Run it again
            </Button>
          )}
          {done > 0 && !finished && (
            <Button variant="secondary" icon={RotateCcw} onClick={reset}>
              Reset
            </Button>
          )}
          <span className="text-fg-tertiary text-[12px]">
            {done} of {steps.length} steps
          </span>
        </div>

        {/* Progress across the four modes, filling as it plays. */}
        <div className="border-line-subtle mt-3 grid min-w-0 grid-cols-2 gap-3 border-t pt-3 sm:grid-cols-4">
          <KeyValue label="Agent acted">
            <span className="text-success">{shownSummary.autonomous}</span>
            <span className="text-fg-tertiary"> / {summary.autonomous}</span>
          </KeyValue>
          <KeyValue label="Held for Finance">
            <span className="text-accent-text">{shownSummary.held}</span>
            <span className="text-fg-tertiary"> / {summary.held}</span>
          </KeyValue>
          <KeyValue label="Escalated">
            <span className="text-warning">{shownSummary.escalated}</span>
            <span className="text-fg-tertiary"> / {summary.escalated}</span>
          </KeyValue>
          <KeyValue label="Refused">
            <span className="text-danger">{shownSummary.refused}</span>
            <span className="text-fg-tertiary"> / {summary.refused}</span>
          </KeyValue>
        </div>
      </Panel>

      {/* ── The run ──────────────────────────────────────────────────────── */}
      {done === 0 ? (
        <Panel>
          <p className="text-fg-secondary text-[13px] leading-relaxed">
            Press <strong className="text-fg">Simulate the agentic flow</strong> to watch the order
            run. Three things are worth watching for: every Finance step stopping even when nothing
            is wrong, the supplier&rsquo;s invoice being reconciled against our own purchase order
            rather than believed, and an emailed instruction being refused outright.
          </p>
        </Panel>
      ) : (
        <ol className="flex min-w-0 flex-col gap-2.5">
          {shown.map((s, i) => (
            <StepCard
              key={s.id}
              step={s}
              index={i}
              isLatest={i === shown.length - 1}
              ref={i === shown.length - 1 ? liveRef : undefined}
            />
          ))}
        </ol>
      )}

      {finished && <Verdict steps={steps} />}
    </div>
  );
}

function StepCard({
  step,
  index,
  isLatest,
  ref,
}: {
  step: AgentStepSim;
  index: number;
  isLatest: boolean;
  ref?: React.Ref<HTMLDivElement>;
}) {
  const meta = MODE_META[step.mode];
  const Icon = meta.icon;
  return (
    <li className="min-w-0">
      <div
        ref={ref}
        className={cn(
          'bg-surface-1 min-w-0 rounded-[11px] border p-3.5 transition-colors',
          step.mode === 'AUTONOMOUS' && 'border-line-subtle',
          step.mode === 'HELD' && 'border-accent-border',
          step.mode === 'ESCALATED' && 'border-warning-border',
          step.mode === 'REFUSED' && 'border-danger-border',
          isLatest && 'shadow-e2',
        )}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-fg-tertiary tnum shrink-0 font-mono text-[11px]">
            {String(index + 1).padStart(2, '0')}
          </span>
          <span className="text-fg-tertiary shrink-0 font-mono text-[10.5px]">{step.code}</span>
          <StakeholderBadge stakeholder={step.team} short />
          <span className="text-fg min-w-0 flex-1 text-[13.5px] font-semibold">{step.title}</span>
          <Chip tone={meta.tone} size="sm" icon={Icon}>
            {meta.label}
          </Chip>
        </div>

        <dl className="mt-2.5 grid min-w-0 gap-2 text-[12.5px] leading-relaxed">
          <Line label="Saw" value={step.perceived} />
          <Line label="Judged" value={step.reasoned} />
          <Line label="Did" value={step.acted} />
        </dl>

        {step.guard && (
          <p className="border-line-subtle text-fg mt-2.5 flex items-start gap-2 border-t pt-2.5 text-[12px] leading-relaxed">
            <ShieldAlert
              className={cn(
                'mt-0.5 size-3.5 shrink-0',
                step.mode === 'REFUSED' ? 'text-danger' : step.mode === 'HELD' ? 'text-accent-text' : 'text-warning',
              )}
              strokeWidth={2}
              aria-hidden
            />
            <span>
              <strong className="font-semibold">Rule that fired:</strong> {step.guard}
            </span>
          </p>
        )}

        <p className="text-fg-tertiary mt-2 text-[11px]">
          {step.humanMinutes === 0
            ? 'No human attention required.'
            : `${step.humanMinutes} minutes of a person's attention.`}
        </p>
      </div>
    </li>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 gap-2.5">
      <dt className="text-fg-tertiary w-[48px] shrink-0 text-[10.5px] font-semibold tracking-[0.04em] uppercase">
        {label}
      </dt>
      <dd className="text-fg-secondary min-w-0 flex-1">{value}</dd>
    </div>
  );
}

/** The point of the exercise, stated once the run has finished. */
function Verdict({ steps }: { steps: AgentStepSim[] }) {
  const s = summarise(steps);
  const saved = s.manualMinutes - s.humanMinutes;
  const pct = Math.round((saved / s.manualMinutes) * 100);
  return (
    <Panel>
      <PanelHeader
        title="What that run means"
        description="The same order, worked by hand against worked under this policy."
      />
      <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-4">
        <KeyValue label="Steps in the flow">{s.total}</KeyValue>
        <KeyValue label="Handled by the agent">
          {s.autonomous} of {s.total}
        </KeyValue>
        <KeyValue label="Human attention">{s.humanMinutes} min</KeyValue>
        <KeyValue label="Worked by hand">{s.manualMinutes} min</KeyValue>
      </div>

      <p className="text-fg-secondary border-line-subtle mt-3 border-t pt-3 text-[13px] leading-relaxed">
        <strong className="text-fg">
          {pct}% less of a person&rsquo;s attention on this order
        </strong>{' '}
        — and the {s.humanMinutes} minutes that remain are spent on the four things that actually
        needed a judgement: a supplier repricing after terms were locked, a marginal defect rate, an
        emailed request for early money, and every point where money left the business.
      </p>
      <p className="text-fg-tertiary mt-2 text-[12px] leading-relaxed">
        The agent never becomes more autonomous than its checks allow. Escalation is not the
        exception case — it is the feature, and the {s.escalated + s.refused} stops above are what
        make the {s.autonomous} unattended steps safe to accept.
      </p>
    </Panel>
  );
}
