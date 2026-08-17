'use client';

/**
 * ONE ORDER, NARROWED TO ONE TEAM'S OBLIGATIONS.
 *
 * The full order detail carries thirteen tabs, because somebody has to be able
 * to see all of it. A warehouse clerk opening it to record an inspection does
 * not: they need their own steps, what each one is waiting on, and nothing else.
 *
 * So this shows only the stages this team owns or holds the next action on —
 * the same steps, rendered by the same panel, filtered.
 *
 * The work is done HERE, not behind a link to the order. The checklist, the
 * evidence form, the document upload and the advance gate are all on this page.
 *
 * They are the SAME components the order page uses, not copies — AdvanceControl,
 * NextActionPanel and StageEvidenceDialog, calling the same server actions. That
 * is what makes this safe: there is still one advance gate, one evidence form
 * and one audit trail, and a team recording something here writes to the order
 * exactly as if they had done it there. A second implementation would drift from
 * the rules the whole platform rests on.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import * as Tabs from '@radix-ui/react-tabs';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowLeft, ArrowUpRight, Ban, Clock, ClipboardCheck, FileText, ListChecks, MessageSquare, Package, PanelLeft, Truck, X } from 'lucide-react';
import type { OrderDetail } from '@/lib/queries/order-detail';
import { normalisePhasePlan } from '@/lib/domain/phase-plan';
import {
  applicableStages,
  getStage,
  resolveRailAnchor,
  stageNextActionOwner,
  stageOwner,
  type PhaseId,
  type StageContext,
} from '@/lib/domain/stages';
import { STAKEHOLDER_META, type Stakeholder } from '@/lib/domain/enums';
import { PageHeader, PageShell, Panel, PanelHeader, EmptyState, Money, MonoId, KeyValue } from '@/components/ui/Layout';
import { Chip, StakeholderBadge } from '@/components/ui/Badges';
import { IncotermTooltip } from '@/components/ui/IncotermTooltip';
import { usePreferences } from '@/components/providers/Preferences';
import { FlowStepsPanel } from '@/app/(app)/orders/[id]/FlowStepsPanel';
import { AdvanceControl, type FinanceApprover } from '@/app/(app)/orders/[id]/AdvanceControl';
import { NextActionPanel } from '@/app/(app)/orders/[id]/NextActionPanel';
import { StageEvidenceDialog } from '@/app/(app)/orders/[id]/StageEvidenceDialog';
import type { EvidenceRecord } from '@/app/(app)/orders/[id]/StageEvidencePanel';
import { CommunicationTab } from '@/app/(app)/orders/[id]/CommunicationTab';
import { ExceptionPanel, type FailedLine } from '@/app/(app)/orders/[id]/ExceptionPanel';
import { TeamLogisticsPanel, type TeamShipment } from '@/components/logistics/TeamLogisticsPanel';
import { InboundEventsPanel } from '@/components/logistics/InboundEventsPanel';
import { AppointCarrier, AppointEscrow, type LegSlot } from '@/components/logistics/AppointCarrier';
import { ESCROW_PARTNERS } from '@/lib/domain/portal-agents';
import { deskMovesGoods } from '@/lib/queries/team-shipments';
import { docConcernsTeam } from '@/lib/domain/document-flow';
import { outstandingObligations } from '@/lib/domain/obligations';
import { OutstandingObligations } from '@/components/flow/OutstandingObligations';
import { ESanchitPanel, LiveCashPanel, TeamDocumentsPanel, TeamLiabilityPanel, TeamOrderFactsPanel, type ESanchitState } from './TeamOrderExtras';
import { DeliverablesPanel } from './DeliverablesPanel';
import { AgentInThreadNote } from '@/components/agentic/AgentInThreadNote';
import type { TeamDeliverables } from '@/lib/queries/team-deliverables';
import { cn, formatDate } from '@/lib/utils';

/**
 * Whose work turns on the delivery term.
 *
 * Inspection is absent deliberately: they check goods against a spec, and no
 * part of that changes with who paid the freight. Putting it on their screen
 * anyway would be one more panel to scroll past on every order.
 */
