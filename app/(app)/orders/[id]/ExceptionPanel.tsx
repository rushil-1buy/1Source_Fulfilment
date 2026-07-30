'use client';

/**
 * EXCEPTION RESOLUTION PANEL.
 *
 * Lives inside the tab that owns the evidence — a failed test is decided in the
 * Testing tab, next to the lot that failed, not in a banner at the top of the
 * page. Where the exception maps to line items, the affected part numbers are
 * named explicitly, because "the lot failed" is not actionable but "12 of 50
 * LM358N failed X-ray" is.
 *
 * Choosing a route runs the real operation: it resolves the exception, logs the
 * decision and its consequence to Communication, and advances the order to
 * whatever stage that route declares.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, ArrowRight, Check, TriangleAlert, X } from 'lucide-react';
import { toast } from 'sonner';
import { resolveExceptionRoute } from '@/lib/actions/stage';
import { exceptionDef, type ExceptionRoute } from '@/lib/domain/exceptions';
import { getStage } from '@/lib/domain/stages';
import { Button, SectionLabel } from '@/components/ui/Layout';
import { Chip } from '@/components/ui/Badges';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import { cn, relativeTime } from '@/lib/utils';

export interface FailedLine {
  mpn: string;
  lotRef: string | null;
  testedQty: number;
  passedQty: number;
  failedQty: number;
  failureMode: string | null;
}

export function ExceptionPanel({
  exception,
  failedLines = [],
}: {
  exception: {
    id: string;
    type: string;
    reason: string;
    severity: string;
    offStage: string;
    openedAt: string;
  };
  /** Populated where the exception maps to specific parts. */
  failedLines?: FailedLine[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<ExceptionRoute | null>(null);

  const def = exceptionDef(exception.type);
  if (!def) return null;

  const choose = (route: ExceptionRoute) => {
    startTransition(async () => {
      const res = await resolveExceptionRoute(exception.id, route.id);
      setConfirming(null);
      if (res.ok) {
        toast.success(res.message, { description: res.detail, duration: 9000 });
        router.refresh();
      } else {
        toast.error(res.message, { description: res.detail });
      }
    });
  };

  return (
    <div className="border-danger-border bg-danger-subtle min-w-0 rounded-[12px] border p-4">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <AlertTriangle className="text-danger size-4 shrink-0" strokeWidth={2.2} aria-hidden />
        <span className="text-danger text-[12.5px] font-semibold tracking-[0.04em] uppercase">
          {def.label} — needs a decision
        </span>
        <InfoTooltip termKey="exceptionType" />
        <Chip tone={exception.severity === 'CRITICAL' ? 'danger' : 'warning'} size="sm">
          {exception.severity.toLowerCase()}
        </Chip>
        <span className="text-fg-tertiary ml-auto shrink-0 text-[11px]">
          Open since {relativeTime(exception.openedAt)} · diverged at stage{' '}
          <span className="font-mono">{getStage(exception.offStage).code}</span>
        </span>
      </div>

      <p className="text-fg mt-2 text-[12.5px] leading-relaxed">{exception.reason}</p>

      {/* ── Which parts actually failed ─────────────────────────────────────── */}
      {def.mapsToLineItems && failedLines.length > 0 && (
        <div className="mt-3">
          <SectionLabel>Parts affected</SectionLabel>
          <div className="border-line-subtle bg-surface-1 overflow-x-auto rounded-[9px] border">
            <table className="w-full border-collapse text-left text-[12px]">
              <thead className="bg-surface-inset">
                <tr className="border-line-subtle border-b">
                  <Th termKey="mpn">Part number</Th>
                  <Th termKey="dateCodeLot">Lot reference</Th>
                  <Th align="right">Quantity tested</Th>
                  <Th align="right">Passed</Th>
                  <Th align="right">Failed</Th>
                  <Th>Failure mode</Th>
                </tr>
              </thead>
              <tbody>
                {failedLines.map((l) => (
                  <tr key={`${l.mpn}-${l.lotRef}`} className="border-line-subtle border-b last:border-0">
                    <td className="px-3 py-2 font-mono text-[11.5px] font-medium">{l.mpn}</td>
                    <td className="text-fg-secondary px-3 py-2 font-mono text-[11px]">
                      {l.lotRef ?? '—'}
                    </td>
                    <td className="tnum px-3 py-2 text-right">{l.testedQty.toLocaleString('en-IN')}</td>
                    <td className="tnum text-success px-3 py-2 text-right">
                      {l.passedQty.toLocaleString('en-IN')}
                    </td>
                    <td
                      className={cn(
                        'tnum px-3 py-2 text-right',
                        l.failedQty > 0 && 'text-danger font-semibold',
                      )}
                    >
                      {l.failedQty.toLocaleString('en-IN')}
                    </td>
                    <td className="text-fg-secondary px-3 py-2 text-[11.5px]">
                      {l.failureMode ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Routes, each showing what it will actually do ───────────────────── */}
      <div className="mt-3">
        <SectionLabel>How to resolve this — choose one route</SectionLabel>
        <div className="border-line-subtle bg-surface-1 overflow-x-auto rounded-[9px] border">
          <table className="w-full border-collapse text-left text-[12px]">
            <thead className="bg-surface-inset">
              <tr className="border-line-subtle border-b">
                <Th>Route</Th>
                <Th>What this does</Th>
                <Th>Order moves to</Th>
                <Th align="right">Action</Th>
              </tr>
            </thead>
            <tbody>
              {def.routes.map((r) => (
                <tr key={r.id} className="border-line-subtle border-b last:border-0">
                  <td className="text-fg px-3 py-2 font-medium">{r.label}</td>
                  <td className="text-fg-secondary px-3 py-2 text-[11.5px] leading-relaxed">
                    {r.consequence}
                  </td>
                  <td className="px-3 py-2">
                    {r.targetStage ? (
                      <span className="flex items-center gap-1.5">
                        <span className="text-fg-tertiary font-mono text-[10px]">
                          {getStage(r.targetStage).code}
                        </span>
                        <span className="text-fg-secondary truncate text-[11.5px]">
                          {getStage(r.targetStage).label}
                        </span>
                      </span>
                    ) : (
                      <Chip tone="danger" size="sm">
                        {r.terminal === 'RESOURCE' ? 'Back to sourcing' : 'Order cancelled'}
                      </Chip>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      size="sm"
                      variant={r.tone === 'danger' ? 'danger' : 'secondary'}
                      icon={ArrowRight}
                      disabled={pending}
                      onClick={() => setConfirming(r)}
                    >
                      Choose
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-fg-tertiary mt-2 text-[11px] leading-relaxed">
          Whichever route you choose is logged to this order&apos;s Communication thread with its
          consequence, and the order moves on from there.
        </p>
      </div>

      {/* ── Confirmation ───────────────────────────────────────────────────── */}
      <Dialog.Root open={confirming !== null} onOpenChange={(o) => !o && setConfirming(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px]" />
          <Dialog.Content className="bg-surface-1 border-line shadow-e4 fixed top-1/2 left-1/2 z-50 w-[min(92vw,540px)] -translate-x-1/2 -translate-y-1/2 rounded-[14px] border p-5">
            <Dialog.Title className="text-fg flex items-center gap-2 text-[15px] font-semibold">
              {confirming?.tone === 'danger' && (
                <TriangleAlert className="text-danger size-4 shrink-0" aria-hidden />
              )}
              {confirming?.label}
            </Dialog.Title>
            <Dialog.Description className="text-fg-secondary mt-2 text-[12.5px] leading-relaxed">
              {confirming?.consequence}
            </Dialog.Description>

            {confirming?.targetStage && (
              <div className="border-line-subtle bg-surface-inset mt-3 rounded-[9px] border px-3 py-2">
                <SectionLabel>The order will move to</SectionLabel>
                <div className="text-fg text-[12.5px] font-medium">
                  <span className="text-fg-tertiary font-mono text-[10.5px]">
                    {getStage(confirming.targetStage).code}
                  </span>{' '}
                  {getStage(confirming.targetStage).label}
                </div>
                <div className="text-fg-tertiary mt-0.5 text-[11.5px]">
                  {getStage(confirming.targetStage).description}
                </div>
              </div>
            )}

            {confirming?.terminal && (
              <div className="border-danger-border bg-danger-subtle mt-3 rounded-[9px] border px-3 py-2">
                <span className="text-danger text-[11.5px] font-semibold">
                  This ends the work order. It cannot be undone from here.
                </span>
              </div>
            )}

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Dialog.Close asChild>
                <Button variant="secondary" icon={X}>
                  Go back
                </Button>
              </Dialog.Close>
              <Button
                variant={confirming?.tone === 'danger' ? 'danger' : 'primary'}
                icon={Check}
                disabled={pending}
                onClick={() => confirming && choose(confirming)}
              >
                {pending ? 'Applying…' : 'Confirm this route'}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function Th({
  children,
  termKey,
  align = 'left',
}: {
  children: React.ReactNode;
  termKey?: string;
  align?: 'left' | 'right';
}) {
  return (
    <th
      scope="col"
      className={cn(
        'text-fg-tertiary px-3 py-2 text-[10px] font-semibold tracking-[0.04em] whitespace-nowrap uppercase',
        align === 'right' && 'text-right',
      )}
    >
      <span className={cn('inline-flex items-center gap-1', align === 'right' && 'flex-row-reverse')}>
        {children}
        {termKey && <InfoTooltip termKey={termKey} />}
      </span>
    </th>
  );
}
