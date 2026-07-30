'use client';

/**
 * The control that actually moves an order forward.
 *
 * Most stages advance with one click. The final escrow release does not: it is
 * hard-gated on a passed inbound inspection AND two distinct Finance approvers,
 * so it opens a dialog that makes both requirements explicit rather than failing
 * with an error after the fact.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, ArrowRight, Check, ClipboardCheck, Lock, ShieldCheck, X } from 'lucide-react';
import { toast } from 'sonner';
import { advanceStage } from '@/lib/actions/stage';
import { getStage, nextStageFor, type StageContext } from '@/lib/domain/stages';
import { assessEvidence } from '@/lib/domain/stage-evidence';
import {
  nextAdvanceStep,
  type AdvanceGateState,
  type AdvanceRequest,
} from '@/lib/domain/advance-gate';
import { StageEvidenceDialog } from './StageEvidenceDialog';
import type { EvidenceRecord } from './StageEvidencePanel';
import { Button, SectionLabel } from '@/components/ui/Layout';
import { Chip } from '@/components/ui/Badges';
import { cn } from '@/lib/utils';

export interface FinanceApprover {
  id: string;
  name: string;
  role: string;
}

export function AdvanceControl({
  workOrderId,
  currentStage,
  currentStageCode,
  currentStageLabel,
  evidenceRecord,
  ctx,
  blocked,
  financeApprovers,
  inspectionPassed,
}: {
  workOrderId: string;
  currentStage: string;
  currentStageCode: string;
  currentStageLabel: string;
  /** Evidence already recorded for the stage being left, if any. */
  evidenceRecord?: EvidenceRecord;
  ctx: StageContext;
  blocked: boolean;
  financeApprovers: FinanceApprover[];
  inspectionPassed: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [approverDialog, setApproverDialog] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  /** Opens the stepped evidence form for the stage being left. */
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  /**
   * The operator's reason for going on without complete evidence, held here
   * rather than inside the evidence dialog.
   *
   * It has to outlive that dialog: when the target stage ALSO needs two
   * approvers, the evidence form closes and the approver dialog opens, and the
   * reason still has to reach the server with the eventual submission. Keeping it
   * in the dialog is what previously dropped it and trapped the order.
   */
  const [waiverReason, setWaiverReason] = useState<string | null>(null);

  const next = blocked ? null : nextStageFor(currentStage, ctx);

  if (blocked) {
    return (
      <p className="text-fg-tertiary text-[11.5px] leading-relaxed">
        This order cannot move forward until the open problem is resolved. Choose a route in the tab
        that owns it.
      </p>
    );
  }

  if (!next) {
    return (
      <p className="text-fg-tertiary text-[11.5px]">
        This order is at the end of the ladder — nothing further to advance.
      </p>
    );
  }

  const needsDualAuthorisation = next.id === 'ESCROW_FINAL_RELEASE_AUTHORISED';

  // Assessed here rather than after a refused round-trip, so pressing Advance
  // opens the form straight away instead of reporting a failure first.
  const evidence = assessEvidence(
    currentStage,
    (evidenceRecord?.values ?? {}) as Record<string, unknown>,
    (evidenceRecord?.documents ?? []).map((d) => d.docType),
  );
  const evidenceOutstanding =
    evidence.missingFields.length + evidence.missingDocs.length;

  /**
   * Everything gathered so far. The single input to the gate decision, so the
   * request can never carry one answer and forget the other.
   */
  const gateState: AdvanceGateState = {
    evidenceComplete: evidence.complete,
    needsDualAuthorisation,
    inspectionPassed,
    overrideReason: waiverReason,
    approverIds: selected,
  };

  const submit = (request: AdvanceRequest) => {
    startTransition(async () => {
      const res = await advanceStage(workOrderId, next.id, {
        ...request,
        // What this page believes, so the server can tell an illegal move apart
        // from a page that has simply fallen behind.
        expectedFromStage: currentStage,
      });
      if (res.ok) {
        toast.success(res.message, { description: res.detail, duration: 9000 });
        setApproverDialog(false);
        setEvidenceOpen(false);
        setSelected([]);
        setWaiverReason(null);
        router.refresh();
        return;
      }
      if (res.staleView) {
        // Not the operator's error. Clear the dialogs they were working in —
        // their answers were about a stage the order has already left — and pull
        // the real state so the next click is computed from something true.
        toast.info(res.message, { description: res.detail, duration: 11000 });
        setApproverDialog(false);
        setEvidenceOpen(false);
        setSelected([]);
        setWaiverReason(null);
        router.refresh();
        return;
      }
      // The gates are assessed before the call, so any other refusal means the
      // server knows something this page does not. Reopening the evidence form on
      // a refusal it did not cause is what made the old loop invisible, so the
      // message is always shown.
      toast.error(res.message, { description: res.detail, duration: 11000 });
      if (/Record the evidence/i.test(res.message)) setEvidenceOpen(true);
    });
  };

  /** Advance if everything is in hand, otherwise open the gate that is not. */
  const proceed = (overrides?: Partial<AdvanceGateState>) => {
    const step = nextAdvanceStep({ ...gateState, ...overrides });
    if (step.kind === 'SUBMIT') return submit(step.request);
    if (step.kind === 'COLLECT_EVIDENCE') {
      setEvidenceOpen(true);
      return;
    }
    // Handing off to the approver dialog: the evidence form has done its job and
    // its answer is already held above, so it closes rather than stacking.
    setEvidenceOpen(false);
    setApproverDialog(true);
  };

  return (
    <>
      <Button
        variant="primary"
        wrap
        className="w-full"
        icon={!evidence.complete ? ClipboardCheck : needsDualAuthorisation ? Lock : ArrowRight}
        disabled={pending}
        onClick={() => proceed()}
      >
        {pending ? 'Working…' : `Advance to ${next.label}`}
      </Button>
      <p className="text-fg-tertiary mt-1.5 text-[11px] leading-relaxed">
        {evidence.complete
          ? next.description
          : `First record what proves "${currentStageLabel}" was done — ${evidenceOutstanding} item${evidenceOutstanding === 1 ? '' : 's'} outstanding. This opens the form.`}
      </p>

      {/* The stage being LEFT is what has to be evidenced, so that is what opens,
          already knowing which stage the operator is trying to advance to. */}
      {evidenceOpen && (
        <StageEvidenceDialog
          workOrderId={workOrderId}
          stageId={currentStage}
          stageCode={currentStageCode}
          stageLabel={currentStageLabel}
          record={evidenceRecord}
          advanceTo={{ label: next.label }}
          onAdvance={(overrideReason) => {
            // Kept before proceeding, and passed straight through as an override
            // too — setState is async, so `gateState` inside proceed() would
            // otherwise still hold the previous (empty) reason on this tick.
            const reason = overrideReason?.trim() || null;
            setWaiverReason(reason);
            proceed({ overrideReason: reason });
          }}
          open
          onOpenChange={(o) => !o && setEvidenceOpen(false)}
        />
      )}

      {/* ── Dual authorisation for the final escrow release ─────────────────── */}
      <Dialog.Root open={approverDialog} onOpenChange={setApproverDialog}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px]" />
          <Dialog.Content className="bg-surface-1 border-line shadow-e4 fixed top-1/2 left-1/2 z-50 w-[min(92vw,560px)] -translate-x-1/2 -translate-y-1/2 rounded-[14px] border p-5">
            <Dialog.Title className="text-fg flex items-center gap-2 text-[15px] font-semibold">
              <Lock className="size-4 shrink-0" aria-hidden />
              Authorise the final release
            </Dialog.Title>
            <Dialog.Description className="text-fg-secondary mt-2 text-[12.5px] leading-relaxed">
              This releases the remaining escrow balance to the supplier. One person can never do it
              alone, so two different Finance approvers must sign.
            </Dialog.Description>

            {/* Gate 1: inspection */}
            <div
              className={cn(
                'mt-3 flex items-start gap-2 rounded-[9px] border px-3 py-2.5',
                inspectionPassed
                  ? 'border-success-border bg-success-subtle'
                  : 'border-danger-border bg-danger-subtle',
              )}
            >
              <ShieldCheck
                className={cn('mt-0.5 size-4 shrink-0', inspectionPassed ? 'text-success' : 'text-danger')}
                aria-hidden
              />
              <span className="min-w-0">
                <span
                  className={cn(
                    'block text-[12px] font-semibold',
                    inspectionPassed ? 'text-success' : 'text-danger',
                  )}
                >
                  {inspectionPassed
                    ? 'Inbound inspection has passed'
                    : 'Inbound inspection has not passed'}
                </span>
                <span className="text-fg-secondary mt-0.5 block text-[11.5px] leading-relaxed">
                  {inspectionPassed
                    ? 'The goods have been verified, so the balance may be released.'
                    : 'Releasing before verifying what arrived would remove the only leverage we have if the goods are wrong. This is refused deliberately.'}
                </span>
              </span>
            </div>

            {/* The evidence waiver, if the operator gave one on the way here.
                Releasing the final payment AND waiving the proof that the goods
                were checked is a combination worth seeing in one place, at the
                moment it is committed rather than afterwards in the audit log. */}
            {waiverReason && (
              <div className="border-warning-border bg-warning-subtle mt-3 flex items-start gap-2 rounded-[9px] border px-3 py-2.5">
                <AlertTriangle className="text-warning mt-0.5 size-4 shrink-0" aria-hidden />
                <span className="min-w-0">
                  <span className="text-warning block text-[12px] font-semibold">
                    Going ahead without the full inspection evidence
                  </span>
                  <span className="text-fg-secondary mt-0.5 block text-[11.5px] leading-relaxed">
                    Recorded against the order: “{waiverReason}”
                  </span>
                </span>
              </div>
            )}

            {/* Gate 2: two approvers */}
            <div className="mt-3">
              <SectionLabel>Choose two Finance approvers</SectionLabel>
              <ul className="grid gap-1.5">
                {financeApprovers.map((a) => {
                  const on = selected.includes(a.id);
                  return (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() =>
                          setSelected((prev) =>
                            prev.includes(a.id) ? prev.filter((x) => x !== a.id) : [...prev, a.id],
                          )
                        }
                        className={cn(
                          'flex w-full items-center gap-2.5 rounded-[9px] border px-3 py-2 text-left transition-colors',
                          on
                            ? 'border-accent bg-accent-subtle'
                            : 'border-line-subtle hover:bg-surface-3',
                        )}
                      >
                        <span
                          className={cn(
                            'grid size-4 shrink-0 place-items-center rounded-[4px] border',
                            on ? 'bg-accent border-accent text-accent-fg' : 'border-line-strong',
                          )}
                          aria-hidden
                        >
                          {on && <Check className="size-3" strokeWidth={3} />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="text-fg block text-[12.5px] font-medium">{a.name}</span>
                          <span className="text-fg-tertiary block text-[11px]">{a.role}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-2 flex items-center gap-2">
                <Chip tone={selected.length >= 2 ? 'success' : 'warning'} size="sm">
                  {selected.length} of 2 selected
                </Chip>
                {financeApprovers.length < 2 && (
                  <Chip tone="danger" size="sm">
                    Only {financeApprovers.length} Finance user exists
                  </Chip>
                )}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Dialog.Close asChild>
                <Button variant="secondary" icon={X}>
                  Cancel
                </Button>
              </Dialog.Close>
              <Button
                variant="primary"
                icon={Lock}
                disabled={pending || selected.length < 2 || !inspectionPassed}
                disabledReason={
                  !inspectionPassed
                    ? 'The inbound inspection must pass first.'
                    : selected.length < 2
                      ? 'Two different Finance approvers are required.'
                      : undefined
                }
                onClick={() => proceed()}
              >
                {pending ? 'Releasing…' : 'Authorise release'}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

export { getStage };
