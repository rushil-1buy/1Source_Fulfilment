'use client';

/**
 * Reviewing and saving a re-planned flow.
 *
 * The strip on the order page is where the operator rearranges phases. This is
 * where they see what that arrangement actually means and commit it, because the
 * three things worth knowing before saving do not fit on a 148px tile:
 *
 *   · what changed, as sentences rather than a before/after list of letters
 *   · which STAGES disappear when a phase is removed — a phase is an abstraction,
 *     "no customs entry is filed and no duty is paid" is the thing being decided
 *   · which arrangements carry a cost, stated but not forbidden
 *
 * The reason is mandatory. A flow that departs from the standard ladder with no
 * explanation is indistinguishable from a mistake six months later, and this
 * dialog is the only moment at which the person who knows why is present.
 */

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  IndianRupee,
  Landmark,
  RotateCcw,
  Scissors,
  Workflow,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { savePhasePlan } from '@/lib/actions/phase-plan';
import {
  DEFAULT_PHASE_PLAN,
  PLAN_REASON_MIN,
  curtailImpact,
  describePlanChanges,
  isDefaultPlan,
  planSequence,
  planWarnings,
  type CurtailWeight,
} from '@/lib/domain/phase-plan';
import { PHASE_DEFS, type PhasePlan, type StageContext } from '@/lib/domain/stages';
import { Button, SectionLabel } from '@/components/ui/Layout';
import { Chip } from '@/components/ui/Badges';
import { cn } from '@/lib/utils';

const field =
  'bg-surface-1 border-line-subtle focus:border-accent text-fg placeholder:text-fg-tertiary w-full rounded-[8px] border px-2.5 py-2 text-[13px] outline-none';

const WEIGHT_META: Record<CurtailWeight, { label: string; icon: typeof IndianRupee; tone: string }> =
  {
    MONEY: { label: 'Money', icon: IndianRupee, tone: 'text-warning' },
    STATUTORY: { label: 'Statutory', icon: Landmark, tone: 'text-danger' },
    ROUTINE: { label: 'Quality', icon: Check, tone: 'text-fg-secondary' },
  };

