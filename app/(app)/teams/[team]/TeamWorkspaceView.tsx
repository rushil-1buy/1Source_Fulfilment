'use client';

/**
 * ONE TEAM'S WORKSPACE.
 *
 * The Control Tower is the master terminal and answers "where is everything".
 * This answers "what do I do next", which is a different question with a
 * different shape: a ranked list of the things that are actually mine, and
 * enough of everyone else's to know who I am waiting on and who I am holding up.
 *
 * TABS, NOT STACKED PANELS. The queues were sections down a long scroll, which
 * put "nothing inbound" and "nothing to answer for" between the reader and
 * anything useful. As tabs the work is what loads, everything else is one click,
 * and the counts on the triggers mean nothing has to be opened to be seen.
 *
 * Every queue is the same table primitive the registers use, so a row reads the
 * same here as anywhere else in the app and the column tooltips come from the
 * same glossary. Opening one goes to the order — the team views are a lens over
 * the master flow, never a second copy of it, so anything done from here shows
 * up on the order's own rail, evidence and audit trail.
 */

import Link from 'next/link';
import * as Tabs from '@radix-ui/react-tabs';
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  Clock,
  Inbox,
  ListChecks,
  MessageSquare,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { TeamWorkspace } from '@/lib/queries/team';
import type { OrderRow } from '@/lib/queries/orders';
import { STAKEHOLDER_META, TEAM_SLUGS } from '@/lib/domain/enums';
import { PageHeader, PageShell, Panel } from '@/components/ui/Layout';
import { RecordTable, type ColumnSpec, type RecordRow } from '@/components/ui/RecordTable';
import { usePreferences } from '@/components/providers/Preferences';
import { cn } from '@/lib/utils';

/** Shared across every queue, so a row means the same thing on each tab. */
const QUEUE_COLUMNS: ColumnSpec[] = [
  { key: 'alias', label: 'Order', termKey: 'workOrder', kind: 'mono', mobile: 'primary', width: '150px' },
  { key: 'stage', label: 'Stage', termKey: 'stage', mobile: 'secondary', width: '230px' },
  { key: 'customer', label: 'Customer', mobile: 'meta' },
  { key: 'state', label: 'State', termKey: 'slaStatus', kind: 'chip', mobile: 'meta', width: '120px' },
  { key: 'here', label: 'Hours at this step', kind: 'number', mobile: 'meta', width: '150px' },
  { key: 'value', label: 'Order value', termKey: 'sellValue', kind: 'money', mobile: 'meta', width: '150px' },
];

/** Queues that name a counterparty get one extra column; the rest share the base. */
const withParty = (label: string): ColumnSpec[] => [
  ...QUEUE_COLUMNS.slice(0, 3),
  { key: 'party', label, kind: 'chip', mobile: 'meta', width: '160px' },
  ...QUEUE_COLUMNS.slice(3),
];

const MESSAGE_COLUMNS: ColumnSpec[] = [
  { key: 'occurredAt', label: 'When', kind: 'datetime', mobile: 'meta', width: '170px' },
  { key: 'alias', label: 'Order', termKey: 'workOrder', kind: 'mono', mobile: 'primary', width: '150px' },
  { key: 'direction', label: 'Direction', kind: 'chip', mobile: 'meta', width: '120px' },
  { key: 'counterparty', label: 'With', mobile: 'secondary', width: '190px' },
  { key: 'channel', label: 'Channel', mobile: 'hidden', width: '120px' },
  { key: 'subject', label: 'Subject', mobile: 'meta' },
];

