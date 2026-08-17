'use client';

/**
 * ORDER DETAIL — master prompt §6.2. Thirteen mandatory tabs.
 *
 * Tabs that do not apply to an order are DISABLED with an explanatory tooltip,
 * never hidden — hiding them confuses the non-technical operators this platform
 * is built for, because they cannot tell "not applicable" from "missing".
 */

import { Fragment, useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import * as Tabs from '@radix-ui/react-tabs';
import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  Ban,
  Boxes,
  Check,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  FileText,
  FileUp,
  FlaskConical,
  // Aliased: the bare name would shadow the DOM's `History` type in this module.
  History as HistoryIcon,
  Landmark,
  LayoutList,
  MessageSquare,
  Package,
  Paperclip,
  Receipt,
  Route,
  ScrollText,
  ShieldCheck,
  Truck,
} from 'lucide-react';
import type { OrderDetail } from '@/lib/queries/order-detail';
import {
  Button,
  EmptyState,
  KeyValue,
  Money,
  MonoId,
  PageShell,
  Panel,
  PanelHeader,
  Pct,
  SectionLabel,
} from '@/components/ui/Layout';
import { Chip, ProvenanceBadge, StakeholderBadge, StatusChip } from '@/components/ui/Badges';
import { Hint, InfoTooltip } from '@/components/ui/InfoTooltip';
import {
  ResponsiveFlowRail,
  type FlowRailData,
  type ManualStep,
} from '@/components/flow/FlowRail';
import { FlowPlanDialog } from './FlowPlanDialog';
import { FlowStepsPanel } from './FlowStepsPanel';
import { NextActionPanel, type StageRelation } from './NextActionPanel';
import { DemoResetButton } from './DemoResetButton';
import { DEMO_ORDER_ALIAS } from '@/lib/demo/constants';
import { DocumentLink, type PrintableKind } from '@/components/print/DocumentLink';
import { StageEvidencePanel, type EvidenceRecord, type StageOption } from './StageEvidencePanel';
import { CommunicationTab } from './CommunicationTab';
import { ExceptionPanel, type FailedLine } from './ExceptionPanel';
import { DocumentSheetDialog, type SheetDoc } from '@/components/documents/DocumentSheet';
import { AdvanceControl, type FinanceApprover } from './AdvanceControl';
import { InsertStepDialog } from './InsertStepDialog';
import { ManualStepDialog } from './ManualStepDialog';
import { EscrowMovementDialog, type EscrowPosition } from './EscrowMovementDialog';
import { DeliveryTermsPanel, type DeliveryTermsData } from './DeliveryTermsPanel';
import { exceptionDef } from '@/lib/domain/exceptions';
import { assessEvidence } from '@/lib/domain/stage-evidence';
import {
  applicableStages,
  getStage,
  ladderPosition,
  PHASE_DEFS,
  resolveRailAnchor,
  type PhaseId,
  type PhasePlan,
  stageOwner,
  type StageContext,
} from '@/lib/domain/stages';
import { normalisePhasePlan, planSequence } from '@/lib/domain/phase-plan';
import {
  ESCROW_MILESTONE_META,
  PAYMENT_METHOD_META,
  SHIPMENT_LEG_META,
  TAX_TREATMENT_META,
  TEST_SCOPE_META,
  type EscrowMilestone,
  type ShipmentLeg,
  type TaxTreatment,
} from '@/lib/domain/enums';
import { cn, formatDate, formatDateTime, humanDuration } from '@/lib/utils';
import { usePreferences } from '@/components/providers/Preferences';

interface TabDef {
  id: string;
  label: string;
  plainLabel: string;
  icon: typeof Activity;
  /** Undefined when applicable; a reason string disables the tab. */
  disabledReason?: string;
  count?: number;
}

/**
 * The section drawer's grouping.
 *
 * Fourteen flat items is a list you scan twice and still lose your place in.
 * These four groups are how the work actually divides: what the order IS, where
 * the money is, what is physically happening to the goods, and the record of it.
 * Ids only — the labels, icons, counts and disabled reasons all still come from
 * the single `tabs` definition, so nothing can drift.
 */
const TAB_GROUPS: { title: string; ids: string[] }[] = [
  { title: 'The order', ids: ['overview', 'flow', 'lines', 'documents'] },
  { title: 'Money', ids: ['escrow', 'tax'] },
  { title: 'Movement & quality', ids: ['testing', 'logistics', 'customs', 'inspection', 'repack'] },
  { title: 'Record', ids: ['communication', 'audit', 'evidence'] },
];