export function FlowPlanDialog({
  workOrderId,
  orderAlias,
  saved,
  proposed,
  ctx,
  onOpenChange,
  onSaved,
}: {
  workOrderId: string;
  orderAlias: string;
  /** The plan currently in force. */
  saved: PhasePlan;
  /** What the operator arranged on the strip. */
  proposed: PhasePlan;
  /** For warnings that depend on what the order is, not just how it is arranged. */
  ctx: StageContext;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState('');
  const [problems, setProblems] = useState<string[]>([]);

  const changes = useMemo(() => describePlanChanges(saved, proposed), [saved, proposed]);
  const warnings = useMemo(
    () => planWarnings(proposed, { ...ctx, phasePlan: proposed }),
    [proposed, ctx],
  );
  const removals = useMemo(
    () =>
      changes
        .filter((c) => c.kind === 'REMOVED')
        .map((c) => curtailImpact(c.phase))
        .filter((x): x is NonNullable<typeof x> => Boolean(x)),
    [changes],
  );
  const stagesLost = removals.reduce((n, r) => n + r.stages.length, 0);

  const reasonTooShort = reason.trim().length < PLAN_REASON_MIN;
  const nothingToDo = changes.length === 0;

  function submit() {
    setProblems([]);
    startTransition(async () => {
      const res = await savePhasePlan({ workOrderId, plan: proposed, reason: reason.trim() });
      if (!res.ok) {
        setProblems(res.problems ?? []);
        toast.error(res.message, { description: res.detail ?? res.errors?.reason });
        return;
      }
      toast.success(res.message, { description: res.detail });
      // Consequences are surfaced again after the save, because they describe the
      // order from here on rather than the act of changing it.
      for (const w of res.warnings ?? []) toast.warning('Worth checking', { description: w });
      onSaved();
      onOpenChange(false);
      router.refresh();
    });
  }

  function resetToStandard() {
    setProblems([]);
    startTransition(async () => {
      const res = await savePhasePlan({
        workOrderId,
        plan: DEFAULT_PHASE_PLAN.map((e) => ({ ...e })),
        reason: reason.trim() || 'Returned to the standard flow.',
      });
      if (!res.ok) {
        setProblems(res.problems ?? []);
        toast.error(res.message, { description: res.detail ?? res.errors?.reason });
        return;
      }
      toast.success(res.message, { description: res.detail });
      onSaved();
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog.Root open onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px]" />
        <Dialog.Content className="bg-surface-1 border-line shadow-e4 fixed top-1/2 left-1/2 z-50 flex max-h-[92vh] w-[min(95vw,660px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[14px] border">
          <div className="border-line-subtle border-b px-5 py-3.5">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Dialog.Title className="text-fg min-w-0 text-[15px] font-semibold">
                <Workflow className="mr-1.5 inline size-4 align-[-2px]" aria-hidden />
                Change this order’s flow
              </Dialog.Title>
              <Chip tone="neutral" size="sm">
                {orderAlias}
              </Chip>
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="Close"
                  className="text-fg-tertiary hover:bg-surface-3 hover:text-fg ml-auto grid size-7 shrink-0 place-items-center rounded-[7px] transition-colors"
                >
                  <X className="size-4" strokeWidth={2} aria-hidden />
                </button>
              </Dialog.Close>
            </div>
            <Dialog.Description className="text-fg-secondary mt-1.5 text-[12.5px] leading-relaxed">
              This changes the route <strong className="font-medium">this order alone</strong> takes.
              The standard ladder every other order follows is untouched.
            </Dialog.Description>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {/* ── Before and after, as the thing an operator reads off the rail ── */}
            <div>
              <SectionLabel>The route</SectionLabel>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                {/* Only shown as a before/after when there IS a before. Striking
                    through the current route next to an identical copy of itself
                    reads as a change that is not being proposed. */}
                {changes.length > 0 && (
                  <>
                    <span className="border-line-subtle text-fg-tertiary tnum rounded-[7px] border border-dashed px-2 py-1 text-[12.5px] line-through">
                      {planSequence(saved)}
                    </span>
                    <ArrowRight
                      className="text-fg-tertiary size-3.5 shrink-0"
                      strokeWidth={2.5}
                      aria-hidden
                    />
                  </>
                )}
                <span className="border-accent-border bg-accent-subtle text-accent-text tnum rounded-[7px] border px-2 py-1 text-[12.5px] font-semibold">
                  {planSequence(proposed)}
                </span>
                {isDefaultPlan(proposed) ? (
                  <Chip tone="success" size="sm">
                    {changes.length > 0 ? 'Back to standard' : 'The standard flow'}
                  </Chip>
                ) : (
                  changes.length === 0 && (
                    <Chip tone="warning" size="sm">
                      In force on this order
                    </Chip>
                  )
                )}
              </div>
            </div>

            {/* ── What changed ────────────────────────────────────────────────── */}
            <div>
              <SectionLabel>
                {nothingToDo ? 'No changes' : `${changes.length} change${changes.length === 1 ? '' : 's'}`}
              </SectionLabel>
              {nothingToDo ? (
                <p className="text-fg-tertiary mt-1.5 text-[12.5px]">
                  This is the flow already in force on the order.
                </p>
              ) : (
                <ul className="mt-1.5 space-y-1">
                  {changes.map((c) => {
                    const Icon =
                      c.kind === 'REMOVED' ? Scissors : c.kind === 'RESTORED' ? RotateCcw : ArrowRight;
                    return (
                      <li
                        key={`${c.kind}-${c.phase}`}
                        className="text-fg-secondary flex items-start gap-2 text-[12.5px] leading-relaxed"
                      >
                        <Icon
                          className={cn(
                            'mt-[3px] size-3.5 shrink-0',
                            c.kind === 'REMOVED' ? 'text-danger' : 'text-fg-tertiary',
                          )}
                          strokeWidth={2.25}
                          aria-hidden
                        />
                        {c.detail}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* ── Exactly which steps disappear ───────────────────────────────── */}
            {removals.length > 0 && (
              <div className="border-danger/35 bg-danger-subtle rounded-[10px] border p-3">
                <div className="text-fg flex flex-wrap items-center gap-2 text-[12.5px] font-semibold">
                  <Scissors className="text-danger size-3.5 shrink-0" strokeWidth={2.25} aria-hidden />
                  {stagesLost} step{stagesLost === 1 ? '' : 's'} will not happen on this order
                </div>
                <div className="mt-2.5 space-y-3">
                  {removals.map((r) => {
                    const w = WEIGHT_META[r.weight];
                    const WIcon = w.icon;
                    return (
                      <div key={r.phase}>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-fg text-[12px] font-semibold">
                            Phase {r.phase} — {PHASE_DEFS[r.phase].label}
                          </span>
                          <span
                            className={cn(
                              'flex items-center gap-1 text-[10px] font-semibold tracking-wide uppercase',
                              w.tone,
                            )}
                          >
                            <WIcon className="size-3" strokeWidth={2.5} aria-hidden />
                            {w.label}
                          </span>
                        </div>
                        {/* The stage codes, because "phase E" is an abstraction and
                            "E4 Customs entry filed" is the thing being given up. */}
                        <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                          {r.stages.map((s) => (
                            <li
                              key={s.code}
                              className="text-fg-tertiary text-[11.5px] line-through decoration-[1.5px]"
                            >
                              <span className="tnum font-semibold">{s.code}</span> {s.label}
                            </li>
                          ))}
                        </ul>
                        <p className="text-fg-secondary mt-1.5 text-[12px] leading-relaxed">
                          {r.consequence}
                        </p>
                        <p className="text-fg-tertiary mt-1 text-[11.5px] leading-relaxed">
                          <span className="font-semibold">Right call when:</span> {r.legitimateWhen}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Allowed, but say so ─────────────────────────────────────────── */}
            {warnings.length > 0 && (
              <div className="border-warning/40 bg-warning-subtle rounded-[10px] border p-3">
                <div className="text-fg flex items-center gap-2 text-[12.5px] font-semibold">
                  <AlertTriangle className="text-warning size-3.5 shrink-0" strokeWidth={2.25} aria-hidden />
                  Allowed, but worth knowing
                </div>
                <ul className="mt-1.5 space-y-1.5">
                  {warnings.map((w, i) => (
                    <li key={i} className="text-fg-secondary text-[12px] leading-relaxed">
                      <span className="text-fg tnum font-semibold">{w.phases.join('/')}</span> — {w.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* ── Anything the server refused ─────────────────────────────────── */}
            {problems.length > 0 && (
              <div className="border-danger/40 bg-danger-subtle rounded-[10px] border p-3">
                <div className="text-danger text-[12.5px] font-semibold">
                  This flow is not allowed on this order
                </div>
                <ul className="mt-1.5 space-y-1">
                  {problems.map((p, i) => (
                    <li key={i} className="text-fg-secondary text-[12px] leading-relaxed">
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* ── The reason ──────────────────────────────────────────────────── */}
            <div>
              <label htmlFor="flow-reason" className="mb-1 block">
                <SectionLabel>Why this order does not follow the standard flow</SectionLabel>
              </label>
              <textarea
                id="flow-reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Supplier is in Bengaluru — goods never cross a border, so there is no import to declare."
                className={cn(field, 'resize-y')}
              />
              <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-fg-tertiary text-[11px]">
                  Recorded against every phase this changes, and in the order’s audit log.
                </span>
                <span
                  className={cn(
                    'tnum text-[11px]',
                    reasonTooShort ? 'text-fg-tertiary' : 'text-success',
                  )}
                >
                  {reason.trim().length}/{PLAN_REASON_MIN}
                </span>
              </div>
            </div>
          </div>

          <div className="border-line-subtle bg-surface-2 flex flex-wrap items-center gap-2 border-t px-5 py-3">
            {!isDefaultPlan(saved) && (
              <button
                type="button"
                onClick={resetToStandard}
                disabled={pending}
                className="border-line-subtle text-fg-secondary hover:bg-surface-3 rounded-[8px] border px-2.5 py-1.5 text-[12px] disabled:opacity-50"
              >
                <RotateCcw className="mr-1 inline size-3 align-[-1px]" aria-hidden />
                Reset to the standard flow
              </button>
            )}
            <div className="ml-auto flex items-center gap-2">
              <Dialog.Close asChild>
                <Button variant="ghost" disabled={pending}>
                  Cancel
                </Button>
              </Dialog.Close>
              <Button onClick={submit} disabled={pending || reasonTooShort || nothingToDo}>
                {pending ? 'Saving…' : 'Save this flow'}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
