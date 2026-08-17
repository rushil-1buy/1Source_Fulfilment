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
 * own message — not a scripted one.
 *
 * THE HUMAN STEPS ARE MARKED, NOT HIDDEN. The run passes through steps that in
 * real life need a person — Finance authorising money, a warehouse clerk
 * opening a carton, a licensed agent signing a customs entry — because a
 * walkthrough that halts at the first one never reaches the other thirty. Each
 * is rendered with its own border, its own badge, and the name of the person it
 * stood in for. A viewer should come away able to say which steps this could
 * genuinely take over and which it never could.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowUpRight,
  Bot,
  Check,
  Flag,
  Mail,
  Pause,
  Play,
  ShieldAlert,
  UserCheck,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  agenticOrderState,
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
  initialLog,
}: {
  orderId: string;
  orderAlias: string;
  startCode: string;
  startLabel: string;
  /**
   * The run so far, read from the database.
   *
   * The log used to start empty on every mount, so navigating away and back —
   * or simply reloading — left an order that had plainly been worked with
   * nothing on screen to show for it, and the only way to see the flow again
   * was to reset and run it from scratch. It is seeded here instead.
   */
  initialLog: RunStepResult[];
}) {
  const router = useRouter();
  const [log, setLog] = useState<RunStepResult[]>(initialLog);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [position, setPosition] = useState({ code: startCode, label: startLabel });
  const liveRef = useRef<HTMLLIElement>(null);

  const last = log[log.length - 1];
  /** Nothing left to do — the ladder is finished. */
  const finished = last?.outcome === 'DONE';
  /*
   * The gate refused. Retryable, unlike finished.
   *
   * This mattered more once the log persisted: a refusal used to vanish on
   * reload and re-enable the buttons by accident, so a blocked order that
   * stayed blocked across reloads would have left the run with no way forward
   * short of deleting it.
   */
  const blocked = last?.outcome === 'BLOCKED';

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
    // Auto-run never resumes itself through a refusal — that is a loop asking
    // the same gate the same question. Continuing is the operator's call.
    if (!running || busy || finished || blocked) return;
    const t = setTimeout(step, TICK_MS);
    return () => clearTimeout(t);
  }, [running, busy, finished, blocked, step, log.length]);

  useEffect(() => {
    if (running) liveRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [log.length, running]);

  const advanced = log.filter((l) => l.outcome === 'ADVANCED').length;
  const mailsAnswered = log.filter((l) => l.repliedTo).length;
  const docs = log.reduce((a, l) => a + l.documentsFiled.length, 0);
  const bypassed = log.filter((l) => l.humanBypass).length;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Panel>
        <PanelHeader
          title="Run the agent on this order"
          description={`This genuinely advances ${orderAlias} — real evidence, real documents, real replies, through the same gate a person uses. It runs the whole flow, and marks every step where a real person would have been.`}
          actions={
            <Chip tone="accent" size="sm" icon={Bot}>
              Live run
            </Chip>
          }
        />

        <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-5">
          <KeyValue label="Order is now at">
            <span className="text-fg-tertiary font-mono text-[10.5px]">{position.code}</span>{' '}
            {position.label}
          </KeyValue>
          <KeyValue label="Steps advanced">{advanced}</KeyValue>
          <KeyValue label="Emails answered">{mailsAnswered}</KeyValue>
          <KeyValue label="Documents filed">{docs}</KeyValue>
          <KeyValue label="Human steps bypassed">
            <span className={bypassed > 0 ? 'text-warning font-semibold' : undefined}>{bypassed}</span>
          </KeyValue>
        </div>

        <div className="border-line-subtle mt-3 flex min-w-0 flex-wrap items-center gap-2 border-t pt-3">
          <Button
            variant="primary"
            icon={running ? Pause : Play}
            onClick={() => setRunning((r) => !r)}
            disabled={busy || finished}
          >
            {running
              ? 'Pause'
              : log.length === 0
                ? 'Run the whole flow'
                : blocked
                  ? 'Try the refused step again'
                  : 'Continue the run'}
          </Button>
          <Button variant="secondary" onClick={step} disabled={busy || running || finished}>
            Single step
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
            Press <strong className="text-fg">Run the whole flow</strong>. On each step the agent
            reads the mail, replies quoting it, records the evidence the gate requires, files the
            documents and advances — all the way to a closed order. Everything it does is written to
            the order, so you can open it afterwards and read the same history from the other side.
          </p>
          <p className="text-fg-secondary border-line-subtle mt-3 border-t pt-3 text-[13px] leading-relaxed">
            Steps that in real life need a person are{' '}
            <strong className="text-fg">passed through and marked</strong>, never skipped quietly.
            Finance authorising money, a clerk opening a carton, a licensed agent signing a customs
            entry: each is rendered with the name of whoever the agent stood in for and what they
            would actually have done. In the live platform those steps queue and wait — here they
            run so the flow can reach the end.
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
  const slug = slugForTeam(r.team);
  const bypass = r.humanBypass;

  /*
   * A bypassed human step is drawn as its OWN outcome, not as a variant of a
   * successful one. It advanced, so a green tick would be literally true — and
   * would bury the single most important thing on the row. Warning tone and a
   * left rule make the human steps findable by scrolling the log rather than by
   * reading every line of it.
   */
  const tone = r.outcome === 'BLOCKED' ? 'danger' : bypass ? 'warning' : r.outcome === 'DONE' ? 'neutral' : 'success';
  const Icon = r.outcome === 'BLOCKED' ? ShieldAlert : bypass ? UserCheck : r.outcome === 'DONE' ? Check : Zap;
  const label =
    r.outcome === 'BLOCKED'
      ? 'Gate refused'
      : r.outcome === 'DONE'
        ? 'Flow complete'
        : bypass
          ? 'Human step — bypassed'
          : 'Agent did this one';

  return (
    <li ref={ref} className="min-w-0">
      <div
        className={cn(
          'bg-surface-1 min-w-0 rounded-[11px] border p-3.5',
          r.outcome === 'BLOCKED'
            ? 'border-danger-border'
            : bypass
              ? 'border-warning-border border-l-[3px]'
              : 'border-line-subtle',
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
              <span className="text-fg-tertiary font-normal">
                {' '}
                → {r.toCode} {r.toLabel}
              </span>
            )}
          </span>
          <Chip tone={tone} size="sm" icon={Icon}>
            {label}
          </Chip>
        </div>

        {r.did && <p className="text-fg-secondary mt-2 text-[12.5px] leading-relaxed">{r.did}</p>}

        {/*
          The person this step stood in for.

          Named, with the specific act they would have performed — "1BUY Finance:
          transfer the agreed amount into escrow" rather than "human required".
          The generic sentence about the KIND follows, because that is the part
          that generalises beyond this one order.
        */}
        {bypass && (
          <div className="bg-warning-subtle border-warning-border mt-2.5 min-w-0 rounded-[9px] border p-2.5">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <Flag className="text-warning size-3.5 shrink-0" strokeWidth={2.2} aria-hidden />
              <span className="text-warning text-[11px] font-semibold tracking-[0.04em] uppercase">
                {bypass.kindLabel} — bypassed for the simulation
              </span>
              {bypass.liveWouldQueue && (
                <Chip tone="muted" size="sm">
                  Live platform would queue this and wait
                </Chip>
              )}
            </div>
            <p className="text-fg mt-1.5 text-[12.5px] leading-relaxed">
              <strong className="font-semibold">{bypass.who}</strong> would have done this:{' '}
              {bypass.wouldDo}
            </p>
            <p className="text-fg-secondary mt-1 text-[11.5px] leading-relaxed">{bypass.note}</p>
          </div>
        )}

        {r.sideEffects.length > 0 && (
          <ul className="text-fg-secondary mt-2 flex min-w-0 flex-col gap-1 text-[12px] leading-relaxed">
            {r.sideEffects.map((e) => (
              <li key={e} className="flex min-w-0 items-start gap-2">
                <Check className="text-success mt-0.5 size-3.5 shrink-0" strokeWidth={2.2} aria-hidden />
                <span className="min-w-0">{e}</span>
              </li>
            ))}
          </ul>
        )}

        {r.repliedTo && (
          <p className="text-fg-secondary mt-1.5 flex items-start gap-2 text-[12px] leading-relaxed">
            <Mail className="text-accent-text mt-0.5 size-3.5 shrink-0" strokeWidth={2} aria-hidden />
            <span>
              Drafted from <strong className="text-fg font-medium">&ldquo;{r.repliedTo}&rdquo;</strong>{' '}
              — the reply quotes it, and both sit in the thread on the order{' '}
              {slug && (
                <>
                  and on{' '}
                  <Link
                    href={`/teams/${slug}/orders/${orderId}`}
                    className="text-accent-text hover:underline"
                  >
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
            {r.outcome === 'BLOCKED' && <strong className="font-semibold">The gate said: </strong>}
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
