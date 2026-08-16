'use client';

/**
 * Press play; the order actually moves.
 *
 * Each tick calls the server for ONE step, which writes real evidence, files
 * real documents, answers real mail and puts the order through the real
 * advance gate. Nothing here is narrated — every line in the log below is a
 * report of a database write that happened, and the order is genuinely at a
 * different stage when the run finishes.
 *
 * Which means the interesting outcomes are the ones this component does not
 * control. If the platform's gate refuses, the run stops and shows the gate's
 * own message. If the next action belongs to Finance, it stops because policy
 * says so. Neither is scripted here, and that is the point of running it for
 * real rather than playing a recording.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowUpRight,
  Bot,
  Check,
  Mail,
  Pause,
  Play,
  RotateCcw,
  ShieldAlert,
  UserCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  agenticOrderState,
  resetAgenticOrder,
  runAgenticStep,
  type RunStepResult,
} from '@/lib/actions/agentic-run';
import { STAKEHOLDER_META, slugForTeam } from '@/lib/domain/enums';
import { Button, KeyValue, Panel, PanelHeader } from '@/components/ui/Layout';
import { Chip, StakeholderBadge } from '@/components/ui/Badges';
import { cn } from '@/lib/utils';

/** Pause between steps — long enough to read a line as it lands. */
const TICK_MS = 1500;

