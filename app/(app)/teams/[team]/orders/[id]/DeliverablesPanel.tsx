'use client';

/**
 * The team's paperwork on this order: draft, edit, check, approve.
 *
 * THE SHAPE OF THE SCREEN follows the shape of the decision. A reviewer needs
 * to answer three questions in order — what does the system think, what did I
 * change, and what is still wrong — so the page is: fields, then the list of
 * overrides, then the checks, then the approve button. Putting the button
 * anywhere above the checks would invite approving before reading them.
 *
 * WHY OVERRIDES GET THEIR OWN LIST. The computed draft is kept alongside the
 * edited values, so every changed figure can be shown as "was X, now Y". A P&L
 * where somebody moved the freight number is a different document from one
 * where they did not, and the difference should not require diffing two
 * versions by eye.
 */

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Check,
  CircleAlert,
  FileText,
  Lock,
  Pencil,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { approveDeliverable, generateDraft, saveDraft } from '@/lib/actions/deliverables';
import { deliverableFor } from '@/lib/domain/deliverables/registry';
import type { CheckResult, DeliverableInput, DeliverableValues } from '@/lib/domain/deliverables/types';
import { fromMinor, toMinor } from '@/lib/domain/money';
import { Button, EmptyState, Money, Panel, PanelHeader, SectionLabel } from '@/components/ui/Layout';
import { Chip } from '@/components/ui/Badges';
import { usePreferences } from '@/components/providers/Preferences';
import { formatDateTime } from '@/lib/utils';
import { cn } from '@/lib/utils';

export interface DeliverableRow {
  id: string;
  kind: string;
  status: string;
  version: number;
  generatedAtStage: string;
  generatedAt: string;
  approvedAt: string | null;
  reviewNote: string | null;
  computed: string;
  values: string;
}

/** What the team owes on this order, whether or not a draft exists yet. */
export interface DeliverableSlot {
  kind: string;
  label: string;
  plainLabel: string;
  purpose: string;
  ready: boolean;
  readyFromLabel: string;
  overdue: boolean;
  latest: DeliverableRow | null;
}

const field =
  'bg-surface-1 border-line-subtle focus:border-accent text-fg placeholder:text-fg-tertiary w-full rounded-[8px] border px-2.5 py-1.5 text-[13px] outline-none disabled:opacity-60';

