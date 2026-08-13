'use client';

/**
 * ONE TEAM'S WORKSPACE.
 *
 * The Control Tower is the master terminal and answers "where is everything".
 * This answers "what do I do next", which is a different question with a
 * different shape: a ranked list of the things that are actually mine, and
 * enough of everyone else's to know who I am waiting on and who I am holding up.
 *
 * The ordering of the page is the ordering of the questions:
 *   1. how much is on me, and how much of it is late
 *   2. what to open first
 *   3. who is blocking me, and who I am blocking
 *   4. what is heading my way
 *
 * Everything below the first section is reference. A team that only ever reads
 * the top of this page should still be doing the right work.
 */

import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  CircleCheck,
  Clock,
  Inbox,
  ListChecks,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { TeamWorkspace } from '@/lib/queries/team';
import type { OrderRow } from '@/lib/queries/orders';
import { STAKEHOLDER_META, TEAM_SLUGS, type Stakeholder } from '@/lib/domain/enums';
import { PageHeader, PageShell, Panel, PanelHeader, EmptyState, Money, MonoId } from '@/components/ui/Layout';
import { Chip, StakeholderBadge } from '@/components/ui/Badges';
import { usePreferences } from '@/components/providers/Preferences';
import { cn, humanDuration } from '@/lib/utils';

export function TeamWorkspaceView({
  workspace,
  loads,
  slug,
}: {
  workspace: TeamWorkspace;
  loads: Record<string, { needsMe: number; overdue: number }>;
  slug: string;
}) {
  const { label: pick } = usePreferences();
  const { queues } = workspace;
  const meta = STAKEHOLDER_META[workspace.team];

  return (
    <PageShell width="full">
      <PageHeader
        title={meta.label}
        description={`${pick(meta.label, meta.plainLabel)} — only the orders this team has to act on. The Control Tower still shows every order.`}
      />

      <TeamSwitcher current={slug} loads={loads} />

      {/* ── 1. How much is on me ─────────────────────────────────────────── */}
      <div className="grid min-w-0 grid-cols-2 gap-2.5 @[720px]:grid-cols-4">
        <Tile
          label="On your desk"
          value={String(queues.needsMe.length)}
          sub={`of ${workspace.totalActive} active orders`}
          icon={ListChecks}
        />
        <Tile
          label="Overdue"
          value={String(queues.overdue)}
          sub={queues.overdue ? 'past the expected time' : 'nothing late'}
          icon={Clock}
          tone={queues.overdue ? 'warning' : 'neutral'}
        />
        <Tile
          label="Blocked"
          value={String(queues.blocked)}
          sub={queues.blocked ? 'stopped until someone acts' : 'nothing stopped'}
          icon={Ban}
          tone={queues.blocked ? 'danger' : 'neutral'}
        />
        <Tile
          label="Value on your desk"
          value={<Money amount={workspace.valueOnDesk} compact withSymbol />}
          sub="what you are answerable for now"
          icon={Wallet}
        />
      </div>

      {/* ── 2. What to open first ────────────────────────────────────────── */}
      <Panel>
        <PanelHeader
          title="Needs you now"
          description="The next action on each of these is yours. Most urgent first — stopped before late, late before on track."
          icon={ListChecks}
        />
        {queues.needsMe.length === 0 ? (
          <EmptyState
            icon={CircleCheck}
            title="Your queue is clear"
            description="Nothing is waiting on this team. Anything you are answerable for is with somebody else — see who, below."
          />
        ) : (
          <ul className="divide-line-subtle -mx-4 divide-y">
            {queues.needsMe.map((o) => (
              <QueueRow key={o.id} order={o} showWaitingOn={false} />
            ))}
          </ul>
        )}
      </Panel>

      {/* ── 3. The handoffs, both directions ─────────────────────────────── */}
      <div className="grid min-w-0 grid-cols-1 gap-4 @[860px]:grid-cols-2">
        <Panel>
          <PanelHeader
            title="You are waiting on"
            description="Yours to answer for, but the next move is somebody else's. This is why the rest is not moving."
            icon={Clock}
          />
          <HandoffList
            rows={workspace.waitingOn}
            empty="Nothing of yours is sitting with anyone else."
          />
        </Panel>
        <Panel>
          <PanelHeader
            title="You are holding up"
            description="Orders somebody else answers for, where the next move is yours. Clearing these unblocks another team."
            icon={AlertTriangle}
          />
          <HandoffList
            rows={workspace.holdingUp}
            empty="You are not holding anybody up."
            tone="warning"
          />
        </Panel>
      </div>

      {/* ── 4. What is heading this way ──────────────────────────────────── */}
      <Panel>
        <PanelHeader
          title="Heading your way"
          description="Not yours yet — the step after the one they are on is. Worth knowing before it lands."
          icon={Inbox}
        />
        {queues.incoming.length === 0 ? (
          <EmptyState compact title="Nothing inbound" description="No order is one step away from this team." />
        ) : (
          <ul className="divide-line-subtle -mx-4 divide-y">
            {queues.incoming.map((o) => (
              <QueueRow key={o.id} order={o} showWaitingOn />
            ))}
          </ul>
        )}
      </Panel>

      {/* Waiting is reference, so it sits last and stays collapsed-feeling. */}
      {queues.waiting.length > 0 && (
        <Panel>
          <PanelHeader
            title="Yours, but not actionable"
            description="You are accountable for these; there is nothing to do until the other party moves."
          />
          <ul className="divide-line-subtle -mx-4 divide-y">
            {queues.waiting.map((o) => (
              <QueueRow key={o.id} order={o} showWaitingOn />
            ))}
          </ul>
        </Panel>
      )}
    </PageShell>
  );
}

