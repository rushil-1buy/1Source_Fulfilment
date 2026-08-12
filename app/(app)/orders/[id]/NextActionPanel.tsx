'use client';

/**
 * NEXT ACTION — the stage's checklist, and the place to actually do it.
 *
 * Three things it has to be at once, which is why it earns its own file rather
 * than living in the presentational flow library:
 *
 *  1. A CHECKLIST. Every sub-task of the stage as a table, documents first, with
 *     ticks derived from what is really on file. Fixed height with its own
 *     scroll, so a nine-task stage does not make the card nine rows tall and
 *     leave the card beside it ending somewhere else.
 *
 *  2. SOMEWHERE TO WORK. A document row takes a file straight from here — the
 *     upload is the commonest thing anybody does on an order, and sending them to
 *     another tab to do it is three clicks for one action. Other rows open the
 *     evidence form at the right stage.
 *
 *  3. A LOOK AHEAD. Clicking any stage on the rail shows that stage's checklist
 *     here, so "what is coming at customs" is answerable without leaving the page.
 *
 * THE RULE THAT MAKES (3) SAFE
 *
 * A stage the order has NOT REACHED is read-only. You can see every sub-task and
 * every document it will want — that is the whole point of looking ahead — but
 * nothing can be uploaded or recorded against it. Evidence filed against a stage
 * the order never entered is a claim about work that has not happened, and it
 * would sail through the gate later without anyone noticing.
 *
 * A stage already PASSED stays writable. Correcting an earlier stage is ordinary
 * — a report arrives late, a number was mistyped — and the evidence panel has
 * always allowed it, so blocking it here would only be inconsistent.
 */

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  Circle,
  ClipboardList,
  Eye,
  FileUp,
  ListChecks,
  Loader2,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { uploadStageDocument } from '@/lib/actions/upload';
import {
  assessSla,
  getStage,
  nextStageFor,
  resolveRailAnchor,
  type StageContext,
} from '@/lib/domain/stages';
import { subTaskProgress, subTaskStates, type SubTaskKind } from '@/lib/domain/stage-tasks';
import { STAKEHOLDER_META } from '@/lib/domain/enums';
import { StakeholderBadge } from '@/components/ui/Badges';
import { cn, humanDuration } from '@/lib/utils';

/** One icon per sub-task kind, so the row type reads without colour. */
const KIND_ICON: Record<SubTaskKind, typeof FileUp> = {
  DOCUMENT: FileUp,
  ACTION: ListChecks,
  CAPTURE: ClipboardList,
};

/** Where the stage being VIEWED sits relative to where the order actually is. */
export type StageRelation = 'CURRENT' | 'AHEAD' | 'PASSED';

export interface StageEvidenceSnapshot {
  stageId: string;
  values: Record<string, unknown>;
  documents: { docType: string }[];
}