const SEES_LIABILITY = new Set<Stakeholder>([
  'ONE_BUY_SOURCING',
  'ONE_BUY_FINANCE',
  'ONE_BUY_INBOUND',
  'ONE_BUY_OUTBOUND',
]);

export function TeamOrderView({
  order,
  team,
  slug,
  financeApprovers,
  deliverables,
  eSanchit,
  shipments = [],
  legSlots = [],
}: {
  order: OrderDetail;
  team: Stakeholder;
  slug: string;
  /** Only Finance may authorise a release, and the final one needs two. */
  financeApprovers: FinanceApprover[];
  /** The documents this team owes on this order, drafted or not. */
  deliverables: TeamDeliverables;
  /** eSanchit filing state — fetched only for the Inbound desk. */
  eSanchit?: ESanchitState | null;
  /** Which legs this desk may appoint a carrier for, already gated by term. */
  legSlots?: LegSlot[];
  /**
   * The carrier legs this desk owns, already scoped and already judged late or
   * not. Both decisions are made on the server: leg scoping because it is
   * policy, and lateness because it is a fact about the current time — and a
   * clock read in a client render is impure, and stale the moment the tab is
   * left open.
   */
  shipments?: TeamShipment[];
}) {
  const { label: pick } = usePreferences();
  const meta = STAKEHOLDER_META[team];
  /** Which stage's evidence form is open, if any. */
  const [evidenceStageId, setEvidenceStageId] = useState<string | null>(null);

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

  const ctx: StageContext = {
    paymentMethod: order.paymentMethod as 'ESCROW',
    testingRequired: order.testingRequired,
    testScope: (order.testScope as 'LOT_SAMPLE' | null) ?? null,
    // Same normalisation the order page does — a raw row list is not a plan.
    phasePlan: normalisePhasePlan(
      order.phasePlan?.length
        ? order.phasePlan.map((r) => ({ phase: r.phase as PhaseId, skipped: r.skipped }))
        : null,
    ),
    incoterms: order.incoterms,
    sellIncoterms: order.customerPo.incoterms,
  };

  const movesGoods = deskMovesGoods(team);

  const { anchorStageId } = resolveRailAnchor(order.stage);
  const current = getStage(anchorStageId);
  const currentOwner = stageOwner(current, ctx);
  const currentNext = stageNextActionOwner(current, ctx);
  // Is the order sitting on a step this team has to move?
  const onOurDesk = currentNext === team;
  const oursToAnswerFor = currentOwner === team;
  const isBlocked = order.status === 'BLOCKED' || Boolean(order.computed.branchStageId);
  // Same source the order page reads it from: the open exception, not a column.
  const blockReason = order.exceptions.find((e) => e.status === 'OPEN')?.reason ?? null;
  /* Anything still open is a decision somebody owes, so it belongs on a desk
     rather than only in the Control Tower. */
  const openExceptions = order.exceptions.filter(
    (e) => e.status === 'OPEN' || e.status === 'IN_PROGRESS',
  );
  /* The parts that actually failed, so the choice is made against evidence
     rather than against a summary line. */
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

  const mine = applicableStages(ctx).filter(
    (s) => stageOwner(s, ctx) === team || stageNextActionOwner(s, ctx) === team,
  );
  const doneIds = new Set(order.computed.completedStageIds);
  const outstanding = mine.filter((s) => !doneIds.has(s.id)).length;

  /*
   * The sections, defined once and rendered twice — the rail on a wide screen,
   * the drawer on a narrow one. Two hand-maintained lists of the same
   * navigation is how a section ends up reachable from only one of them.
   */
  const sections = [
    { value: 'steps', icon: ListChecks, label: 'Your steps', count: outstanding },
    {
      value: 'order',
      icon: Package,
      label: 'Order & items',
      count: order.customerPo.lines.length,
    },
    ...(movesGoods
      ? [{ value: 'logistics', icon: Truck, label: 'Logistics', count: shipments.length }]
      : []),
    {
      value: 'paperwork',
      icon: ClipboardCheck,
      label: 'Your paperwork',
      count: deliverables.slots.filter((d) => d.latest?.status !== 'APPROVED').length,
    },
    {
      value: 'docs',
      icon: FileText,
      label: 'Documents',
      /*
       * The SCOPED count, not the order's total. The section shows this desk's
       * documents; a badge counting all of them would promise twenty-seven and
       * open on six, which reads as a bug rather than as a filter.
       */
      count: order.documents.filter((d) => docConcernsTeam(d.docType, team)).length,
    },
    {
      value: 'comms',
      icon: MessageSquare,
      label: 'Communication',
      count: order.communications.filter((c) => c.entryClass === 'HUMAN').length,
    },
  ];

  const [section, setSection] = useState('steps');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const activeSection = sections.find((t) => t.value === section);

  return (
    <PageShell width="full">
      <PageHeader
        title={order.alias}
        description={`${pick(meta.label, meta.plainLabel)} — only the steps this team is on. ${order.customerPo.customer.name}.`}
      />

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Link
          href={`/teams/${slug}`}
          className="border-line-subtle text-fg-secondary hover:bg-surface-3 hover:text-fg flex shrink-0 items-center gap-1.5 rounded-[8px] border px-2.5 py-1.5 text-[12.5px] transition-colors"
        >
          <ArrowLeft className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
          Back to {meta.short}
        </Link>
        <Link
          href={`/orders/${order.id}`}
          className="border-accent-border bg-accent-subtle text-accent-text hover:bg-accent-subtle/80 flex shrink-0 items-center gap-1.5 rounded-[8px] border px-2.5 py-1.5 text-[12.5px] font-medium transition-colors"
        >
          Open the full order
          <ArrowUpRight className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
        </Link>
      </div>

      {/* Where the order is, and whether that is this team's problem right now. */}
      <Panel>
        <PanelHeader
          title="Where it is"
          description="The step the order is sitting on, and who has to move it."
          actions={
            isBlocked ? (
              <Chip tone="danger" size="sm" icon={Ban}>
                Blocked
              </Chip>
            ) : onOurDesk ? (
              <Chip tone="accent" size="sm">
                Waiting on you
              </Chip>
            ) : (
              <Chip tone="neutral" size="sm" icon={Clock}>
                With {STAKEHOLDER_META[currentNext].short}
              </Chip>
            )
          }
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KeyValue label="Current step">
            <span className="text-fg-tertiary font-mono text-[10.5px]">{current.code}</span>{' '}
            {current.label}
          </KeyValue>
          <KeyValue label="Next move" termKey="stage">
            <StakeholderBadge stakeholder={currentNext} short />
          </KeyValue>
          <KeyValue label="Sales Order">
            {order.soNumber ? (
              <MonoId value={order.soNumber} />
            ) : (
              <span className="text-fg-tertiary">Not raised yet</span>
            )}
          </KeyValue>
          <KeyValue label="Order value" termKey="sellValue">
            <Money amount={order.sellValue} withCode={false} />
          </KeyValue>
          <KeyValue label="Customer">{order.customerPo.customer.name}</KeyValue>
          <KeyValue label="Supplier">{order.supplierPo.supplier.name}</KeyValue>
          <KeyValue label="Bought on">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="font-mono">{order.incoterms}</span>
              <IncotermTooltip code={order.incoterms} />
            </span>
          </KeyValue>
          <KeyValue label="Wanted by">
            {order.customerPo.requestedDeliveryDate
              ? formatDate(order.customerPo.requestedDeliveryDate)
              : '—'}
          </KeyValue>
        </div>

        {isBlocked && blockReason && (
          <p className="text-danger bg-danger-subtle mt-3 rounded-[8px] px-3 py-2 text-[12px] leading-relaxed">
            <strong className="font-semibold">Blocked:</strong> {blockReason}
          </p>
        )}

        {onOurDesk && (
          <div className="border-line-subtle mt-3 border-t pt-3">
            <AdvanceControl
              workOrderId={order.id}
              currentStage={order.stage}
              currentStageCode={current.code}
              currentStageLabel={current.label}
              evidenceRecord={evidenceRecords.find((r) => r.stageId === order.stage)}
              ctx={ctx}
              blocked={isBlocked}
              financeApprovers={financeApprovers}
              inspectionPassed={order.inspections.some((i) => i.verdict === 'PASSED')}
            />
          </div>
        )}
        {!onOurDesk && oursToAnswerFor && (
          <p className="text-fg-secondary border-line-subtle mt-3 border-t pt-3 text-[12px] leading-relaxed">
            You answer for this step, but the next move is{' '}
            {STAKEHOLDER_META[currentNext].label}&rsquo;s. There is nothing for you to do until they
            move.
          </p>
        )}
      </Panel>

      {onOurDesk && (
        <NextActionPanel
          workOrderId={order.id}
          currentStage={order.stage}
          viewStageId={anchorStageId}
          relation="CURRENT"
          ctx={ctx}
          isBlocked={isBlocked}
          blockReason={blockReason}
          stageEnteredAt={order.stageEnteredAt}
          evidence={evidenceRecords}
          onOpenEvidence={setEvidenceStageId}
          onBackToCurrent={() => setEvidenceStageId(null)}
        />
      )}

      {/* The same form the order page uses, opened from here. One implementation
          of the gate, one audit trail — this is only another way in. */}
      {evidenceStageId && (
        <StageEvidenceDialog
          workOrderId={order.id}
          stageId={evidenceStageId}
          stageCode={getStage(evidenceStageId).code}
          stageLabel={getStage(evidenceStageId).label}
          record={evidenceRecords.find((r) => r.stageId === evidenceStageId)}
          open
          onOpenChange={(o) => !o && setEvidenceStageId(null)}
        />
      )}

      {/*
        Cost and risk, before the steps.

        Shown to the desks that actually move goods and to the ones that pay for
        the moving. Sourcing and Finance see it too, because the term decides
        what the supplier's price already includes — but Inspection does not,
        since nothing they do turns on who booked the freight.
      */}
      {/*
        The decision itself, on the desk that has to make it.
        
        A blocked order used to show this team WHY it stopped and then send them
        to the full order to do anything about it — which is the redirect this
        whole workspace exists to remove. It is the order page's own panel and
        the same server actions, so a route chosen here is the identical write,
        with one audit trail.
      */}
      {/*
        What the order owes, shown to every desk and not only to the one that
        owes it. A deferred payment is Finance's to discharge, but the desk
        working the outbound needs to know the order is carrying one — it is
        why the order will stop short of closing.
      */}
      {(() => {
        const owed = outstandingObligations(ctx, order.stage, order.computed.completedStageIds);
        return owed.length > 0 ? (
          <OutstandingObligations obligations={owed} orderId={order.id} />
        ) : null;
      })()}

      {openExceptions.map((e) => (
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

      {/* Engaging the provider comes before watching the money: there is no
          cash position until somebody has been appointed to hold it. */}
      {team === 'ONE_BUY_FINANCE' && (
        <Panel>
          <PanelHeader
            title="Escrow provider"
            description="Finance appoints who holds the money and opens the account. The provider confirms the hold to the supplier; funds only move once the goods are received at 1BUY."
          />
          <AppointEscrow
            orderId={order.id}
            paymentMethod={order.paymentMethod}
            currentProvider={order.escrowAccount?.provider ?? null}
            escrowRef={order.escrowAccount?.escrowRef ?? null}
            funded={(order.escrowAccount?.fundedAmount ?? 0) > 0}
            partners={ESCROW_PARTNERS.map((p) => ({
              code: p.code,
              name: p.name,
              region: p.region,
              status: p.status,
            }))}
          />
        </Panel>
      )}

      {/* Finance watches the money while the order runs; the signable P&L
          waits for the end of the flow. Cash, not goods — see cash-flows.ts. */}
      {team === 'ONE_BUY_FINANCE' && deliverables.input && (
        <LiveCashPanel input={deliverables.input} />
      )}

      {SEES_LIABILITY.has(team) && (
        <TeamLiabilityPanel
          team={team}
          buyIncoterms={order.incoterms}
          sellIncoterms={order.customerPo.incoterms}
        />
      )}


      {/* The CHA's document portal, on the desk that coordinates the CHA. */}
      {team === 'ONE_BUY_INBOUND' && eSanchit && (
        <ESanchitPanel orderId={order.id} status={eSanchit} />
      )}

      {/*
        Steps and correspondence are the two things a desk does on an order, so
        they are two tabs of one panel rather than two stacked panels — the same
        treatment the queues get, for the same reason.

        Communication lives HERE, inside the order, and not as a cross-order
        inbox on the workspace. A message about an order without the order in
        front of you is a message you cannot act on, and one filed from a
        cross-order list is one filed with the order as an afterthought. Every
        message on this tab is this order's, and lands on this order's thread
        and audit trail.
      */}
      <Panel padded={false}>
        {/*
          ── Side navigation, not a tab strip ──────────────────────────────

          Six sections in a horizontal strip is a scroll on any laptop and a
          guessing game as to what is off the right edge. Down the side they are
          all visible at once, the counts line up in a column the eye can read,
          and adding a seventh costs nothing.

          Below `lg` the same list becomes a drawer rather than being dropped:
          the sections are the navigation, so hiding them on a narrow screen
          would leave the order with no way through it.
        */}
        <Tabs.Root
          value={section}
          onValueChange={setSection}
          orientation="vertical"
          className="grid min-w-0 lg:grid-cols-[210px_minmax(0,1fr)]"
        >
          {/* The drawer's handle — narrow screens only. */}
          <div className="border-line-subtle flex min-w-0 items-center gap-2 border-b px-3 py-2 lg:hidden">
            <Dialog.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
              <Dialog.Trigger asChild>
                <button
                  type="button"
                  className="border-line-subtle text-fg hover:bg-surface-3 inline-flex min-w-0 items-center gap-2 rounded-[8px] border px-2.5 py-1.5 text-[12.5px] font-medium transition-colors"
                >
                  <PanelLeft className="size-4 shrink-0" strokeWidth={2} aria-hidden />
                  <span className="min-w-0 truncate">{activeSection?.label ?? 'Sections'}</span>
                  {(activeSection?.count ?? 0) > 0 && (
                    <span className="bg-accent-subtle text-accent-text tnum rounded-full px-1.5 text-[10.5px]">
                      {activeSection?.count}
                    </span>
                  )}
                </button>
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px]" />
                <Dialog.Content className="bg-surface-1 border-line shadow-e4 fixed top-0 left-0 z-50 flex h-full w-[min(84vw,290px)] flex-col border-r">
                  <div className="border-line-subtle flex items-center gap-2 border-b px-3 py-2.5">
                    <Dialog.Title className="text-fg min-w-0 flex-1 truncate text-[13px] font-semibold">
                      {order.alias}
                    </Dialog.Title>
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
                  <Dialog.Description className="sr-only">
                    Sections of this order
                  </Dialog.Description>
                  <Tabs.List
                    aria-label="Sections of this order"
                    className="flex min-w-0 flex-col gap-0.5 overflow-y-auto p-2"
                  >
                    {sections.map((t) => (
                      <SectionTab key={t.value} {...t} onSelect={() => setDrawerOpen(false)} />
                    ))}
                  </Tabs.List>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
          </div>

          {/* The persistent rail — wide screens. Sticky, so it stays reachable
              on a long Communication thread. */}
          <Tabs.List
            aria-label="This order, from this team's desk"
            className="border-line-subtle hidden min-w-0 flex-col gap-0.5 self-start border-r p-2 lg:sticky lg:top-4 lg:flex"
          >
            {sections.map((t) => (
              <SectionTab key={t.value} {...t} />
            ))}
          </Tabs.List>

          <Tabs.Content value="steps" className="min-w-0 outline-none">
            <div className="p-4 pb-0">
              <PanelHeader
                title="Your steps on this order"
                description={`${mine.length} of the order's steps are yours — ${outstanding} still outstanding. Everything else on this order is somebody else's and is not shown.`}
              />
            </div>
            {mine.length === 0 ? (
              <EmptyState
                title="Nothing on this order is yours"
                description="No step on this order is owned by this team or waiting on its action. It appeared in your queue because the step after the current one is yours."
              />
            ) : (
              <FlowStepsPanel
                currentStage={order.stage}
                ctx={ctx}
                completedStageIds={order.computed.completedStageIds}
                evidence={order.stageEvidence.map((r) => ({
                  stageId: r.stageId,
                  values: JSON.parse(r.values) as Record<string, unknown>,
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
                ownerFilter={team}
              />
            )}
          </Tabs.Content>

          {/* A team narrowed to its own steps still has to know WHAT it is
              handling. Inspection cannot check a marking without the part
              number; outbound cannot pack without the quantities. */}
          <Tabs.Content value="order" className="min-w-0 p-4 outline-none">
            <TeamOrderFactsPanel
              team={team}
              facts={{
                alias: order.alias,
                soNumber: order.soNumber,
                customerPo: order.customerPo.poNumber,
                customerPi: order.customerPi?.piNumber ?? null,
                supplierPo: order.supplierPo.poNumber,
                supplierPi: order.supplierPi?.piNumber ?? null,
                customer: order.customerPo.customer.name,
                customerGstin: order.customerPo.customer.gstin,
                supplier: order.supplierPo.supplier.name,
                supplierCountry: order.supplierPo.supplier.country,
                paymentMethod: order.paymentMethod,
                creditDays: order.creditDays,
                testingRequired: order.testingRequired,
                testScope: order.testScope,
                buyIncoterms: order.incoterms,
                sellIncoterms: order.customerPo.incoterms,
                buyCurrency: order.buyCurrency,
                fxRate: order.fxRate,
                sellValue: order.sellValue,
                buyValue: order.buyValue,
                requestedDelivery: order.customerPo.requestedDeliveryDate,
                createdAt: order.createdAt,
              }}
              items={order.customerPo.lines.map((l) => ({
                id: l.id,
                lineNo: l.lineNo,
                mpn: l.mpn,
                manufacturer: l.manufacturer,
                description: l.description,
                hsnCode: l.hsnCode,
                quantity: l.quantity,
                uom: l.uom,
                unitPrice: l.unitPrice,
                lineTotal: l.lineTotal,
                // Matched by part number: the two orders are written by
                // different parties and their line numbering need not agree.
                unitCost: order.supplierPo.lines.find((sl) => sl.mpn === l.mpn)?.unitPrice ?? null,
                buyCurrency: order.buyCurrency,
                testingRequired: l.testingRequired,
              }))}
            />
          </Tabs.Content>

          {movesGoods && (
            <Tabs.Content value="logistics" className="min-w-0 p-4 outline-none">
              <div className="flex min-w-0 flex-col gap-4">
                <AppointCarrier orderId={order.id} slots={legSlots} />
                <TeamLogisticsPanel team={team} shipments={shipments} />

                {/*
                  The events that happen between the steps.

                  Inbound only: the outbound leg is a domestic movement to a
                  customer and has an entirely different set of things that go
                  wrong. Offering an appraiser's query on an outbound consignment
                  would be offering a control nobody could ever use.
                */}
                {team === 'ONE_BUY_INBOUND' && (
                  <div className="border-line-subtle mt-4 border-t pt-4">
                    <InboundEventsPanel
                      orderId={order.id}
                      currentStage={order.stage}
                      buyIncoterms={order.incoterms}
                      openEvents={order.inboundEvents
                        .filter((e) => e.status === 'OPEN')
                        .map((e) => ({
                          id: e.id,
                          eventId: e.eventId,
                          stageId: e.stageId,
                          note: e.note,
                          bearerParty: e.bearerParty,
                          effect: e.effect,
                          openedAt: e.openedAt,
                        }))}
                    />
                  </div>
                )}
              </div>
            </Tabs.Content>
          )}

          {/* What this team must PRODUCE, as opposed to what already exists.
              Kept separate from Documents for that reason: one is a to-do list
              with a gate on it, the other is a register of what is filed. */}
          <Tabs.Content value="paperwork" className="min-w-0 p-4 outline-none">
            <DeliverablesPanel
              orderId={order.id}
              slots={deliverables.slots}
              input={deliverables.input}
            />
          </Tabs.Content>

          <Tabs.Content value="docs" className="min-w-0 p-4 outline-none">
            <TeamDocumentsPanel
              team={team}
              orderAlias={order.alias}
              docs={order.documents.map((d) => ({
                id: d.id,
                docType: d.docType,
                title: d.title,
                fileName: d.fileName,
                stageId: d.stageId,
                uploadedBy: d.uploadedBy,
                createdAt: d.createdAt,
                version: d.version,
                sizeBytes: d.sizeBytes,
                bodyText: d.bodyText,
              }))}
            />
          </Tabs.Content>

          <Tabs.Content value="comms" className="min-w-0 p-4 outline-none">
            {/* The agent sits in the thread, not beside it. Its replies are
                ordinary messages authored by "Autonomous agent · <team>", each
                quoting the mail it was drafted from — so the email and the
                reply read together and either can be audited against the other. */}
            <AgentInThreadNote team={team} order={order} />
            {/* The order page's own thread, sent as this team. Same component,
                same records — not a second inbox that would drift from it. */}
            <CommunicationTab order={order} fromTeam={team} />
          </Tabs.Content>
        </Tabs.Root>
      </Panel>
    </PageShell>
  );
}

/**
 * One tab of the order panel, carrying its count.
 *
 * Same treatment as the workspace queues — attached to the panel's top edge and
 * underlined into its border — so moving between the two screens does not mean
 * relearning what a tab looks like.
 */
function SectionTab({
  value,
  icon: Icon,
  label,
  count,
  onSelect,
}: {
  value: string;
  icon: LucideIcon;
  label: string;
  count: number;
  /** Closes the drawer when the rail is rendered inside one. */
  onSelect?: () => void;
}) {
  return (
    <Tabs.Trigger
      value={value}
      onClick={onSelect}
      className={cn(
        'group flex w-full min-w-0 items-center gap-2 rounded-[8px] px-2.5 py-2 text-left',
        'text-[12.5px] transition-colors',
        'text-fg-secondary hover:text-fg hover:bg-surface-3',
        'data-[state=active]:bg-accent-subtle data-[state=active]:text-accent-text data-[state=active]:font-medium',
        'focus-visible:ring-accent/40 focus-visible:ring-2 focus-visible:outline-none',
      )}
    >
      <Icon className="size-4 shrink-0" strokeWidth={2} aria-hidden />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count > 0 && (
        <span
          className={cn(
            'tnum shrink-0 rounded-full px-1.5 text-[10.5px] transition-colors',
            'bg-surface-3 text-fg-secondary',
            'group-data-[state=active]:bg-accent group-data-[state=active]:text-accent-fg',
          )}
        >
          {count}
        </span>
      )}
    </Tabs.Trigger>
  );
}
