'use client';

import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  CircleCheck,
  Clock,
  Landmark,
  ListChecks,
  Receipt,
  ShieldAlert,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import {
  EmptyState,
  Money,
  PageHeader,
  PageShell,
  Panel,
  PanelHeader,
} from '@/components/ui/Layout';
import { Chip, StatusChip } from '@/components/ui/Badges';
import { Hint, InfoTooltip } from '@/components/ui/InfoTooltip';
import { MicroRail } from '@/components/flow/FlowRail';
import type { OrderRow } from '@/lib/queries/orders';
import { PHASES, PHASE_DEFS } from '@/lib/domain/stages';
import {
  ROLE_META,
  STAKEHOLDER_META,
  TEAM_SLUGS,
  type Role,
  type Stakeholder,
} from '@/lib/domain/enums';
import { cn, humanDuration, relativeTime } from '@/lib/utils';

/**
 * Task owners are stored as either a stakeholder or an internal role. Both are
 * enum values, and neither should ever reach the screen raw — "WHL" and
 * "QCWarehouse" mean nothing to a reader.
 */
function ownerLabel(value: string): string {
  if (value in STAKEHOLDER_META) return STAKEHOLDER_META[value as Stakeholder].label;
  if (value in ROLE_META) return ROLE_META[value as Role].label;
  return value.replace(/([a-z])([A-Z])/g, '$1 $2');
}

export interface ControlTowerProps {
  rows: OrderRow[];
  /** Per-team queue depth, so the master terminal can route to the right desk. */
  teamLoads: Record<string, { needsMe: number; overdue: number }>;
  kpis: {
    activeOrders: number;
    valueInFlight: number;
    escrowHeld: number;
    openExceptions: number;
    slaBreaches: number;
    atRisk: number;
    avgCycleDays: number;
    realisedMargin: number;
    receivables: number;
    itcAvailable: number;
    dutyPayable: number;
    openTasks: number;
  };
  activity: {
    id: string;
    orderId: string;
    alias: string;
    toStage: string;
    actorLabel: string;
    createdAt: string;
  }[];
  tasks: {
    id: string;
    title: string;
    priority: string;
    dueAt: string | null;
    ownerRole: string | null;
    orderId: string | null;
    alias: string | null;
  }[];
}

