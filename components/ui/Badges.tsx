'use client';

/**
 * Status rendering primitives. Per §8.1, status is NEVER conveyed by colour
 * alone — every chip pairs its colour with an icon and a text label.
 */

import {
  AlertTriangle,
  Ban,
  Check,
  CircleDashed,
  CircleDot,
  Clock,
  Cpu,
  FlaskConical,
  Hand,
  Info,
  Loader,
  MinusCircle,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Hint } from './InfoTooltip';
import {
  PROVENANCE_META,
  STAKEHOLDER_META,
  type Provenance,
  type Stakeholder,
} from '@/lib/domain/enums';

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'muted';

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-surface-3 text-fg-secondary border-line-subtle',
  accent: 'bg-accent-subtle text-accent-text border-accent-border',
  success: 'bg-success-subtle text-success border-success-border',
  warning: 'bg-warning-subtle text-warning border-warning-border',
  danger: 'bg-danger-subtle text-danger border-danger-border',
  info: 'bg-info-subtle text-info border-info-border',
  muted: 'bg-muted-subtle text-muted border-muted-border',
};

export function Chip({
  children,
  tone = 'neutral',
  icon: Icon,
  className,
  size = 'md',
}: {
  children: React.ReactNode;
  tone?: Tone;
  icon?: LucideIcon;
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-full border font-medium whitespace-nowrap',
        size === 'sm' ? 'px-1.5 py-[1px] text-[10.5px]' : 'px-2 py-[2px] text-[11.5px]',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {Icon && <Icon className={size === 'sm' ? 'size-2.5' : 'size-3'} strokeWidth={2.2} aria-hidden />}
      <span className="truncate">{children}</span>
    </span>
  );
}

// ── Generic status chip driven by a lookup table ────────────────────────────

interface StatusSpec {
  label: string;
  plainLabel?: string;
  tone: Tone;
  icon: LucideIcon;
}

