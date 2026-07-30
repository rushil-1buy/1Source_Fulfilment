'use client';

/**
 * Putting the demo order back to its starting position.
 *
 * Only ever rendered on the demo fixture — see the alias check at the call site —
 * because it deletes an order and everything hanging off it. On a real order that
 * would be destruction of records, so it should never be one prop away from
 * appearing on one.
 *
 * It confirms first, and the confirmation says what actually disappears rather
 * than asking "are you sure?". A demo is usually run in front of people, and
 * "reset" pressed by accident mid-walkthrough is not recoverable.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { RotateCcw, X } from 'lucide-react';
import { toast } from 'sonner';
import { resetDemoOrder } from '@/lib/actions/demo';
import { Button } from '@/components/ui/Layout';
import { Chip } from '@/components/ui/Badges';

/** What a run through the flow leaves behind, named so the operator can weigh it. */
const CLEARED = [
  'Escrow account, funding and every release',
  'Test requests and laboratory results',
  'Shipments, tracking and customs entry',
  'Goods receipts, inspections and repack jobs',
  'Tax invoices, input tax credit and RCM entries',
  'Stage evidence, uploaded documents and manual steps',
  'Any re-planned or curtailed flow',
];

export function DemoResetButton({ currentStageLabel }: { currentStageLabel: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const run = () => {
    startTransition(async () => {
      const res = await resetDemoOrder();
      if (!res.ok) {
        toast.error(res.message, { description: res.detail, duration: 11000 });
        return;
      }
      toast.success(res.message, { description: res.detail, duration: 9000 });
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border-line-subtle text-fg-secondary hover:bg-surface-3 hover:text-fg flex shrink-0 items-center gap-1.5 rounded-[8px] border border-dashed px-2.5 py-1.5 text-[12px] transition-colors"
        title="Put this demo order back to B3, ready to run through again"
      >
        <RotateCcw className="size-3.5" strokeWidth={2} aria-hidden />
        Reset demo
      </button>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px]" />
          <Dialog.Content className="bg-surface-1 border-line shadow-e4 fixed top-1/2 left-1/2 z-50 flex max-h-[92vh] w-[min(94vw,540px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[14px] border">
            <div className="border-line-subtle border-b px-5 py-3.5">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Dialog.Title className="text-fg min-w-0 text-[15px] font-semibold">
                  <RotateCcw className="mr-1.5 inline size-4 align-[-2px]" aria-hidden />
                  Start the demo over
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
                The order goes back to{' '}
                <strong className="text-fg font-medium">
                  B3 · Supplier Proforma Invoice received
                </strong>{' '}
                in Phase B, with all four documents in place and 30 stages ahead of it — exactly
                where it starts.
              </Dialog.Description>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-fg-tertiary text-[10.5px] font-semibold tracking-[0.05em] uppercase">
                  Currently at
                </span>
                <Chip tone="neutral" size="sm">
                  {currentStageLabel}
                </Chip>
              </div>

              <p className="text-fg-secondary text-[12.5px] leading-relaxed">
                Everything the last run produced is deleted, not hidden:
              </p>
              <ul className="mt-2 space-y-1">
                {CLEARED.map((c) => (
                  <li key={c} className="text-fg-secondary flex items-start gap-2 text-[12px]">
                    <span className="bg-line-strong mt-[7px] size-1 shrink-0 rounded-full" aria-hidden />
                    {c}
                  </li>
                ))}
              </ul>
              <p className="text-fg-tertiary mt-3 text-[11.5px] leading-relaxed">
                Only this demo order is touched. Every other order, and all the reference data, is
                left alone.
              </p>
            </div>

            <div className="border-line-subtle bg-surface-2 flex flex-wrap items-center justify-end gap-2 border-t px-5 py-3">
              <Dialog.Close asChild>
                <Button variant="ghost" disabled={pending}>
                  Cancel
                </Button>
              </Dialog.Close>
              <Button variant="danger" icon={RotateCcw} onClick={run} disabled={pending}>
                {pending ? 'Resetting…' : 'Reset to B3'}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
