'use client';

/**
 * Moving money into or out of escrow.
 *
 * One dialog, two modes, because the operator is answering the same four
 * questions either way: how much, why, on what proof, and — for a release — on
 * whose authority.
 *
 * Amount and percentage are two views of one number and stay in step whichever is
 * typed. The amount is what gets sent: money derived from a rounded percentage
 * loses paise, and over a dozen releases that is a reconciliation someone has to
 * do by hand.
 *
 * The bar previews the position AFTER the movement before anything is committed,
 * so "what will this do to the account" is answered by looking rather than by
 * arithmetic.
 */

import { useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowDownToLine, ArrowUpFromLine, Check, Paperclip, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { fundEscrow, releaseEscrow } from '@/lib/actions/escrow';
import { uploadRecordDocument } from '@/lib/actions/upload';
import { Button, Money, SectionLabel } from '@/components/ui/Layout';
import { Chip } from '@/components/ui/Badges';
import { ESCROW_MILESTONES, ESCROW_MILESTONE_META, type EscrowMilestone } from '@/lib/domain/enums';
import { cn } from '@/lib/utils';
import type { FinanceApprover } from './AdvanceControl';

const field =
  'bg-surface-1 border-line-subtle focus:border-accent text-fg placeholder:text-fg-tertiary w-full rounded-[8px] border px-2.5 py-1.5 text-[13px] outline-none';

export interface EscrowPosition {
  escrowId: string;
  escrowRef: string;
  agreedAmount: number;
  fundedAmount: number;
  releasedAmount: number;
  /** Instructed but not yet settled — inside "held", but already spoken for. */
  instructedAmount: number;
  currency: string;
  supplierName: string;
  /** Whether the inbound inspection has passed — gates the final release. */
  inspectionPassed: boolean;
}

/** Rounds to whole paise. Half up, matching lib/domain/money. */
const toMinor = (major: number) => Math.round(major * 100);
const toMajor = (minor: number) => minor / 100;

export function EscrowMovementDialog({
  mode,
  workOrderId,
  position,
  financeApprovers,
  onOpenChange,
}: {
  mode: 'FUND' | 'RELEASE';
  workOrderId: string;
  position: EscrowPosition;
  financeApprovers: FinanceApprover[];
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const held = Math.max(0, position.fundedAmount - position.releasedAmount);
  /** What can actually go out: held money that is not already on its way out. */
  const available = Math.max(0, held - position.instructedAmount);
  const isRelease = mode === 'RELEASE';

  /**
   * What 100% means differs by direction, and getting it wrong would be a
   * money bug: filling the account means the agreed amount less what is already
   * in; emptying it means everything currently held.
   */
  const base = isRelease ? available : Math.max(0, position.agreedAmount - position.fundedAmount);
  const baseLabel = isRelease ? 'of what is available' : 'of what is still to fund';

  const [amountMajor, setAmountMajor] = useState<string>(base > 0 ? String(toMajor(base)) : '');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [milestone, setMilestone] = useState<EscrowMilestone>(
    // Emptying the account is the final settlement; anything less is enablement.
    'TEST_ENABLEMENT',
  );
  const [approverIds, setApproverIds] = useState<string[]>([]);

  const [proof, setProof] = useState<{ id: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const amount = useMemo(() => {
    const n = Number(amountMajor);
    return Number.isFinite(n) && n > 0 ? toMinor(n) : 0;
  }, [amountMajor]);

  const pct = base > 0 ? (amount / base) * 100 : 0;
  const emptiesAccount = isRelease && amount === available && available > 0;
  const overshoot = isRelease ? Math.max(0, amount - available) : 0;
  /** Funding past the agreed amount is allowed, but it is worth saying out loud. */
  const overAgreed = !isRelease ? Math.max(0, position.fundedAmount + amount - position.agreedAmount) : 0;

  const needsApprovers = isRelease && (emptiesAccount || milestone === 'FINAL_SETTLEMENT');
  const gateBlocked = needsApprovers && !position.inspectionPassed;

  const setFromPct = (p: number) => {
    // Whole paise, so the field never shows a value the server would round.
    setAmountMajor(String(toMajor(Math.round((base * p) / 100))));
  };

  // ── The position after this movement, for the preview bar ──────────────────
  const after = useMemo(() => {
    const funded = isRelease ? position.fundedAmount : position.fundedAmount + amount;
    const released = isRelease ? position.releasedAmount + amount : position.releasedAmount;
    const heldAfter = Math.max(0, funded - released);
    return {
      funded,
      released,
      held: heldAfter,
      // A movement made here settles at once, so anything already in flight is
      // unaffected by it and stays carved out of what is available.
      available: Math.max(0, heldAfter - position.instructedAmount),
    };
  }, [isRelease, amount, position.fundedAmount, position.releasedAmount, position.instructedAmount]);

  const scale = Math.max(position.agreedAmount, after.funded, 1);

  const pickProof = async (file: File) => {
    setUploading(true);
    setErrors((e) => ({ ...e, proofDocumentId: '' }));
    const fd = new FormData();
    fd.set('file', file);
    fd.set('docType', isRelease ? 'ESCROW_RELEASE_PROOF' : 'ESCROW_FUNDING_PROOF');
    fd.set('title', `${isRelease ? 'Release' : 'Funding'} proof · ${position.escrowRef}`);
    fd.set('workOrderId', workOrderId);
    const res = await uploadRecordDocument(fd);
    setUploading(false);
    if (res.ok && res.documentId) {
      setProof({ id: res.documentId, name: file.name });
      toast.success('Proof attached.', { description: res.detail });
    } else {
      toast.error(res.message, { description: res.detail, duration: 10000 });
    }
  };

  const submit = () => {
    setErrors({});
    startTransition(async () => {
      const common = {
        workOrderId,
        amount,
        reason,
        proofDocumentId: proof?.id ?? '',
        reference: reference.trim() || null,
      };
      const res = isRelease
        ? await releaseEscrow({ ...common, milestone, approverIds })
        : await fundEscrow(common);
      if (res.ok) {
        toast.success(res.message, { description: res.detail, duration: 11000 });
        onOpenChange(false);
        router.refresh();
      } else {
        setErrors(res.errors ?? {});
        toast.error(res.message, { description: res.detail, duration: 13000 });
      }
    });
  };

  const Icon = isRelease ? ArrowUpFromLine : ArrowDownToLine;

  return (
    <Dialog.Root open onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px]" />
        <Dialog.Content className="bg-surface-1 border-line shadow-e4 fixed top-1/2 left-1/2 z-50 flex max-h-[92vh] w-[min(95vw,660px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[14px] border">
          <div className="border-line-subtle border-b px-5 py-3.5">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Dialog.Title className="text-fg min-w-0 text-[15px] font-semibold">
                <Icon className="mr-1.5 inline size-4 align-[-2px]" aria-hidden />
                {isRelease ? 'Release money from escrow' : 'Add money to escrow'}
              </Dialog.Title>
              <Chip tone="neutral" size="sm">
                {position.escrowRef}
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
              {isRelease ? (
                <>
                  Paid to <strong className="font-medium">{position.supplierName}</strong>. Available
                  to release: <Money amount={available} />
                  {position.instructedAmount > 0 && (
                    <>
                      {' '}
                      — <Money amount={held} /> is held but{' '}
                      <Money amount={position.instructedAmount} /> of it is already instructed and
                      waiting to settle
                    </>
                  )}
                  . A release cannot exceed that.
                </>
              ) : (
                <>
                  Funded so far <Money amount={position.fundedAmount} /> of{' '}
                  <Money amount={position.agreedAmount} /> agreed.
                </>
              )}
            </Dialog.Description>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="grid gap-4">
              {/* ── How much ───────────────────────────────────────────────── */}
              <div>
                <SectionLabel>How much</SectionLabel>
                <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
                  <label className="block min-w-0">
                    <span className="text-fg-secondary mb-1 block text-[11.5px] font-medium">
                      Amount ({position.currency})
                    </span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={amountMajor}
                      onChange={(e) => setAmountMajor(e.target.value)}
                      className={cn(field, 'tnum', errors.amount && 'border-danger')}
                    />
                  </label>
                  <span className="text-fg-tertiary hidden pb-2 text-[11.5px] sm:block">=</span>
                  <label className="block min-w-0">
                    <span className="text-fg-secondary mb-1 block text-[11.5px] font-medium">
                      Percentage {baseLabel}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step="0.1"
                        value={base > 0 ? Number(pct.toFixed(1)) : 0}
                        onChange={(e) => setFromPct(Number(e.target.value))}
                        disabled={base <= 0}
                        className={cn(field, 'tnum')}
                      />
                      <span className="text-fg-tertiary shrink-0 text-[13px]">%</span>
                    </div>
                  </label>
                </div>

                {/* Presets, because these are the fractions actually negotiated. */}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[15, 25, 50, 75, 100].map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setFromPct(p)}
                      disabled={base <= 0}
                      className={cn(
                        'rounded-[7px] border px-2 py-1 text-[11.5px] transition-colors disabled:opacity-40',
                        Math.abs(pct - p) < 0.05
                          ? 'border-accent-border bg-accent-subtle text-accent-text'
                          : 'border-line-subtle text-fg-secondary hover:bg-surface-3',
                      )}
                    >
                      {p}%{p === 100 ? (isRelease ? ' — all of it' : ' — top up in full') : ''}
                    </button>
                  ))}
                </div>

                <div className="text-fg-tertiary mt-2 text-[11.5px] leading-relaxed">
                  {base <= 0 ? (
                    <span className="text-warning">
                      {isRelease
                        ? position.instructedAmount > 0
                          ? 'Everything held is already instructed and waiting to settle, so there is nothing left to release.'
                          : 'Nothing is held, so there is nothing to release. Add money first.'
                        : 'The account is already funded to the agreed amount. Anything added now goes above it.'}
                    </span>
                  ) : (
                    <>
                      100% here means <Money amount={base} /> — {baseLabel}.
                    </>
                  )}
                </div>
                {errors.amount && (
                  <span className="text-danger mt-1 block text-[11.5px]">{errors.amount}</span>
                )}
                {overshoot > 0 && (
                  <span className="text-danger mt-1 block text-[11.5px]">
                    That is <Money amount={overshoot} /> more than the account can release.
                  </span>
                )}
                {overAgreed > 0 && (
                  <span className="text-warning mt-1 block text-[11.5px] leading-relaxed">
                    This takes the account <Money amount={overAgreed} /> above the agreed amount.
                    Allowed — top-ups happen — but it is recorded as such on the audit log.
                  </span>
                )}
              </div>

              {/* ── What it does to the account ─────────────────────────────── */}
              <div className="border-line-subtle bg-surface-inset rounded-[9px] border px-3 py-2.5">
                <SectionLabel>The account after this</SectionLabel>
                <BalanceBar
                  label="Now"
                  released={position.releasedAmount}
                  instructed={position.instructedAmount}
                  available={available}
                  funded={position.fundedAmount}
                  agreed={position.agreedAmount}
                  scale={scale}
                />
                <div className="mt-2">
                  <BalanceBar
                    label="After"
                    released={after.released}
                    instructed={position.instructedAmount}
                    available={after.available}
                    funded={after.funded}
                    agreed={position.agreedAmount}
                    scale={scale}
                    highlight
                  />
                </div>
                <div className="text-fg-tertiary mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
                  <Legend className="bg-success" label="Released" />
                  {position.instructedAmount > 0 && (
                    <Legend className="bg-info/70" label="Instructed" />
                  )}
                  <Legend className="bg-warning" label={position.instructedAmount > 0 ? 'Available' : 'Held'} />
                  <Legend className="bg-surface-3 border-line-strong border" label="Not funded" />
                </div>
              </div>

              {/* ── Release-only: which milestone, and who signed ───────────── */}
              {isRelease && (
                <div className="grid gap-3.5">
                  <label className="block min-w-0">
                    <span className="text-fg-secondary mb-1 block text-[11.5px] font-medium">
                      What is it being released against
                    </span>
                    <select
                      value={milestone}
                      onChange={(e) => setMilestone(e.target.value as EscrowMilestone)}
                      className={field}
                    >
                      {ESCROW_MILESTONES.map((m) => (
                        <option key={m} value={m}>
                          {ESCROW_MILESTONE_META[m].label} — {ESCROW_MILESTONE_META[m].plainLabel}
                        </option>
                      ))}
                    </select>
                    <span className="text-fg-tertiary mt-1 block text-[11.5px] leading-relaxed">
                      Gate: {ESCROW_MILESTONE_META[milestone].gate}
                    </span>
                  </label>

                  {needsApprovers && (
                    <div
                      className={cn(
                        'rounded-[9px] border px-3 py-2.5',
                        gateBlocked
                          ? 'border-danger/40 bg-danger-subtle'
                          : 'border-warning/40 bg-warning-subtle',
                      )}
                    >
                      <SectionLabel>
                        {emptiesAccount ? 'This empties the account' : 'Final settlement'}
                      </SectionLabel>
                      {gateBlocked ? (
                        <p className="text-danger text-[12px] leading-relaxed">
                          Blocked: the inbound inspection has not passed. Releasing the balance before
                          we have verified what arrived would remove the only leverage we have if the
                          goods are wrong. Release a partial amount against test enablement instead.
                        </p>
                      ) : (
                        <>
                          <p className="text-fg-secondary mb-2 text-[12px] leading-relaxed">
                            Two different Finance approvers have to sign. One person can never release
                            the balance alone.
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {financeApprovers.map((a) => {
                              const on = approverIds.includes(a.id);
                              return (
                                <button
                                  key={a.id}
                                  type="button"
                                  onClick={() =>
                                    setApproverIds((prev) =>
                                      on ? prev.filter((x) => x !== a.id) : [...prev, a.id],
                                    )
                                  }
                                  className={cn(
                                    'flex items-center gap-1.5 rounded-[7px] border px-2 py-1 text-[11.5px] transition-colors',
                                    on
                                      ? 'border-success bg-success-subtle text-success'
                                      : 'border-line-subtle text-fg-secondary hover:bg-surface-3',
                                  )}
                                >
                                  {on && <Check className="size-3" strokeWidth={3} aria-hidden />}
                                  {a.name} · {a.role}
                                </button>
                              );
                            })}
                          </div>
                          {financeApprovers.length < 2 && (
                            <p className="text-danger mt-1.5 text-[11.5px]">
                              Only {financeApprovers.length} Finance user exists, so this release
                              cannot be authorised. Add another under Settings → Users.
                            </p>
                          )}
                          {errors.approverIds && (
                            <p className="text-danger mt-1.5 text-[11.5px]">{errors.approverIds}</p>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ── Why ─────────────────────────────────────────────────────── */}
              <label className="block min-w-0">
                <span className="text-fg-secondary mb-1 block text-[11.5px] font-medium">
                  What is this movement for
                </span>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder={
                    isRelease
                      ? 'e.g. Supplier shipped the full quantity and the inspection passed — releasing the balance per the signed terms.'
                      : 'e.g. Advance deposit against the signed escrow terms, paid by RTGS from the HDFC current account.'
                  }
                  className={cn(field, 'resize-y leading-relaxed', errors.reason && 'border-danger')}
                />
                <span
                  className={cn(
                    'mt-1 block text-[11.5px] leading-relaxed',
                    errors.reason ? 'text-danger' : 'text-fg-tertiary',
                  )}
                >
                  {errors.reason ??
                    'Required. This is the answer to "on what authority did this money move" when somebody asks months later.'}
                </span>
              </label>

              {/* ── Proof ───────────────────────────────────────────────────── */}
              <div className="min-w-0">
                <span className="text-fg-secondary mb-1 block text-[11.5px] font-medium">
                  Proof of the movement
                </span>
                <input
                  ref={fileInput}
                  type="file"
                  className="hidden"
                  accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.xlsx,.docx"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void pickProof(f);
                    e.target.value = '';
                  }}
                />
                {proof ? (
                  <div className="border-success/40 bg-success-subtle flex min-w-0 items-center gap-2 rounded-[8px] border px-2.5 py-2">
                    <Paperclip className="text-success size-3.5 shrink-0" aria-hidden />
                    <span className="text-fg min-w-0 flex-1 truncate text-[12.5px]">{proof.name}</span>
                    <button
                      type="button"
                      onClick={() => setProof(null)}
                      className="text-fg-tertiary hover:text-fg shrink-0 text-[11.5px] underline"
                    >
                      Replace
                    </button>
                  </div>
                ) : (
                  <Button
                    variant="secondary"
                    icon={Upload}
                    wrap
                    disabled={uploading}
                    onClick={() => fileInput.current?.click()}
                  >
                    {uploading ? 'Uploading…' : 'Attach the proof'}
                  </Button>
                )}
                <span
                  className={cn(
                    'mt-1 block text-[11.5px] leading-relaxed',
                    errors.proofDocumentId ? 'text-danger' : 'text-fg-tertiary',
                  )}
                >
                  {errors.proofDocumentId ??
                    (isRelease
                      ? 'Required — the release instruction, signed authority, or the provider’s confirmation. It is filed against this movement, not loosely against the order.'
                      : 'Required — the bank advice or transfer confirmation for the deposit.')}
                </span>
              </div>

              <label className="block min-w-0">
                <span className="text-fg-secondary mb-1 block text-[11.5px] font-medium">
                  Their reference{' '}
                  <span className="text-fg-tertiary font-normal">(optional)</span>
                </span>
                <input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder={isRelease ? 'Provider instruction reference' : 'UTR / bank reference'}
                  className={cn(field, 'font-mono text-[12px]')}
                />
              </label>
            </div>
          </div>

          <div className="border-line-subtle flex flex-wrap items-center justify-end gap-2 border-t px-5 py-3">
            <span className="text-fg-tertiary mr-auto text-[11.5px]">
              {amount > 0 ? (
                <>
                  Moving <Money amount={amount} className="text-fg font-semibold" />
                  {base > 0 && ` · ${pct.toFixed(1)}% ${baseLabel}`}
                </>
              ) : (
                'Enter an amount'
              )}
            </span>
            <Dialog.Close asChild>
              <Button variant="secondary" icon={X}>
                Cancel
              </Button>
            </Dialog.Close>
            <Button
              variant="primary"
              icon={Icon}
              wrap
              disabled={pending || uploading}
              disabledReason={
                gateBlocked
                  ? 'The inbound inspection has not passed.'
                  : amount <= 0
                    ? 'Enter an amount first.'
                    : overshoot > 0
                      ? 'That is more than the account holds.'
                      : !proof
                        ? 'Attach the proof of this movement.'
                        : reason.trim().length < 12
                          ? 'Say what this movement is for.'
                          : needsApprovers && approverIds.length < 2
                            ? 'Two Finance approvers have to sign.'
                            : undefined
              }
              onClick={submit}
            >
              {pending
                ? 'Recording…'
                : isRelease
                  ? emptiesAccount
                    ? 'Release the balance'
                    : 'Release this amount'
                  : 'Add to escrow'}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * The same three-segment bar the escrow panel draws, so before/after and the
 * panel afterwards are visibly the same object rather than two similar charts.
 * `scale` is shared between the two bars — otherwise each would normalise to its
 * own total and a movement would look like no change at all.
 */
function BalanceBar({
  label,
  released,
  instructed,
  available,
  funded,
  agreed,
  scale,
  highlight,
}: {
  label: string;
  released: number;
  instructed: number;
  available: number;
  funded: number;
  agreed: number;
  scale: number;
  highlight?: boolean;
}) {
  const w = (n: number) => `${(Math.max(0, n) / Math.max(1, scale)) * 100}%`;
  const unfunded = Math.max(0, agreed - funded);
  return (
    <div className="min-w-0">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3">
        <span
          className={cn(
            'text-[11px] font-semibold tracking-[0.04em] uppercase',
            highlight ? 'text-accent-text' : 'text-fg-tertiary',
          )}
        >
          {label}
        </span>
        <span className="text-fg-secondary tnum text-[11.5px]">
          <Money amount={released} withCode={false} /> released ·{' '}
          <Money amount={available} withCode={false} />{' '}
          {instructed > 0 ? 'available' : 'held'}
        </span>
      </div>
      <div
        className={cn(
          'bg-surface-3 flex h-2.5 w-full overflow-hidden rounded-full',
          highlight && 'ring-accent-border ring-1',
        )}
      >
        <span className="bg-success h-full" style={{ width: w(released) }} />
        {instructed > 0 && (
          <span
            className="bg-info/70 border-surface-1 h-full border-l"
            style={{ width: w(instructed) }}
          />
        )}
        <span className="bg-warning h-full" style={{ width: w(available) }} />
        {/* Drawn, not left as empty track: an unfilled tail reads as "the bar
            ends here" rather than "this much has never been paid in". */}
        <span
          className="bg-surface-3 border-line-strong h-full border-l"
          style={{ width: w(unfunded) }}
        />
      </div>
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn('size-2 rounded-full', className)} aria-hidden />
      {label}
    </span>
  );
}
