'use client';

/**
 * What the filing agent did, step by step.
 *
 * An agent that acts on an external portal and reports only "done" is an agent
 * nobody can audit. Every run this dialog shows is also on the integration log
 * and the order's thread — this is just the readable form, shown the moment
 * the run finishes so the operator sees what was done in their name before
 * they move on.
 */

import * as Dialog from '@radix-ui/react-dialog';
import { Bot, Check, X } from 'lucide-react';
import { Chip } from '@/components/ui/Badges';
import type { AgentRun } from '@/lib/domain/portal-agents';

const offset = (ms: number) => `+${(ms / 1000).toFixed(1)}s`;

export function AgentRunDialog({
  run,
  title,
  open,
  onOpenChange,
}: {
  run: AgentRun | null;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!run) return null;
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px]" />
        <Dialog.Content className="bg-surface-1 border-line shadow-e4 fixed top-1/2 left-1/2 z-50 flex max-h-[88vh] w-[min(94vw,560px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[14px] border">
          <div className="border-line-subtle flex items-center gap-2 border-b px-4 py-3">
            <Bot className="text-accent-text size-4 shrink-0" strokeWidth={2} aria-hidden />
            <Dialog.Title className="text-fg min-w-0 flex-1 truncate text-[14px] font-semibold">
              {title}
            </Dialog.Title>
            <Chip tone="muted" size="sm">
              Simulated
            </Chip>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="text-fg-tertiary hover:text-fg hover:bg-surface-3 rounded-[7px] p-1.5 transition-colors"
              >
                <X className="size-4" strokeWidth={2} aria-hidden />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="text-fg-secondary border-line-subtle border-b px-4 py-2.5 text-[12px] leading-relaxed">
            {run.portal} — acknowledgement{' '}
            <span className="text-fg font-mono font-medium">{run.reference}</span>. No external
            portal is contacted in this build; the steps are the script the production agent runs,
            and the run is on the integration log and the order&rsquo;s thread.
          </Dialog.Description>
          <ol className="min-h-0 flex-1 overflow-y-auto p-4">
            {run.steps.map((s, i) => (
              <li key={i} className="flex min-w-0 items-start gap-2.5 pb-3 last:pb-0">
                <span className="bg-success-subtle mt-0.5 grid size-5 shrink-0 place-items-center rounded-full">
                  <Check className="text-success size-3" strokeWidth={2.5} aria-hidden />
                </span>
                <span className="text-fg min-w-0 flex-1 text-[12.5px] leading-relaxed">
                  {s.action}
                </span>
                <span className="tnum text-fg-tertiary shrink-0 font-mono text-[11px]">
                  {offset(s.atMs)}
                </span>
              </li>
            ))}
          </ol>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
