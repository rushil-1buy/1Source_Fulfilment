'use client';

/**
 * Acting on a step somebody added by hand.
 *
 * Marking it done needs nothing beyond the click — the exit criteria said what
 * "done" means. Skipping or removing it does need a reason, because the step was
 * added for a stated reason and walking past that silently leaves the original
 * concern unanswered on the record.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, Clock3, Minus, Plus, ThumbsDown, ThumbsUp, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { decideCustomStage, removeCustomStage, setCustomStageStatus } from '@/lib/actions/custom-stage';
import { Button, SectionLabel } from '@/components/ui/Layout';
import { Chip } from '@/components/ui/Badges';
import { STAKEHOLDER_META } from '@/lib/domain/enums';
import { getStage } from '@/lib/domain/stages';
import { cn, humanDuration, relativeTime } from '@/lib/utils';
import type { ManualStep } from '@/components/flow/FlowRail';

const field =
  'bg-surface-1 border-line-subtle focus:border-accent text-fg placeholder:text-fg-tertiary w-full rounded-[8px] border px-2.5 py-1.5 text-[13px] outline-none';

/** Which of the reason-bearing actions the operator is part-way through. */
type Intent = 'skip' | 'remove' | 'reject' | null;

export function ManualStepDialog({
  step,
  onOpenChange,
}: {
  step: ManualStep;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [intent, setIntent] = useState<Intent>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const owner = STAKEHOLDER_META[step.owner as keyof typeof STAKEHOLDER_META];
  const after = getStage(step.afterStageId);
  const done = step.status === 'DONE';
  const skipped = step.status === 'SKIPPED';

  const finish = (res: { ok: boolean; message: string; detail?: string; errors?: Record<string, string> }) => {
    if (res.ok) {
      toast.success(res.message, { description: res.detail, duration: 9000 });
      onOpenChange(false);
      router.refresh();
    } else {
      setError(res.errors?.reason ?? res.detail ?? res.message);
      toast.error(res.message, { description: res.detail, duration: 11000 });
    }
  };

  const setStatus = (status: 'PENDING' | 'DONE' | 'SKIPPED') => {
    setError(null);
    startTransition(async () => {
      finish(await setCustomStageStatus(step.id, status, { reason: reason.trim() || undefined }));
    });
  };

  const remove = () => {
    setError(null);
    startTransition(async () => {
      finish(await removeCustomStage(step.id, reason));
    });
  };

  const pendingApproval = step.approval === 'PENDING_APPROVAL';
  const rejected = step.approval === 'REJECTED';

  const decide = (decision: 'APPROVED' | 'REJECTED') => {
    startTransition(async () => {
      finish(await decideCustomStage(step.id, decision, reason.trim()));
    });
  };

  return (
    <Dialog.Root open onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px]" />
        <Dialog.Content className="bg-surface-1 border-line shadow-e4 fixed top-1/2 left-1/2 z-50 flex max-h-[92vh] w-[min(95vw,560px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[14px] border">
          <div className="border-line-subtle border-b px-5 py-3.5">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Dialog.Title className="text-fg min-w-0 text-[15px] font-semibold">
                <Plus className="mr-1.5 inline size-4 align-[-2px]" aria-hidden />
                {step.label}
              </Dialog.Title>
              {/* Approval first: whether the step belongs in the flow at all
                  outranks whether somebody has carried it out. */}
              {step.approval === 'PENDING_APPROVAL' ? (
                <Chip tone="warning" size="sm">
                  Awaiting approval
                </Chip>
              ) : step.approval === 'REJECTED' ? (
                <Chip tone="danger" size="sm">
                  Rejected
                </Chip>
              ) : (
                <Chip tone={done ? 'success' : skipped ? 'neutral' : step.blocking ? 'warning' : 'accent'} size="sm">
                  {done ? 'Done' : skipped ? 'Skipped' : step.blocking ? 'Must do' : 'Not done yet'}
                </Chip>
              )}
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
              A manual step on this order only. It sits after{' '}
              <strong className="font-medium">
                {after ? `${after.code} · ${after.label}` : step.afterStageId}
              </strong>
              .
            </Dialog.Description>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="grid gap-3.5">
              <div className="border-accent-border bg-accent-subtle rounded-[9px] border px-3 py-2.5">
                <SectionLabel>Why it was added</SectionLabel>
                <p className="text-fg text-[12.5px] leading-relaxed">{step.reason}</p>
                <p className="text-fg-tertiary mt-1.5 text-[11.5px]">
                  {step.createdBy} · {relativeTime(step.createdAt)}
                </p>
              </div>

              <dl className="grid gap-3 sm:grid-cols-2">
                <Detail label="Who has to do it">{owner?.label ?? step.owner}</Detail>
                <Detail label="Expected to take">{humanDuration(step.expectedHours)}</Detail>
                {step.exitCriteria && (
                  <div className="sm:col-span-2">
                    <Detail label="What counts as finished">{step.exitCriteria}</Detail>
                  </div>
                )}
                {step.completedBy && (
                  <Detail label={skipped ? 'Skipped by' : 'Completed by'}>
                    {step.completedBy}
                    {step.completedAt ? ` · ${relativeTime(step.completedAt)}` : ''}
                  </Detail>
                )}
              </dl>

              {intent && (
                <label className="block min-w-0">
                  <span className="text-fg-secondary mb-1 block text-[11.5px] font-medium">
                    {intent === 'skip' ? 'Why is it being skipped' : 'Why is it being removed'}
                  </span>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={3}
                    autoFocus
                    placeholder={
                      intent === 'skip'
                        ? 'What changed, so the concern behind this step no longer applies'
                        : 'Why this step should not have been added'
                    }
                    className={cn(field, 'resize-y leading-relaxed', error && 'border-danger')}
                  />
                  <span
                    className={cn(
                      'mt-1 block text-[11.5px] leading-relaxed',
                      error ? 'text-danger' : 'text-fg-tertiary',
                    )}
                  >
                    {error ??
                      `Required. The step was added because: ${step.reason} — that concern needs an answer on the record.`}
                  </span>
                </label>
              )}

              <p className="text-fg-tertiary text-[11.5px] leading-relaxed">
                Every change here is written to the audit log as its own entry, with the reason
                attached.
              </p>
            </div>
          </div>

          {/* ── Approval ─────────────────────────────────────────────────────
              A requested step gates on somebody else agreeing. Until then the
              done/skip controls are hidden entirely: marking a step done that
              nobody agreed to would put a completion on the record for work that
              was never sanctioned. */}
          {pendingApproval && (
            <div className="border-warning-border bg-warning-subtle border-t px-5 py-3">
              <div className="text-warning flex items-center gap-1.5 text-[12.5px] font-semibold">
                <Clock3 className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden />
                Waiting for approval
              </div>
              <p className="text-fg-secondary mt-1 text-[11.5px] leading-relaxed">
                Requested by {step.createdBy}. It shows on the flow but gates nothing until it is
                approved. Both the decision and the reason go on the audit log.
              </p>
              {intent === 'reject' && (
                <div className="mt-2">
                  <label htmlFor="reject-reason">
                    <SectionLabel>Why it is being rejected</SectionLabel>
                  </label>
                  <input
                    id="reject-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="The requester needs to know what to do instead."
                    className={cn(field, 'mt-1')}
                  />
                </div>
              )}
              <div className="mt-2.5 flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  icon={ThumbsUp}
                  disabled={pending || intent === 'reject'}
                  onClick={() => decide('APPROVED')}
                >
                  {pending ? 'Saving…' : 'Approve'}
                </Button>
                <Button
                  variant={intent === 'reject' ? 'danger' : 'secondary'}
                  icon={ThumbsDown}
                  disabled={pending}
                  onClick={() => (intent === 'reject' ? decide('REJECTED') : setIntent('reject'))}
                >
                  {intent === 'reject' ? 'Confirm rejection' : 'Reject'}
                </Button>
                {intent === 'reject' && (
                  <Button
                    variant="ghost"
                    icon={X}
                    disabled={pending}
                    onClick={() => {
                      setIntent(null);
                      setReason('');
                      setError(null);
                    }}
                  >
                    Back
                  </Button>
                )}
              </div>
            </div>
          )}

          {rejected && (
            <div className="border-danger-border bg-danger-subtle border-t px-5 py-3">
              <div className="text-danger text-[12.5px] font-semibold">
                Rejected by {step.decidedBy ?? 'a reviewer'}
              </div>
              {step.decisionNote && (
                <p className="text-fg-secondary mt-1 text-[11.5px] leading-relaxed">
                  {step.decisionNote}
                </p>
              )}
              <p className="text-fg-tertiary mt-1 text-[11px]">
                It stays on the record but is not part of this order&rsquo;s flow.
              </p>
            </div>
          )}

          <div className="border-line-subtle flex flex-wrap items-center gap-2 border-t px-5 py-3">
            {/* Removal is the destructive one, so it sits apart from the rest. */}
            {intent !== 'skip' && intent !== 'reject' && (
              <Button
                // Escalates only on the second click, so removal is never one
                // stray press away.
                variant={intent === 'remove' ? 'danger' : 'ghost'}
                icon={Trash2}
                disabled={pending}
                onClick={() => (intent === 'remove' ? remove() : setIntent('remove'))}
              >
                {intent === 'remove' ? 'Confirm removal' : 'Remove'}
              </Button>
            )}
            <div className="ml-auto flex flex-wrap gap-2">
              {intent ? (
                <Button
                  variant="secondary"
                  icon={X}
                  disabled={pending}
                  onClick={() => {
                    setIntent(null);
                    setReason('');
                    setError(null);
                  }}
                >
                  Back
                </Button>
              ) : (
                <Dialog.Close asChild>
                  <Button variant="secondary" icon={X}>
                    Close
                  </Button>
                </Dialog.Close>
              )}
              {!done && intent !== 'remove' && intent !== 'reject' && step.approval === 'APPROVED' && (
                <Button
                  variant={intent === 'skip' ? 'primary' : 'secondary'}
                  icon={Minus}
                  disabled={pending}
                  onClick={() => (intent === 'skip' ? setStatus('SKIPPED') : setIntent('skip'))}
                >
                  {intent === 'skip' ? 'Confirm skip' : 'Skip it'}
                </Button>
              )}
              {!intent &&
                (done || skipped ? (
                  <Button variant="secondary" icon={Plus} disabled={pending} onClick={() => setStatus('PENDING')}>
                    Reopen
                  </Button>
                ) : (
                  <Button variant="primary" icon={Check} disabled={pending} onClick={() => setStatus('DONE')}>
                    {pending ? 'Saving…' : 'Mark it done'}
                  </Button>
                ))}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-fg-tertiary text-[10px] font-semibold tracking-[0.06em] uppercase">
        {label}
      </dt>
      <dd className="text-fg mt-0.5 text-[12.5px] leading-relaxed">{children}</dd>
    </div>
  );
}