const STATUS_MAP: Record<string, StatusSpec> = {
  // Work order
  ACTIVE: { label: 'Active', tone: 'accent', icon: CircleDot },
  BLOCKED: { label: 'Blocked', tone: 'danger', icon: AlertTriangle },
  CLOSED: { label: 'Closed', tone: 'success', icon: Check },
  CANCELLED: { label: 'Cancelled', tone: 'muted', icon: Ban },
  // SLA
  ON_TRACK: { label: 'On track', tone: 'success', icon: Check },
  AT_RISK: { label: 'At risk', tone: 'warning', icon: Clock },
  BREACHED: { label: 'Overdue', tone: 'danger', icon: AlertTriangle },
  // Documents
  DRAFT: { label: 'Draft', tone: 'neutral', icon: CircleDashed },
  ISSUED: { label: 'Issued', tone: 'info', icon: Check },
  SENT: { label: 'Sent', tone: 'info', icon: Check },
  ACCEPTED: { label: 'Accepted', tone: 'success', icon: Check },
  EXPIRED: { label: 'Expired', tone: 'muted', icon: Clock },
  SUPERSEDED: { label: 'Superseded', tone: 'muted', icon: MinusCircle },
  ACKNOWLEDGED: { label: 'Acknowledged', tone: 'success', icon: Check },
  RECEIVED: { label: 'Received', tone: 'info', icon: Check },
  PAID: { label: 'Paid', tone: 'success', icon: Check },
  // AVL
  APPROVED: { label: 'Approved', tone: 'success', icon: ShieldCheck },
  PENDING: { label: 'Pending', tone: 'warning', icon: Clock },
  SUSPENDED: { label: 'Suspended', tone: 'danger', icon: Ban },
  // Escrow
  OPENED: { label: 'Opened', tone: 'info', icon: CircleDot },
  FUNDED: { label: 'Funded', tone: 'accent', icon: Check },
  PARTIALLY_RELEASED: { label: 'Part released', tone: 'warning', icon: CircleDot },
  SETTLED: { label: 'Settled', tone: 'success', icon: Check },
  DISPUTED: { label: 'Disputed', tone: 'danger', icon: AlertTriangle },
  REFUNDED: { label: 'Refunded', tone: 'muted', icon: MinusCircle },
  INSTRUCTED: { label: 'Instructed', tone: 'info', icon: CircleDot },
  FAILED: { label: 'Failed', tone: 'danger', icon: AlertTriangle },
  // Testing
  SUBMITTED: { label: 'Submitted', tone: 'info', icon: Check },
  SCOPE_CONFIRMED: { label: 'Scope agreed', tone: 'info', icon: Check },
  IN_PROGRESS: { label: 'In progress', tone: 'accent', icon: Loader },
  COMPLETED: { label: 'Completed', tone: 'success', icon: Check },
  ON_HOLD: { label: 'On hold', tone: 'warning', icon: Hand },
  PASS: { label: 'Pass', tone: 'success', icon: Check },
  FAIL: { label: 'Fail', tone: 'danger', icon: AlertTriangle },
  PARTIAL: { label: 'Partial', tone: 'warning', icon: MinusCircle },
  // Shipments
  BOOKED: { label: 'Booked', tone: 'info', icon: Check },
  IN_TRANSIT: { label: 'In transit', tone: 'accent', icon: Loader },
  CUSTOMS: { label: 'At customs', tone: 'warning', icon: ShieldCheck },
  OUT_FOR_DELIVERY: { label: 'Out for delivery', tone: 'accent', icon: Loader },
  DELIVERED: { label: 'Delivered', tone: 'success', icon: Check },
  EXCEPTION: { label: 'Problem', tone: 'danger', icon: AlertTriangle },
  // Customs
  NOT_FILED: { label: 'Not filed', tone: 'neutral', icon: CircleDashed },
  FILED: { label: 'Filed', tone: 'info', icon: Check },
  UNDER_ASSESSMENT: { label: 'Being assessed', tone: 'accent', icon: Loader },
  QUERY_RAISED: { label: 'Query raised', tone: 'danger', icon: AlertTriangle },
  ASSESSED: { label: 'Assessed', tone: 'info', icon: Check },
  DUTY_PAID: { label: 'Duty paid', tone: 'accent', icon: Check },
  OUT_OF_CHARGE: { label: 'Released', plainLabel: 'Cleared', tone: 'success', icon: Check },
  // Inspection
  PASSED: { label: 'Passed', tone: 'success', icon: Check },
  QC_PENDING: { label: 'QC pending', tone: 'warning', icon: Clock },
  // Tax / e-invoice
  NOT_APPLICABLE: { label: 'Not applicable', tone: 'muted', icon: MinusCircle },
  GENERATED: { label: 'Generated', tone: 'success', icon: Check },
  // Tasks / exceptions
  OPEN: { label: 'Open', tone: 'warning', icon: CircleDot },
  RESOLVED: { label: 'Resolved', tone: 'success', icon: Check },
  DONE: { label: 'Done', tone: 'success', icon: Check },
  // Communication
  AWAITING_REPLY: { label: 'Awaiting reply', tone: 'warning', icon: Clock },
  REPLIED: { label: 'Replied', tone: 'success', icon: Check },
  ACTION_REQUIRED: { label: 'Action required', tone: 'danger', icon: AlertTriangle },
  // GSTR-2B
  MATCHED: { label: 'Matched', tone: 'success', icon: Check },
  UNMATCHED: { label: 'Unmatched', tone: 'warning', icon: Clock },
  MISMATCH: { label: 'Mismatch', tone: 'danger', icon: AlertTriangle },
  NOT_IN_2B: { label: 'Not in 2B', tone: 'danger', icon: AlertTriangle },
};