/**
 * Moving between teams, with each one's load on the chip.
 *
 * The counts are the point. A switcher that only names the teams makes someone
 * click through five workspaces to find where the pressure is; naming the number
 * means they can see it before they move.
 */
function TeamSwitcher({
  current,
  loads,
}: {
  current: string;
  loads: Record<string, { needsMe: number; overdue: number }>;
}) {
  return (
    <nav
      aria-label="Team workspaces"
      className="border-line-subtle bg-surface-2 flex min-w-0 flex-wrap gap-0.5 self-start rounded-[9px] border p-0.5"
    >
      {Object.entries(TEAM_SLUGS).map(([slug, team]) => {
        const load = loads[team] ?? { needsMe: 0, overdue: 0 };
        const active = slug === current;
        return (
          <Link
            key={slug}
            href={`/teams/${slug}`}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex min-w-0 items-center gap-1.5 rounded-[7px] px-3 py-1.5 text-[12.5px] font-medium transition-colors',
              active
                ? 'bg-surface-1 text-fg shadow-e1'
                : 'text-fg-secondary hover:text-fg hover:bg-surface-3',
            )}
          >
            {STAKEHOLDER_META[team].short}
            {load.needsMe > 0 && (
              <span
                className={cn(
                  'tnum rounded-full px-1.5 text-[10.5px]',
                  load.overdue > 0 ? 'bg-warning-subtle text-warning' : 'bg-surface-3 text-fg-secondary',
                )}
              >
                {load.needsMe}
              </span>
            )}
          </Link>
        );
      })}
      <Link
        href="/dashboard"
        className="text-fg-tertiary hover:text-fg-secondary hover:bg-surface-3 flex min-w-0 items-center gap-1.5 rounded-[7px] px-3 py-1.5 text-[12.5px] transition-colors"
      >
        Everything
        <ArrowRight className="size-3 shrink-0" strokeWidth={2} aria-hidden />
      </Link>
    </nav>
  );
}

/** One order in a queue. The stage and why it is urgent, then who has it. */
function QueueRow({ order, showWaitingOn }: { order: OrderRow; showWaitingOn: boolean }) {
  return (
    <li className="min-w-0">
      <Link
        href={`/orders/${order.id}`}
        className="hover:bg-surface-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 transition-colors"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
            <MonoId value={order.alias} copyable={false} />
            {order.isBlocked && (
              <Chip tone="danger" size="sm" icon={Ban}>
                Blocked
              </Chip>
            )}
            {!order.isBlocked && order.slaStatus === 'BREACHED' && (
              <Chip tone="warning" size="sm" icon={Clock}>
                Overdue
              </Chip>
            )}
            <span className="text-fg-tertiary min-w-0 truncate text-[11.5px]">
              {order.customerName}
            </span>
          </span>
          <span className="text-fg-secondary text-[12px]">
            <span className="text-fg-tertiary font-mono text-[10.5px]">{order.stageCode}</span>{' '}
            {order.stageLabel}
            {order.isBlocked && order.blockReason ? (
              <span className="text-danger"> — {order.blockReason}</span>
            ) : (
              <span className="text-fg-tertiary">
                {' · '}
                {humanDuration(order.hoursInStage)} here
              </span>
            )}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {showWaitingOn && <StakeholderBadge stakeholder={order.nextActionOwner} short />}
          <Money amount={order.sellValue} compact withSymbol />
        </span>
      </Link>
    </li>
  );
}

/** Who is on the other end of a handoff, and how many orders sit there. */
function HandoffList({
  rows,
  empty,
  tone,
}: {
  rows: { party: Stakeholder; label: string; count: number }[];
  empty: string;
  tone?: 'warning';
}) {
  if (rows.length === 0) {
    return <EmptyState compact title="Nothing here" description={empty} />;
  }
  return (
    <ul className="divide-line-subtle -mx-4 divide-y">
      {rows.map((r) => (
        <li key={r.party} className="flex min-w-0 items-center gap-3 px-4 py-2">
          <StakeholderBadge stakeholder={r.party} />
          <span className="text-fg-tertiary min-w-0 flex-1 truncate text-[11.5px]">
            {STAKEHOLDER_META[r.party].plainLabel}
          </span>
          <span
            className={cn(
              'tnum shrink-0 rounded-[6px] px-2 py-0.5 text-[12px] font-medium',
              tone === 'warning' ? 'bg-warning-subtle text-warning' : 'bg-surface-3 text-fg-secondary',
            )}
          >
            {r.count} {r.count === 1 ? 'order' : 'orders'}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Tile({
  label,
  value,
  sub,
  icon: Icon,
  tone = 'neutral',
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  icon: LucideIcon;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}) {
  const toneClass = {
    neutral: 'text-fg-tertiary',
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-danger',
  }[tone];

  return (
    <div className="bg-surface-1 border-line-subtle min-w-0 rounded-[11px] border p-3">
      <div className="flex min-w-0 items-center gap-1.5">
        <Icon className={cn('size-3.5 shrink-0', toneClass)} strokeWidth={2} aria-hidden />
        <span className="text-fg-tertiary truncate text-[10.5px] font-semibold tracking-[0.04em] uppercase">
          {label}
        </span>
      </div>
      <div className="tnum text-fg mt-1.5 text-[21px] leading-none font-semibold tracking-[-0.01em]">
        {value}
      </div>
      {sub && <div className="text-fg-tertiary mt-1 truncate text-[11px]">{sub}</div>}
    </div>
  );
}