export function ControlTower({ rows, kpis, activity, tasks, teamLoads }: ControlTowerProps) {
  const active = rows.filter((r) => r.status === 'ACTIVE' || r.status === 'BLOCKED');
  const attention = rows
    .filter((r) => r.isBlocked || (r.slaStatus !== 'ON_TRACK' && r.status !== 'CLOSED'))
    .sort((a, b) => Number(b.isBlocked) - Number(a.isBlocked) || b.hoursInStage - a.hoursInStage);

  // Phase distribution — magnitude across seven ordered phases, so ONE hue with
  // the count direct-labelled on each mark. Never a rainbow.
  const phaseCounts = PHASES.map((p) => ({
    phase: p,
    def: PHASE_DEFS[p],
    count: active.filter((r) => r.phase === p).length,
  }));
  const maxPhase = Math.max(1, ...phaseCounts.map((p) => p.count));

  return (
    <PageShell width="full">
      <PageHeader
        title="Control Tower"
        plainTitle="Overview"
        description="Where every order stands right now, what needs your attention, and where the money is."
      />

      {/* The way INTO the team desks.
          This screen is the master terminal — it can see everything, which is
          exactly why it needs a route to each team's own view. Without it the
          workspaces are reachable only from the sidebar, and an admin looking at
          a pile of overdue orders cannot tell whose desk they are stuck on. */}
      <div className="mb-4 min-w-0">
        <div className="text-fg-tertiary mb-1.5 text-[10.5px] font-semibold tracking-[0.04em] uppercase">
          On each team&rsquo;s desk
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-5">
          {Object.entries(TEAM_SLUGS).map(([slug, team]) => {
            const load = teamLoads[team] ?? { needsMe: 0, overdue: 0 };
            return (
              <Link
                key={slug}
                href={`/teams/${slug}`}
                className="bg-surface-1 border-line-subtle hover:bg-surface-3 block min-w-0 rounded-[11px] border p-3 transition-colors"
              >
                <div className="text-fg-tertiary truncate text-[10.5px] font-semibold tracking-[0.04em] uppercase">
                  {STAKEHOLDER_META[team].short}
                </div>
                <div className="mt-1.5 flex items-baseline gap-2">
                  <span className="tnum text-fg text-[21px] leading-none font-semibold tracking-[-0.01em]">
                    {load.needsMe}
                  </span>
                  {load.overdue > 0 && (
                    <span className="text-warning tnum text-[11px] font-medium">
                      {load.overdue} late
                    </span>
                  )}
                </div>
                <div className="text-fg-tertiary mt-1 truncate text-[11px]">
                  {load.needsMe === 0 ? 'queue clear' : 'waiting on them'}
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
        <Tile label="Active orders" termKey="workOrder" value={String(kpis.activeOrders)} icon={ListChecks} href="/orders" />
        <Tile
          label="Value in flight"
          termKey="sellValue"
          value={<Money amount={kpis.valueInFlight} compact withSymbol />}
          icon={TrendingUp}
          href="/orders"
        />
        <Tile
          label="Held in escrow"
          termKey="escrowHeld"
          value={<Money amount={kpis.escrowHeld} compact withSymbol />}
          icon={Landmark}
          href="/escrow"
        />
        <Tile
          label="Problems open"
          termKey="exceptionType"
          value={String(kpis.openExceptions)}
          icon={ShieldAlert}
          tone={kpis.openExceptions > 0 ? 'danger' : 'neutral'}
          href="/orders"
        />
        <Tile
          label="Overdue"
          termKey="slaStatus"
          value={String(kpis.slaBreaches)}
          sub={kpis.atRisk > 0 ? `${kpis.atRisk} more at risk` : undefined}
          icon={Clock}
          tone={kpis.slaBreaches > 0 ? 'warning' : 'neutral'}
          href="/orders"
        />
        <Tile
          label="Realised margin"
          termKey="trueMargin"
          value={<Money amount={kpis.realisedMargin} compact withSymbol />}
          sub={kpis.avgCycleDays ? `${kpis.avgCycleDays.toFixed(0)}d avg cycle` : undefined}
          icon={CircleCheck}
          tone="success"
          href="/reports"
        />
      </div>

      <Panel className="mb-4">
        <PanelHeader
          title="Where every active order is right now"
          description="Counts by phase. Click a phase to see those orders."
        />
        {active.length === 0 ? (
          <EmptyState compact title="No active orders" description="Everything is closed or not yet sourced." />
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
            {phaseCounts.map((p) => (
              <li key={p.phase} className="min-w-0">
                <Link
                  href="/orders"
                  className="border-line-subtle hover:bg-surface-3 block rounded-[9px] border p-2.5 transition-colors"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="bg-surface-3 text-fg-tertiary grid size-4 shrink-0 place-items-center rounded-full text-[9px] font-semibold">
                      {p.phase}
                    </span>
                    <span className="text-fg-secondary truncate text-[11.5px] font-medium">
                      {p.def.label}
                    </span>
                  </div>
                  <div className="mt-2 flex items-end gap-2">
                    <span className="tnum text-fg text-[22px] leading-none font-semibold">
                      {p.count}
                    </span>
                    <div className="mb-1 flex-1">
                      <div className="bg-surface-3 h-1.5 overflow-hidden rounded-full">
                        <div
                          className="bg-accent h-full rounded-full"
                          style={{ width: `${(p.count / maxPhase) * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Panel className="min-w-0">
          <PanelHeader
            title="Needs attention"
            description="Blocked orders first, then whatever has sat longest past its expected time."
            actions={
              <Link
                href="/orders"
                className="text-accent-text inline-flex items-center gap-1 text-[12px] hover:underline"
              >
                All orders <ArrowRight className="size-3" aria-hidden />
              </Link>
            }
          />
          {attention.length === 0 ? (
            <EmptyState
              compact
              title="Nothing needs attention"
              description="No order is blocked or running late. This is the state you want."
            />
          ) : (
            <ul className="divide-line-subtle -mx-4 divide-y">
              {attention.slice(0, 6).map((r) => (
                <li key={r.id}>
                  <Link href={`/orders/${r.id}`} className="hover:bg-surface-3 block px-4 py-2.5 transition-colors">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="font-mono text-[11.5px] font-medium">{r.alias}</span>
                      {r.isBlocked ? (
                        <Chip tone="danger" icon={AlertTriangle} size="sm">
                          Blocked
                        </Chip>
                      ) : (
                        <StatusChip status={r.slaStatus} size="sm" />
                      )}
                      <span className="text-fg-tertiary truncate text-[11.5px]">{r.customerName}</span>
                      <span className="ml-auto shrink-0">
                        <MicroRail
                          data={{
                            currentStage: r.stage,
                            ctx: r.ctx,
                            isBlocked: r.isBlocked,
                            stageEnteredAt: r.stageEnteredAt,
                            completedStageIds: r.completedStageIds,
                          }}
                        />
                      </span>
                    </div>
                    <div className="text-fg-secondary mt-1 text-[12px]">
                      {r.blockReason ? (
                        <span className="text-danger line-clamp-2">{r.blockReason}</span>
                      ) : (
                        <>
                          Stuck at <span className="font-medium">{r.stageLabel}</span> for{' '}
                          {humanDuration(r.hoursInStage)} — expected {humanDuration(r.expectedHours)}.
                        </>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="grid min-w-0 grid-cols-1 gap-4">
          <Panel>
            <PanelHeader title="Money" description="Where cash is committed, owed and recoverable." icon={Banknote} />
            <dl className="divide-line-subtle -mx-4 divide-y">
              <MoneyRow
                label="Held in escrow"
                termKey="escrowHeld"
                amount={kpis.escrowHeld}
                hint="Our exposure right now — funded but not yet released."
              />
              <MoneyRow label="Customer receivables" amount={kpis.receivables} hint="Invoiced but not yet paid." />
              <MoneyRow
                label="Import duty payable"
                termKey="bcd"
                amount={kpis.dutyPayable}
                hint="Assessed by customs but not yet paid."
              />
              <MoneyRow
                label="Input tax credit available"
                termKey="itc"
                amount={kpis.itcAvailable}
                tone="success"
                hint="GST already paid that we set against the GST we collect. Real money back — and the reason it must never be treated as cost."
              />
            </dl>
          </Panel>

          <Panel>
            <PanelHeader title="My action queue" description="Most urgent first." icon={ListChecks} />
            {tasks.length === 0 ? (
              <EmptyState compact title="Nothing assigned" description="Your queue is clear." />
            ) : (
              <ul className="divide-line-subtle -mx-4 divide-y">
                {tasks.map((t) => {
                  const overdue = t.dueAt ? new Date(t.dueAt).getTime() < Date.now() : false;
                  return (
                    <li key={t.id} className="px-4 py-2">
                      <Link href={t.orderId ? `/orders/${t.orderId}` : '/orders'} className="block">
                        <div className="flex min-w-0 items-start gap-2">
                          <span
                            className={cn(
                              'mt-1 size-1.5 shrink-0 rounded-full',
                              t.priority === 'URGENT'
                                ? 'bg-danger'
                                : t.priority === 'HIGH'
                                  ? 'bg-warning'
                                  : 'bg-line-strong',
                            )}
                            aria-hidden
                          />
                          <span className="min-w-0 flex-1">
                            <span className="text-fg block text-[12.5px] leading-snug">{t.title}</span>
                            <span className="text-fg-tertiary mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                              {t.alias && <span className="font-mono">{t.alias}</span>}
                              {t.ownerRole && <span>· {ownerLabel(t.ownerRole)}</span>}
                              {t.dueAt && (
                                <span className={overdue ? 'text-danger font-medium' : undefined}>
                                  · due {relativeTime(t.dueAt)}
                                </span>
                              )}
                            </span>
                          </span>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      <Panel className="mt-4">
        <PanelHeader
          title="Recent activity"
          description="Every stage change across all orders, newest first."
          icon={Receipt}
        />
        <ol className="divide-line-subtle -mx-4 divide-y">
          {activity.map((t) => (
            <li key={t.id} className="px-4 py-2">
              <Link
                href={`/orders/${t.orderId}`}
                className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px]"
              >
                <span className="font-mono text-[11px] font-medium">{t.alias}</span>
                <span className="text-fg-secondary min-w-0 truncate">
                  advanced to{' '}
                  <span className="text-fg font-medium">
                    {t.toStage.replace(/_/g, ' ').toLowerCase()}
                  </span>
                </span>
                <span className="text-fg-tertiary truncate">by {t.actorLabel}</span>
                <span className="text-fg-tertiary ml-auto shrink-0">{relativeTime(t.createdAt)}</span>
              </Link>
            </li>
          ))}
        </ol>
      </Panel>
    </PageShell>
  );
}

function Tile({
  label,
  value,
  sub,
  icon: Icon,
  tone = 'neutral',
  termKey,
  href,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  icon: LucideIcon;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
  termKey?: string;
  href?: string;
}) {
  const toneClass = {
    neutral: 'text-fg-tertiary',
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-danger',
  }[tone];

  return (
    <Link
      href={href ?? '/orders'}
      className="bg-surface-1 border-line-subtle hover:bg-surface-3 block min-w-0 rounded-[11px] border p-3 transition-colors"
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <Icon className={cn('size-3.5 shrink-0', toneClass)} strokeWidth={2} aria-hidden />
        <span className="text-fg-tertiary truncate text-[10.5px] font-semibold tracking-[0.04em] uppercase">
          {label}
        </span>
        {termKey && <InfoTooltip termKey={termKey} />}
      </div>
      {/* The tile IS the visualisation — a hero number, so no plot, no hover layer. */}
      <div className="tnum text-fg mt-1.5 text-[21px] leading-none font-semibold tracking-[-0.01em]">
        {value}
      </div>
      {sub && <div className="text-fg-tertiary mt-1 truncate text-[11px]">{sub}</div>}
    </Link>
  );
}

function MoneyRow({
  label,
  amount,
  termKey,
  tone,
  hint,
}: {
  label: string;
  amount: number;
  termKey?: string;
  tone?: 'success';
  hint: string;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 px-4 py-2">
      <dt className="text-fg-secondary flex min-w-0 items-center gap-1 text-[12.5px]">
        <Hint content={<span>{hint}</span>}>
          <span className="truncate">{label}</span>
        </Hint>
        {termKey && <InfoTooltip termKey={termKey} />}
      </dt>
      <dd className="shrink-0">
        <Money
          amount={amount}
          className={cn('text-[13px] font-semibold', tone === 'success' && 'text-success')}
        />
      </dd>
    </div>
  );
}