export function StatusChip({
  status,
  size = 'md',
  className,
}: {
  status: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const spec = STATUS_MAP[status] ?? {
    label: status.replace(/_/g, ' ').toLowerCase(),
    tone: 'neutral' as Tone,
    icon: Info,
  };
  return (
    <Chip tone={spec.tone} icon={spec.icon} size={size} className={cn('capitalize', className)}>
      {spec.label}
    </Chip>
  );
}

// ── Stakeholder badge ───────────────────────────────────────────────────────

const SH_CLASSES: Record<Stakeholder, string> = {
  // All five 1BUY teams share the indigo. Seven categorical hues is already the
  // ceiling under deuteranopia (see the palette note in globals.css), so colour
  // answers "which organisation" and the label answers "which team".
  ONE_BUY_SOURCING: 'bg-sh-onebuy-subtle text-sh-onebuy border-sh-onebuy/25',
  ONE_BUY_FINANCE: 'bg-sh-onebuy-subtle text-sh-onebuy border-sh-onebuy/25',
  ONE_BUY_INBOUND: 'bg-sh-onebuy-subtle text-sh-onebuy border-sh-onebuy/25',
  ONE_BUY_OUTBOUND: 'bg-sh-onebuy-subtle text-sh-onebuy border-sh-onebuy/25',
  ONE_BUY_INSPECTION: 'bg-sh-onebuy-subtle text-sh-onebuy border-sh-onebuy/25',
  CUSTOMER: 'bg-sh-customer-subtle text-sh-customer border-sh-customer/25',
  SUPPLIER: 'bg-sh-supplier-subtle text-sh-supplier border-sh-supplier/25',
  ESCROW: 'bg-sh-escrow-subtle text-sh-escrow border-sh-escrow/25',
  WHL: 'bg-sh-whl-subtle text-sh-whl border-sh-whl/25',
  WHA: 'bg-sh-wha-subtle text-sh-wha border-sh-wha/25',
  LOGISTICS: 'bg-sh-logistics-subtle text-sh-logistics border-sh-logistics/25',
};

export function StakeholderBadge({
  stakeholder,
  short,
  className,
}: {
  stakeholder: Stakeholder;
  short?: boolean;
  className?: string;
}) {
  const meta = STAKEHOLDER_META[stakeholder];
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-[5px] border px-1.5 py-[1px] text-[10.5px] font-semibold whitespace-nowrap',
        SH_CLASSES[stakeholder],
        className,
      )}
      title={meta.plainLabel}
    >
      {short ? meta.short : meta.label}
    </span>
  );
}

/** The colour dot used in swimlanes and legends. */
export function StakeholderDot({ stakeholder }: { stakeholder: Stakeholder }) {
  const cls: Record<Stakeholder, string> = {
    ONE_BUY_SOURCING: 'bg-sh-onebuy',
    ONE_BUY_FINANCE: 'bg-sh-onebuy',
    ONE_BUY_INBOUND: 'bg-sh-onebuy',
    ONE_BUY_OUTBOUND: 'bg-sh-onebuy',
    ONE_BUY_INSPECTION: 'bg-sh-onebuy',
    CUSTOMER: 'bg-sh-customer',
    SUPPLIER: 'bg-sh-supplier',
    ESCROW: 'bg-sh-escrow',
    WHL: 'bg-sh-whl',
    WHA: 'bg-sh-wha',
    LOGISTICS: 'bg-sh-logistics',
  };
  return <span className={cn('size-2 shrink-0 rounded-full', cls[stakeholder])} aria-hidden />;
}

// ── Provenance badge (§11A.0 rule 3, AC#20) ─────────────────────────────────

const PROV_TONE: Record<Provenance, Tone> = {
  MANUAL: 'neutral',
  API: 'info',
  MOCK: 'warning',
};

const PROV_ICON: Record<Provenance, LucideIcon> = {
  MANUAL: Hand,
  API: Cpu,
  MOCK: FlaskConical,
};

export function ProvenanceBadge({
  provenance,
  actor,
  at,
  ref: sourceRef,
  size = 'sm',
}: {
  provenance: Provenance | string;
  actor?: string | null;
  at?: Date | string | null;
  ref?: string | null;
  size?: 'sm' | 'md';
}) {
  const p = (provenance as Provenance) in PROVENANCE_META ? (provenance as Provenance) : 'MANUAL';
  const meta = PROVENANCE_META[p];
  const when = at ? new Date(at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : null;

  return (
    <Hint
      content={
        <div className="space-y-1">
          <div className="font-medium">{meta.label}</div>
          <div>{meta.description}</div>
          {actor && (
            <div className="text-fg-tertiary">
              By <span className="text-fg-secondary">{actor}</span>
            </div>
          )}
          {when && <div className="text-fg-tertiary">{when}</div>}
          {sourceRef && (
            <div className="text-fg-tertiary font-mono text-[10.5px]">Ref {sourceRef}</div>
          )}
        </div>
      }
    >
      <span>
        <Chip tone={PROV_TONE[p]} icon={PROV_ICON[p]} size={size}>
          {meta.label}
        </Chip>
      </span>
    </Hint>
  );
}