export function NextActionPanel({
  workOrderId,
  currentStage,
  viewStageId,
  relation,
  ctx,
  isBlocked,
  blockReason,
  stageEnteredAt,
  evidence,
  onAdvance,
  onOpenEvidence,
  onBackToCurrent,
  className,
}: {
  workOrderId: string;
  /** Where the order actually is. */
  currentStage: string;
  /** Which stage the panel is showing — the current one unless the rail says otherwise. */
  viewStageId: string;
  relation: StageRelation;
  ctx: StageContext;
  isBlocked: boolean;
  blockReason?: string | null;
  stageEnteredAt: string;
  /** Every stage's saved evidence, so a looked-ahead stage shows its real state too. */
  evidence: StageEvidenceSnapshot[];
  onAdvance?: () => void;
  onOpenEvidence: (stageId: string) => void;
  onBackToCurrent: () => void;
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  /** The document slot a file is being chosen for. */
  const [uploadingDocId, setUploadingDocId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const pendingDocId = useRef<string | null>(null);

  const { anchorStageId, branch } = resolveRailAnchor(currentStage);
  const sla = assessSla(anchorStageId, new Date(stageEnteredAt));
  const blocked = isBlocked || branch !== null;
  const next = blocked ? null : nextStageFor(currentStage, ctx);

  const viewing = getStage(viewStageId);
  const isPreview = relation !== 'CURRENT';
  /** Only a stage the order has not reached is locked. See the header. */
  const readOnly = relation === 'AHEAD';

  const ev = evidence.find((e) => e.stageId === viewStageId);
  const tasks = subTaskStates(
    viewStageId,
    ev?.values ?? {},
    (ev?.documents ?? []).map((d) => d.docType),
    ctx,
  );
  const progress = subTaskProgress(tasks);

  const tone = readOnly
    ? 'border-line bg-surface-2'
    : blocked
      ? 'border-danger-border bg-danger-subtle'
      : sla.status !== 'ON_TRACK'
        ? 'border-warning-border bg-warning-subtle'
        : 'border-accent-border bg-accent-subtle';

  /** Opens the OS file picker for one document slot. */
  const pickFile = (docId: string) => {
    if (readOnly) return;
    pendingDocId.current = docId;
    fileInput.current?.click();
  };

  const onFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const docId = pendingDocId.current;
    // Reset immediately so choosing the same file twice still fires a change.
    e.target.value = '';
    pendingDocId.current = null;
    if (!file || !docId) return;

    setUploadingDocId(docId);
    startTransition(async () => {
      // FormData so the browser streams the bytes rather than base64 through props.
      const fd = new FormData();
      fd.set('workOrderId', workOrderId);
      fd.set('stageId', viewStageId);
      fd.set('docId', docId);
      fd.set('file', file);
      const res = await uploadStageDocument(fd);
      setUploadingDocId(null);
      if (res.ok) {
        toast.success(res.message, { description: res.detail });
        router.refresh();
      } else {
        toast.error(res.message, { description: res.detail });
      }
    });
  };

  const rowActionable = (kind: SubTaskKind) => !readOnly && (kind === 'DOCUMENT' || true);

  return (
    <div
      className={cn(
        '@container flex h-full min-w-0 flex-col rounded-[12px] border p-3.5 transition-colors sm:p-4',
        tone,
        className,
      )}
    >
      {/* One hidden input serves every document row; the slot is held in a ref. */}
      <input
        ref={fileInput}
        type="file"
        className="hidden"
        onChange={onFileChosen}
        accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.xlsx,.docx"
      />

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-fg-tertiary text-[10px] font-semibold tracking-[0.08em] uppercase">
          {isPreview
            ? relation === 'AHEAD'
              ? 'Coming up'
              : 'Already passed'
            : blocked
              ? 'Blocked — needs a decision'
              : 'Next action'}
        </span>
        <span className="text-fg-tertiary tnum ml-auto text-[10.5px]">
          {viewing.code} · {progress.done}/{progress.total} done
        </span>
      </div>

      {branch && !isPreview && (
        <div className="text-danger mt-1 text-[11px] font-semibold">{branch.label}</div>
      )}

      <p className="text-fg mt-1.5 text-[13px] leading-snug font-medium">
        {isPreview
          ? viewing.label
          : blocked && blockReason
            ? blockReason
            : getStage(anchorStageId).nextAction}
      </p>

      {/* ── Looking at a stage the order is not on ─────────────────────────── */}
      {isPreview && (
        <div
          className={cn(
            'mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[8px] border px-2.5 py-1.5',
            readOnly ? 'border-line-subtle bg-surface-1/60' : 'border-line-subtle bg-surface-1/60',
          )}
        >
          <Eye className="text-fg-tertiary size-3.5 shrink-0" strokeWidth={2} aria-hidden />
          <span className="text-fg-secondary min-w-0 text-[11px] leading-snug">
            {readOnly ? (
              <>
                The order has not reached this step. You can see what it needs — nothing can be
                recorded against it yet.
              </>
            ) : (
              <>This step has already been passed. Anything filed here is a correction.</>
            )}
          </span>
          <button
            type="button"
            onClick={onBackToCurrent}
            className="border-line-subtle text-fg-secondary hover:bg-surface-3 ml-auto flex shrink-0 items-center gap-1 rounded-[6px] border px-1.5 py-0.5 text-[10.5px]"
          >
            <ChevronLeft className="size-3" strokeWidth={2.5} aria-hidden />
            Back to {getStage(anchorStageId).code}
          </button>
        </div>
      )}

      {/* ── The checklist ─────────────────────────────────────────────────── */}
      {tasks.length > 0 && (
        <div className="border-line-subtle bg-surface-1/70 mt-3 min-h-0 overflow-hidden rounded-[9px] border">
          <div className="max-h-[132px] overflow-y-auto overscroll-contain sm:max-h-[152px]">
            <table className="w-full border-collapse text-left">
              <thead className="bg-surface-2/80 sticky top-0 z-10 backdrop-blur-sm">
                <tr className="border-line-subtle border-b">
                  <th scope="col" className="text-fg-tertiary w-7 px-2 py-1.5 text-[9.5px] font-semibold tracking-[0.05em] uppercase">
                    <span className="sr-only">Done</span>
                  </th>
                  <th scope="col" className="text-fg-tertiary px-1 py-1.5 text-[9.5px] font-semibold tracking-[0.05em] uppercase">
                    Sub-task
                  </th>
                  <th scope="col" className="text-fg-tertiary hidden px-2 py-1.5 text-right text-[9.5px] font-semibold tracking-[0.05em] uppercase @[26rem]:table-cell">
                    Owner
                  </th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => {
                  const Icon = KIND_ICON[t.kind];
                  const isDoc = t.kind === 'DOCUMENT';
                  const busy = isDoc && uploadingDocId === t.id.slice(4);
                  const clickable = rowActionable(t.kind);
                  return (
                    <tr
                      key={t.id}
                      className={cn(
                        'border-line-subtle/70 border-b last:border-0',
                        clickable && 'hover:bg-surface-2/60 cursor-pointer',
                      )}
                      onClick={
                        clickable
                          ? () => (isDoc ? pickFile(t.id.slice(4)) : onOpenEvidence(viewStageId))
                          : undefined
                      }
                    >
                      <td className="px-2 py-1.5 align-top">
                        {busy ? (
                          <Loader2 className="text-accent size-3.5 animate-spin" aria-label="Uploading" />
                        ) : t.done ? (
                          <CheckCircle2 className="text-success size-3.5" strokeWidth={2.4} aria-label="Done" />
                        ) : (
                          <Circle
                            className={cn('size-3.5', t.required ? 'text-warning' : 'text-fg-tertiary')}
                            strokeWidth={2}
                            aria-label={t.required ? 'Required, outstanding' : 'Outstanding'}
                          />
                        )}
                      </td>
                      <td className="min-w-0 px-1 py-1.5 align-top">
                        <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
                          <Icon className="text-fg-tertiary mt-[3px] size-3 shrink-0" strokeWidth={2} aria-hidden />
                          <span
                            className={cn(
                              'min-w-0 text-[11.5px] leading-snug',
                              t.done ? 'text-fg-tertiary line-through decoration-[1.5px]' : 'text-fg',
                            )}
                          >
                            {t.label}
                          </span>
                          {t.required && !t.done && (
                            <span className="text-warning text-[9px] font-semibold tracking-wide uppercase">
                              Required
                            </span>
                          )}
                          {t.standard && (
                            <span className="border-line-subtle text-fg-secondary tnum rounded border px-1 py-px text-[9px]">
                              {t.standard}
                            </span>
                          )}
                          {/* The affordance only appears where the action is real —
                              on a locked stage there is nothing to invite. */}
                          {isDoc && !t.done && !readOnly && (
                            <span className="text-accent-text inline-flex items-center gap-0.5 text-[9.5px] font-medium">
                              <Upload className="size-2.5" strokeWidth={2.5} aria-hidden />
                              {busy ? 'Uploading…' : 'Upload'}
                            </span>
                          )}
                        </span>
                        {t.outstanding && t.outstanding.length > 0 && (
                          <span className="text-fg-tertiary mt-0.5 block text-[10px] leading-snug">
                            Still needed: {t.outstanding.join(', ')}
                          </span>
                        )}
                      </td>
                      <td className="text-fg-tertiary hidden px-2 py-1.5 text-right align-top text-[10px] whitespace-nowrap @[26rem]:table-cell">
                        {STAKEHOLDER_META[t.owner]?.short ?? t.owner}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {readOnly ? (
            <div className="border-line-subtle text-fg-tertiary border-t px-2.5 py-1.5 text-[11px]">
              Read-only until the order reaches {viewing.code}.
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onOpenEvidence(viewStageId)}
              disabled={pending}
              className="border-line-subtle text-fg-secondary hover:bg-surface-3 hover:text-fg w-full border-t px-2.5 py-1.5 text-left text-[11px] transition-colors disabled:opacity-60"
            >
              {progress.requiredOutstanding > 0
                ? `Open the form — ${progress.requiredOutstanding} required item${progress.requiredOutstanding === 1 ? '' : 's'} outstanding`
                : 'Open the form to record or attach anything else'}
            </button>
          )}
        </div>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-2.5">
        <StakeholderBadge stakeholder={isPreview ? viewing.owner : getStage(anchorStageId).nextActionOwner} />
        <span className="text-fg-tertiary text-[11.5px]">
          {isPreview
            ? `Usually takes ${humanDuration(viewing.expectedHours)}`
            : sla.status === 'ON_TRACK'
              ? `Here ${humanDuration(sla.hoursInStage)}, expected ${humanDuration(sla.expectedHours)}`
              : `${humanDuration(sla.overdueHours)} over the expected ${humanDuration(sla.expectedHours)}`}
        </span>
      </div>

      {/* Advancing is about where the order IS, so it never shows on a preview. */}
      {next && onAdvance && !isPreview && (
        <button
          type="button"
          onClick={onAdvance}
          className="bg-accent text-accent-fg hover:bg-accent-hover mt-3 inline-flex items-center justify-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-[12.5px] font-medium transition-colors"
        >
          Advance to {next.label}
          <ArrowRight className="size-3.5" strokeWidth={2.2} aria-hidden />
        </button>
      )}
    </div>
  );
}
