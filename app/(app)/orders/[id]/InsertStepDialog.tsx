'use client';

/**
 * Adding a step the standard flow does not have, to ONE order.
 *
 * The form asks for a reason and will not save without one. An extra step changes
 * what "done" means for this order, and an unexplained one is indistinguishable
 * from a mistake six weeks later — so "why" is a required field, not a note.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { CornerDownRight, Plus, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import { insertCustomStage } from '@/lib/actions/custom-stage';
import { Button, SectionLabel } from '@/components/ui/Layout';
import { cn } from '@/lib/utils';

const field =
  'bg-surface-1 border-line-subtle focus:border-accent text-fg placeholder:text-fg-tertiary w-full rounded-[8px] border px-2.5 py-1.5 text-[13px] outline-none';

const OWNERS = [
  { code: 'ONE_BUY', label: '1BUY' },
  { code: 'CUSTOMER', label: 'The customer' },
  { code: 'SUPPLIER', label: 'The supplier' },
  { code: 'ESCROW', label: 'The escrow provider' },
  { code: 'WHL', label: 'The testing laboratory' },
  { code: 'WHA', label: 'The customs agent' },
  { code: 'LOGISTICS', label: 'The logistics partner' },
] as const;

/** One option in the position picker. */
export interface InsertPoint {
  id: string;
  code: string;
  label: string;
  /** Where this stage sits relative to where the order actually is. */
  relation: 'PASSED' | 'CURRENT' | 'AHEAD';
}

