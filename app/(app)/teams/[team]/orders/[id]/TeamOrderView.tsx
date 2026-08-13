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
 * WHAT IT DELIBERATELY DOES NOT DO is offer a second place to record evidence
 * or advance the order. There is one advance gate, one evidence form and one
 * audit trail, and they live on the order. A parallel set here would be a second
 * implementation of the rules the whole platform rests on, and the two would
 * drift. Acting deep-links to the order instead, which is why anything done from
 * a team's desk still lands on the master flow.
 */

import Link from 'next/link';
import { ArrowLeft, ArrowUpRight, Ban, Clock } from 'lucide-react';
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
import { usePreferences } from '@/components/providers/Preferences';
import { FlowStepsPanel } from '@/app/(app)/orders/[id]/FlowStepsPanel';
import { formatDate } from '@/lib/utils';

export function TeamOrderView({
  order,
  team,
  slug,
}: {
  order: OrderDetail;
  team: Stakeholder;
  slug: string;
}) {
  const { label: pick } = usePreferences();
  const meta = STAKEHOLDER_META[team];

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

  const mine = applicableStages(ctx).filter(
    (s) => stageOwner(s, ctx) === team || stageNextActionOwner(s, ctx) === team,
  );
  const doneIds = new Set(order.computed.completedStageIds);
  const outstanding = mine.filter((s) => !doneIds.has(s.id)).length;

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
          <KeyValue label="Bought on" termKey="incoterms">
            <span className="font-mono">{order.incoterms}</span>
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
          <p className="text-fg-secondary border-line-subtle mt-3 border-t pt-3 text-[12px] leading-relaxed">
            The next action here is yours. Recording evidence and advancing happen on the order
            itself, so there is one gate and one audit trail —{' '}
            <Link href={`/orders/${order.id}`} className="text-accent-text underline">
              open the full order
            </Link>{' '}
            to do it.
          </p>
        )}
        {!onOurDesk && oursToAnswerFor && (
          <p className="text-fg-secondary border-line-subtle mt-3 border-t pt-3 text-[12px] leading-relaxed">
            You answer for this step, but the next move is{' '}
            {STAKEHOLDER_META[currentNext].label}&rsquo;s. There is nothing for you to do until they
            move.
          </p>
        )}
      </Panel>

      <Panel padded={false}>
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
            }))}
            manualSteps={order.customStages}
            ownerFilter={team}
          />
        )}
      </Panel>
    </PageShell>
  );
}