export function DeliverablesPanel({
  orderId,
  slots,
  input,
}: {
  orderId: string;
  slots: DeliverableSlot[];
  /** The same order facts the server checks against, so the live preview and
   *  the actual gate cannot disagree. */
  input: DeliverableInput | null;
}) {
  const { label: pick } = usePreferences();

  if (slots.length === 0) {
    return (
      <EmptyState
        title="This team produces no documents on this order"
        description="Nothing on this order's flow makes a document this team is answerable for."
      />
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="text-fg-tertiary text-[11.5px] leading-relaxed">
        Documents this team is answerable for. Each is drafted from the order&rsquo;s own figures and
        stays a draft until somebody approves it — the system proposes, a person decides.
      </p>
      {slots.map((slot) => (
        /*
         * Keyed by the version's id, not just the document kind.
         *
         * `values` is seeded from the row in a useState initialiser, which does
         * NOT re-run when a new draft arrives — so after generating, the form
         * kept its empty state while the computed draft had real figures, and
         * every field rendered as "Edited". Remounting on a new version is the
         * honest fix: a new draft is a new document, not the old one with
         * different numbers.
         */
        <DeliverableCard
          key={`${slot.kind}:${slot.latest?.id ?? 'none'}`}
          orderId={orderId}
          slot={slot}
          input={input}
          pick={pick}
        />
      ))}
    </div>
  );
}

function DeliverableCard({
  orderId,
  slot,
  input,
  pick,
}: {
  orderId: string;
  slot: DeliverableSlot;
  input: DeliverableInput | null;
  pick: (a: string, b: string) => string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const def = deliverableFor(slot.kind);

  const latest = slot.latest;
  const approved = latest?.status === 'APPROVED';

  const computed: DeliverableValues = useMemo(
    () => (latest ? (JSON.parse(latest.computed) as DeliverableValues) : {}),
    [latest],
  );
  const [values, setValues] = useState<DeliverableValues>(() =>
    latest ? (JSON.parse(latest.values) as DeliverableValues) : {},
  );
  const [reviewNote, setReviewNote] = useState(latest?.reviewNote ?? '');

  /*
   * Checks are recomputed in the browser as the reviewer types, so the effect
   * of an edit is immediate. The server runs them again on approve — this copy
   * is a convenience, not the control.
   */
  const checks: CheckResult[] = useMemo(
    () => (def && latest && input ? def.check(values, input) : []),
    [def, latest, input, values],
  );

  const overrides = useMemo(
    () =>
      Object.keys(computed)
        .filter((k) => String(computed[k] ?? '') !== String(values[k] ?? ''))
        .map((k) => ({
          key: k,
          label: def?.fields.find((f) => f.key === k)?.label ?? k,
          kind: def?.fields.find((f) => f.key === k)?.kind ?? 'text',
          from: computed[k],
          to: values[k],
        })),
    [computed, values, def],
  );

  const failing = checks.filter((c) => c.status === 'FAIL');
  const warning = checks.filter((c) => c.status === 'WARN');

  if (!def) return null;

  const draft = () =>
    start(async () => {
      const res = await generateDraft(orderId, slot.kind);
      if (res.ok) {
        toast.success(res.message, { description: res.detail, duration: 8000 });
        setOpen(true);
        router.refresh();
      } else {
        toast.error(res.message, { description: res.detail, duration: 9000 });
      }
    });

  const save = () =>
    start(async () => {
      if (!latest) return;
      const res = await saveDraft(latest.id, values);
      if (res.ok) toast.success(res.message, { description: res.detail });
      else toast.error(res.message, { description: res.detail });
      router.refresh();
    });

  const approve = () =>
    start(async () => {
      if (!latest) return;
      /*
       * Save first, then approve.
       *
       * The server checks the PERSISTED values, not what is on screen — which
       * is right, because the browser is not the control. But it made approving
       * a two-step dance nobody would guess at: you fill in the missing field,
       * click Approve, and are told that field is missing. Committing the edits
       * as part of approving removes the trap without weakening the gate, since
       * the checks still run server-side against what was just written.
       */
      const saved = await saveDraft(latest.id, values);
      if (!saved.ok) {
        toast.error(saved.message, { description: saved.detail });
        return;
      }
      const res = await approveDeliverable(latest.id, reviewNote);
      if (res.ok) {
        toast.success(res.message, { description: res.detail, duration: 9000 });
        setOpen(false);
        router.refresh();
      } else {
        toast.error(res.message, { description: res.detail, duration: 11000 });
      }
    });

  return (
    <Panel padded={false}>
      <div className="min-w-0 p-4">
        <PanelHeader
          title={pick(def.label, def.plainLabel)}
          description={def.purpose}
          actions={
            approved ? (
              <Chip tone="success" size="sm" icon={Lock}>
                Approved v{latest.version}
              </Chip>
            ) : latest ? (
              <Chip tone="warning" size="sm" icon={Pencil}>
                Draft v{latest.version}
              </Chip>
            ) : slot.ready ? (
              <Chip tone="neutral" size="sm">
                Not drafted
              </Chip>
            ) : (
              <Chip tone="muted" size="sm">
                Too early
              </Chip>
            )
          }
        />

        {/* State line — what exists, and what it was drawn from. */}
        <p className="text-fg-secondary mt-1 text-[12px] leading-relaxed">
          {approved && latest ? (
            <>
              Approved {formatDateTime(latest.approvedAt)}, filed against the order.
              {latest.reviewNote ? ` Reason noted: ${latest.reviewNote}` : ''}
            </>
          ) : latest ? (
            <>
              Drafted {formatDateTime(latest.generatedAt)} from the order as it stood at{' '}
              {latest.generatedAtStage.replace(/_/g, ' ').toLowerCase()}. Nothing is filed until it
              is approved.
            </>
          ) : slot.ready ? (
            <>No draft yet. Generating one reads the order&rsquo;s current figures.</>
          ) : (
            <>
              Its figures only mean something once the order reaches {slot.readyFromLabel}. Drafting
              now would produce a confident document full of placeholders.
            </>
          )}
        </p>

        <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
          {slot.ready && (
            <Button
              variant={latest ? 'secondary' : 'primary'}
              icon={RefreshCw}
              onClick={draft}
              disabled={pending}
            >
              {latest ? 'Draft a new version' : 'Generate the draft'}
            </Button>
          )}
          {latest && (
            <Button variant="secondary" icon={FileText} onClick={() => setOpen((o) => !o)}>
              {open ? 'Hide the document' : approved ? 'Read the document' : 'Open and review'}
            </Button>
          )}
          {slot.overdue && !approved && (
            <Chip tone="danger" size="sm" icon={AlertTriangle}>
              Overdue — the order is past where this should have been signed
            </Chip>
          )}
        </div>
      </div>

      {open && latest && (
        <div className="border-line-subtle border-t">
          {/* ── The document itself ─────────────────────────────────────── */}
          {def.sections.map((section) => {
            const fields = def.fields.filter((f) => f.section === section.key);
            if (fields.length === 0) return null;
            return (
              <div key={section.key} className="border-line-subtle min-w-0 border-b p-4">
                <SectionLabel>{section.label}</SectionLabel>
                {section.note && (
                  <p className="text-fg-tertiary mt-1 mb-2.5 text-[11.5px] leading-relaxed">
                    {section.note}
                  </p>
                )}
                <div className="mt-2 grid min-w-0 gap-3 sm:grid-cols-2">
                  {fields.map((f) => {
                    const changed = String(computed[f.key] ?? '') !== String(values[f.key] ?? '');
                    return (
                      <label key={f.key} className="min-w-0">
                        <span className="text-fg-secondary flex min-w-0 flex-wrap items-center gap-1.5 text-[12px] font-medium">
                          {pick(f.label, f.plainLabel ?? f.label)}
                          {f.required && <span className="text-danger text-[10.5px]">Required</span>}
                          {f.derived && (
                            <span className="text-fg-tertiary text-[10.5px]">Computed</span>
                          )}
                          {changed && (
                            <span className="text-warning text-[10.5px] font-semibold">Edited</span>
                          )}
                        </span>
                        <FieldInput
                          kind={f.kind}
                          value={values[f.key] ?? ''}
                          disabled={approved}
                          onChange={(v) => setValues((p) => ({ ...p, [f.key]: v }))}
                        />
                        <span className="text-fg-tertiary mt-1 block text-[11px] leading-relaxed">
                          {f.help}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* ── What the reviewer changed ───────────────────────────────── */}
          <div className="border-line-subtle min-w-0 border-b p-4">
            <SectionLabel>Changes from the system&rsquo;s draft</SectionLabel>
            {overrides.length === 0 ? (
              <p className="text-fg-tertiary mt-1.5 text-[12px] leading-relaxed">
                Nothing has been changed. Every figure here is the one computed from the order.
              </p>
            ) : (
              <>
                <p className="text-fg-tertiary mt-1 mb-2 text-[11.5px] leading-relaxed">
                  {overrides.length} figure{overrides.length === 1 ? '' : 's'}{' '}
                  overridden. The system&rsquo;s own draft is kept, so an override stays visible
                  rather than quietly replacing what was computed.
                </p>
                <ul className="flex min-w-0 flex-col gap-1.5">
                  {overrides.map((o) => (
                    <li
                      key={o.key}
                      className="border-warning-border bg-warning-subtle flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-[8px] border px-2.5 py-1.5 text-[12px]"
                    >
                      <span className="text-fg font-medium">{o.label}</span>
                      <span className="text-fg-tertiary">was</span>
                      <ValueText kind={o.kind} value={o.from} />
                      <span className="text-fg-tertiary">now</span>
                      <ValueText kind={o.kind} value={o.to} />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          {/* ── Checks ──────────────────────────────────────────────────── */}
          <div className="border-line-subtle min-w-0 border-b p-4">
            <SectionLabel>Checks</SectionLabel>
            <p className="text-fg-tertiary mt-1 mb-2 text-[11.5px] leading-relaxed">
              Run again on the server when you approve, against the order&rsquo;s figures at that
              moment — this list is here so you can see the effect of an edit as you make it.
            </p>
            <ul className="flex min-w-0 flex-col gap-1.5">
              {checks.map((c) => (
                <li
                  key={c.key}
                  className={cn(
                    'flex min-w-0 items-start gap-2 rounded-[8px] border px-2.5 py-2 text-[12px] leading-relaxed',
                    c.status === 'FAIL' && 'border-danger-border bg-danger-subtle',
                    c.status === 'WARN' && 'border-warning-border bg-warning-subtle',
                    c.status === 'PASS' && 'border-line-subtle',
                  )}
                >
                  <span className="mt-0.5 shrink-0">
                    {c.status === 'PASS' ? (
                      <Check className="text-success size-3.5" strokeWidth={2.5} aria-hidden />
                    ) : c.status === 'WARN' ? (
                      <CircleAlert className="text-warning size-3.5" strokeWidth={2.5} aria-hidden />
                    ) : (
                      <AlertTriangle className="text-danger size-3.5" strokeWidth={2.5} aria-hidden />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="text-fg font-medium">{c.label}</span>
                    <span className="text-fg-secondary block">{c.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* ── The gate ────────────────────────────────────────────────── */}
          <div className="min-w-0 p-4">
            {approved ? (
              <p className="text-fg-secondary flex items-start gap-2 text-[12px] leading-relaxed">
                <Lock className="mt-0.5 size-3.5 shrink-0" strokeWidth={2} aria-hidden />
                This version is approved and is not editable. If the figures have moved, draft a new
                version — the change should be visible, not silent.
              </p>
            ) : (
              <>
                {warning.length > 0 && (
                  <label className="mb-3 block min-w-0">
                    <SectionLabel>Why you are approving over the warnings</SectionLabel>
                    <textarea
                      value={reviewNote}
                      onChange={(e) => setReviewNote(e.target.value)}
                      rows={2}
                      placeholder="e.g. Margin is under the floor because the customer took a price concession agreed by sales."
                      className={cn(field, 'mt-1 resize-y')}
                    />
                    <span className="text-fg-tertiary mt-1 block text-[11px] leading-relaxed">
                      Required. Approving over a warning is a judgement call, and one with no reason
                      recorded cannot be told apart from an oversight.
                    </span>
                  </label>
                )}
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Button variant="secondary" onClick={save} disabled={pending}>
                    Save draft
                  </Button>
                  <Button
                    variant="primary"
                    icon={ShieldCheck}
                    onClick={approve}
                    disabled={pending || failing.length > 0 || (warning.length > 0 && !reviewNote.trim())}
                  >
                    Approve and file
                  </Button>
                  {failing.length > 0 && (
                    <span className="text-danger text-[12px]">
                      {failing.length} check{failing.length === 1 ? '' : 's'} must pass first.
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}

/** Money is stored in minor units; the form shows and accepts major ones. */
function FieldInput({
  kind,
  value,
  disabled,
  onChange,
}: {
  kind: string;
  value: string | number | boolean | null;
  disabled: boolean;
  onChange: (v: string | number | boolean) => void;
}) {
  if (kind === 'boolean') {
    return (
      <span className="mt-1 flex items-center gap-2">
        <input
          type="checkbox"
          checked={Boolean(value)}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="accent-accent size-4"
        />
        <span className="text-fg-secondary text-[12.5px]">{value ? 'Yes' : 'No'}</span>
      </span>
    );
  }
  if (kind === 'longText') {
    return (
      <textarea
        value={String(value ?? '')}
        disabled={disabled}
        rows={3}
        onChange={(e) => onChange(e.target.value)}
        className={cn(field, 'mt-1 resize-y')}
      />
    );
  }
  if (kind === 'money') {
    return (
      <input
        type="number"
        step="0.01"
        value={value === '' || value === null ? '' : fromMinor(Number(value))}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === '' ? 0 : toMinor(Number(e.target.value)))}
        className={cn(field, 'mt-1 tnum')}
      />
    );
  }
  return (
    <input
      type={kind === 'date' ? 'date' : kind === 'number' ? 'number' : 'text'}
      value={String(value ?? '')}
      disabled={disabled}
      onChange={(e) => onChange(kind === 'number' ? Number(e.target.value) : e.target.value)}
      className={cn(field, 'mt-1', kind === 'number' && 'tnum')}
    />
  );
}

function ValueText({ kind, value }: { kind: string; value: string | number | boolean | null }) {
  if (kind === 'money') return <Money amount={Number(value ?? 0)} withCode={false} />;
  if (kind === 'boolean') return <span className="text-fg font-medium">{value ? 'Yes' : 'No'}</span>;
  return (
    <span className="text-fg font-medium">
      {String(value ?? '').trim() === '' ? '(blank)' : String(value)}
    </span>
  );
}