export function InsertStepDialog({
  workOrderId,
  afterStage,
  afterCustomStageId,
  stages,
  onOpenChange,
}: {
  workOrderId: string;
  /** Where the button was pressed — the starting position, not a fixed one. */
  afterStage: { id: string; code: string; label: string };
  /** The manual step the new one goes after, when the gap sits inside a group. */
  afterCustomStageId?: string | null;
  /**
   * This order's whole flow, in order, each marked against where the order is.
   *
   * The position is chosen HERE rather than fixed by whichever button was
   * pressed: somebody writing "second inspection after repack" usually realises
   * mid-sentence that it belongs two stages further on, and making them cancel
   * and re-open from a different place is how a request ends up in the wrong slot.
   */
  stages: InsertPoint[];
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});

  /**
   * Changing the position clears the manual-step anchor: it identified a slot
   * inside the ORIGINAL stage's group, and carrying it to a different stage
   * would put the step in a group it does not belong to.
   */
  const [afterStageId, setAfterStageId] = useState(afterStage.id);
  const movedFromOriginal = afterStageId !== afterStage.id;

  const [label, setLabel] = useState('');
  const [reason, setReason] = useState('');
  const [owner, setOwner] = useState<string>('ONE_BUY');
  const [exitCriteria, setExitCriteria] = useState('');
  const [expectedHours, setExpectedHours] = useState('24');
  const [blocking, setBlocking] = useState(false);

  const chosenIndex = stages.findIndex((s) => s.id === afterStageId);
  const chosen = chosenIndex >= 0 ? stages[chosenIndex] : null;
  /** What the new step would sit in front of. */
  const follows = chosenIndex >= 0 ? (stages[chosenIndex + 1] ?? null) : null;
  const here = stages.find((s) => s.relation === 'CURRENT') ?? null;

  const submit = () => {
    setErrors({});
    startTransition(async () => {
      const res = await insertCustomStage({
        workOrderId,
        afterStageId,
        afterCustomStageId: movedFromOriginal ? null : (afterCustomStageId ?? null),
        label,
        reason,
        owner: owner as 'ONE_BUY',
        exitCriteria: exitCriteria || null,
        expectedHours: Number(expectedHours || 24),
        blocking,
      });
      if (res.ok) {
        toast.success(res.message, { description: res.detail, duration: 10000 });
        onOpenChange(false);
        router.refresh();
      } else {
        setErrors(res.errors ?? {});
        toast.error(res.message, { description: res.detail, duration: 11000 });
      }
    });
  };

  return (
    <Dialog.Root open onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px]" />
        <Dialog.Content className="bg-surface-1 border-line shadow-e4 fixed top-1/2 left-1/2 z-50 flex max-h-[92vh] w-[min(95vw,620px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[14px] border">
          <div className="border-line-subtle border-b px-5 py-3.5">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Dialog.Title className="text-fg min-w-0 text-[15px] font-semibold">
                <Plus className="mr-1.5 inline size-4 align-[-2px]" aria-hidden />
                Request a step in this order&rsquo;s flow
              </Dialog.Title>
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
              This adds a step to <strong>this order only</strong>. The standard ladder is untouched,
              and the step is drawn as a manual insert so nobody mistakes it for standard process.
            </Dialog.Description>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="grid gap-3.5">
              {/* Where it goes ────────────────────────────────────────────── */}
              <div className="border-line-subtle bg-surface-inset rounded-[9px] border px-3 py-2.5">
                <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <SectionLabel>Where it goes</SectionLabel>
                  {here && (
                    <span className="text-fg-tertiary ml-auto text-[10.5px]">
                      Order is at{' '}
                      <span className="text-accent-text tnum font-semibold">{here.code}</span>{' '}
                      {here.label}
                    </span>
                  )}
                </div>

                <label className="block min-w-0">
                  <span className="sr-only">Put the step after</span>
                  <select
                    value={afterStageId}
                    onChange={(e) => setAfterStageId(e.target.value)}
                    className={cn(field, 'mb-2')}
                  >
                    {stages.map((s) => (
                      <option
                        key={s.id}
                        value={s.id}
                        // A step cannot be inserted into the past — it would
                        // describe work that should have happened and did not.
                        disabled={s.relation === 'PASSED'}
                      >
                        After {s.code} · {s.label}
                        {s.relation === 'CURRENT' ? ' — the order is here' : ''}
                        {s.relation === 'PASSED' ? ' — already passed' : ''}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="grid gap-1 text-[12px]">
                  {chosen && <Neighbour code={chosen.code} label={chosen.label} current={chosen.relation === 'CURRENT'} />}
                  <span className="text-accent-text flex min-w-0 items-center gap-1.5 pl-3 font-medium">
                    <CornerDownRight className="size-3.5 shrink-0" aria-hidden />
                    {label.trim() || 'your new step'}
                  </span>
                  {follows && (
                    <Neighbour code={follows.code} label={follows.label} current={follows.relation === 'CURRENT'} />
                  )}
                </div>

                {movedFromOriginal && afterCustomStageId && (
                  <p className="text-fg-tertiary mt-2 text-[11px] leading-relaxed">
                    Moved from where you clicked, so it will sit at the end of{' '}
                    {chosen?.code}&rsquo;s group rather than in the exact slot you pressed.
                  </p>
                )}
              </div>

              <label className="block min-w-0">
                <span className="text-fg-secondary mb-1 block text-[11.5px] font-medium">
                  What is the step
                </span>
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. Second inspection after repack"
                  className={cn(field, errors.label && 'border-danger')}
                />
                {errors.label && (
                  <span className="text-danger mt-1 block text-[11.5px]">{errors.label}</span>
                )}
              </label>

              <label className="block min-w-0">
                <span className="text-fg-secondary mb-1 block text-[11.5px] font-medium">
                  Why this order needs it
                </span>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder="What happened on this order that the standard flow does not cover"
                  className={cn(field, 'resize-y leading-relaxed', errors.reason && 'border-danger')}
                />
                <span
                  className={cn(
                    'mt-1 block text-[11.5px] leading-relaxed',
                    errors.reason ? 'text-danger' : 'text-fg-tertiary',
                  )}
                >
                  {errors.reason ??
                    'Required. This is what someone reads in six weeks when they ask why this order has a step no other order has.'}
                </span>
              </label>

              <div className="grid gap-3.5 sm:grid-cols-2">
                <label className="block min-w-0">
                  <span className="text-fg-secondary mb-1 block text-[11.5px] font-medium">
                    Who has to do it
                  </span>
                  <select value={owner} onChange={(e) => setOwner(e.target.value)} className={field}>
                    {OWNERS.map((o) => (
                      <option key={o.code} value={o.code}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block min-w-0">
                  <span className="text-fg-secondary mb-1 block text-[11.5px] font-medium">
                    Expected to take
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={2160}
                    value={expectedHours}
                    onChange={(e) => setExpectedHours(e.target.value)}
                    className={field}
                  />
                  <span className="text-fg-tertiary mt-1 block text-[11.5px]">
                    Hours. Drives the ageing warning, same as a standard stage.
                  </span>
                </label>
              </div>

              <label className="block min-w-0">
                <span className="text-fg-secondary mb-1 block text-[11.5px] font-medium">
                  What counts as finished
                </span>
                <input
                  value={exitCriteria}
                  onChange={(e) => setExitCriteria(e.target.value)}
                  placeholder="e.g. Second inspection report signed and filed"
                  className={field}
                />
                <span className="text-fg-tertiary mt-1 block text-[11.5px] leading-relaxed">
                  Written so two different people would agree whether it is done.
                </span>
              </label>

              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={blocking}
                  onChange={(e) => setBlocking(e.target.checked)}
                  className="accent-accent mt-0.5 size-3.5 shrink-0"
                />
                <span className="min-w-0">
                  <span className="text-fg block text-[12.5px] font-medium">
                    The order should not pass this point until it is done
                  </span>
                  <span className="text-fg-tertiary block text-[11.5px] leading-relaxed">
                    Shown prominently on the flow and in the next action. It is a flag rather than a
                    hard lock — the stage ladder still governs transitions, so a forgotten step can
                    never strand an order with no way forward.
                  </span>
                </span>
              </label>
            </div>
          </div>

          <div className="border-line-subtle flex flex-wrap justify-end gap-2 border-t px-5 py-3">
            <Dialog.Close asChild>
              <Button variant="secondary" icon={X}>
                Cancel
              </Button>
            </Dialog.Close>
            <Button variant="primary" icon={Send} disabled={pending} onClick={submit}>
              {pending ? 'Sending…' : 'Send for approval'}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Neighbour({
  code,
  label,
  current,
}: {
  code?: string;
  label: string;
  /** Marked so the requester can see the step's position relative to the order. */
  current?: boolean;
}) {
  return (
    <span className="text-fg-secondary flex min-w-0 items-center gap-1.5">
      <span className="text-fg-tertiary shrink-0 font-mono text-[10.5px]">{code ?? 'manual'}</span>
      <span className="min-w-0">{label}</span>
      {current && (
        <span className="border-accent-border text-accent-text shrink-0 rounded border px-1 py-px text-[9px] font-semibold tracking-wide uppercase">
          Order is here
        </span>
      )}
    </span>
  );
}
