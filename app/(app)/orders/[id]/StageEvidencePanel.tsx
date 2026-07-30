'use client';

/**
 * STAGE EVIDENCE — what the team recorded to show each stage was really done.
 *
 * The tab itself is a register: one row per stage on this order's path, showing
 * where the proof stands. Filling it in happens in a dialog with steps, because
 * a stage can ask for a dozen things and a wall of inputs is where people lose
 * their place.
 *
 * Every stage is openable, not just the current one. Corrections to earlier
 * stages are a normal part of the work — a figure typed under pressure gets
 * fixed later — and the honest way to allow that is to keep every version rather
 * than lock the record.
 */

import { useMemo, useState } from 'react';
import { ClipboardCheck, CircleAlert, PenLine } from 'lucide-react';
import { assessEvidence, evidenceFor } from '@/lib/domain/stage-evidence';
import { Panel, PanelHeader } from '@/components/ui/Layout';
import { Chip } from '@/components/ui/Badges';
import { cn, formatDate } from '@/lib/utils';
import { StageEvidenceDialog } from './StageEvidenceDialog';

export interface EvidenceRecord {
  stageId: string;
  status: string;
  values: Record<string, string | number | boolean | null>;
  completedAt: string | null;
  documents: { id: string; docType: string; fileName: string; sizeBytes: number; version: number }[];
  revisions: {
    id: string;
    revision: number;
    changeSummary: string;
    reason: string | null;
    actorLabel: string;
    createdAt: string;
  }[];
}

export interface StageOption {
  id: string;
  code: string;
  label: string;
  reached: boolean;
  isCurrent: boolean;
}

