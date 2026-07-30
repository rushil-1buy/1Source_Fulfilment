'use client';

/**
 * Recording a stage's evidence, a few questions at a time.
 *
 * A stage can ask for a dozen things. Laid out in one column that is a wall of
 * inputs, and the person filling it in loses their place. So it is a dialog with
 * steps: DOCUMENTS FIRST, then four questions to a step, then a review that
 * names anything still outstanding before it is signed off.
 *
 * Documents lead for the same reason they lead the checklist on the order page:
 * the paperwork is what comes from somebody else, so it is the item most likely
 * to be missing and the only one with a lead time. Asking for it after a dozen
 * fields means discovering the signed report has not arrived at the point the
 * form is otherwise finished — which is the worst moment to find out.
 *
 * Navigation never blocks on validation. People fill forms out of order — they
 * go and find a number and come back — so a step with something missing is
 * marked, not locked, and everything saves as a draft until it is genuinely
 * complete.
 */

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import {
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Eye,
  FileUp,
  History,
  Paperclip,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { saveStageEvidence } from '@/lib/actions/evidence';
import { deleteDocument, uploadStageDocument } from '@/lib/actions/upload';
import {
  assessEvidence,
  evidenceFor,
  type EvidenceDoc,
  type EvidenceField,
} from '@/lib/domain/stage-evidence';
import { Button } from '@/components/ui/Layout';
import { Chip } from '@/components/ui/Badges';
import { cn, formatDateTime } from '@/lib/utils';
import type { EvidenceRecord } from './StageEvidencePanel';

/** Questions per step. Four fits without scrolling at a typical dialog height. */
const PER_STEP = 4;

const input =
  'bg-surface-1 border-line-subtle focus:border-accent text-fg placeholder:text-fg-tertiary w-full rounded-[8px] border px-2.5 py-1.5 text-[13px] outline-none';

type Step =
  | { kind: 'fields'; title: string; fields: EvidenceField[] }
  | { kind: 'documents'; title: string; documents: EvidenceDoc[] }
  | { kind: 'review'; title: string };

export function StageEvidenceDialog({
  workOrderId,
  stageId,
  stageCode,
  stageLabel,
  record,
  advanceTo,
  onAdvance,
  open,
  onOpenChange,
}: {
  workOrderId: string;
  stageId: string;
  stageCode: string;
  stageLabel: string;
  record?: EvidenceRecord;
  /**
   * Set when opened from the Advance button: the operator's actual goal is to
   * move the order on, so the last step finishes the job rather than making them
   * close this and press Advance again.
   */
  advanceTo?: { label: string };
  onAdvance?: (evidenceOverrideReason?: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const def = evidenceFor(stageId);
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState(0);
  const [reason, setReason] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  /** Reason for moving on without complete evidence. */
  const [overrideReason, setOverrideReason] = useState('');

  const [draft, setDraft] = useState<Record<string, string | boolean>>(() => {
    const seed: Record<string, string | boolean> = {};
    for (const f of def?.fields ?? []) {
      const v = record?.values?.[f.id];
      seed[f.id] = f.type === 'boolean' ? v === true : v == null ? '' : String(v);
    }
    return seed;
  });

  const steps: Step[] = useMemo(() => {
    if (!def) return [];
    const out: Step[] = [];
    // Documents first — see the note at the top of the file.
    if (def.documents.length > 0) {
      out.push({ kind: 'documents', title: 'Documents', documents: def.documents });
    }
    const chunks = Math.ceil(def.fields.length / PER_STEP) || 1;
    for (let i = 0; i < chunks; i++) {
      const fields = def.fields.slice(i * PER_STEP, (i + 1) * PER_STEP);
      if (fields.length === 0) continue;
      out.push({
        kind: 'fields',
        title: chunks === 1 ? 'What to record' : `What to record — part ${i + 1} of ${chunks}`,
        fields,
      });
    }
    out.push({ kind: 'review', title: 'Review and sign off' });
    return out;
  }, [def]);

  const attachedDocIds = useMemo(() => (record?.documents ?? []).map((d) => d.docType), [record]);
  const assessment = useMemo(
    () => assessEvidence(stageId, draft, attachedDocIds),
    [stageId, draft, attachedDocIds],
  );
  const wasSignedOff = record?.status === 'SUBMITTED';

  /** Which steps still have something required outstanding, for the indicator. */
  const stepIncomplete = useMemo(
    () =>
      steps.map((s) => {
        if (s.kind === 'fields') return s.fields.some((f) => assessment.missingFields.some((m) => m.id === f.id));
        if (s.kind === 'documents') return assessment.missingDocs.length > 0;
        return !assessment.complete;
      }),
    [steps, assessment],
  );

  if (!def) return null;

  const set = (id: string, v: string | boolean) => setDraft((p) => ({ ...p, [id]: v }));
  const last = steps.length - 1;
  const current = steps[Math.min(step, last)];

  const save = (closeAfter: boolean, thenAdvance = false) => {
    startTransition(async () => {
      const res = await saveStageEvidence(workOrderId, stageId, draft, {
        reason: reason.trim() || undefined,
      });
      if (res.ok) {
        toast[res.complete ? 'success' : 'message'](res.message, {
          description: res.detail,
          duration: 9000,
        });
        setReason('');
        router.refresh();
        // Saving is what makes the evidence complete on the server, so the
        // advance has to follow it, not race it.
        if (thenAdvance && res.complete && onAdvance) onAdvance();
        else if (closeAfter) onOpenChange(false);
      } else {
        toast.error(res.message, { description: res.detail, duration: 11000 });
      }
    });
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px]" />
        <Dialog.Content className="bg-surface-1 border-line shadow-e4 fixed top-1/2 left-1/2 z-50 flex max-h-[92vh] w-[min(95vw,720px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[14px] border">
          {/* ── Header ─────────────────────────────────────────────────────── */}
          <div className="border-line-subtle border-b px-5 py-3.5">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Dialog.Title className="text-fg min-w-0 text-[15px] font-semibold">
                <span className="text-fg-tertiary font-mono text-[12px]">{stageCode}</span>{' '}
                {stageLabel}
              </Dialog.Title>
              <Chip tone={wasSignedOff ? 'success' : record ? 'warning' : 'neutral'} size="sm">
                {wasSignedOff ? 'Signed off' : record ? 'Draft' : 'Not started'}
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
              {def.attestation}
            </Dialog.Description>

            {/* Step indicator — a marked step is one with something outstanding. */}
            <div className="mt-3 flex min-w-0 flex-wrap items-center gap-1.5">
              {steps.map((s, i) => (
                <button
                  key={s.title}
                  type="button"
                  onClick={() => setStep(i)}
                  title={s.title}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full border px-2 py-[3px] text-[11px] transition-colors',
                    i === step
                      ? 'border-accent bg-accent-subtle text-accent-text font-medium'
                      : stepIncomplete[i]
                        ? 'border-warning-border text-warning hover:bg-warning-subtle'
                        : 'border-success-border text-success hover:bg-success-subtle',
                  )}
                >
                  {stepIncomplete[i] ? (
                    <CircleAlert className="size-3 shrink-0" strokeWidth={2.4} aria-hidden />
                  ) : (
                    <Check className="size-3 shrink-0" strokeWidth={3} aria-hidden />
                  )}
                  {i + 1}
                </button>
              ))}
              <span className="text-fg-tertiary ml-1 text-[11.5px]">
                Step {Math.min(step, last) + 1} of {steps.length} · {current.title}
              </span>
            </div>
          </div>

          {/* ── Body ───────────────────────────────────────────────────────── */}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {current.kind === 'fields' && (
              <div className="grid gap-3.5 sm:grid-cols-2">
                {current.fields.map((f) => (
                  <FieldControl
                    key={f.id}
                    field={f}
                    value={draft[f.id]}
                    missing={assessment.missingFields.some((m) => m.id === f.id)}
                    onChange={(v) => set(f.id, v)}
                  />
                ))}
              </div>
            )}

            {current.kind === 'documents' && (
              <ul className="grid gap-2.5">
                {current.documents.map((slot) => (
                  <DocumentSlot
                    key={slot.id}
                    workOrderId={workOrderId}
                    stageId={stageId}
                    slot={slot}
                    attached={(record?.documents ?? [])
                      .filter((d) => d.docType === slot.id)
                      .sort((a, b) => b.version - a.version)[0]}
                  />
                ))}
              </ul>
            )}

            {current.kind === 'review' && (
              <div className="grid gap-3">
                {assessment.complete ? (
                  <div className="border-success-border bg-success-subtle flex items-start gap-2 rounded-[9px] border px-3 py-2.5">
                    <Check className="text-success mt-0.5 size-4 shrink-0" strokeWidth={3} aria-hidden />
                    <span className="min-w-0">
                      <span className="text-success block text-[12.5px] font-semibold">
                        Everything required is recorded
                      </span>
                      <span className="text-fg-secondary mt-0.5 block text-[11.5px] leading-relaxed">
                        Saving now signs this stage off, and the order can move on from here.
                      </span>
                    </span>
                  </div>
                ) : (
                  <div className="border-warning-border bg-warning-subtle rounded-[9px] border px-3 py-2.5">
                    <span className="text-warning flex items-center gap-1.5 text-[12.5px] font-semibold">
                      <CircleAlert className="size-4 shrink-0" strokeWidth={2.2} aria-hidden />
                      Still outstanding
                    </span>
                    <ul className="mt-1.5 grid gap-1">
                      {assessment.missingFields.map((f) => (
                        <li key={f.id} className="text-fg-secondary text-[11.5px] leading-relaxed">
                          · {f.label}
                        </li>
                      ))}
                      {assessment.missingDocs.map((d) => (
                        <li key={d.id} className="text-fg-secondary text-[11.5px] leading-relaxed">
                          · {d.label} (document)
                        </li>
                      ))}
                    </ul>
                    <p className="text-fg-tertiary mt-2 text-[11px] leading-relaxed">
                      It will save as a draft. Nothing is lost — come back when you have the rest.
                    </p>
                  </div>
                )}

                {/* Opened from Advance, still short: the way past the gate lives
                    here rather than somewhere else, but it costs a reason. */}
                {advanceTo && !assessment.complete && (
                  <div className="border-line-subtle rounded-[9px] border px-3 py-2.5">
                    <span className="text-fg text-[12.5px] font-medium">
                      Need to move on before this is complete?
                    </span>
                    <label className="mt-2 block">
                      <span className="text-fg-secondary mb-1 block text-[11.5px] font-medium">
                        Reason for proceeding without it
                      </span>
                      <input
                        value={overrideReason}
                        onChange={(e) => setOverrideReason(e.target.value)}
                        placeholder="Why this order must move on before the evidence is filed"
                        className={input}
                      />
                      <span className="text-fg-tertiary mt-1 block text-[11px] leading-relaxed">
                        Recorded against the order and on the audit log, naming exactly what was
                        missing. For a real reason — not to skip the step.
                      </span>
                    </label>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="mt-2"
                      disabled={pending || overrideReason.trim().length < 8}
                      disabledReason={
                        overrideReason.trim().length < 8
                          ? 'Write a reason first — a few words at minimum.'
                          : undefined
                      }
                      onClick={() => onAdvance?.(overrideReason.trim())}
                    >
                      Proceed to {advanceTo.label} and record why
                    </Button>
                  </div>
                )}

                {wasSignedOff && (
                  <label className="block min-w-0">
                    <span className="text-fg-secondary mb-1 block text-[11.5px] font-medium">
                      Reason for the correction
                    </span>
                    <input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="What was wrong, and how you know the new value is right"
                      className={input}
                    />
                    <span className="text-fg-tertiary mt-1 block text-[11.5px] leading-relaxed">
                      This stage is already signed off and someone downstream has relied on it, so a
                      change needs a reason. It is kept with the revision.
                    </span>
                  </label>
                )}

                {record && record.revisions.length > 0 && (
                  <div className="border-line-subtle rounded-[9px] border">
                    <button
                      type="button"
                      onClick={() => setShowHistory((v) => !v)}
                      className="hover:bg-surface-3 flex w-full items-center gap-2 px-3 py-2 text-left transition-colors"
                    >
                      <History className="text-fg-tertiary size-3.5 shrink-0" strokeWidth={2} aria-hidden />
                      <span className="text-fg text-[12.5px] font-medium">
                        History — {record.revisions.length} revision
                        {record.revisions.length === 1 ? '' : 's'}
                      </span>
                      <span className="text-fg-tertiary ml-auto text-[11px]">
                        {showHistory ? 'Hide' : 'Show'}
                      </span>
                    </button>
                    {showHistory && (
                      <ul className="divide-line-subtle border-line-subtle divide-y border-t">
                        {[...record.revisions]
                          .sort((a, b) => b.revision - a.revision)
                          .map((r) => (
                            <li key={r.id} className="px-3 py-2">
                              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                                <Chip size="sm" tone="neutral">
                                  Revision {r.revision}
                                </Chip>
                                <span className="text-fg-secondary text-[11.5px]">
                                  {r.actorLabel}
                                </span>
                                <span className="text-fg-tertiary text-[11px]">
                                  {formatDateTime(r.createdAt)}
                                </span>
                              </div>
                              <p className="text-fg mt-1 text-[11.5px] leading-relaxed">
                                {r.changeSummary}
                              </p>
                              {r.reason && (
                                <p className="text-warning bg-warning-subtle mt-1 rounded-[5px] px-2 py-1 text-[11px] leading-relaxed">
                                  <strong className="font-semibold">Reason:</strong> {r.reason}
                                </p>
                              )}
                            </li>
                          ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Navigation ─────────────────────────────────────────────────── */}
          <div className="border-line-subtle flex min-w-0 flex-wrap items-center gap-2 border-t px-5 py-3">
            <Button
              variant="secondary"
              size="sm"
              icon={ChevronLeft}
              disabled={step === 0}
              onClick={() => setStep((s) => Math.max(0, s - 1))}
            >
              Back
            </Button>
            {step < last ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setStep((s) => Math.min(last, s + 1))}
              >
                Next
                <ChevronRight className="size-3.5" strokeWidth={2} aria-hidden />
              </Button>
            ) : (
              <span className="text-fg-tertiary text-[11.5px]">Last step</span>
            )}

            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                icon={Save}
                disabled={pending}
                onClick={() => save(false)}
              >
                Save and stay
              </Button>
              <Button
                variant="primary"
                size="sm"
                icon={advanceTo && assessment.complete ? ArrowRight : Save}
                disabled={pending}
                onClick={() => save(true, Boolean(advanceTo))}
              >
                {pending
                  ? 'Saving…'
                  : advanceTo && assessment.complete
                    ? `Sign off and advance to ${advanceTo.label}`
                    : wasSignedOff
                      ? 'Record correction'
                      : assessment.complete
                        ? 'Sign off and close'
                        : 'Save draft and close'}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function FieldControl({
  field: f,
  value,
  missing,
  onChange,
}: {
  field: EvidenceField;
  value: string | boolean | undefined;
  missing: boolean;
  onChange: (v: string | boolean) => void;
}) {
  const span = f.half && f.type !== 'longtext' ? 'sm:col-span-1' : 'sm:col-span-2';

  if (f.type === 'boolean') {
    return (
      <div className={cn('min-w-0', span)}>
        <label
          className={cn(
            'flex cursor-pointer items-start gap-2.5 rounded-[8px] border px-3 py-2.5 transition-colors',
            value === true
              ? 'border-success-border bg-success-subtle'
              : missing
                ? 'border-warning-border bg-warning-subtle'
                : 'border-line-subtle',
          )}
        >
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
            className="accent-accent mt-0.5 size-3.5 shrink-0"
          />
          <span className="min-w-0">
            <span className="text-fg block text-[12.5px] font-medium">
              {f.label}
              {f.required && <span className="text-danger ml-0.5">*</span>}
            </span>
            <span className="text-fg-secondary block text-[11.5px] leading-relaxed">{f.help}</span>
          </span>
        </label>
      </div>
    );
  }

  return (
    <label className={cn('block min-w-0', span)}>
      <span className="text-fg-secondary mb-1 block text-[11.5px] font-medium">
        {f.label}
        {f.required && <span className="text-danger ml-0.5">*</span>}
        {f.unit && <span className="text-fg-tertiary font-normal"> ({f.unit})</span>}
      </span>
      {f.type === 'select' ? (
        <select
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className={cn(input, missing && 'border-warning')}
        >
          <option value="">Not set</option>
          {f.options?.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : f.type === 'longtext' ? (
        <textarea
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          placeholder={f.placeholder}
          className={cn(input, 'resize-y leading-relaxed', missing && 'border-warning')}
        />
      ) : (
        <input
          type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          placeholder={f.placeholder}
          step={f.type === 'number' ? 'any' : undefined}
          className={cn(input, missing && 'border-warning')}
        />
      )}
      <span className="text-fg-tertiary mt-1 block text-[11.5px] leading-relaxed">{f.help}</span>
    </label>
  );
}

function DocumentSlot({
  workOrderId,
  stageId,
  slot,
  attached,
}: {
  workOrderId: string;
  stageId: string;
  slot: EvidenceDoc;
  attached?: { id: string; fileName: string; sizeBytes: number; version: number };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // FormData, so the browser streams the bytes to the server action rather than
  // encoding a whole PDF into a JSON payload.
  const pick = (file: File) => {
    startTransition(async () => {
      const fd = new FormData();
      fd.set('workOrderId', workOrderId);
      fd.set('stageId', stageId);
      fd.set('docId', slot.id);
      fd.set('file', file);
      const res = await uploadStageDocument(fd);
      if (res.ok) toast.success(res.message, { description: res.detail, duration: 8000 });
      else toast.error(res.message, { description: res.detail, duration: 10000 });
      router.refresh();
    });
  };

  const remove = () => {
    if (!attached) return;
    startTransition(async () => {
      const res = await deleteDocument(attached.id);
      if (res.ok) toast.success(res.message, { description: res.detail });
      else toast.error(res.message);
      router.refresh();
    });
  };

  return (
    <li
      className={cn(
        'flex min-w-0 flex-wrap items-start gap-x-3 gap-y-2 rounded-[9px] border px-3 py-2.5',
        attached
          ? 'border-success-border bg-success-subtle'
          : slot.required
            ? 'border-warning-border bg-warning-subtle'
            : 'border-line-subtle',
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-fg text-[12.5px] font-medium">{slot.label}</span>
          <Chip size="sm" tone={slot.required ? 'danger' : 'neutral'}>
            {slot.required ? 'Required' : 'If available'}
          </Chip>
        </span>
        <span className="text-fg-secondary mt-0.5 block text-[11.5px] leading-relaxed">
          {slot.help}
        </span>
        {attached && (
          <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <Paperclip className="text-fg-tertiary size-3.5 shrink-0" aria-hidden />
            <span className="text-fg font-mono text-[11px]">{attached.fileName}</span>
            <span className="text-fg-tertiary text-[10.5px]">
              {(attached.sizeBytes / 1024).toFixed(0)} KB · revision {attached.version}
            </span>
            <a
              href={`/api/documents/${attached.id}`}
              target="_blank"
              rel="noopener"
              className="text-accent-text hover:text-accent inline-flex items-center gap-1 text-[11px] font-medium hover:underline"
            >
              <Eye className="size-3.5" strokeWidth={2} aria-hidden />
              View
            </a>
            <a
              href={`/api/documents/${attached.id}?download=1`}
              className="text-fg-tertiary hover:text-fg text-[11px] hover:underline"
            >
              Download
            </a>
          </span>
        )}
      </span>

      <span className="flex shrink-0 items-center gap-1.5">
        <label
          className={cn(
            'border-line-subtle bg-surface-1 text-fg-secondary hover:bg-surface-3 hover:text-fg inline-flex cursor-pointer items-center gap-1.5 rounded-[7px] border px-2 py-1 text-[11.5px] transition-colors',
            pending && 'pointer-events-none opacity-60',
          )}
        >
          <FileUp className="size-3.5" strokeWidth={2} aria-hidden />
          {pending ? 'Uploading…' : attached ? 'Replace' : 'Upload'}
          <input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.xlsx,.xls,.doc,.docx,.csv,.txt"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) pick(file);
              e.target.value = '';
            }}
          />
        </label>
        {attached && (
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            aria-label={`Remove ${slot.label}`}
            className="text-fg-tertiary hover:bg-danger-subtle hover:text-danger grid size-7 place-items-center rounded-[7px] transition-colors"
          >
            <Trash2 className="size-3.5" strokeWidth={2} aria-hidden />
          </button>
        )}
      </span>
    </li>
  );
}