export function AgenticRunner({
  orderId,
  orderAlias,
  startCode,
  startLabel,
}: {
  orderId: string;
  orderAlias: string;
  startCode: string;
  startLabel: string;
}) {
  const router = useRouter();
  const [log, setLog] = useState<RunStepResult[]>([]);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [position, setPosition] = useState({ code: startCode, label: startLabel });
  const liveRef = useRef<HTMLLIElement>(null);

  /** Stopped for a reason the operator needs to act on, rather than paused. */
  const last = log[log.length - 1];
  const halted = last && (last.outcome === 'HELD' || last.outcome === 'BLOCKED' || last.outcome === 'DONE');

  const step = useCallback(async () => {
    setBusy(true);
    try {
      const res = await runAgenticStep(orderId);
      setLog((l) => [...l, res]);
      if (res.outcome !== 'ADVANCED') setRunning(false);
      const state = await agenticOrderState(orderId);
      if (state) setPosition({ code: state.code, label: state.label });
      // Refresh so the Control Tower, the queues and the team screens show the
      // order where it now actually is — this run moved it.
      router.refresh();
    } finally {
      setBusy(false);
    }
  }, [orderId, router]);

  useEffect(() => {
    if (!running || busy || halted) return;
    const t = setTimeout(step, TICK_MS);
    return () => clearTimeout(t);
  }, [running, busy, halted, step, log.length]);

  useEffect(() => {
    if (running) liveRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [log.length, running]);

  const reset = async () => {
    setRunning(false);
    setBusy(true);
    try {
      const res = await resetAgenticOrder(orderId);
      if (res.ok) {
        setLog([]);
        toast.success('Order reset', { description: res.message });
        const state = await agenticOrderState(orderId);
        if (state) setPosition({ code: state.code, label: state.label });
        router.refresh();
      } else {
        toast.error(res.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const advanced = log.filter((l) => l.outcome === 'ADVANCED').length;
  const mailsAnswered = log.filter((l) => l.repliedTo).length;
  const docs = log.reduce((a, l) => a + l.documentsFiled.length, 0);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Panel>
        <PanelHeader
          title="Run the agent on this order"
          description={`This genuinely advances ${orderAlias} — real evidence, real documents, real replies, through the same gate a person uses. It stops on its own when the next action belongs to Finance.`}
          actions={
            <Chip tone="accent" size="sm" icon={Bot}>
              Live run
            </Chip>
          }
        />

        <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-4">
          <KeyValue label="Order is now at">
            <span className="text-fg-tertiary font-mono text-[10.5px]">{position.code}</span>{' '}
            {position.label}
          </KeyValue>
          <KeyValue label="Steps advanced">{advanced}</KeyValue>
          <KeyValue label="Emails answered">{mailsAnswered}</KeyValue>
          <KeyValue label="Documents filed">{docs}</KeyValue>
        </div>

        <div className="border-line-subtle mt-3 flex min-w-0 flex-wrap items-center gap-2 border-t pt-3">
          <Button
            variant="primary"
            icon={running ? Pause : Play}
            onClick={() => setRunning((r) => !r)}
            disabled={busy || halted}
          >
            {running ? 'Pause' : log.length === 0 ? 'Simulate the agentic flow' : 'Continue'}
          </Button>
          <Button variant="secondary" onClick={step} disabled={busy || running || halted}>
            Single step
          </Button>
          <Button variant="secondary" icon={RotateCcw} onClick={reset} disabled={busy}>
            Reset the order
          </Button>
          <Link
            href={`/orders/${orderId}`}
            className="text-accent-text inline-flex items-center gap-1.5 text-[12.5px] font-medium hover:underline"
          >
            Open the order
            <ArrowUpRight className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
          </Link>
        </div>
      </Panel>

      {log.length === 0 ? (
        <Panel>
          <p className="text-fg-secondary text-[13px] leading-relaxed">
            Press <strong className="text-fg">Simulate the agentic flow</strong>. The agent will read
            the mail on each step, reply quoting it, record the evidence the gate requires, file the
            documents, and advance — until it reaches a step where the next action is
            Finance&rsquo;s, where it stops and hands over. Everything it does is written to the
            order, so you can open it afterwards and see the same history from the other side.
          </p>
        </Panel>
      ) : (
        <ol className="flex min-w-0 flex-col gap-2.5">
          {log.map((r, i) => (
            <StepRow key={i} r={r} index={i} ref={i === log.length - 1 ? liveRef : undefined} orderId={orderId} />
          ))}
        </ol>
      )}
    </div>
  );
}

function StepRow({
  r,
  index,
  ref,
  orderId,
}: {
  r: RunStepResult;
  index: number;
  ref?: React.Ref<HTMLLIElement>;
  orderId: string;
}) {
  const tone =
    r.outcome === 'ADVANCED'
      ? 'success'
      : r.outcome === 'HELD'
        ? 'accent'
        : r.outcome === 'DONE'
          ? 'neutral'
          : 'danger';
  const Icon = r.outcome === 'ADVANCED' ? Check : r.outcome === 'HELD' ? UserCheck : ShieldAlert;
  const slug = slugForTeam(r.team);

  return (
    <li ref={ref} className="min-w-0">
      <div
        className={cn(
          'bg-surface-1 min-w-0 rounded-[11px] border p-3.5',
          r.outcome === 'ADVANCED' && 'border-line-subtle',
          r.outcome === 'HELD' && 'border-accent-border',
          r.outcome === 'BLOCKED' && 'border-danger-border',
          r.outcome === 'DONE' && 'border-line-subtle',
        )}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-fg-tertiary tnum shrink-0 font-mono text-[11px]">
            {String(index + 1).padStart(2, '0')}
          </span>
          <span className="text-fg-tertiary shrink-0 font-mono text-[10.5px]">{r.fromCode}</span>
          <StakeholderBadge stakeholder={r.team} short />
          <span className="text-fg min-w-0 flex-1 text-[13px] font-semibold">
            {r.fromLabel}
            {r.toCode && r.outcome === 'ADVANCED' && (
              <span className="text-fg-tertiary font-normal"> → {r.toCode} {r.toLabel}</span>
            )}
          </span>
          <Chip tone={tone} size="sm" icon={Icon}>
            {r.outcome === 'ADVANCED'
              ? 'Agent advanced it'
              : r.outcome === 'HELD'
                ? 'Held for Finance'
                : r.outcome === 'DONE'
                  ? 'Flow complete'
                  : 'Gate refused'}
          </Chip>
        </div>

        {r.did && <p className="text-fg-secondary mt-2 text-[12.5px] leading-relaxed">{r.did}</p>}

        {r.repliedTo && (
          <p className="text-fg-secondary mt-1.5 flex items-start gap-2 text-[12px] leading-relaxed">
            <Mail className="text-accent-text mt-0.5 size-3.5 shrink-0" strokeWidth={2} aria-hidden />
            <span>
              Drafted from{' '}
              <strong className="text-fg font-medium">&ldquo;{r.repliedTo}&rdquo;</strong> — the
              reply quotes it, and both sit in the thread on the order{' '}
              {slug && (
                <>
                  and on{' '}
                  <Link href={`/teams/${slug}/orders/${orderId}`} className="text-accent-text hover:underline">
                    {STAKEHOLDER_META[r.team].short}&rsquo;s communication tab
                  </Link>
                </>
              )}
              .
            </span>
          </p>
        )}

        {r.reason && (
          <p
            className={cn(
              'border-line-subtle mt-2 border-t pt-2 text-[12px] leading-relaxed',
              r.outcome === 'BLOCKED' ? 'text-danger' : 'text-fg',
            )}
          >
            <strong className="font-semibold">
              {r.outcome === 'HELD' ? 'Why it stopped: ' : r.outcome === 'BLOCKED' ? 'The gate said: ' : ''}
            </strong>
            {r.reason}
          </p>
        )}

        {(r.evidenceFilled.length > 0 || r.documentsFiled.length > 0) && (
          <p className="text-fg-tertiary mt-2 text-[11px] leading-relaxed">
            {r.evidenceFilled.length > 0 && <>Evidence: {r.evidenceFilled.join(', ')}. </>}
            {r.documentsFiled.length > 0 && <>Filed: {r.documentsFiled.join(', ')}.</>}
          </p>
        )}
      </div>
    </li>
  );
}