export function OrderDetailView({
  order,
  financeApprovers,
}: {
  order: OrderDetail;
  financeApprovers: FinanceApprover[];
}) {
  // Tabs are deep-linkable (?tab=communication) so a colleague can be sent
  // straight to the part of the order being discussed.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [fallbackTab, setFallbackTab] = useState('overview');
  const tab = searchParams.get('tab') ?? fallbackTab;

  const setTab = useCallback(
    (next: string) => {
      setFallbackTab(next);
      const params = new URLSearchParams(searchParams.toString());
      if (next === 'overview') params.delete('tab');
      else params.set('tab', next);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  /**
   * The plan in force. No rows means this order runs the standard ladder, which
   * is the overwhelmingly common case — so the default is built here rather than
   * stored per order.
   */
  const savedPlan: PhasePlan = useMemo(
    () =>
      normalisePhasePlan(
        order.phasePlan?.length
          ? order.phasePlan.map((r) => ({ phase: r.phase as PhaseId, skipped: r.skipped }))
          : null,
      ),
    [order.phasePlan],
  );

  /**
   * What the operator is currently proposing. Held here rather than saved on every
   * drag: re-planning a flow usually takes several moves, and each intermediate
   * arrangement is not something anyone meant to commit.
   */
  const [draftPlan, setDraftPlan] = useState<PhasePlan | null>(null);
  const [planEditing, setPlanEditing] = useState(false);
  const [planReviewOpen, setPlanReviewOpen] = useState(false);
  /**
   * Derived rather than cleared in an effect: a draft that has become identical
   * to the saved plan is not a draft. Doing it here means a save cannot leave a
   * phantom "unsaved changes" banner on screen for the frame before the effect
   * runs.
   */
  const activePlan =
    draftPlan && planSequence(draftPlan) !== planSequence(savedPlan) ? draftPlan : savedPlan;

  const rail: FlowRailData = useMemo(
    () => ({
      currentStage: order.stage,
      ctx: {
        paymentMethod: order.paymentMethod as 'ADVANCE' | 'ESCROW' | 'CREDIT',
        testingRequired: order.testingRequired,
        testScope: (order.testScope as 'LOT_SAMPLE' | 'FULL_BATCH' | null) ?? null,
        phasePlan: activePlan,
        // The term we bought on drives the whole inbound leg — which customs
        // steps this order runs at all, and whose name sits against them.
        incoterms: order.incoterms,
        sellIncoterms: order.customerPo.incoterms,
      },
      isBlocked: order.status === 'BLOCKED' || Boolean(order.computed.branchStageId),
      blockReason: order.exceptions.find((e) => e.status === 'OPEN')?.reason ?? null,
      stageEnteredAt: order.stageEnteredAt,
      completedStageIds: order.computed.completedStageIds,
      transitions: order.transitions.map((t) => ({
        toStage: t.toStage,
        createdAt: t.createdAt,
        actorLabel: t.actorLabel,
      })),
      customStages: order.customStages,
    }),
    [order, activePlan],
  );

  /**
   * Which stage the Next Action panel is showing.
   *
   * Null means "wherever the order is", which is what it snaps back to when the
   * order moves — pinning a preview across an advance would leave the operator
   * looking at a stage that is no longer relevant without noticing.
   */
  const [preview, setPreview] = useState<{ stageId: string; pinnedAt: string } | null>(null);
  const anchorStageId = useMemo(() => resolveRailAnchor(order.stage).anchorStageId, [order.stage]);
  /**
   * A preview is remembered together with the stage the order was on when it was
   * chosen, and ignored once the order moves — so advancing snaps the panel back
   * to reality without an effect racing the render to clear it.
   */
  const shownStageId = preview?.pinnedAt === order.stage ? preview.stageId : anchorStageId;

  /** Where the shown stage sits relative to where the order actually is. */
  const stageRelation: StageRelation = useMemo(() => {
    if (shownStageId === anchorStageId) return 'CURRENT';
    const here = ladderPosition(anchorStageId, rail.ctx);
    const there = ladderPosition(shownStageId, rail.ctx);
    // An unknown position is treated as ahead: locked is the safe default when
    // the panel cannot prove the order has been there.
    if (here < 0 || there < 0) return 'AHEAD';
    return there < here ? 'PASSED' : 'AHEAD';
  }, [shownStageId, anchorStageId, rail.ctx]);

  /**
   * Every stage a requested step could be attached to, marked against where the
   * order is. Built here rather than in the dialog because the ladder depends on
   * this order's own flow — a re-planned or curtailed order must offer its own
   * sequence, not the standard one.
   */
  const insertPoints = useMemo(
    () =>
      applicableStages(rail.ctx).map((s) => {
        const pos = ladderPosition(s.id, rail.ctx);
        const herePos = ladderPosition(anchorStageId, rail.ctx);
        return {
          id: s.id,
          code: s.code,
          label: s.label,
          relation: (s.id === anchorStageId
            ? 'CURRENT'
            : pos >= 0 && herePos >= 0 && pos < herePos
              ? 'PASSED'
              : 'AHEAD') as 'PASSED' | 'CURRENT' | 'AHEAD',
        };
      }),
    [rail.ctx, anchorStageId],
  );

  /** Which gap the operator clicked +, and which manual step they opened. */
  const [insertAt, setInsertAt] = useState<{
    stageId: string;
    customStageId: string | null;
  } | null>(null);
  const [activeStep, setActiveStep] = useState<ManualStep | null>(null);

  const { label: pick } = usePreferences();
  const isEscrow = order.paymentMethod === 'ESCROW';
  /** The demo fixture, which alone gets a reset control. */
  const isDemoOrder = order.alias === DEMO_ORDER_ALIAS;
  const unread = order.communications.filter((c) => c.isUnread).length;

  /**
   * Evidence can be recorded for any stage this order's path includes — not only
   * the one it is sitting on — because corrections to earlier stages are normal.
   * Stages the order will never reach (the testing branch on an untested order)
   * are left out rather than offered and then refused.
   */
  const evidenceStages: StageOption[] = useMemo(() => {
    const reached = new Set(order.transitions.map((t) => t.toStage));
    return applicableStages({
      paymentMethod: order.paymentMethod as 'ESCROW',
      testingRequired: order.testingRequired,
      testScope: (order.testScope as 'LOT_SAMPLE' | null) ?? null,
      incoterms: order.incoterms,
    }).map((s) => ({
      id: s.id,
      code: s.code,
      label: s.label,
      reached: reached.has(s.id) || s.id === order.stage,
      isCurrent: s.id === order.stage,
    }));
  }, [order.transitions, order.paymentMethod, order.testingRequired, order.testScope, order.stage]);

  const evidenceRecords: EvidenceRecord[] = useMemo(
    () =>
      order.stageEvidence.map((e) => ({
        stageId: e.stageId,
        status: e.status,
        values: JSON.parse(e.values) as Record<string, string | number | boolean | null>,
        completedAt: e.completedAt,
        documents: e.documents.map((d) => ({
          id: d.id,
          docType: d.docType,
          fileName: d.fileName,
          sizeBytes: d.sizeBytes,
          version: d.version,
        })),
        revisions: e.revisions.map((r) => ({
          id: r.id,
          revision: r.revision,
          changeSummary: r.changeSummary,
          reason: r.reason,
          actorLabel: r.actorLabel,
          createdAt: r.createdAt,
        })),
      })),
    [order.stageEvidence],
  );

  /**
   * What the CURRENT stage is still missing.
   *
   * Lifted onto the front page rather than left on the evidence tab: the card
   * beside the checklist was a heading, a sentence and a button with a hand's
   * width of nothing between them, while the one thing an operator needs before
   * pressing that button — what is still outstanding — sat behind a tab.
   */
  const currentOutstanding = useMemo(() => {
    const rec = evidenceRecords.find((r) => r.stageId === order.stage);
    const a = assessEvidence(
      order.stage,
      (rec?.values ?? {}) as Record<string, unknown>,
      (rec?.documents ?? []).map((d) => d.docType),
    );
    return {
      complete: a.complete || a.notApplicable,
      fields: a.missingFields.map((f) => f.label),
      docs: a.missingDocs.map((d) => d.label),
    };
  }, [evidenceRecords, order.stage]);
  const openExceptions = order.exceptions.filter(
    (e) => e.status === 'OPEN' || e.status === 'IN_PROGRESS',
  );

  const tabs: TabDef[] = [
    { id: 'overview', label: 'Overview', plainLabel: 'Summary', icon: LayoutList },
    { id: 'flow', label: 'Flow', plainLabel: 'Progress', icon: Route },
    {
      id: 'lines',
      label: 'Line Items',
      plainLabel: 'Parts',
      icon: Boxes,
      count: order.customerPo.lines.length,
    },
    {
      id: 'documents',
      label: 'Documents',
      plainLabel: 'Files',
      icon: FileText,
      count: order.documents.length,
    },
    {
      id: 'escrow',
      label: 'Payments & Escrow',
      plainLabel: 'Money',
      icon: Landmark,
      disabledReason: isEscrow
        ? undefined
        : `This order is on ${order.paymentMethod.toLowerCase()} payment terms, so no escrow account is involved.`,
    },
    {
      id: 'testing',
      label: 'Testing',
      plainLabel: 'Lab testing',
      icon: FlaskConical,
      disabledReason: order.testingRequired
        ? undefined
        : 'No line item on this order requires testing, so nothing was sent to a lab.',
    },
    {
      id: 'logistics',
      label: 'Logistics',
      plainLabel: 'Shipping',
      icon: Truck,
      count: order.shipments.length,
      disabledReason:
        order.shipments.length > 0 ? undefined : 'Nothing has shipped on this order yet.',
    },
    {
      id: 'customs',
      label: 'Customs',
      plainLabel: 'Customs',
      icon: ShieldCheck,
      disabledReason: order.customsEntry
        ? undefined
        : 'No customs entry has been filed yet — the goods have not reached the border.',
    },
    {
      id: 'inspection',
      label: 'Inspection',
      plainLabel: 'Goods check',
      icon: ClipboardCheck,
      disabledReason:
        order.grns.length > 0 || order.inspections.length > 0
          ? undefined
          : 'The goods have not arrived with us yet, so there is nothing to inspect.',
    },
    {
      id: 'repack',
      label: 'Rebrand & Repack',
      plainLabel: 'Repacking',
      icon: Package,
      disabledReason:
        order.repackJobs.length > 0
          ? undefined
          : 'Repacking starts only after the inbound inspection passes.',
    },
    {
      id: 'tax',
      label: 'Invoicing & Tax',
      plainLabel: 'Bill & GST',
      icon: Receipt,
      disabledReason:
        order.taxInvoices.length > 0 || order.itcEntries.length > 0
          ? undefined
          : 'No invoice has been raised and no input credits recorded yet.',
    },
    {
      id: 'communication',
      label: 'Communication',
      plainLabel: 'Messages',
      icon: MessageSquare,
      count: order.communications.length,
    },
    { id: 'audit', label: 'Audit Log', plainLabel: 'History', icon: ScrollText },
    // Last on the strip deliberately. The evidence register is a reference view
    // over every stage; the day-to-day work happens in the tabs to its left, and
    // the form itself is reached from the Advance button, not from here.
    {
      id: 'evidence',
      label: 'Stage Evidence',
      plainLabel: 'Proof',
      icon: ClipboardCheck,
      count: order.stageEvidence.filter((e) => e.status === 'SUBMITTED').length,
    },
  ];

  return (
    <PageShell width="full">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="mb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-fg font-mono text-[19px] leading-tight font-semibold">
                {order.alias}
              </h1>
              <StatusChip status={order.status} />
              {!order.nameLocked && (
                <Hint
                  content={
                    <span>
                      Waiting for the supplier&apos;s proforma invoice. The Work Order name
                      completes automatically once it&apos;s recorded.
                    </span>
                  }
                >
                  <span>
                    <Chip tone="warning" size="sm">
                      SPI pending
                    </Chip>
                  </span>
                </Hint>
              )}
              {order.computed.sla.status !== 'ON_TRACK' && order.status !== 'CLOSED' && (
                <StatusChip status={order.computed.sla.status} />
              )}
            </div>
            <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-2">
              <span className="text-fg-tertiary text-[10.5px] font-semibold tracking-[0.05em] uppercase">
                Work order name
              </span>
              <InfoTooltip termKey="canonicalName" />
              <MonoId value={order.canonicalName} className="min-w-0" truncate />
            </div>
            {order.provisionalName && order.nameLocked && (
              <div className="text-fg-tertiary mt-1 text-[11px]">
                Previously{' '}
                <span className="font-mono">{order.provisionalName}</span> — still searchable.
              </div>
            )}
          </div>

          {/* min-w-0, NOT shrink-0. The parent wraps, so this row drops to its
              own line on a phone — but shrink-0 pinned it to its content width
              (463px against a 375px viewport) and its own flex-wrap could never
              engage. */}
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Chip tone={isEscrow ? 'accent' : 'neutral'}>
              {PAYMENT_METHOD_META[order.paymentMethod as 'ESCROW'].label}
            </Chip>
            {order.testingRequired && order.testScope && (
              <Chip tone="warning">{TEST_SCOPE_META[order.testScope as 'LOT_SAMPLE'].label}</Chip>
            )}
            <Chip tone="neutral">{order.incoterms}</Chip>
            <DocumentLink
              kind="work-order"
              id={order.id}
              label="Work order document"
              variant="button"
            />
            {/* Demo fixture only. The control deletes the order and everything
                hanging off it, so it is gated on the alias rather than on a role
                or a flag — there is no configuration under which it can appear on
                a real order. */}
            {isDemoOrder && (
              <DemoResetButton
                currentStageLabel={`${getStage(order.stage).code} ${getStage(order.stage).label}`}
              />
            )}
          </div>
        </div>
      </header>

      {/* ── Rail + next action ───────────────────────────────────────────────
          items-start keeps the two columns top-aligned, and exceptions render
          full width below rather than stacking tall in a narrow column and
          leaving the rail side empty. */}
      {/* The rail owns the full width of the canvas. Nothing sits beside it:
          it is the widest thing on the page — 7 phase tiles and up to 8 stage
          nodes — and a 320px companion column was squeezing the tiles until
          their labels truncated and the last stage wrapped onto its own line.
          Next action and the advance control read as a strip underneath. */}
      <div className="mb-3 min-w-0">
        <ResponsiveFlowRail
          data={rail}
          // Clicking a stage previews it in the Next Action panel rather than
          // navigating away — the question "what does that step need" is asked
          // far more often than "show me the flow tab".
          onStageClick={(stageId) => setPreview({ stageId, pinnedAt: order.stage })}
          onInsertStep={(stageId, customStageId) => setInsertAt({ stageId, customStageId })}
          onManualStepClick={setActiveStep}
          plan={{
            value: activePlan,
            saved: savedPlan,
            editing: planEditing,
            onEditingChange: setPlanEditing,
            onPropose: setDraftPlan,
            onReview: () => setPlanReviewOpen(true),
            onDiscard: () => setDraftPlan(null),
            disabled: order.status === 'CLOSED' || order.status === 'CANCELLED',
            disabledReason: `This order is ${order.status.toLowerCase()} — its flow is a record of the route it took, not a plan.`,
          }}
        />
      </div>

      {/* Two cards of equal height: what needs to happen, and the control that
          does it. Both use the same eyebrow / headline / action rhythm so their
          text sits on shared baselines rather than drifting apart. */}
      <div
        className={cn(
          'mb-3 grid min-w-0 items-stretch gap-3',
          order.status !== 'CLOSED' && order.status !== 'CANCELLED'
            ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]'
            : 'grid-cols-1',
        )}
      >
        <NextActionPanel
          workOrderId={order.id}
          currentStage={order.stage}
          viewStageId={shownStageId}
          relation={stageRelation}
          ctx={rail.ctx}
          isBlocked={order.status === 'BLOCKED' || Boolean(order.computed.branchStageId)}
          blockReason={order.exceptions.find((e) => e.status === 'OPEN')?.reason ?? null}
          stageEnteredAt={order.stageEnteredAt}
          // Every stage's evidence, so a looked-ahead stage shows its real state
          // rather than a blank checklist.
          evidence={evidenceRecords.map((r) => ({
            stageId: r.stageId,
            values: r.values as Record<string, unknown>,
            documents: r.documents.map((d) => ({ docType: d.docType })),
          }))}
          onOpenEvidence={() => setTab('evidence')}
          onBackToCurrent={() => setPreview(null)}
        />
        {order.status !== 'CLOSED' && order.status !== 'CANCELLED' && (
          <Panel className="flex h-full min-w-0 flex-col">
            <div className="text-fg-tertiary text-[10px] font-semibold tracking-[0.08em] uppercase">
              Move it on
            </div>
            <p className="text-fg mt-1.5 text-[13px] leading-snug font-medium">
              Records the step and everything it produces.
            </p>

            {/* ── What is still outstanding ──────────────────────────────────
                Fills the space this card used to leave empty, and answers the
                question actually being asked at the moment of pressing Advance:
                what is missing, and is it a form field or a piece of paper. */}
            {currentOutstanding.complete ? (
              <div className="border-success-border bg-success-subtle mt-3 flex items-start gap-2 rounded-[9px] border px-2.5 py-2">
                <CheckCircle2 className="text-success mt-px size-4 shrink-0" strokeWidth={2.2} aria-hidden />
                <span className="min-w-0">
                  <span className="text-success block text-[12px] font-semibold">
                    Everything for this stage is on file
                  </span>
                  <span className="text-fg-secondary mt-0.5 block text-[11.5px] leading-relaxed">
                    Nothing is outstanding, so the order can move on.
                  </span>
                </span>
              </div>
            ) : (
              <div className="border-warning-border bg-warning-subtle mt-3 min-h-0 flex-1 overflow-hidden rounded-[9px] border">
                <div className="text-warning border-warning-border/60 flex flex-wrap items-baseline gap-x-2 border-b px-2.5 py-1.5 text-[11.5px] font-semibold">
                  Still outstanding
                  <span className="text-fg-tertiary ml-auto text-[10.5px] font-normal">
                    {currentOutstanding.docs.length} document
                    {currentOutstanding.docs.length === 1 ? '' : 's'} ·{' '}
                    {currentOutstanding.fields.length} answer
                    {currentOutstanding.fields.length === 1 ? '' : 's'}
                  </span>
                </div>
                {/* Scrolls rather than stretching, so this card's height stays
                    tied to the checklist beside it however long the list is. */}
                <ul className="max-h-[104px] overflow-y-auto overscroll-contain px-2.5 py-1.5">
                  {/* Documents first, as everywhere else — they come from
                      somebody else and take the longest to chase. */}
                  {currentOutstanding.docs.map((d) => (
                    <li key={`d-${d}`} className="flex items-start gap-1.5 py-px">
                      <FileUp className="text-warning mt-[3px] size-3 shrink-0" strokeWidth={2.2} aria-hidden />
                      <span className="text-fg-secondary min-w-0 text-[11px] leading-snug">{d}</span>
                    </li>
                  ))}
                  {currentOutstanding.fields.map((f) => (
                    <li key={`f-${f}`} className="flex items-start gap-1.5 py-px">
                      <ClipboardList className="text-fg-tertiary mt-[3px] size-3 shrink-0" strokeWidth={2.2} aria-hidden />
                      <span className="text-fg-secondary min-w-0 text-[11px] leading-snug">{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-auto pt-2.5">
              <AdvanceControl
                workOrderId={order.id}
                currentStage={order.stage}
                currentStageCode={getStage(order.stage)?.code ?? ''}
                currentStageLabel={getStage(order.stage)?.label ?? order.stage}
                evidenceRecord={evidenceRecords.find((r) => r.stageId === order.stage)}
                ctx={rail.ctx}
                blocked={rail.isBlocked}
                financeApprovers={financeApprovers}
                inspectionPassed={order.inspections.some((i) => i.verdict === 'PASSED')}
              />
            </div>
          </Panel>
        )}
      </div>

      {/* Open exceptions are NOT repeated here. Each one is decided inside the tab
          that holds its evidence — a failed test in Testing, next to the lot that
          failed — and the decision is logged to Communication. The rail and the
          Next Action card only point there. */}
      {openExceptions.length > 0 && (
        <div className="border-danger-border bg-danger-subtle mb-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[10px] border px-3.5 py-2.5">
          <AlertTriangle className="text-danger size-4 shrink-0" strokeWidth={2.2} aria-hidden />
          <span className="text-danger text-[12.5px] font-semibold">
            {openExceptions.length === 1
              ? `${exceptionDef(openExceptions[0].type)?.label ?? 'A problem'} is blocking this order`
              : `${openExceptions.length} problems are blocking this order`}
          </span>
          <span className="text-fg-secondary min-w-0 flex-1 truncate text-[12px]">
            Decide it in the{' '}
            {[...new Set(openExceptions.map((e) => exceptionDef(e.type)?.ownerTab ?? 'overview'))]
              .map((t) => tabs.find((x) => x.id === t)?.label ?? t)
              .join(' and ')}{' '}
            tab.
          </span>
          {[...new Set(openExceptions.map((e) => exceptionDef(e.type)?.ownerTab ?? 'overview'))].map(
            (t) => (
              <Button
                key={t}
                size="sm"
                variant="danger"
                icon={ArrowRight}
                onClick={() => setTab(t)}
                className="shrink-0"
              >
                Go to {tabs.find((x) => x.id === t)?.label ?? t}
              </Button>
            ),
          )}
        </div>
      )}

      {/* ── Tabs ───────────────────────────────────────────────────────────── */}
      {/* ═══════════════════════════════════════════════════════════════════
          SECTION DRAWER (was a horizontal tab strip)

          Still Radix Tabs underneath, so keyboard roving focus, aria-selected /
          aria-controls, the disabled states and the URL sync all behave exactly
          as before — only the presentation changed.

          One list, styled responsively: a sticky card at lg and up, and the
          original horizontal scroller below it, because a 224px sidebar on a
          400px screen is unusable. Group headings hide on the narrow layout so
          the triggers flow in a row.

          To revert: set orientation back to horizontal, drop the grid wrapper and
          the group loop, and render `tabs.map(...)` straight into Tabs.List.
          ═══════════════════════════════════════════════════════════════════ */}
      <Tabs.Root
        value={tab}
        onValueChange={setTab}
        orientation="vertical"
        className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,232px)_minmax(0,1fr)]"
      >
        <Tabs.List
          className={cn(
            'border-line-subtle min-w-0 border-b pb-px',
            // Narrow: the original scrolling strip.
            'flex gap-0.5 overflow-x-auto',
            // Wide: a sticky card that stays with you down a long panel.
            'lg:bg-surface-1 lg:sticky lg:top-4 lg:flex-col lg:gap-0 lg:overflow-visible',
            'lg:rounded-[12px] lg:border lg:p-2 lg:pb-2',
          )}
        >
          {TAB_GROUPS.map((group, gi) => {
            const items = group.ids
              .map((id) => tabs.find((t) => t.id === id))
              .filter((t): t is TabDef => Boolean(t));
            if (items.length === 0) return null;
            return (
              <Fragment key={group.title}>
                <span
                  className={cn(
                    'text-fg-tertiary hidden text-[10px] font-semibold tracking-[0.07em] uppercase lg:block',
                    'px-2.5 pt-2 pb-1',
                    gi > 0 && 'border-line-subtle mt-1.5 border-t pt-2.5',
                  )}
                >
                  {group.title}
                </span>
                {items.map((t) => {
                  const disabled = Boolean(t.disabledReason);
                  const trigger = (
                    <Tabs.Trigger
                      value={t.id}
                      disabled={disabled}
                      className={cn(
                        'flex shrink-0 items-center gap-1.5 text-[12.5px] whitespace-nowrap transition-colors',
                        // Narrow: underline, as before.
                        'rounded-t-[8px] border-b-2 border-transparent px-2.5 py-2',
                        'data-[state=active]:border-accent data-[state=active]:text-accent-text data-[state=active]:font-medium',
                        // Wide: a full-width row whose active marker is a left
                        // edge — a bottom border on a vertical list points nowhere.
                        'lg:w-full lg:rounded-[8px] lg:border-b-0 lg:border-l-2 lg:py-1.5 lg:text-[13px]',
                        'lg:data-[state=active]:bg-accent-subtle lg:data-[state=active]:border-l-accent',
                        disabled
                          ? 'text-fg-tertiary cursor-not-allowed opacity-45'
                          : 'text-fg-secondary hover:text-fg hover:bg-surface-3',
                      )}
                    >
                      <t.icon className="size-3.5 shrink-0" strokeWidth={1.9} aria-hidden />
                      {/* Truncates rather than widening the drawer. */}
                      <span className="min-w-0 lg:truncate">{pick(t.label, t.plainLabel)}</span>
                      {/* Counts sit in their own right-hand column at lg, so they
                          line up down the list instead of trailing each label. */}
                      <span className="flex shrink-0 items-center gap-1 lg:ml-auto">
                        {typeof t.count === 'number' && t.count > 0 && (
                          <span className="bg-surface-3 text-fg-tertiary tnum rounded-full px-1.5 text-[10px]">
                            {t.count}
                          </span>
                        )}
                        {t.id === 'communication' && unread > 0 && (
                          <span className="bg-warning text-warning-fg tnum rounded-full px-1.5 text-[10px] font-semibold">
                            {unread}
                          </span>
                        )}
                        {disabled && <Ban className="size-3 shrink-0" aria-hidden />}
                      </span>
                    </Tabs.Trigger>
                  );
                  return disabled ? (
                    <Hint key={t.id} content={<span>{t.disabledReason}</span>}>
                      {/* span wrapper: a disabled trigger does not fire pointer events */}
                      <span className="shrink-0 lg:w-full">{trigger}</span>
                    </Hint>
                  ) : (
                    <span key={t.id} className="shrink-0 lg:w-full">
                      {trigger}
                    </span>
                  );
                })}
              </Fragment>
            );
          })}
        </Tabs.List>

        {/* Every panel, unchanged, in the right-hand column. */}
        <div className="min-w-0">
        <Tabs.Content value="overview" className="min-w-0 outline-none">
          <OverviewTab order={order} />
        </Tabs.Content>
        <Tabs.Content value="flow" className="min-w-0 outline-none">
          {/*
            Two sub-tabs rather than one stacked scroll, the same split Logistics
            makes and for the same reason: these answer two different questions.

            "What does this stage involve, and what is still outstanding" is a
            forward-looking question asked while working the order. "When did we
            pass stage four, who recorded it and how long did it sit" is a
            backward-looking audit question. Stacked, the reader had to scroll
            past all 36 steps — each with its sub-tasks and filed documents — to
            reach the history table.

            Steps leads because opening Flow is far more often the first question
            than the second.
          */}
          <Tabs.Root defaultValue="steps" className="grid min-w-0 grid-cols-1 gap-4">
            <Tabs.List
              aria-label="Flow views"
              className="border-line-subtle bg-surface-2 flex min-w-0 flex-wrap gap-0.5 self-start rounded-[9px] border p-0.5"
            >
              <SubTabTrigger
                value="steps"
                icon={LayoutList}
                label="Steps"
                count={applicableStages(rail.ctx).length}
              />
              <SubTabTrigger
                value="history"
                icon={HistoryIcon}
                label="Stage history"
                count={order.transitions.length}
              />
            </Tabs.List>

            <Tabs.Content value="steps" className="min-w-0 outline-none">
              <FlowStepsPanel
                currentStage={order.stage}
                ctx={rail.ctx}
                completedStageIds={order.computed.completedStageIds}
                evidence={evidenceRecords.map((r) => ({
                  stageId: r.stageId,
                  values: r.values as Record<string, unknown>,
                  documents: r.documents.map((d) => ({ docType: d.docType })),
                }))}
                documents={order.documents.map((d) => ({
                  id: d.id,
                  docType: d.docType,
                  title: d.title,
                  fileName: d.fileName,
                  stageId: d.stageId,
                  createdAt: d.createdAt,
                  uploadedBy: d.uploadedBy,
                  version: d.version,
                  sizeBytes: d.sizeBytes,
                  bodyText: d.bodyText,
                }))}
                manualSteps={order.customStages}
                orderAlias={order.alias}
                refs={{
                  customerPo: order.customerPo.poNumber,
                  supplierPo: order.supplierPo.poNumber,
                  customer: order.customerPo.customer.name,
                  supplier: order.supplierPo.supplier.name,
                }}
              />
            </Tabs.Content>

            <Tabs.Content value="history" className="min-w-0 outline-none">
              <FlowTab order={order} ctx={rail.ctx} />
            </Tabs.Content>
          </Tabs.Root>
        </Tabs.Content>
        <Tabs.Content value="lines" className="min-w-0 outline-none">
          <LineItemsTab order={order} />
        </Tabs.Content>
        <Tabs.Content value="documents" className="min-w-0 outline-none">
          <DocumentsTab order={order} />
        </Tabs.Content>
        <Tabs.Content value="evidence" className="min-w-0 outline-none">
          <StageEvidencePanel
            workOrderId={order.id}
            initialStageId={order.stage}
            stages={evidenceStages}
            records={evidenceRecords}
          />
        </Tabs.Content>
        <Tabs.Content value="escrow" className="min-w-0 outline-none">
          <EscrowTab order={order} financeApprovers={financeApprovers} />
        </Tabs.Content>
        <Tabs.Content value="testing" className="min-w-0 outline-none">
          <TestingTab order={order} exceptions={openExceptions} />
        </Tabs.Content>
        <Tabs.Content value="logistics" className="min-w-0 outline-none">
          <LogisticsTab order={order} />
        </Tabs.Content>
        <Tabs.Content value="customs" className="min-w-0 outline-none">
          <CustomsTab order={order} />
        </Tabs.Content>
        <Tabs.Content value="inspection" className="min-w-0 outline-none">
          <InspectionTab order={order} />
        </Tabs.Content>
        <Tabs.Content value="repack" className="min-w-0 outline-none">
          <RepackTab order={order} />
        </Tabs.Content>
        <Tabs.Content value="tax" className="min-w-0 outline-none">
          <TaxTab order={order} />
        </Tabs.Content>
        <Tabs.Content value="communication" className="min-w-0 outline-none">
          <CommunicationTab order={order} />
        </Tabs.Content>
        <Tabs.Content value="audit" className="min-w-0 outline-none">
          <AuditTab order={order} />
        </Tabs.Content>
        </div>
      </Tabs.Root>

      {/* Both are driven from the rail: + between two stages, or clicking an
          inserted step. Mounted here, outside the tab panels, so neither closes
          when the operator switches tabs behind it. */}
      {insertAt && (
        <InsertStepDialog
          workOrderId={order.id}
          afterStage={{
            id: insertAt.stageId,
            code: getStage(insertAt.stageId)?.code ?? '',
            label: getStage(insertAt.stageId)?.label ?? insertAt.stageId,
          }}
          afterCustomStageId={insertAt.customStageId}
          // The whole flow, so the position can be changed inside the dialog and
          // the order's own position is visible while choosing.
          stages={insertPoints}
          onOpenChange={(open) => !open && setInsertAt(null)}
        />
      )}
      {activeStep && (
        <ManualStepDialog
          step={activeStep}
          onOpenChange={(open) => !open && setActiveStep(null)}
        />
      )}
      {planReviewOpen && (
        <FlowPlanDialog
          workOrderId={order.id}
          orderAlias={order.alias}
          saved={savedPlan}
          proposed={activePlan}
          ctx={rail.ctx}
          onOpenChange={setPlanReviewOpen}
          onSaved={() => {
            // The draft has become the saved plan, so it is no longer pending —
            // and edit mode has served its purpose.
            setDraftPlan(null);
            setPlanEditing(false);
          }}
        />
      )}
    </PageShell>
  );
}


// ═══════════════════════════════════════════════════════════════════════════
// Overview
// ═══════════════════════════════════════════════════════════════════════════

function OverviewTab({ order }: { order: OrderDetail }) {
  const m = order.computed.margin;
  const docs = [
    {
      label: "Customer's order",
      termKey: 'workOrder',
      number: order.customerPo.poNumber,
      date: order.customerPo.poDate,
      value: order.customerPo.totalValue,
      currency: 'INR',
      status: order.customerPo.status,
      stakeholder: 'CUSTOMER' as const,
      // The customer's own purchase order is their paper, not ours — we hold it
      // as a scan, so there is nothing for us to generate.
      print: null,
    },
    {
      label: 'Our quote (PI)',
      termKey: 'proformaInvoice',
      number: order.customerPi?.piNumber ?? '—',
      date: order.customerPi?.piDate ?? null,
      value: order.customerPi?.totalValue ?? 0,
      currency: 'INR',
      status: order.customerPi?.status ?? 'NOT_ISSUED',
      stakeholder: 'ONE_BUY_SOURCING' as const,
      print: order.customerPi ? ({ kind: 'proforma-invoice', id: order.customerPi.id } as const) : null,
    },
    {
      label: 'Our order to supplier',
      number: order.supplierPo.poNumber,
      date: order.supplierPo.poDate,
      value: order.supplierPo.totalValue,
      currency: order.supplierPo.currency,
      status: order.supplierPo.status,
      stakeholder: 'ONE_BUY_SOURCING' as const,
      print: ({ kind: 'purchase-order', id: order.supplierPo.id } as const),
    },
    {
      label: "Supplier's quote (PI)",
      number: order.supplierPi?.piNumber ?? 'Pending',
      date: order.supplierPi?.piDate ?? null,
      value: order.supplierPi?.totalValue ?? 0,
      currency: order.supplierPo.currency,
      status: order.supplierPi?.status ?? 'PENDING',
      stakeholder: 'SUPPLIER' as const,
      print: order.supplierPi ? ({ kind: 'proforma-invoice', id: order.supplierPi.id } as const) : null,
    },
  ];

  const totalQty = order.customerPo.lines.reduce((a, l) => a + l.quantity, 0);
  const testedLines = order.customerPo.lines.filter((l) => l.testingRequired).length;

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      {/*
        What the order IS, before what it is worth or where it stands.
        
        The full breakdown lives on Line Items, with prices, margin and lot
        codes. But "which parts?" is the first question anyone asks about an
        order, and answering it should not require knowing which of fourteen
        tabs to open. This is the answer, not a summary of it — every line is
        here, with its quantity.
      */}
      <Panel padded={false}>
        <div className="p-4 pb-0">
          <PanelHeader
            title="Parts on this order"
            description={`${order.customerPo.lines.length} line${order.customerPo.lines.length === 1 ? '' : 's'}, ${totalQty.toLocaleString('en-IN')} pieces${
              testedLines > 0 ? ` · ${testedLines} going to the laboratory` : ''
            }. Prices, margin and lot codes are on Line Items.`}
          />
        </div>
        {order.customerPo.lines.length === 0 ? (
          <EmptyState
            title="No lines yet"
            description="Nothing has been added to the customer's purchase order."
          />
        ) : (
          <ul className="min-w-0 px-4 pb-4">
            {order.customerPo.lines.map((l) => (
              <li
                key={l.id}
                className="border-line-subtle flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b py-2 last:border-b-0"
              >
                <span className="text-fg shrink-0 font-mono text-[12.5px] font-medium">{l.mpn}</span>
                <span className="text-fg-secondary shrink-0 text-[12px]">{l.manufacturer}</span>
                <span className="text-fg-tertiary min-w-0 flex-1 truncate text-[12px]">
                  {l.description}
                </span>
                {/* Testing is per line: an order can send two of three parts
                    to the lab, and the third must not look tested because the
                    ORDER was. */}
                {l.testingRequired && (
                  <Chip tone="info" size="sm">
                    Lab tested
                  </Chip>
                )}
                <span className="tnum text-fg shrink-0 text-[12.5px] font-medium">
                  {l.quantity.toLocaleString('en-IN')} {l.uom}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel>
        <PanelHeader
          title="The four linked documents"
          description="This is what the work order name is built from — customer PO, our PI, our PO, supplier PI."
        />
        <ul className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
          {docs.map((d) => (
            <li
              key={d.label}
              className="border-line-subtle bg-surface-inset min-w-0 rounded-[10px] border p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-fg-tertiary truncate text-[10.5px] font-semibold tracking-[0.04em] uppercase">
                  {d.label}
                </span>
                <StakeholderBadge stakeholder={d.stakeholder} short />
              </div>
              <div className="mt-1.5 flex items-center gap-1.5">
                <MonoId value={d.number} truncate />
                {d.termKey && <InfoTooltip termKey={d.termKey} />}
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-fg-tertiary text-[11px]">{formatDate(d.date)}</span>
                <StatusChip status={d.status} size="sm" />
              </div>
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                <span className="text-fg text-[13px] font-semibold">
                  <Money amount={d.value} currency={d.currency} />
                </span>
                {d.print && <DocumentLink kind={d.print.kind} id={d.print.id} label="Document" />}
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      <SourcingCoveragePanel order={order} />

      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHeader
            title="Commercials"
            description="Landed cost deliberately excludes recoverable taxes, so margin is the real figure."
            termKey="landedCost"
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <KeyValue label="Sell value" termKey="sellValue">
              <Money amount={order.sellValue} />
            </KeyValue>
            <KeyValue label="Buy value" termKey="buyValue">
              <Money amount={order.buyValue} />
            </KeyValue>
            <KeyValue label="Landed cost" termKey="landedCost">
              <Money amount={m.landedCost} />
            </KeyValue>
            <KeyValue label="True margin" termKey="trueMargin">
              <span className="flex flex-wrap items-baseline gap-1.5">
                <Money amount={m.trueMargin} tone="auto" />
                <Pct value={m.trueMarginPct} tone="auto" className="text-[11px]" />
                {m.belowFloor && (
                  <Chip tone="danger" size="sm">
                    Below floor
                  </Chip>
                )}
              </span>
            </KeyValue>
            <KeyValue label="Before tax credits" termKey="marginBeforeCredits">
              <span className="flex flex-wrap items-baseline gap-1.5">
                <Money amount={m.marginBeforeCredits} tone="auto" />
                <Pct value={m.marginBeforeCreditsPct} className="text-fg-tertiary text-[11px]" />
              </span>
            </KeyValue>
            <KeyValue label="Recoverable taxes" termKey="itc">
              <Money amount={m.creditableTaxes} className="text-success" />
            </KeyValue>
          </div>

          <div className="border-line-subtle mt-3 border-t pt-3">
            <SectionLabel>What landed cost is made of</SectionLabel>
            <ul className="grid gap-1">
              {order.computed.landed.components
                .filter((c) => c.amount !== 0)
                .map((c) => (
                  <li key={c.key} className="flex min-w-0 items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      {c.included ? (
                        <Check className="text-success size-3 shrink-0" strokeWidth={3} aria-hidden />
                      ) : (
                        <Ban className="text-fg-tertiary size-3 shrink-0" aria-hidden />
                      )}
                      <Hint content={<span>{c.reason}</span>}>
                        <span
                          className={cn(
                            'truncate text-[12px]',
                            c.included ? 'text-fg-secondary' : 'text-fg-tertiary line-through',
                          )}
                        >
                          {c.label}
                        </span>
                      </Hint>
                    </span>
                    <Money
                      amount={c.amount}
                      className={cn('shrink-0 text-[12px]', !c.included && 'text-fg-tertiary')}
                    />
                  </li>
                ))}
            </ul>
            <p className="text-fg-tertiary mt-2 text-[11px] leading-relaxed">
              Struck-through lines are recoverable as Input Tax Credit, so they are excluded from
              cost. Counting them would understate margin on every import.
            </p>
          </div>
        </Panel>

        <div className="grid min-w-0 grid-cols-1 gap-4">
          <Panel>
            <PanelHeader title="Who is involved" />
            {/* Fixed-width tiles in a horizontal scroller rather than a grid, so
                the addresses and registration numbers keep their size on a narrow
                viewport instead of shrinking until they stop being readable. */}
            <div className="-mx-1 flex min-w-0 snap-x gap-2.5 overflow-x-auto px-1 pb-1">
              <PartyCard
                stakeholder="CUSTOMER"
                name={order.customerPo.customer.name}
                lines={[
                  order.customerPo.customer.contactName,
                  order.customerPo.customer.contactEmail,
                  `${order.customerPo.customer.city}, ${order.customerPo.customer.stateName}`,
                  order.customerPo.customer.gstin
                    ? `GSTIN ${order.customerPo.customer.gstin}`
                    : 'No GSTIN on file',
                ]}
                badges={[
                  order.customerPo.customer.isSez ? 'SEZ unit' : null,
                  order.customerPo.customer.paymentTerms,
                ].filter(Boolean) as string[]}
                fixedWidth
              />
              <PartyCard
                stakeholder="SUPPLIER"
                name={order.supplierPo.supplier.name}
                lines={[
                  order.supplierPo.supplier.contactName,
                  order.supplierPo.supplier.contactEmail,
                  `${order.supplierPo.supplier.city}, ${order.supplierPo.supplier.country}`,
                  order.supplierPo.supplier.gstin
                    ? `GSTIN ${order.supplierPo.supplier.gstin}`
                    : 'Overseas supplier — no GSTIN',
                ]}
                badges={[
                  order.supplierPo.supplier.isForeign ? 'Import' : 'Domestic',
                  order.incoterms,
                ]}
                fixedWidth
              />
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Key dates & terms" />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <KeyValue label="RFQ / Sourcing ID" termKey="sourcingRef">
                {order.customerPo.sourcingRef ?? order.supplierPo.sourcingRef ? (
                  <MonoId
                    value={(order.customerPo.sourcingRef ?? order.supplierPo.sourcingRef)!}
                    truncate
                  />
                ) : (
                  'Not from an enquiry'
                )}
              </KeyValue>
              <KeyValue label="Order created">{formatDate(order.createdAt)}</KeyValue>
              <KeyValue label="Terms locked" termKey="fxRate">
                {order.termsLockedAt ? formatDate(order.termsLockedAt) : 'Not yet'}
              </KeyValue>
              <KeyValue label="Customer wants by">
                {formatDate(order.customerPo.requestedDeliveryDate)}
              </KeyValue>
              <KeyValue label="Exchange rate" termKey="fxRate">
                1 {order.buyCurrency} = {order.fxRate.toFixed(2)} INR
              </KeyValue>
              <KeyValue label="Coverage" termKey="coverage">
                <Pct value={order.computed.coveragePct} />
              </KeyValue>
              <KeyValue label="Time in current stage" termKey="slaStatus">
                {humanDuration(order.computed.sla.hoursInStage)}
              </KeyValue>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function PartyCard({
  stakeholder,
  name,
  lines,
  badges,
  fixedWidth,
  muted,
  href,
}: {
  stakeholder: 'CUSTOMER' | 'SUPPLIER';
  name: string;
  lines: string[];
  badges: string[];
  /** Holds its width in a scroller instead of shrinking with the container. */
  fixedWidth?: boolean;
  /** A party on a sibling work order, not this one. */
  muted?: boolean;
  href?: string;
}) {
  const body = (
    <>
      <StakeholderBadge stakeholder={stakeholder} />
      <div className="text-fg mt-1.5 truncate text-[13px] font-semibold">{name}</div>
      <ul className="mt-1 space-y-0.5">
        {lines.map((l) => (
          <li key={l} className="text-fg-tertiary truncate text-[11.5px]">
            {l}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap gap-1">
        {badges.map((b) => (
          <Chip key={b} size="sm">
            {b}
          </Chip>
        ))}
      </div>
    </>
  );

  const cls = cn(
    'border-line-subtle bg-surface-inset rounded-[10px] border p-3',
    fixedWidth ? 'w-[268px] shrink-0 snap-start' : 'min-w-0',
    muted && 'opacity-70',
    href && 'hover:border-line-strong hover:opacity-100 block text-left transition-colors',
  );

  return href ? (
    <Link href={href} className={cls} title={`Open ${name}’s work order`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════
// Flow
// ═══════════════════════════════════════════════════════════════════════════

function FlowTab({ order, ctx }: { order: OrderDetail; ctx: StageContext }) {
  const rows = [...order.transitions].reverse();
  return (
    <Panel padded={false}>
      <div className="p-4 pb-0">
        <PanelHeader
          title="Stage history"
          description="Every stage change, who recorded it, where the record came from, and how long the order sat at the previous stage."
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-[12.5px]">
          <thead className="bg-surface-inset">
            <tr className="border-line-subtle border-y">
              <Th width="60px">Step</Th>
              <Th width="70px">Phase</Th>
              <Th termKey="stage">Stage</Th>
              <Th width="150px">Responsible party</Th>
              <Th width="180px">Recorded by</Th>
              <Th termKey="provenance" width="120px">
                Source
              </Th>
              <Th align="right" width="150px">
                Time at previous stage
              </Th>
              <Th align="right" width="170px">
                Date and time
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const stage = getStage(t.toStage);
              return (
                <tr key={t.id} className="border-line-subtle border-b last:border-0">
                  <td className="text-fg-tertiary px-3 py-2 font-mono text-[11px]">{stage.code}</td>
                  <td className="text-fg-secondary px-3 py-2">
                    {PHASE_DEFS[stage.phase].label}
                  </td>
                  <td className="text-fg px-3 py-2 font-medium">{stage.label}</td>
                  <td className="px-3 py-2">
                    <StakeholderBadge stakeholder={stageOwner(stage, ctx)} />
                  </td>
                  <td className="text-fg-secondary px-3 py-2">{t.actorLabel}</td>
                  <td className="px-3 py-2">
                    <ProvenanceBadge
                      provenance={t.provenance}
                      actor={t.actorLabel}
                      at={t.createdAt}
                    />
                  </td>
                  <td className="tnum text-fg-secondary px-3 py-2 text-right">
                    {t.durationSecondsInPrevious != null
                      ? humanDuration(t.durationSecondsInPrevious / 3600)
                      : '—'}
                  </td>
                  <td className="tnum text-fg-tertiary px-3 py-2 text-right whitespace-nowrap">
                    {formatDateTime(t.createdAt)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="bg-surface-inset">
            <tr className="border-line-subtle border-t font-semibold">
              <td className="px-3 py-2" colSpan={6}>
                {rows.length} stage change{rows.length === 1 ? '' : 's'} recorded
              </td>
              <td className="tnum px-3 py-2 text-right">
                {humanDuration(
                  rows.reduce((a, t) => a + (t.durationSecondsInPrevious ?? 0) / 3600, 0),
                )}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Line items
// ═══════════════════════════════════════════════════════════════════════════

/**
 * How much of the customer's order has actually been bought.
 *
 * Shown only when there is a gap. The work order covers what we purchased; the
 * customer ordered some quantity, and those two are not automatically the same
 * number. An operator looking at a healthy-looking job has no other way of
 * seeing that a slice of what the customer asked for was never bought at all.
 *
 * Coverage is read from `coverageByLine`, which counts allocations against the
 * CUSTOMER's line — so it stays correct if a line is ever covered by more than
 * one purchase.
 */
function SourcingCoveragePanel({ order }: { order: OrderDetail }) {
  const orderedQty = order.customerPo.lines.reduce((a, l) => a + l.quantity, 0);
  const coveredQty = order.customerPo.lines.reduce(
    (a, l) => a + Math.min(l.quantity, order.coverageByLine[l.id] ?? 0),
    0,
  );
  const shortfallQty = Math.max(0, orderedQty - coveredQty);

  // Nothing to explain when the whole order was bought.
  if (shortfallQty === 0) return null;

  const pct = (q: number) => (orderedQty > 0 ? (q / orderedQty) * 100 : 0);
  /** Which customer lines are still short, and by how much. */
  const shortLines = order.customerPo.lines
    .map((l) => {
      const covered = order.coverageByLine[l.id] ?? 0;
      return { l, covered, short: Math.max(0, l.quantity - covered) };
    })
    .filter((x) => x.short > 0);

  return (
    <Panel>
      <PanelHeader
        title="Sourcing this customer order"
        termKey="coverage"
        description={`Part of ${order.customerPo.poNumber} has not been bought yet.`}
      />

      {/* Where the customer's order actually is, in one bar. */}
      <div className="mb-3">
        <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="text-fg text-[12.5px] font-medium">
            {coveredQty.toLocaleString('en-IN')} of {orderedQty.toLocaleString('en-IN')} units bought
          </span>
          <span className="text-warning text-[11.5px] font-medium">
            {shortfallQty.toLocaleString('en-IN')} still to source
          </span>
        </div>
        <div className="bg-surface-3 flex h-2.5 w-full overflow-hidden rounded-full">
          <Hint
            content={
              <span>
                Bought — {coveredQty.toLocaleString('en-IN')} units ({pct(coveredQty).toFixed(1)}%)
              </span>
            }
          >
            <span className="bg-accent h-full transition-[width]" style={{ width: `${pct(coveredQty)}%` }} />
          </Hint>
          {/* The gap is drawn, not left as empty track. An unfilled tail reads as
              "the bar ends here"; a warning-toned segment reads as "this part is
              missing", which is what it is. */}
          <Hint
            content={
              <span>
                Not bought — {shortfallQty.toLocaleString('en-IN')} units (
                {pct(shortfallQty).toFixed(1)}%)
              </span>
            }
          >
            <span
              className="bg-warning/45 border-surface-1 h-full border-l-2"
              style={{ width: `${pct(shortfallQty)}%` }}
            />
          </Hint>
        </div>
      </div>

      <div className="border-warning/40 bg-warning-subtle rounded-[9px] border px-3 py-2.5">
        <div className="text-warning flex items-center gap-1.5 text-[12px] font-semibold">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
          {shortfallQty.toLocaleString('en-IN')} units have not been bought
        </div>
        <ul className="text-fg-secondary mt-1.5 grid gap-0.5 text-[11.5px] leading-relaxed">
          {shortLines.map(({ l, covered, short }) => (
            <li key={l.id} className="min-w-0">
              <span className="font-mono text-[11px]">{l.mpn}</span> — {short.toLocaleString('en-IN')}{' '}
              of {l.quantity.toLocaleString('en-IN')} not bought
              {covered > 0 ? ` (${covered.toLocaleString('en-IN')} covered)` : ' (nothing bought yet)'}
            </li>
          ))}
        </ul>
        <p className="text-fg-tertiary mt-1.5 text-[11.5px] leading-relaxed">
          Normal while sourcing is still in progress. It becomes a problem if the gap is still open
          near {formatDate(order.customerPo.requestedDeliveryDate)}, the date the customer wants
          delivery. Close it from Created Purchase Orders → the customer order&rsquo;s sourcing view.
        </p>
      </div>
    </Panel>
  );
}

function LineItemsTab({ order }: { order: OrderDetail }) {
  /**
   * One row per ALLOCATION, not per customer line.
   *
   * This used to render one row per customer line and print the customer's full
   * ordered quantity and full line value against it. On a split order that is
   * wrong twice over: it claims this job covers 6,000 pieces when it covers
   * 3,500, and it books the whole line's revenue to every one of the three work
   * orders — so the three of them together appeared to sell three times what the
   * customer bought. What this job is answerable for is its allocations.
   */
  const rows = order.mappings
    .map((m) => {
      const cl = order.customerPo.lines.find((l) => l.id === m.customerPoLineId);
      const sl = order.supplierPo.lines.find((l) => l.id === m.supplierPoLineId);
      return cl && sl ? { m, cl, sl } : null;
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => a.cl.lineNo - b.cl.lineNo || a.sl.lineNo - b.sl.lineNo);

  // Customer lines this job does not touch at all — nothing was bought for them.
  const untouched = order.customerPo.lines.filter(
    (l) => !order.mappings.some((m) => m.customerPoLineId === l.id),
  );
  const allocatedTotal = rows.reduce((a, r) => a + r.m.allocatedQty, 0);

  return (
    <Panel padded={false}>
      <div className="p-4 pb-0">
        <PanelHeader
          title="Parts on this order"
          description="Customer side and supplier side, mapped line by line with the margin on each."

        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-[12.5px]">
          <thead className="bg-surface-inset">
            <tr className="border-line-subtle border-y">
              <Th termKey="mpn">Part number</Th>
              <Th termKey="hsnCode">HSN</Th>
              <Th align="right" termKey="quantity">
                Qty on this order
              </Th>
              <Th align="right" termKey="unitPrice">
                Sell price
              </Th>
              <Th align="right">Buy price</Th>
              <Th align="right">Sell total</Th>
              <Th align="right">Margin</Th>
              <Th termKey="testingRequired">Testing</Th>
              <Th termKey="dateCodeLot">Date code / lot</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ m, cl, sl }) => {
              const buyInInr = sl.unitPrice * order.fxRate;
              const marginPerUnit = cl.unitPrice - buyInInr;
              const marginPct = cl.unitPrice > 0 ? (marginPerUnit / cl.unitPrice) * 100 : 0;
              return (
                <tr key={m.id} className="border-line-subtle border-b last:border-0">
                  <td className="px-3 py-2">
                    <div className="font-mono text-[12px] font-medium">{cl.mpn}</div>
                    <div className="text-fg-tertiary truncate text-[11px]">{cl.manufacturer}</div>
                  </td>
                  <td className="px-3 py-2 font-mono text-[11.5px]">{cl.hsnCode}</td>
                  <td className="tnum px-3 py-2 text-right">
                    {m.allocatedQty.toLocaleString('en-IN')}
                  </td>
                  <td className="tnum px-3 py-2 text-right">{cl.unitPrice}</td>
                  <td className="tnum px-3 py-2 text-right">
                    {order.supplierPo.currency} {sl.unitPrice}
                  </td>
                  <td className="tnum px-3 py-2 text-right">
                    {/* The allocated share, not the whole customer line. */}
                    <Money amount={Math.round(m.allocatedQty * cl.unitPrice * 100)} withCode={false} />
                  </td>
                  <td className="tnum px-3 py-2 text-right">
                    <span
                      className={cn(
                        marginPct < 0 ? 'text-danger' : marginPct < 8 ? 'text-warning' : 'text-success',
                      )}
                    >
                      {marginPct.toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {cl.testingRequired ? (
                      <Chip tone="warning" size="sm">
                        {sl.testScope ? TEST_SCOPE_META[sl.testScope as 'LOT_SAMPLE'].label : 'Required'}
                      </Chip>
                    ) : (
                      <span className="text-fg-tertiary text-[11.5px]">No</span>
                    )}
                  </td>
                  <td className="text-fg-secondary px-3 py-2 font-mono text-[11px]">
                    {sl.dateCodeLot ?? '—'}
                  </td>
                </tr>
              );
            })}
            {/* Named rather than omitted: a line missing from this table without
                explanation reads as a data error. */}
            {untouched.map((l) => {
              const coveredAll = order.coverageByLine[l.id] ?? 0;
              return (
              <tr key={l.id} className="border-line-subtle bg-surface-inset/50 border-b last:border-0">
                <td className="px-3 py-2">
                  <div className="text-fg-tertiary font-mono text-[12px]">{l.mpn}</div>
                  <div className="text-fg-tertiary truncate text-[11px]">{l.manufacturer}</div>
                </td>
                <td className="px-3 py-2 font-mono text-[11.5px]">{l.hsnCode}</td>
                <td className="text-fg-tertiary px-3 py-2 text-right text-[11.5px]">—</td>
                {/* 3 leading cells of 9, so colSpan 6 reaches the last column. */}
                <td className="text-fg-tertiary px-3 py-2 text-right text-[11.5px]" colSpan={6}>
                  {coveredAll === 0
                    ? `Nothing bought against this line yet — ${l.quantity.toLocaleString('en-IN')} still to source`
                    : `Not on this order — ${coveredAll.toLocaleString('en-IN')} bought, ${Math.max(0, l.quantity - coveredAll).toLocaleString('en-IN')} still to source`}
                </td>
              </tr>
              );
            })}
          </tbody>
          <tfoot className="bg-surface-inset">
            <tr className="border-line-subtle border-t font-semibold">
              <td className="px-3 py-2" colSpan={2}>
                Total
              </td>
              <td className="tnum px-3 py-2 text-right">
                {allocatedTotal.toLocaleString('en-IN')}
              </td>
              <td />
              <td />
              <td className="tnum px-3 py-2 text-right">
                <Money amount={order.sellValue} withCode={false} />
              </td>
              <td className="tnum px-3 py-2 text-right">
                <Pct value={order.computed.margin.trueMarginPct} tone="auto" />
              </td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
    </Panel>
  );
}

function Th({
  children,
  termKey,
  align = 'left',
  width,
}: {
  children: React.ReactNode;
  termKey?: string;
  align?: 'left' | 'right';
  width?: string;
}) {
  return (
    <th
      scope="col"
      style={width ? { width } : undefined}
      className={cn(
        'text-fg-tertiary px-3 py-2 text-[10.5px] font-semibold tracking-[0.04em] whitespace-nowrap uppercase',
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

// ═══════════════════════════════════════════════════════════════════════════
// Documents
// ═══════════════════════════════════════════════════════════════════════════

function DocumentsTab({ order }: { order: OrderDetail }) {
  /** Which filed document the sheet viewer has open, if any. */
  const [sheetDoc, setSheetDoc] = useState<SheetDoc | null>(null);
  /**
   * The documents this platform produces itself, on paper we control. Each opens
   * in the viewer, so the sheet can be read without leaving the order.
   *
   * The customer's own purchase order is deliberately absent: that is their
   * paper and we hold it as a received file, not something we can regenerate.
   */
  const generated: {
    label: string;
    number: string;
    kind: PrintableKind;
    id: string;
    note: string;
  }[] = [
    // The work order itself is deliberately absent. It is an internal job sheet,
    // not correspondence, so it lives on the button in this order's header rather
    // than in a list of documents that go to customers and suppliers.
    {
      label: 'Our purchase order to the supplier',
      number: order.supplierPo.poNumber,
      kind: 'purchase-order',
      id: order.supplierPo.id,
      note: 'The voucher the supplier acts on.',
    },
    ...(order.customerPi
      ? [
          {
            label: 'Our proforma invoice to the customer',
            number: order.customerPi.piNumber,
            kind: 'proforma-invoice' as const,
            id: order.customerPi.id,
            note: 'Our quote. Terms lock when the customer accepts it.',
          },
        ]
      : []),
    ...(order.supplierPi
      ? [
          {
            label: "The supplier's proforma invoice",
            number: order.supplierPi.externalRef ?? order.supplierPi.piNumber,
            kind: 'proforma-invoice' as const,
            id: order.supplierPi.id,
            note: 'What the supplier quoted us, including their bank details for payment.',
          },
        ]
      : []),
  ];

  /** Filed documents that map onto a sheet we can render. */
  const viewerFor = (docType: string): { kind: PrintableKind; id: string } | null => {
    if (docType === 'SUPPLIER_PO') return { kind: 'purchase-order', id: order.supplierPo.id };
    if (docType === 'CUSTOMER_PI' && order.customerPi)
      return { kind: 'proforma-invoice', id: order.customerPi.id };
    if (docType === 'SUPPLIER_PI' && order.supplierPi)
      return { kind: 'proforma-invoice', id: order.supplierPi.id };
    return null;
  };

  /**
   * One table, not two panels. Every document that exists against this order is
   * a row with the same variable heads, whether we generated it or a stage filed
   * it — an operator comparing paperwork should read down one column, not across
   * two differently shaped lists.
   */
  const generatedIds = new Set(generated.map((g) => `${g.kind}:${g.id}`));
  type Row = {
    key: string;
    document: string;
    reference: string;
    onOurPaper: boolean;
    filedAt: string | null;
    fileName: string | null;
    sizeKb: number | null;
    version: number | null;
    provenance: string | null;
    actor: string | null;
    view: { kind: PrintableKind; id: string } | null;
    purpose: string | null;
    /**
     * The filed record, for documents that have no printable of their own.
     *
     * Most of what a stage files is not something we generate — a bill of
     * entry, a test report, a proof of delivery. Those used to end the row with
     * "Not generated here", which is true and useless: the document IS here,
     * with its content, and a register that cannot open its own rows is a list
     * of filenames.
     */
    sheet: SheetDoc | null;
  };

  const rows: Row[] = [
    ...generated.map((g) => ({
      key: `gen:${g.kind}:${g.id}`,
      document: g.label,
      reference: g.number,
      onOurPaper: true,
      filedAt: null,
      fileName: null,
      sizeKb: null,
      version: null,
      provenance: null,
      actor: null,
      view: { kind: g.kind, id: g.id },
      purpose: g.note,
      sheet: null,
    })),
    ...order.documents
      // A filed copy of a document we also generate would be the same sheet
      // twice; the generated row already links to the live version.
      .filter((d) => {
        const v = viewerFor(d.docType);
        return !v || !generatedIds.has(`${v.kind}:${v.id}`);
      })
      .map((d) => ({
        key: `filed:${d.id}`,
        document: d.title,
        reference: d.docType.replace(/_/g, ' ').toLowerCase(),
        onOurPaper: false,
        filedAt: d.createdAt,
        fileName: d.fileName,
        sizeKb: Math.round(d.sizeBytes / 1024),
        version: d.version,
        provenance: d.provenance,
        actor: d.uploadedBy,
        view: viewerFor(d.docType),
        purpose: null,
        sheet: {
          id: d.id,
          docType: d.docType,
          kindLabel: d.docType.replace(/_/g, ' ').toLowerCase(),
          title: d.title,
          fileName: d.fileName,
          uploadedBy: d.uploadedBy,
          createdAt: d.createdAt,
          version: d.version,
          sizeBytes: d.sizeBytes,
          stepLabel: d.stageId ? `${getStage(d.stageId).code} ${getStage(d.stageId).label}` : null,
          orderAlias: order.alias,
          bodyText: d.bodyText,
        },
      })),
  ];

  return (
    <Panel padded={false}>
      <div className="px-4 pt-4">
        <PanelHeader
          title="Documents"
          description="Everything on this order — what we produce on our own paper, and what each stage files. Open any of ours to read the sheet exactly as it prints."
        />
      </div>

      {rows.length === 0 ? (
        <div className="px-4 pb-4">
          <EmptyState
            icon={FileText}
            title="No documents yet"
            description="Documents are filed here automatically as each stage produces them."
          />
        </div>
      ) : (
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-left">
            <thead>
              <tr className="border-line-subtle bg-surface-2 border-y">
                {[
                  ['Document', 'What the paper is'],
                  ['Reference', 'The number it is known by'],
                  ['Origin', 'Raised on our paper, or filed by a stage'],
                  ['Dated', 'When it was filed against this order'],
                  ['File', 'Stored file name, size and revision'],
                  ['Recorded by', 'Who produced it, and whether by hand or by connector'],
                  ['', 'Open the document'],
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
              {rows.map((r) => (
                <tr key={r.key} className="hover:bg-surface-3/50 align-top transition-colors">
                  <td className="px-3 py-2.5">
                    <span className="text-fg block text-[12.5px] font-medium">{r.document}</span>
                    {r.purpose && (
                      <span className="text-fg-tertiary mt-0.5 block max-w-[min(42ch,100%)] text-[11px] leading-relaxed">
                        {r.purpose}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <MonoId value={r.reference} truncate />
                  </td>
                  <td className="px-3 py-2.5">
                    <Chip size="sm" tone={r.onOurPaper ? 'accent' : 'neutral'}>
                      {r.onOurPaper ? 'On our paper' : 'Filed by a stage'}
                    </Chip>
                  </td>
                  <td className="text-fg-secondary px-3 py-2.5 text-[11.5px] whitespace-nowrap">
                    {r.filedAt ? formatDate(r.filedAt) : 'Generated on demand'}
                  </td>
                  <td className="px-3 py-2.5">
                    {r.fileName ? (
                      <span className="text-fg-tertiary block font-mono text-[10.5px]">
                        {r.fileName}
                        <span className="block">
                          {r.sizeKb} KB · revision {r.version}
                        </span>
                      </span>
                    ) : (
                      <span className="text-fg-tertiary text-[11.5px]">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {r.provenance && r.actor ? (
                      <ProvenanceBadge
                        provenance={r.provenance}
                        actor={r.actor}
                        at={r.filedAt ?? undefined}
                      />
                    ) : (
                      <span className="text-fg-tertiary text-[11.5px]">1BUY</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {r.view ? (
                      <DocumentLink
                        kind={r.view.kind}
                        id={r.view.id}
                        label="View"
                        documentTitle={r.reference}
                        variant="button"
                      />
                    ) : r.sheet ? (
                      <button
                        type="button"
                        onClick={() => setSheetDoc(r.sheet)}
                        className="border-line-subtle text-fg-secondary hover:bg-surface-3 hover:text-fg focus-visible:ring-accent/40 inline-flex items-center gap-1.5 rounded-[7px] border px-2 py-1 text-[11.5px] font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
                      >
                        <FileText className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
                        View
                      </button>
                    ) : (
                      <span className="text-fg-tertiary text-[11px]">No content on file</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* One viewer for every filed document. The team registers already open
          their rows this way; the Control Tower had no reason to be the place
          where a register cannot open its own contents. */}
      <DocumentSheetDialog
        doc={sheetDoc}
        open={sheetDoc !== null}
        onOpenChange={(o) => !o && setSheetDoc(null)}
      />
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Payments & Escrow
// ═══════════════════════════════════════════════════════════════════════════

function EscrowTab({
  order,
  financeApprovers,
}: {
  order: OrderDetail;
  financeApprovers: FinanceApprover[];
}) {
  const esc = order.escrowAccount;
  /** Which movement dialog is open, if any. */
  const [movement, setMovement] = useState<'FUND' | 'RELEASE' | null>(null);

  if (!esc) {
    return (
      <Panel>
        <EmptyState
          icon={Landmark}
          title="No escrow account yet"
          description={
            order.paymentMethod === 'ESCROW'
              ? 'The account is opened when the order reaches C1 · Escrow account opened. Advance the order to that stage and it will appear here.'
              : `This order is on ${order.paymentMethod.toLowerCase()} terms, so no money is held in escrow.`
          }
        />
      </Panel>
    );
  }
  const held = Math.max(0, esc.fundedAmount - esc.releasedAmount);
  /**
   * Instructed but not yet settled. `releasedAmount` counts only settled
   * movements, so this money is still inside "held" while being spoken for —
   * it must not be offered up for release a second time.
   */
  const inFlight = esc.transactions
    .filter((t) => t.status === 'INSTRUCTED' && t.type.endsWith('RELEASE'))
    .reduce((a, t) => a + t.amount, 0);
  const available = Math.max(0, held - inFlight);
  const stillToFund = Math.max(0, esc.agreedAmount - esc.fundedAmount);
  /** Percentages of the agreed amount — the figure everything is negotiated against. */
  const pctOf = (n: number) => (esc.agreedAmount > 0 ? (n / esc.agreedAmount) * 100 : 0);
  const inspectionPassed = order.inspections.some((i) => i.verdict === 'PASSED');
  const settled = esc.status === 'SETTLED';

  const position: EscrowPosition = {
    escrowId: esc.id,
    escrowRef: esc.escrowRef,
    agreedAmount: esc.agreedAmount,
    fundedAmount: esc.fundedAmount,
    releasedAmount: esc.releasedAmount,
    currency: esc.currency,
    instructedAmount: inFlight,
    supplierName: order.supplierPo.supplier.name,
    inspectionPassed,
  };

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <Panel>
        <PanelHeader
          title="Escrow account"
          description="Money held by a neutral third party, released only against business milestones. Every movement needs a reason and a proof document."
          termKey="escrowRef"
          actions={<StatusChip status={esc.status} />}
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KeyValue label="Reference" termKey="escrowRef">
            <MonoId value={esc.escrowRef} />
          </KeyValue>
          <KeyValue label="Agreed amount">
            <Money amount={esc.agreedAmount} />
          </KeyValue>
          <KeyValue label="Funded">
            <span className="flex flex-wrap items-baseline gap-1.5">
              <Money amount={esc.fundedAmount} />
              <span className="text-fg-tertiary tnum text-[11px]">
                {pctOf(esc.fundedAmount).toFixed(1)}%
              </span>
            </span>
          </KeyValue>
          <KeyValue label="Held right now" termKey="escrowHeld">
            <span className="flex flex-wrap items-baseline gap-1.5">
              <Money amount={held} className="text-warning" />
              <span className="text-fg-tertiary tnum text-[11px]">{pctOf(held).toFixed(1)}%</span>
            </span>
          </KeyValue>
        </div>
        {inFlight > 0 && (
          <div className="border-line-subtle mt-3 grid grid-cols-1 gap-3 border-t pt-3 sm:grid-cols-2">
            <KeyValue label="Instructed, awaiting settlement">
              <span className="flex flex-wrap items-baseline gap-1.5">
                <Money amount={inFlight} className="text-info" />
                <span className="text-fg-tertiary tnum text-[11px]">{pctOf(inFlight).toFixed(1)}%</span>
              </span>
            </KeyValue>
            <KeyValue label="Available to release now">
              <span className="flex flex-wrap items-baseline gap-1.5">
                <Money amount={available} />
                <span className="text-fg-tertiary tnum text-[11px]">
                  {pctOf(available).toFixed(1)}%
                </span>
              </span>
            </KeyValue>
            <p className="text-fg-tertiary sm:col-span-2 text-[11.5px] leading-relaxed">
              Money already instructed sits inside &ldquo;held&rdquo; until the provider settles it, but
              it is spoken for — so it is not available to release again.
            </p>
          </div>
        )}

        {/* ── The bar. Three segments, all drawn: an unfilled tail reads as "the
            bar ends here" rather than "this much has never been paid in". ── */}
        <div className="mt-3">
          <div className="bg-surface-3 flex h-2.5 overflow-hidden rounded-full">
            <Hint
              content={
                <span>
                  Released to {order.supplierPo.supplier.name} — <Money amount={esc.releasedAmount} />{' '}
                  ({pctOf(esc.releasedAmount).toFixed(1)}% of agreed)
                </span>
              }
            >
              <span className="bg-success h-full" style={{ width: `${pctOf(esc.releasedAmount)}%` }} />
            </Hint>
            {inFlight > 0 && (
              <Hint
                content={
                  <span>
                    Instructed, awaiting settlement — <Money amount={inFlight} /> (
                    {pctOf(inFlight).toFixed(1)}% of agreed). Committed, so not available to release
                    again.
                  </span>
                }
              >
                <span
                  className="bg-info/70 border-surface-1 h-full border-l"
                  style={{ width: `${pctOf(inFlight)}%` }}
                />
              </Hint>
            )}
            <Hint
              content={
                <span>
                  Available to release — <Money amount={available} /> ({pctOf(available).toFixed(1)}%
                  of agreed)
                </span>
              }
            >
              <span className="bg-warning h-full" style={{ width: `${pctOf(available)}%` }} />
            </Hint>
            <Hint
              content={
                <span>
                  Never paid in — <Money amount={stillToFund} /> ({pctOf(stillToFund).toFixed(1)}% of
                  agreed)
                </span>
              }
            >
              <span
                className="bg-surface-3 border-line-strong h-full border-l"
                style={{ width: `${pctOf(stillToFund)}%` }}
              />
            </Hint>
          </div>
          <div className="text-fg-tertiary mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
            <span className="flex items-center gap-1.5">
              <span className="bg-success size-2 rounded-full" aria-hidden /> Released{' '}
              <Money amount={esc.releasedAmount} /> · {pctOf(esc.releasedAmount).toFixed(1)}%
            </span>
            {inFlight > 0 && (
              <span className="flex items-center gap-1.5">
                <span className="bg-info/70 size-2 rounded-full" aria-hidden /> Instructed{' '}
                <Money amount={inFlight} /> · {pctOf(inFlight).toFixed(1)}%
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <span className="bg-warning size-2 rounded-full" aria-hidden />{' '}
              {inFlight > 0 ? 'Available' : 'Held'} <Money amount={available} /> ·{' '}
              {pctOf(available).toFixed(1)}%
            </span>
            <span className="flex items-center gap-1.5">
              <span className="bg-surface-3 border-line-strong size-2 rounded-full border" aria-hidden />{' '}
              Not funded <Money amount={stillToFund} /> · {pctOf(stillToFund).toFixed(1)}%
            </span>
            <span className="flex items-center gap-1.5">
              <span className="bg-line size-2 rounded-full" aria-hidden /> Fees{' '}
              <Money amount={esc.feeAmount} />
            </span>
          </div>
        </div>

        {/* ── The two movements ─────────────────────────────────────────────── */}
        <div className="border-line-subtle mt-3.5 flex flex-wrap items-center gap-2 border-t pt-3.5">
          <Button
            variant="secondary"
            icon={ArrowDownToLine}
            wrap
            onClick={() => setMovement('FUND')}
            disabledReason={
              settled
                ? 'The account is settled. Adding money to a closed account would misstate what happened.'
                : undefined
            }
          >
            Add money to escrow
          </Button>
          <Button
            variant="primary"
            icon={ArrowUpFromLine}
            wrap
            onClick={() => setMovement('RELEASE')}
            disabledReason={
              available <= 0
                ? esc.fundedAmount === 0
                  ? 'Nothing has been paid in yet, so there is nothing to release.'
                  : inFlight > 0
                    ? 'Everything held is already instructed and waiting to settle.'
                    : 'Everything funded has already been released.'
                : undefined
            }
          >
            Release money
          </Button>
          <span className="text-fg-tertiary ml-auto text-[11.5px] leading-relaxed">
            {available > 0 ? (
              <>
                <Money amount={available} className="text-fg font-medium" /> available to release
              </>
            ) : stillToFund > 0 ? (
              <>
                <Money amount={stillToFund} className="text-fg font-medium" /> still to pay in
              </>
            ) : (
              'Nothing outstanding.'
            )}
          </span>
        </div>

        <p className="text-fg-tertiary mt-2 text-[11px]">
          Provider: {esc.provider} ·{' '}
          <ProvenanceBadge
            provenance={esc.provenance}
            actor={esc.provenanceActor}
            at={esc.provenanceAt}
            ref={esc.provenanceRef}
          />
        </p>
      </Panel>

      {movement && (
        <EscrowMovementDialog
          mode={movement}
          workOrderId={order.id}
          position={position}
          financeApprovers={financeApprovers}
          onOpenChange={(open) => !open && setMovement(null)}
        />
      )}

      <Panel padded={false}>
        <div className="p-4 pb-2">
          <PanelHeader
            title="Movements"
            description="Every deposit and release, oldest first, with the reason and the proof filed against it. Nothing here can be edited — a correction is a new movement."
            termKey="escrowMilestone"
            actions={
              <span className="text-fg-tertiary text-[11.5px]">
                {esc.transactions.length} movement{esc.transactions.length === 1 ? '' : 's'}
              </span>
            }
          />
        </div>
        {esc.transactions.length === 0 && (
          <div className="px-4 pb-4">
            <p className="text-fg-tertiary text-[12.5px] leading-relaxed">
              Nothing has moved yet. The account is open at{' '}
              <Money amount={esc.agreedAmount} /> agreed but no money has been paid in.
            </p>
          </div>
        )}
        <ul className="divide-line-subtle divide-y">
          {esc.transactions.map((t) => (
            <li key={t.id} className="px-4 py-2.5">
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                <Chip
                  tone={
                    t.type === 'FUND'
                      ? 'info'
                      : t.type === 'FINAL_RELEASE'
                        ? 'success'
                        : t.type === 'PARTIAL_RELEASE'
                          ? 'warning'
                          : 'neutral'
                  }
                  size="sm"
                >
                  {t.type.replace(/_/g, ' ').toLowerCase()}
                </Chip>
                {t.milestone && (
                  <Hint
                    content={
                      <div className="space-y-1">
                        <div className="font-medium">
                          {ESCROW_MILESTONE_META[t.milestone as EscrowMilestone].label}
                        </div>
                        <div>{ESCROW_MILESTONE_META[t.milestone as EscrowMilestone].plainLabel}</div>
                        <div className="text-fg-tertiary">
                          Gate: {ESCROW_MILESTONE_META[t.milestone as EscrowMilestone].gate}
                        </div>
                      </div>
                    }
                  >
                    <span>
                      <Chip tone="accent" size="sm">
                        {ESCROW_MILESTONE_META[t.milestone as EscrowMilestone].label}
                      </Chip>
                    </span>
                  </Hint>
                )}
                <span className="text-fg min-w-0 flex-1 text-[12.5px] leading-relaxed">
                  {t.reason}
                </span>
                <StatusChip status={t.status} size="sm" />
                <span className="flex shrink-0 flex-col items-end">
                  <Money
                    amount={t.amount}
                    className={cn('font-semibold', t.type === 'FUND' ? 'text-info' : 'text-success')}
                  />
                  {/* The share of the agreed amount, so a figure can be judged
                      without dividing it by the total in your head. */}
                  <span className="text-fg-tertiary tnum text-[10.5px]">
                    {pctOf(t.amount).toFixed(1)}% of agreed
                  </span>
                </span>
                <span className="text-fg-tertiary shrink-0 text-[11px]">
                  {formatDate(t.valueDate)}
                </span>
              </div>
              <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-fg-tertiary text-[11px]">
                  Recorded by {t.provenanceActor ?? 'unknown'} ·{' '}
                  <ProvenanceBadge
                    provenance={t.provenance}
                    actor={t.provenanceActor}
                    at={t.provenanceAt}
                    ref={t.provenanceRef}
                  />
                </span>
                {t.reference && (
                  <span className="text-fg-tertiary font-mono text-[10.5px]">{t.reference}</span>
                )}
                {/* Proof is shown on the movement, not buried in the documents
                    list: "which payment does this prove" is the whole question. */}
                {t.documents.length > 0 ? (
                  t.documents.map((d) => (
                    <a
                      key={d.id}
                      href={`/api/documents/${d.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent-text hover:bg-accent-subtle border-accent-border/60 flex min-w-0 items-center gap-1 rounded-[6px] border px-1.5 py-[1px] text-[10.5px] transition-colors"
                    >
                      <Paperclip className="size-3 shrink-0" aria-hidden />
                      <span className="min-w-0 max-w-[16rem] truncate">{d.fileName}</span>
                    </a>
                  ))
                ) : (
                  <Chip tone="warning" size="sm">
                    No proof on file
                  </Chip>
                )}
              </div>
              {t.approvals.length > 0 && (
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <span className="text-fg-tertiary flex items-center gap-1 text-[10.5px] font-semibold tracking-[0.04em] uppercase">
                    Dual authorisation
                    <InfoTooltip termKey="dualAuthorisation" />
                  </span>
                  {t.approvals.map((a) => (
                    <Chip key={a.id} tone="success" icon={Check} size="sm">
                      {a.approver.name} · {a.approver.role}
                    </Chip>
                  ))}
                  {t.approvals.length < 2 && (
                    <Chip tone="danger" size="sm">
                      Needs a second Finance approver
                    </Chip>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Testing
// ═══════════════════════════════════════════════════════════════════════════

function TestingTab({
  order,
  exceptions,
}: {
  order: OrderDetail;
  exceptions: OrderDetail['exceptions'];
}) {
  /**
   * The decision belongs next to the evidence, so a failed test is resolved here
   * with the failing lots named — not in a banner detached from the report.
   */
  const testingExceptions = exceptions.filter(
    (e) => exceptionDef(e.type)?.ownerTab === 'testing',
  );

  const failedLines: FailedLine[] = order.testRequests
    .flatMap((tr) => tr.result?.lineResults ?? [])
    .filter((lr) => lr.failedQty > 0)
    .map((lr) => ({
      mpn: lr.mpn,
      lotRef: lr.lotRef,
      testedQty: lr.testedQty,
      passedQty: lr.passedQty,
      failedQty: lr.failedQty,
      failureMode: lr.failureMode,
    }));

  if (order.testRequests.length === 0 && testingExceptions.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon={FlaskConical}
          title="No test request raised yet"
          description="A test request is created when the supplier is instructed to send parts to the testing laboratory."
        />
      </Panel>
    );
  }
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      {testingExceptions.map((e) => (
        <ExceptionPanel
          key={e.id}
          exception={{
            id: e.id,
            type: e.type,
            reason: e.reason,
            severity: e.severity,
            offStage: e.offStage,
            openedAt: e.openedAt,
          }}
          failedLines={failedLines}
        />
      ))}
      {order.testRequests.map((tr) => (
        <Panel key={tr.id}>
          <PanelHeader
            title={`Test request ${tr.requestNo}`}
            description="Independent lab verification before the full shipment moves."
            actions={
              <span className="flex items-center gap-1.5">
                <StatusChip status={tr.status} />
                {tr.result && <StatusChip status={tr.result.verdict} />}
              </span>
            }
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KeyValue label="Scope" termKey="testScope">
              {TEST_SCOPE_META[tr.scope as 'LOT_SAMPLE'].label}
            </KeyValue>
            <KeyValue label="Sample size">{tr.sampleSize ?? 'Full batch'}</KeyValue>
            <KeyValue label="AQL" termKey="aql">
              {tr.aql ?? '—'}
            </KeyValue>
            <KeyValue label="Lab reference">
              {tr.labRequestRef ? <MonoId value={tr.labRequestRef} /> : 'Not yet acknowledged'}
            </KeyValue>
            <KeyValue label="Received at lab">{formatDate(tr.receivedAt)}</KeyValue>
            <KeyValue label="Quantity received">{tr.receivedQty ?? '—'}</KeyValue>
            <KeyValue label="Testing cost">
              <Money amount={tr.testCost} />
            </KeyValue>
            <KeyValue label="Where this came from" termKey="provenance">
              <ProvenanceBadge
                provenance={tr.provenance}
                actor={tr.provenanceActor}
                at={tr.provenanceAt}
                ref={tr.provenanceRef}
              />
            </KeyValue>
          </div>

          {tr.labIsForeign && (
            <p className="text-warning bg-warning-subtle border-warning-border mt-3 rounded-[8px] border px-2.5 py-2 text-[11.5px]">
              This lab is overseas, so the testing fee is an import of services — it is
              reverse-charged and self-invoiced rather than carrying the lab&apos;s own GST.
            </p>
          )}

          {tr.result && (
            <div className="border-line-subtle mt-3 border-t pt-3">
              <SectionLabel>Result</SectionLabel>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <KeyValue label="Verdict" termKey="testVerdict">
                  <StatusChip status={tr.result.verdict} />
                </KeyValue>
                <KeyValue label="Report number">
                  <MonoId value={tr.result.reportNo} />
                </KeyValue>
                <KeyValue label="Signed by">{tr.result.signedBy}</KeyValue>
                <KeyValue label="Tested on">{formatDate(tr.result.testedAt)}</KeyValue>
              </div>
              {tr.result.summary && (
                <p className="text-fg-secondary mt-2 text-[12px] leading-relaxed">
                  {tr.result.summary}
                </p>
              )}

              <div className="mt-3 overflow-x-auto">
                <table className="w-full border-collapse text-left text-[12px]">
                  <thead className="bg-surface-inset">
                    <tr className="border-line-subtle border-y">
                      <Th termKey="mpn">Part</Th>
                      <Th>Lot</Th>
                      <Th align="right">Tested</Th>
                      <Th align="right">Passed</Th>
                      <Th align="right">Failed</Th>
                      <Th>Verdict</Th>
                      <Th>Failure mode</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {tr.result.lineResults.map((lr) => (
                      <tr key={lr.id} className="border-line-subtle border-b last:border-0">
                        <td className="px-3 py-2 font-mono text-[11.5px]">{lr.mpn}</td>
                        <td className="px-3 py-2 font-mono text-[11px]">{lr.lotRef ?? '—'}</td>
                        <td className="tnum px-3 py-2 text-right">{lr.testedQty}</td>
                        <td className="tnum text-success px-3 py-2 text-right">{lr.passedQty}</td>
                        <td
                          className={cn(
                            'tnum px-3 py-2 text-right',
                            lr.failedQty > 0 && 'text-danger font-semibold',
                          )}
                        >
                          {lr.failedQty}
                        </td>
                        <td className="px-3 py-2">
                          <StatusChip status={lr.verdict} size="sm" />
                        </td>
                        <td className="text-fg-secondary px-3 py-2 text-[11.5px]">
                          {lr.failureMode ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Panel>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Logistics
// ═══════════════════════════════════════════════════════════════════════════

function LogisticsTab({ order }: { order: OrderDetail }) {
  /**
   * Two sub-tabs, because these are two different jobs.
   *
   * "Who pays for and insures this leg" is a commercial question answered once,
   * when the terms are agreed. "Where is the box right now" is an operational one
   * answered every day. Stacking them made a long scroll where the reader had to
   * pass the whole Incoterms reference to reach a tracking number.
   *
   * Tracking leads because it is the question asked most often — where is the box
   * today. The terms sit one click away with a one-line reminder carried onto the
   * tracking view, so "whose freight is this" is never more than a glance away.
   */
  const terms: DeliveryTermsData = {
    workOrderIncoterms: order.incoterms,
    supplierPoIncoterms: order.supplierPo.incoterms,
    customerPoIncoterms: order.customerPo.incoterms,
    supplierName: order.supplierPo.supplier.name,
    customerName: order.customerPo.customer.name,
    costs: {
      freightCost: order.freightCost,
      insuranceCost: order.insuranceCost,
      clearanceCost: order.clearanceCost,
      dutyBcd: order.dutyBcd,
      dutySws: order.dutySws,
      dutyIgst: order.dutyIgst,
    },
    hasInsurance: order.insuranceCost > 0,
  };

  const legs = order.shipments.length;
  const events = order.shipments.reduce((a, sh) => a + sh.events.length, 0);

  return (
    <Tabs.Root defaultValue="tracking" className="grid min-w-0 grid-cols-1 gap-4">
      <Tabs.List
        aria-label="Logistics views"
        className="border-line-subtle bg-surface-2 flex min-w-0 flex-wrap gap-0.5 self-start rounded-[9px] border p-0.5"
      >
        <SubTabTrigger
          value="tracking"
          icon={Truck}
          label="Tracking"
          count={legs > 0 ? legs : undefined}
        />
        <SubTabTrigger value="terms" icon={ShieldCheck} label="Delivery Terms" />
      </Tabs.List>

      <Tabs.Content value="tracking" className="grid min-w-0 grid-cols-1 gap-4 outline-none">
        {/* A one-line reminder of the term, so the operator reading a tracking
            number does not have to switch tabs to recall whose freight this is. */}
        <p className="text-fg-tertiary text-[11.5px] leading-relaxed">
          Bought <strong className="text-fg-secondary font-mono">{order.incoterms}</strong>, sold{' '}
          <strong className="text-fg-secondary font-mono">{order.customerPo.incoterms}</strong> ·{' '}
          {legs === 0 ? 'no legs booked yet' : `${legs} leg${legs === 1 ? '' : 's'}`}
          {events > 0 ? `, ${events} tracking event${events === 1 ? '' : 's'}` : ''}. See Delivery
          Terms for who carries each one.
        </p>

        {order.shipments.length === 0 && (
        <Panel>
          <EmptyState
            icon={Truck}
            title="Nothing has shipped yet"
            description="Shipments appear here once a leg is booked. The delivery terms above already say who will be arranging and paying for it."
          />
        </Panel>
      )}

      {order.shipments.map((s) => {
        const meta = SHIPMENT_LEG_META[s.legType as ShipmentLeg];
        return (
          <Panel key={s.id}>
            <PanelHeader
              title={meta.label}
              description={`${meta.route} — ${meta.plainLabel}`}
              termKey="shipmentLeg"
              actions={
                <span className="flex items-center gap-1.5">
                  <Chip size="sm">{s.carrierCode}</Chip>
                  <StatusChip status={s.status} />
                </span>
              }
            />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <KeyValue label="Tracking number" termKey="awb">
                {s.awb ? <MonoId value={s.awb} /> : '—'}
              </KeyValue>
              <KeyValue label="From">
                {s.originName}, {s.originCountry}
              </KeyValue>
              <KeyValue label="To">
                {s.destName}, {s.destCountry}
              </KeyValue>
              <KeyValue label="Chargeable weight" termKey="chargeableWeight">
                {s.chargeableWeightKg ? `${s.chargeableWeightKg} kg` : '—'}
              </KeyValue>
              <KeyValue label="Pieces">{s.pieces}</KeyValue>
              <KeyValue label="Freight">
                <Money amount={s.freightAmount} />
              </KeyValue>
              <KeyValue label="Dispatched">{formatDate(s.dispatchedAt)}</KeyValue>
              <KeyValue label="Delivered">{formatDate(s.deliveredAt)}</KeyValue>
            </div>

            {s.rateQuotes && (
              <div className="border-line-subtle mt-3 border-t pt-3">
                <SectionLabel>Rates the operator chose from</SectionLabel>
                <ul className="grid gap-1 sm:grid-cols-2">
                  {(JSON.parse(s.rateQuotes) as { service: string; transitDays: number; amount: number; currency: string }[]).map(
                    (q) => (
                      <li
                        key={q.service}
                        className="border-line-subtle flex items-center justify-between gap-2 rounded-[7px] border px-2.5 py-1.5 text-[12px]"
                      >
                        <span className="truncate">{q.service}</span>
                        <span className="text-fg-tertiary shrink-0">{q.transitDays}d</span>
                        <Money amount={q.amount} currency={q.currency} className="shrink-0" />
                      </li>
                    ),
                  )}
                </ul>
              </div>
            )}

            {s.events.length > 0 && (
              <div className="border-line-subtle mt-3 border-t pt-3">
                <SectionLabel>Tracking</SectionLabel>
                <ol className="grid gap-1.5">
                  {s.events.map((e) => (
                    <li key={e.id} className="flex min-w-0 items-start gap-2 text-[12px]">
                      <span className="bg-accent mt-1.5 size-1.5 shrink-0 rounded-full" aria-hidden />
                      <span className="text-fg-tertiary w-32 shrink-0 text-[11px]">
                        {formatDateTime(e.occurredAt)}
                      </span>
                      <span className="text-fg-secondary min-w-0 flex-1">{e.description}</span>
                      <span className="text-fg-tertiary shrink-0 text-[11px]">{e.location}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </Panel>
        );
      })}

      {order.pods.map((p) => (
        <Panel key={p.id}>
          <PanelHeader title="Proof of delivery" termKey="pod" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KeyValue label="POD number">
              <MonoId value={p.podNumber} />
            </KeyValue>
            <KeyValue label="Signed by">{p.signedBy}</KeyValue>
            <KeyValue label="Delivered">{formatDateTime(p.deliveredAt)}</KeyValue>
            <KeyValue label="Shared with customer">{formatDate(p.sharedWithCustomerAt)}</KeyValue>
          </div>
          <div className="mt-2">
            <ProvenanceBadge
              provenance={p.provenance}
              actor={p.provenanceActor}
              at={p.provenanceAt}
              ref={p.provenanceRef}
            />
          </div>
        </Panel>
      ))}
      </Tabs.Content>

      <Tabs.Content value="terms" className="min-w-0 outline-none">
        <DeliveryTermsPanel data={terms} />
      </Tabs.Content>
    </Tabs.Root>
  );
}

/** One sub-tab trigger, styled like the segmented controls used elsewhere. */
/**
 * One segment of a sub-tab strip, inside an already-selected top-level tab.
 *
 * Shared by Logistics and Flow. Both had the same problem — two jobs stacked
 * into one long scroll — and the answer has to look identical in both places,
 * or a second row of tabs reads as a different kind of control rather than the
 * same one applied twice.
 */
function SubTabTrigger({
  value,
  icon: Icon,
  label,
  count,
}: {
  value: string;
  icon: typeof Truck;
  label: string;
  count?: number;
}) {
  return (
    <Tabs.Trigger
      value={value}
      className={cn(
        'text-fg-secondary hover:text-fg data-[state=active]:bg-surface-1 data-[state=active]:text-fg data-[state=active]:shadow-e1',
        'focus-visible:ring-accent/40 flex min-w-0 items-center gap-1.5 rounded-[7px] px-3 py-1.5 text-[12.5px] font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none',
      )}
    >
      <Icon className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
      {label}
      {count != null && (
        <span className="bg-surface-3 text-fg-secondary tnum rounded-full px-1.5 text-[10.5px]">
          {count}
        </span>
      )}
    </Tabs.Trigger>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Customs
// ═══════════════════════════════════════════════════════════════════════════

function CustomsTab({ order }: { order: OrderDetail }) {
  const ce = order.customsEntry;
  if (!ce) return null;
  const fxVariance = ce.exchangeRateUsed ? ce.exchangeRateUsed - order.fxRate : 0;

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <Panel>
        <PanelHeader
          title="Bill of Entry"
          description="Filed with Indian customs by our agent. Status is tracked from ICEGATE."
          termKey="boe"
          actions={<StatusChip status={ce.status} />}
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KeyValue label="BoE number" termKey="boe">
            {ce.boeNumber ? <MonoId value={ce.boeNumber} /> : '—'}
          </KeyValue>
          <KeyValue label="Filed on">{formatDate(ce.filedAt)}</KeyValue>
          <KeyValue label="Port">{ce.portCode ?? '—'}</KeyValue>
          <KeyValue label="Customs agent">{ce.whaAgentName ?? '—'}</KeyValue>
        </div>
        <div className="mt-2">
          <ProvenanceBadge
            provenance={ce.provenance}
            actor={ce.provenanceActor}
            at={ce.provenanceAt}
            ref={ce.provenanceRef}
          />
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title="Duty, broken out by head"
          description="Only some of this is a real cost — the IGST comes back to us as input credit."
        />
        <div className="grid gap-2">
          <DutyRow
            label="Assessable value"
            termKey="taxableValue"
            amount={ce.assessableValue}
            note="What customs valued the goods at, using their own exchange rate."
          />
          <DutyRow
            label="Basic Customs Duty (BCD)"
            termKey="bcd"
            amount={ce.dutyBcd}
            creditable={false}
          />
          <DutyRow
            label="Social Welfare Surcharge (SWS)"
            termKey="sws"
            amount={ce.dutySws}
            creditable={false}
          />
          <DutyRow
            label="IGST paid at import"
            termKey="importIgst"
            amount={ce.dutyIgst}
            creditable
          />
          <div className="border-line-subtle mt-1 flex items-center justify-between gap-2 border-t pt-2">
            <span className="text-fg text-[12.5px] font-semibold">Total paid to customs</span>
            <Money amount={ce.totalDuty} className="font-semibold" />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-fg-tertiary text-[12px]">
              Of which a real cost (not recoverable)
            </span>
            <Money amount={ce.dutyBcd + ce.dutySws} className="text-warning" />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-fg-tertiary text-[12px]">Of which recoverable as credit</span>
            <Money amount={ce.dutyIgst} className="text-success" />
          </div>
        </div>

        {ce.exchangeRateUsed && (
          <div className="border-line-subtle mt-3 border-t pt-3">
            <SectionLabel>Exchange rate variance</SectionLabel>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <KeyValue label="Our locked rate" termKey="fxRate">
                {order.fxRate.toFixed(2)}
              </KeyValue>
              <KeyValue label="Customs rate" termKey="customsExchangeRate">
                {ce.exchangeRateUsed.toFixed(2)}
              </KeyValue>
              <KeyValue label="Difference">
                <span className={fxVariance > 0 ? 'text-warning' : 'text-success'}>
                  {fxVariance > 0 ? '+' : ''}
                  {fxVariance.toFixed(2)}
                </span>
              </KeyValue>
            </div>
            <p className="text-fg-tertiary mt-1.5 text-[11px]">
              Customs sets its own rate on the day, so the duty differs from what our locked rate
              would suggest. This gap is expected, not an error.
            </p>
          </div>
        )}
      </Panel>

      <Panel padded={false}>
        <div className="p-4 pb-2">
          <PanelHeader title="Customs timeline" />
        </div>
        <ol className="divide-line-subtle divide-y">
          {ce.statusHistory.map((h) => (
            <li key={h.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
              <StatusChip status={h.status} size="sm" />
              <span className="text-fg-secondary min-w-0 flex-1 text-[12px]">{h.note}</span>
              <ProvenanceBadge provenance={h.provenance} />
              <span className="text-fg-tertiary shrink-0 text-[11px]">
                {formatDateTime(h.occurredAt)}
              </span>
            </li>
          ))}
        </ol>
      </Panel>

      {ce.queries.length > 0 && (
        <Panel padded={false}>
          <div className="p-4 pb-2">
            <PanelHeader title="Customs queries" description="Each one blocks clearance until answered." />
          </div>
          <ul className="divide-line-subtle divide-y">
            {ce.queries.map((q) => (
              <li key={q.id} className="px-4 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <MonoId value={q.queryRef} />
                  <StatusChip status={q.status} size="sm" />
                  <span className="text-fg-tertiary text-[11px]">{formatDate(q.raisedAt)}</span>
                </div>
                <p className="text-fg-secondary mt-1 text-[12px]">{q.queryText}</p>
                {q.responseText && (
                  <p className="text-fg-tertiary mt-1 text-[12px]">
                    <b>Our response:</b> {q.responseText}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function DutyRow({
  label,
  termKey,
  amount,
  creditable,
  note,
}: {
  label: string;
  termKey?: string;
  amount: number;
  creditable?: boolean;
  note?: string;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="text-fg-secondary truncate text-[12.5px]">{label}</span>
        {termKey && <InfoTooltip termKey={termKey} />}
        {creditable === true && (
          <Chip tone="success" size="sm">
            Recoverable
          </Chip>
        )}
        {creditable === false && (
          <Chip tone="warning" size="sm">
            Real cost
          </Chip>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {note && (
          <Hint content={<span>{note}</span>}>
            <span className="text-fg-tertiary text-[10.5px]">why?</span>
          </Hint>
        )}
        <Money amount={amount} />
      </span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Inspection
// ═══════════════════════════════════════════════════════════════════════════

function InspectionTab({ order }: { order: OrderDetail }) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      {order.grns.map((g) => (
        <Panel key={g.id}>
          <PanelHeader
            title={`Goods receipt ${g.grnNumber}`}
            termKey="grn"
            description="What physically arrived, checked against the packing list."
            actions={
              g.hasShortfall ? (
                <Chip tone="danger" icon={AlertTriangle}>
                  Shortfall
                </Chip>
              ) : (
                <Chip tone="success" icon={Check}>
                  Quantities match
                </Chip>
              )
            }
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KeyValue label="Received">{formatDateTime(g.receivedAt)}</KeyValue>
            <KeyValue label="Cartons">{g.cartons}</KeyValue>
            <KeyValue label="Storage location" termKey="storageLocation">
              {g.storageLocation ? (
                <MonoId value={g.storageLocation} copyable={false} />
              ) : (
                'Not put away'
              )}
            </KeyValue>
            <KeyValue label="Received by">{g.receivedBy}</KeyValue>
            <KeyValue label="Remarks">{g.remarks ?? '—'}</KeyValue>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-left text-[12px]">
              <thead className="bg-surface-inset">
                <tr className="border-line-subtle border-y">
                  <Th termKey="mpn">Part</Th>
                  <Th align="right">Expected</Th>
                  <Th align="right">Received</Th>
                  <Th termKey="dateCodeLot">Date code / lot</Th>
                  <Th>Condition</Th>
                </tr>
              </thead>
              <tbody>
                {g.lines.map((l) => (
                  <tr key={l.id} className="border-line-subtle border-b last:border-0">
                    <td className="px-3 py-2 font-mono text-[11.5px]">{l.mpn}</td>
                    <td className="tnum px-3 py-2 text-right">{l.expectedQty.toLocaleString('en-IN')}</td>
                    <td
                      className={cn(
                        'tnum px-3 py-2 text-right',
                        l.receivedQty < l.expectedQty && 'text-danger font-semibold',
                      )}
                    >
                      {l.receivedQty.toLocaleString('en-IN')}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px]">{l.dateCodeLot ?? '—'}</td>
                    <td className="px-3 py-2">
                      <StatusChip status={l.condition === 'OK' ? 'PASS' : 'FAIL'} size="sm" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ))}

      {order.inspections.map((ins) => {
        const done = ins.checklist.filter((c) => c.result !== 'PENDING').length;
        return (
          <Panel key={ins.id}>
            <PanelHeader
              title={`Inspection ${ins.reportNo}`}
              termKey="inspectionVerdict"
              description="Our own detailed check. Passing this is what unlocks the final supplier payment."
              actions={<StatusChip status={ins.verdict} />}
            />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <KeyValue label="Inspector">{ins.inspector?.name ?? '—'}</KeyValue>
              <KeyValue label="Started">{formatDateTime(ins.startedAt)}</KeyValue>
              <KeyValue label="Signed off">{formatDateTime(ins.signedOffAt)}</KeyValue>
              <KeyValue label="Checks complete">
                {done} / {ins.checklist.length}
              </KeyValue>
            </div>
            {ins.remarks && (
              <p className="text-fg-secondary mt-2 text-[12px]">{ins.remarks}</p>
            )}
            <ul className="mt-3 grid gap-1.5">
              {ins.checklist.map((c) => (
                <li
                  key={c.id}
                  className="border-line-subtle flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-[8px] border px-2.5 py-2"
                >
                  <span className="text-fg-tertiary w-5 shrink-0 text-[11px]">{c.sequence}</span>
                  <span className="min-w-0 flex-1">
                    <span className="text-fg block truncate text-[12.5px]">{c.label}</span>
                    {c.expected && (
                      <span className="text-fg-tertiary block truncate text-[11px]">
                        Expected: {c.expected}
                        {c.observed ? ` · Observed: ${c.observed}` : ''}
                      </span>
                    )}
                  </span>
                  {c.evidenceCount > 0 && (
                    <Chip size="sm">{c.evidenceCount} photos</Chip>
                  )}
                  <StatusChip status={c.result === 'PENDING' ? 'PENDING' : c.result} size="sm" />
                </li>
              ))}
            </ul>
          </Panel>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Rebrand & Repack
// ═══════════════════════════════════════════════════════════════════════════

function RepackTab({ order }: { order: OrderDetail }) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      {order.repackJobs.map((r) => (
        <Panel key={r.id}>
          <PanelHeader
            title={`Repack job ${r.jobNo}`}
            termKey="repackJob"
            description="Our value-add as Merchant of Record — the goods leave under our brand."
            actions={<StatusChip status={r.status} />}
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KeyValue label="Label template">{r.labelTemplate}</KeyValue>
            <KeyValue label="Cartons">{r.cartonCount}</KeyValue>
            <KeyValue label="Serials captured">
              {r.serialsCaptured.toLocaleString('en-IN')}
            </KeyValue>
            <KeyValue label="QC by">{r.qcBy ?? 'Pending'}</KeyValue>
            <KeyValue label="Started">{formatDateTime(r.startedAt)}</KeyValue>
            <KeyValue label="Completed">{formatDateTime(r.completedAt)}</KeyValue>
            <KeyValue label="Repack cost">
              <Money amount={r.repackCost} />
            </KeyValue>
            <KeyValue label="GST on repack (recoverable)">
              <Money amount={r.repackGst} className="text-success" />
            </KeyValue>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Chip size="sm">{r.beforePhotos} before photos</Chip>
            <Chip size="sm">{r.afterPhotos} after photos</Chip>
          </div>
          {r.remarks && <p className="text-fg-secondary mt-2 text-[12px]">{r.remarks}</p>}
        </Panel>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Invoicing & Tax
// ═══════════════════════════════════════════════════════════════════════════

function TaxTab({ order }: { order: OrderDetail }) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      {order.taxInvoices.map((inv) => {
        const treatment = TAX_TREATMENT_META[inv.taxTreatment as TaxTreatment];
        return (
          <Panel key={inv.id}>
            <PanelHeader
              title={`Tax invoice ${inv.invoiceNumber}`}
              description="The sell-side GST position, computed line by line and traceable to the rule that produced it."
              actions={
                <span className="flex flex-wrap items-center gap-1.5">
                  <StatusChip status={inv.status} />
                  <StatusChip status={inv.eInvoiceStatus} size="sm" />
                </span>
              }
            />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <KeyValue label="Invoice date">{formatDate(inv.invoiceDate)}</KeyValue>
              <KeyValue label="Place of supply" termKey="placeOfSupply">
                {inv.placeOfSupplyName} ({inv.placeOfSupply})
              </KeyValue>
              <KeyValue label="Tax treatment" termKey="taxTreatment">
                <Hint
                  content={
                    <div className="space-y-1">
                      <div className="font-medium">{treatment.label}</div>
                      <div>{treatment.plainLabel}</div>
                      <div className="text-fg-tertiary">Heads applied: {treatment.heads}</div>
                    </div>
                  }
                >
                  <span>
                    <Chip tone="accent" size="sm">
                      {treatment.label}
                    </Chip>
                  </span>
                </Hint>
              </KeyValue>
              <KeyValue label="Due date">{formatDate(inv.dueDate)}</KeyValue>
            </div>

            {inv.lutApplied && (
              <p className="text-info bg-info-subtle border-info-border mt-3 rounded-[8px] border px-2.5 py-2 text-[11.5px]">
                Supplied under Letter of Undertaking, so this zero-rated supply carries no tax up
                front and no refund claim is needed.
              </p>
            )}

            <div className="mt-3 overflow-x-auto">
              <table className="w-full border-collapse text-left text-[12px]">
                <thead className="bg-surface-inset">
                  <tr className="border-line-subtle border-y">
                    <Th termKey="mpn">Part</Th>
                    <Th termKey="hsnCode">HSN</Th>
                    <Th align="right">Qty</Th>
                    <Th align="right">Rate</Th>
                    <Th align="right" termKey="taxableValue">
                      Taxable
                    </Th>
                    <Th align="right" termKey="cgst">
                      CGST
                    </Th>
                    <Th align="right" termKey="sgst">
                      SGST
                    </Th>
                    <Th align="right" termKey="igst">
                      IGST
                    </Th>
                    <Th align="right">Line total</Th>
                  </tr>
                </thead>
                <tbody>
                  {inv.lines.map((l) => (
                    <tr key={l.id} className="border-line-subtle border-b last:border-0">
                      <td className="px-3 py-2 font-mono text-[11.5px]">{l.mpn}</td>
                      <td className="px-3 py-2 font-mono text-[11px]">{l.hsnCode}</td>
                      <td className="tnum px-3 py-2 text-right">{l.quantity.toLocaleString('en-IN')}</td>
                      <td className="tnum px-3 py-2 text-right">{l.unitPrice}</td>
                      <td className="tnum px-3 py-2 text-right">
                        <Money amount={l.taxableValue} withCode={false} />
                      </td>
                      <td className="tnum px-3 py-2 text-right">
                        {l.cgstRate > 0 ? (
                          <>
                            <span className="text-fg-tertiary text-[10px]">{l.cgstRate}%</span>{' '}
                            <Money amount={l.cgstAmount} withCode={false} />
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="tnum px-3 py-2 text-right">
                        {l.sgstRate > 0 ? (
                          <>
                            <span className="text-fg-tertiary text-[10px]">{l.sgstRate}%</span>{' '}
                            <Money amount={l.sgstAmount} withCode={false} />
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="tnum px-3 py-2 text-right">
                        {l.igstRate > 0 ? (
                          <>
                            <span className="text-fg-tertiary text-[10px]">{l.igstRate}%</span>{' '}
                            <Money amount={l.igstAmount} withCode={false} />
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="tnum px-3 py-2 text-right font-medium">
                        <Money amount={l.lineTotal} withCode={false} />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-surface-inset font-semibold">
                  <tr className="border-line-subtle border-t">
                    <td className="px-3 py-2" colSpan={4}>
                      Total
                    </td>
                    <td className="tnum px-3 py-2 text-right">
                      <Money amount={inv.taxableValue} withCode={false} />
                    </td>
                    <td className="tnum px-3 py-2 text-right">
                      <Money amount={inv.cgstAmount} withCode={false} />
                    </td>
                    <td className="tnum px-3 py-2 text-right">
                      <Money amount={inv.sgstAmount} withCode={false} />
                    </td>
                    <td className="tnum px-3 py-2 text-right">
                      <Money amount={inv.igstAmount} withCode={false} />
                    </td>
                    <td className="tnum px-3 py-2 text-right">
                      <Money amount={inv.totalAmount} withCode={false} />
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {inv.roundingAdjustment !== 0 && (
              <p className="text-fg-tertiary mt-2 text-[11px]">
                Rounded to the nearest rupee — an adjustment of{' '}
                <Money amount={inv.roundingAdjustment} />.
              </p>
            )}
            {inv.amountInWords && (
              <p className="text-fg-secondary mt-2 text-[12px]">
                <span className="text-fg-tertiary text-[10.5px] font-semibold tracking-[0.04em] uppercase">
                  In words
                </span>{' '}
                {inv.amountInWords}
              </p>
            )}

            {inv.irn && (
              <div className="border-line-subtle mt-3 grid gap-3 border-t pt-3 sm:grid-cols-3">
                <KeyValue label="IRN" termKey="irn">
                  <MonoId value={`${inv.irn.slice(0, 24)}…`} />
                </KeyValue>
                <KeyValue label="Acknowledgement">{inv.ackNo}</KeyValue>
                <KeyValue label="Acknowledged">{formatDate(inv.ackDate)}</KeyValue>
              </div>
            )}

            {inv.eWayBills.map((e) => (
              <div key={e.id} className="border-line-subtle mt-3 grid gap-3 border-t pt-3 sm:grid-cols-4">
                <KeyValue label="E-way bill" termKey="ewayBill">
                  {e.ewbNumber ? (
                    <MonoId value={e.ewbNumber} />
                  ) : (
                    <Chip tone="warning" size="sm">
                      Awaiting number
                    </Chip>
                  )}
                </KeyValue>
                <KeyValue label="Valid until">
                  {e.validUntil ? formatDate(e.validUntil) : 'Starts when the number is issued'}
                </KeyValue>
                <KeyValue label="Distance">{e.distanceKm} km</KeyValue>
                <KeyValue label="Vehicle">{e.vehicleNumber ?? '—'}</KeyValue>
              </div>
            ))}
          </Panel>
        );
      })}

      {order.itcEntries.length > 0 && (
        <Panel padded={false}>
          <div className="p-4 pb-2">
            <PanelHeader
              title="Input tax credit on this order"
              termKey="itc"
              description="GST we already paid and will claim back. This is why it is excluded from landed cost."
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-[12px]">
              <thead className="bg-surface-inset">
                <tr className="border-line-subtle border-y">
                  <Th>Source</Th>
                  <Th>Document</Th>
                  <Th>Supplier</Th>
                  <Th align="right">Credit</Th>
                  <Th termKey="gstr2b">GSTR-2B</Th>
                </tr>
              </thead>
              <tbody>
                {order.itcEntries.map((i) => (
                  <tr key={i.id} className="border-line-subtle border-b last:border-0">
                    <td className="px-3 py-2">
                      <Chip size="sm">{i.source.replace(/_/g, ' ').toLowerCase()}</Chip>
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px]">{i.documentRef}</td>
                    <td className="px-3 py-2">{i.supplierName}</td>
                    <td className="tnum px-3 py-2 text-right">
                      <Money amount={i.totalCredit} withCode={false} className="text-success" />
                    </td>
                    <td className="px-3 py-2">
                      <StatusChip status={i.gstr2bStatus} size="sm" />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-surface-inset font-semibold">
                <tr className="border-line-subtle border-t">
                  <td className="px-3 py-2" colSpan={3}>
                    Total recoverable
                  </td>
                  <td className="tnum px-3 py-2 text-right text-success">
                    <Money
                      amount={order.itcEntries.reduce((a, i) => a + i.totalCredit, 0)}
                      withCode={false}
                    />
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </Panel>
      )}

      {order.rcSelfInvoices.map((r) => (
        <Panel key={r.id}>
          <PanelHeader
            title={`Reverse-charge self-invoice ${r.invoiceNumber}`}
            termKey="reverseCharge"
            description="Raised because we bought a service from abroad. We owe the tax and claim it back, so the net cash effect is nil."
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KeyValue label="Vendor">{r.vendorName}</KeyValue>
            <KeyValue label="Country">{r.vendorCountry}</KeyValue>
            <KeyValue label="Service">{r.serviceType.toLowerCase()}</KeyValue>
            <KeyValue label="SAC code">{r.hsnSacCode}</KeyValue>
            <KeyValue label="Taxable value">
              <Money amount={r.taxableValue} />
            </KeyValue>
            <KeyValue label={`IGST @ ${r.igstRate}%`}>
              <Money amount={r.igstAmount} />
            </KeyValue>
            <KeyValue label="Liability booked">
              {r.liabilityBooked ? <Chip tone="warning" size="sm">Yes</Chip> : 'No'}
            </KeyValue>
            <KeyValue label="Credit claimed">
              {r.creditClaimed ? <Chip tone="success" size="sm">Yes</Chip> : 'No'}
            </KeyValue>
          </div>
        </Panel>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Audit log
// ═══════════════════════════════════════════════════════════════════════════

function AuditTab({ order }: { order: OrderDetail }) {
  return (
    <Panel padded={false}>
      <div className="p-4 pb-2">
        <PanelHeader
          title="Audit log"
          description="Immutable record of who changed what, and when. Nothing here can be edited."
        />
      </div>
      {/* Tabular, because a log is read by scanning one column at a time — "what
          changed" down one, "from what" down the next. The old inline form ran
          the field name, the old value and the new value together in a sentence,
          which made a set of changes impossible to compare. */}
      <div className="min-w-0 overflow-x-auto">
        <table className="w-full min-w-[1040px] border-collapse text-left">
          <thead>
            <tr className="border-line-subtle bg-surface-2 border-y">
              {[
                ['When', 'Exact time the change was recorded'],
                ['Action', 'Whether the value was created, changed or removed'],
                ['Record', 'What the change was made to'],
                ['Field', 'The single field this row is about'],
                ['From', 'The value before — blank if there was none'],
                ['To', 'The value after — blank if it was cleared'],
                ['Reason', 'Given when a justification was required'],
                ['By', 'Who made the change, and whether by hand or by connector'],
              ].map(([label, hint]) => (
                <th
                  key={label}
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
            {order.auditEntries.map((a) => (
              <tr key={a.id} className="align-top">
                <td className="text-fg-secondary px-3 py-2 text-[11.5px] whitespace-nowrap">
                  {formatDateTime(a.createdAt)}
                </td>
                <td className="px-3 py-2">
                  <Chip
                    size="sm"
                    tone={
                      a.action === 'DELETE'
                        ? 'danger'
                        : a.action === 'CREATE'
                          ? 'success'
                          : a.action === 'AUTHORISE'
                            ? 'warning'
                            : 'neutral'
                    }
                  >
                    {a.action.toLowerCase()}
                  </Chip>
                </td>
                <td className="text-fg px-3 py-2 text-[12px]">{a.entity}</td>
                <td className="text-fg-secondary px-3 py-2 text-[12px]">{a.field ?? '—'}</td>
                {/* break-words, not break-all: values are a mix of codes and
                    prose, and break-all shredded sentences one letter per line.
                    This breaks at spaces first and only splits a token when the
                    token itself is longer than the column. */}
                <td className="min-w-[9.5rem] px-3 py-2">
                  {a.beforeValue ? (
                    <span className="text-fg-secondary font-mono text-[11px] break-words">
                      {a.beforeValue}
                    </span>
                  ) : (
                    <span className="text-fg-tertiary text-[11px] italic">not set</span>
                  )}
                </td>
                <td className="min-w-[9.5rem] px-3 py-2">
                  {a.afterValue ? (
                    <span className="text-fg font-mono text-[11px] break-words">{a.afterValue}</span>
                  ) : (
                    <span className="text-fg-tertiary text-[11px] italic">cleared</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {a.reason ? (
                    <span className="text-warning max-w-[min(36ch,100%)] text-[11.5px] leading-relaxed">
                      {a.reason}
                    </span>
                  ) : (
                    <span className="text-fg-tertiary text-[11px]">—</span>
                  )}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="text-fg-secondary text-[11.5px]">{a.actorLabel}</span>
                    <ProvenanceBadge provenance={a.provenance} />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