export function StageEvidencePanel({
  workOrderId,
  stages,
  records,
  initialStageId,
}: {
  workOrderId: string;
  stages: StageOption[];
  records: EvidenceRecord[];
  initialStageId: string;
}) {
  const [openStage, setOpenStage] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      stages
        .filter((s) => evidenceFor(s.id))
        .map((s) => {
          const record = records.find((r) => r.stageId === s.id);
          const def = evidenceFor(s.id)!;
          const assessment = assessEvidence(
            s.id,
            (record?.values ?? {}) as Record<string, unknown>,
            (record?.documents ?? []).map((d) => d.docType),
          );
          const answered = def.fields.filter((f) => {
            const v = record?.values?.[f.id];
            return f.type === 'boolean' ? v === true : v !== undefined && v !== null && v !== '';
          }).length;
          return { stage: s, record, def, assessment, answered };
        }),
    [stages, records],
  );

  const signedOff = rows.filter((r) => r.record?.status === 'SUBMITTED').length;
  const currentRow = rows.find((r) => r.stage.isCurrent);
  const active = openStage ? rows.find((r) => r.stage.id === openStage) : undefined;

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      {/* The stage the order is sitting on is what blocks it, so it leads. */}
      {currentRow && !currentRow.assessment.complete && (
        <div className="border-warning-border bg-warning-subtle flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-[10px] border px-3.5 py-3">
          <CircleAlert className="text-warning size-4 shrink-0" strokeWidth={2.2} aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="text-warning block text-[12.5px] font-semibold">
              {currentRow.stage.label} is not yet evidenced
            </span>
            <span className="text-fg-secondary mt-0.5 block text-[11.5px] leading-relaxed">
              {currentRow.assessment.missingFields.length} answer
              {currentRow.assessment.missingFields.length === 1 ? '' : 's'} and{' '}
              {currentRow.assessment.missingDocs.length} document
              {currentRow.assessment.missingDocs.length === 1 ? '' : 's'} outstanding. The order
              cannot move on until this is complete.
            </span>
          </span>
          <button
            type="button"
            onClick={() => setOpenStage(currentRow.stage.id)}
            className="bg-accent text-accent-fg hover:bg-accent-hover inline-flex shrink-0 items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-[12.5px] font-medium transition-colors"
          >
            <PenLine className="size-3.5" strokeWidth={2} aria-hidden />
            Record it now
          </button>
        </div>
      )}

      <Panel padded={false}>
        <div className="px-4 pt-4">
          <PanelHeader
            title="Stage evidence"
            description="What the team recorded to show each stage was genuinely done. An order cannot move on until the stage it is leaving is complete."
            actions={
              <Chip tone={signedOff === rows.length ? 'success' : 'neutral'}>
                {signedOff} of {rows.length} signed off
              </Chip>
            }
          />
        </div>

        <div className="min-w-0 overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-left">
            <thead>
              <tr className="border-line-subtle bg-surface-2 border-y">
                {[
                  ['Stage', 'The step being evidenced'],
                  ['Where the order is', 'Whether it has reached this stage yet'],
                  ['Proof', 'Signed off, part-recorded, or not started'],
                  ['Answers', 'How many of the questions are answered'],
                  ['Documents', 'Attached against what the stage expects'],
                  ['Signed off', 'When the evidence first became complete'],
                  ['Revisions', 'How many times it has been changed'],
                  ['', 'Record or correct the evidence'],
                ].map(([label, hint]) => (
                  <th
                    key={label || 'actions'}
                    scope="col"
                    title={hint}
                    className="text-fg-secondary px-3 py-2 text-[11px] font-semibold tracking-[0.03em] whitespace-nowrap uppercase"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-line-subtle divide-y">
              {rows.map(({ stage, record, def, assessment, answered }) => {
                const requiredFields = def.fields.filter((f) => f.required).length;
                const attachedCount = new Set((record?.documents ?? []).map((d) => d.docType)).size;
                return (
                  <tr
                    key={stage.id}
                    className={cn(
                      'hover:bg-surface-3/50 align-middle transition-colors',
                      stage.isCurrent && 'bg-accent-subtle/40',
                    )}
                  >
                    <td className="px-3 py-2.5">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="text-fg-tertiary font-mono text-[10.5px]">
                          {stage.code}
                        </span>
                        <span className="text-fg text-[12.5px] font-medium">{stage.label}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      {stage.isCurrent ? (
                        <Chip tone="accent" size="sm">
                          Currently here
                        </Chip>
                      ) : stage.reached ? (
                        <Chip tone="neutral" size="sm">
                          Passed
                        </Chip>
                      ) : (
                        <span className="text-fg-tertiary text-[11.5px]">Not reached yet</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <Chip
                        tone={
                          record?.status === 'SUBMITTED'
                            ? 'success'
                            : record
                              ? 'warning'
                              : 'neutral'
                        }
                        size="sm"
                      >
                        {record?.status === 'SUBMITTED'
                          ? 'Signed off'
                          : record
                            ? 'Part recorded'
                            : 'Not started'}
                      </Chip>
                    </td>
                    <td className="text-fg-secondary tnum px-3 py-2.5 text-[11.5px] whitespace-nowrap">
                      {answered} of {def.fields.length}
                      {requiredFields > 0 && (
                        <span className="text-fg-tertiary"> · {requiredFields} required</span>
                      )}
                    </td>
                    <td className="text-fg-secondary tnum px-3 py-2.5 text-[11.5px] whitespace-nowrap">
                      {def.documents.length === 0 ? (
                        <span className="text-fg-tertiary">None expected</span>
                      ) : (
                        <>
                          {attachedCount} of {def.documents.length}
                          {assessment.missingDocs.length > 0 && (
                            <span className="text-warning">
                              {' '}
                              · {assessment.missingDocs.length} required missing
                            </span>
                          )}
                        </>
                      )}
                    </td>
                    <td className="text-fg-secondary px-3 py-2.5 text-[11.5px] whitespace-nowrap">
                      {record?.completedAt ? formatDate(record.completedAt) : '—'}
                    </td>
                    <td className="text-fg-secondary tnum px-3 py-2.5 text-[11.5px]">
                      {record?.revisions.length ?? 0}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => setOpenStage(stage.id)}
                        className="border-line-subtle text-fg-secondary hover:bg-surface-3 hover:text-fg inline-flex shrink-0 items-center gap-1.5 rounded-[7px] border px-2 py-1 text-[11.5px] whitespace-nowrap transition-colors"
                      >
                        {record?.status === 'SUBMITTED' ? (
                          <>
                            <ClipboardCheck className="size-3.5" strokeWidth={2} aria-hidden />
                            Review
                          </>
                        ) : (
                          <>
                            <PenLine className="size-3.5" strokeWidth={2} aria-hidden />
                            Record
                          </>
                        )}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Keyed on the stage so switching rows rebuilds the form from that stage's
          own saved values rather than carrying the previous one's answers over. */}
      {active && (
        <StageEvidenceDialog
          key={active.stage.id}
          workOrderId={workOrderId}
          stageId={active.stage.id}
          stageCode={active.stage.code}
          stageLabel={active.stage.label}
          record={active.record}
          open
          onOpenChange={(o) => !o && setOpenStage(null)}
        />
      )}

      <p className="text-fg-tertiary text-[11.5px] leading-relaxed">
        Recording evidence for a stage the order has not reached yet is allowed — it will simply be
        there when the stage arrives. Correcting a stage already signed off is allowed too; it asks
        you why, and keeps the previous version.
      </p>
    </div>
  );
}

/** Kept for callers that referenced the initial stage; the table opens any stage. */
export type { StageOption as EvidenceStageOption };