function toRows(orders: OrderRow[], party?: 'nextActionOwner' | 'owner'): RecordRow[] {
  return orders.map((o) => ({
    id: o.id,
    href: `/orders/${o.id}`,
    alias: o.alias,
    stage: `${o.stageCode} ${o.stageLabel}`,
    customer: o.customerName,
    // Blocked outranks late: one is behind, the other has stopped entirely.
    state: o.isBlocked
      ? 'Blocked'
      : o.slaStatus === 'BREACHED'
        ? 'Overdue'
        : o.slaStatus === 'AT_RISK'
          ? 'At risk'
          : 'On track',
    here: Math.round(o.hoursInStage),
    value: o.sellValue,
    ...(party ? { party: STAKEHOLDER_META[o[party]].short } : {}),
  }));
}

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
  // Ours to act on but owned by somebody else — clearing these unblocks them.
  const holdingUp = queues.needsMe.filter((o) => o.owner !== workspace.team);

  return (
    <PageShell width="full">
      <PageHeader
        title={meta.label}
        description={`${pick(meta.label, meta.plainLabel)} — only the orders this team has to act on. The Control Tower still shows every order.`}
      />

      <TeamSwitcher current={slug} loads={loads} />

      <div className="grid min-w-0 grid-cols-3 gap-2.5">
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
      </div>

      <Tabs.Root defaultValue="needs" className="grid min-w-0 grid-cols-1 gap-3">
        <Tabs.List
          aria-label="This team's queues"
          className="border-line-subtle bg-surface-2 flex min-w-0 flex-wrap gap-0.5 self-start rounded-[9px] border p-0.5"
        >
          <QueueTab value="needs" icon={ListChecks} label="Needs you now" count={queues.needsMe.length} />
          <QueueTab value="waiting" icon={Clock} label="Waiting on" count={queues.waiting.length} />
          <QueueTab value="holding" icon={AlertTriangle} label="Holding up" count={holdingUp.length} />
          <QueueTab value="incoming" icon={Inbox} label="Heading your way" count={queues.incoming.length} />
          <QueueTab value="messages" icon={MessageSquare} label="Communication" count={workspace.messages.length} />
        </Tabs.List>

        <Tabs.Content value="needs" className="min-w-0 outline-none">
          <QueuePanel
            note="The next action on each of these is yours. Ranked — stopped before late, late before on track."
            columns={QUEUE_COLUMNS}
            rows={toRows(queues.needsMe)}
            exportName={`${slug}-needs-you-now`}
            searchPlaceholder="Search your queue…"
            emptyTitle="Your queue is clear"
            emptyDescription="Nothing is waiting on this team. Anything you answer for is with somebody else — see the other tabs."
          />
        </Tabs.Content>

        <Tabs.Content value="waiting" className="min-w-0 outline-none">
          <QueuePanel
            note="Yours to answer for, but the next move is somebody else's. This is why the rest is not moving."
            columns={withParty('Waiting on')}
            rows={toRows(queues.waiting, 'nextActionOwner')}
            exportName={`${slug}-waiting-on`}
            searchPlaceholder="Search what you are waiting on…"
            emptyTitle="Nothing sitting with anyone else"
            emptyDescription="Nothing of yours is parked with another party right now."
          />
        </Tabs.Content>

        <Tabs.Content value="holding" className="min-w-0 outline-none">
          <QueuePanel
            note="Orders somebody else answers for, where the next move is yours. Clearing these unblocks another team."
            columns={withParty('Holding up')}
            rows={toRows(holdingUp, 'owner')}
            exportName={`${slug}-holding-up`}
            searchPlaceholder="Search what you are holding up…"
            emptyTitle="You are not holding anybody up"
            emptyDescription="Every order waiting on you is one you also own, so nobody else is blocked by it."
          />
        </Tabs.Content>

        <Tabs.Content value="incoming" className="min-w-0 outline-none">
          <QueuePanel
            note="Not yours yet — the step after the one they are on is. Worth knowing before it lands."
            columns={withParty('With now')}
            rows={toRows(queues.incoming, 'nextActionOwner')}
            exportName={`${slug}-heading-your-way`}
            searchPlaceholder="Search what is heading your way…"
            emptyTitle="Nothing inbound"
            emptyDescription="No order is one step away from this team."
          />
        </Tabs.Content>

        <Tabs.Content value="messages" className="min-w-0 outline-none">
          <QueuePanel
            note="Correspondence on the orders this team is on, newest first. Messages are written against an order so they land on its own thread and its audit trail — open a row to read it or reply."
            columns={MESSAGE_COLUMNS}
            rows={workspace.messages.map((m) => ({
              id: m.id,
              href: `/orders/${m.orderId}?tab=communication`,
              occurredAt: m.occurredAt,
              alias: m.alias,
              direction:
                m.direction === 'INTERNAL' ? 'Internal' : m.direction === 'INBOUND' ? 'Received' : 'Sent',
              counterparty: m.counterparty,
              channel: m.channel,
              subject: m.subject,
            }))}
            rowNoun="messages"
            exportName={`${slug}-communication`}
            searchPlaceholder="Search messages…"
            emptyTitle="No correspondence yet"
            emptyDescription="Nothing has been logged against the orders on this desk. Open an order to send or record a message."
          />
        </Tabs.Content>
      </Tabs.Root>
    </PageShell>
  );
}

/**
 * A queue tab's body: one line saying what the tab means, then the table.
 *
 * The note is inside the panel rather than in a page-level header because each
 * tab means something different, and a description that changes with the tab is
 * the only kind worth having.
 */
function QueuePanel({
  note,
  columns,
  rows,
  exportName,
  searchPlaceholder,
  emptyTitle,
  emptyDescription,
  rowNoun = 'orders',
}: {
  note: string;
  columns: ColumnSpec[];
  rows: RecordRow[];
  exportName: string;
  searchPlaceholder: string;
  emptyTitle: string;
  emptyDescription: string;
  rowNoun?: string;
}) {
  return (
    <Panel padded={false}>
      <p className="border-line-subtle text-fg-tertiary border-b px-4 py-2 text-[11.5px] leading-relaxed">
        {note}
      </p>
      <RecordTable
        columns={columns}
        rows={rows}
        rowNoun={rowNoun}
        searchPlaceholder={searchPlaceholder}
        exportName={exportName}
        emptyTitle={emptyTitle}
        emptyDescription={emptyDescription}
      />
    </Panel>
  );
}

/** One tab, carrying its count so nothing has to be opened to be seen. */
function QueueTab({
  value,
  icon: Icon,
  label,
  count,
}: {
  value: string;
  icon: LucideIcon;
  label: string;
  count: number;
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
      <span className="truncate">{label}</span>
      {count > 0 && (
        <span className="bg-surface-3 text-fg-secondary tnum rounded-full px-1.5 text-[10.5px]">
          {count}
        </span>
      )}
    </Tabs.Trigger>
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
