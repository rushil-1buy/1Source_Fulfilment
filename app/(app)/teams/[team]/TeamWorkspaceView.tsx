"use client";

import { useState } from "react";

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
 *
 * There is no team switcher on the page. The sidebar already lists all five
 * desks, and a second set of the same links directly beneath the page title was
 * one navigation too many for a screen whose job is to show one team's work.
 */

import * as Tabs from "@radix-ui/react-tabs";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  Inbox,
  Layers,
  ListChecks,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { TeamWorkspace } from "@/lib/queries/team";
import type { OrderRow } from "@/lib/queries/orders";
import { STAKEHOLDER_META } from "@/lib/domain/enums";
import { PageHeader, PageShell, Panel } from "@/components/ui/Layout";
import {
  RecordTable,
  type ColumnSpec,
  type RecordRow,
} from "@/components/ui/RecordTable";
import { usePreferences } from "@/components/providers/Preferences";
import { cn } from "@/lib/utils";

/** Shared across every queue, so a row means the same thing on each tab. */
const QUEUE_COLUMNS: ColumnSpec[] = [
  {
    key: "alias",
    label: "Order",
    termKey: "workOrder",
    kind: "mono",
    mobile: "primary",
    width: "150px",
  },
  {
    // Named for what a team actually asks — "where is it?" — not for the
    // schema's word. The code rides along with the label because B3 is what
    // gets said out loud and the sentence is what makes it mean something.
    key: "stage",
    label: "Step it is on",
    termKey: "stage",
    mobile: "secondary",
    width: "250px",
  },
  {
    // The step alone does not say how bad a delay is. A phase and a "step N of
    // M" do: stalled at B3 of 36 is a sourcing problem with room to recover,
    // stalled at G4 of 36 is a customer already expecting delivery.
    key: "phase",
    label: "Phase",
    termKey: "phase",
    mobile: "meta",
    width: "215px",
  },
  {
    key: "progress",
    label: "Progress",
    mobile: "meta",
    width: "130px",
  },
  { key: "customer", label: "Customer", mobile: "meta" },
  {
    key: "state",
    label: "State",
    termKey: "slaStatus",
    kind: "chip",
    mobile: "meta",
    width: "120px",
  },
  {
    key: "here",
    label: "Hours at this step",
    kind: "number",
    mobile: "meta",
    width: "150px",
  },
  {
    key: "value",
    label: "Order value",
    termKey: "sellValue",
    kind: "money",
    mobile: "meta",
    width: "150px",
  },
];

/** Queues that name a counterparty get one extra column; the rest share the base. */
const withParty = (label: string): ColumnSpec[] => {
  // Slot the counterparty in after Progress, wherever Customer happens to be —
  // an index would silently point at the wrong column the next time this list
  // changes, and the failure would look like a formatting bug, not a wrong one.
  const at = QUEUE_COLUMNS.findIndex((c) => c.key === "customer");
  return [
    ...QUEUE_COLUMNS.slice(0, at),
    { key: "party", label, kind: "chip", mobile: "meta", width: "160px" },
    ...QUEUE_COLUMNS.slice(at),
  ];
};

/**
 * `slug` routes rows into the TEAM-scoped order view rather than the full one.
 *
 * That view shows only this team's steps; the full order is one click further
 * on, and is still where evidence is recorded and the order advanced.
 */
function toRows(
  orders: OrderRow[],
  slug: string,
  party?: "nextActionOwner" | "owner",
): RecordRow[] {
  return orders.map((o) => ({
    id: o.id,
    href: `/teams/${slug}/orders/${o.id}`,
    alias: o.alias,
    stage: `${o.stageCode} ${o.stageLabel}`,
    phase: `${o.phase} · ${o.phaseLabel}`,
    // "Step 6 of 36" rather than a bare code: B3 says where, not how far, and an
    // order stuck near the end is a different problem from one stuck at the start.
    progress: `Step ${o.stepsDone + 1} of ${o.stepsTotal}`,
    customer: o.customerName,
    // Blocked outranks late: one is behind, the other has stopped entirely.
    state: o.isBlocked
      ? "Blocked"
      : o.slaStatus === "BREACHED"
        ? "Overdue"
        : o.slaStatus === "AT_RISK"
          ? "At risk"
          : "On track",
    here: Math.round(o.hoursInStage),
    value: o.sellValue,
    ...(party ? { party: STAKEHOLDER_META[o[party]].short } : {}),
  }));
}

export function TeamWorkspaceView({
  workspace,
  slug,
}: {
  workspace: TeamWorkspace;
  /** Only for building row hrefs and export filenames — no switcher any more. */
  slug: string;
}) {
  const { label: pick } = usePreferences();
  const { queues } = workspace;
  /* Controlled, so the two roll-up tiles can open the list behind their number
     rather than being a figure with nowhere to go. */
  const [tab, setTab] = useState('needs');
  const meta = STAKEHOLDER_META[workspace.team];
  // Ours to act on but owned by somebody else — clearing these unblocks them.
  const holdingUp = queues.needsMe.filter((o) => o.owner !== workspace.team);

  return (
    <PageShell width="full">
      <PageHeader
        title={meta.label}
        description={`${pick(meta.label, meta.plainLabel)} — only the orders this team has to act on. The Control Tower still shows every order.`}
      />

      <div className="grid min-w-0 grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        <Tile
          label="On your desk"
          value={String(queues.needsMe.length)}
          sub={`of ${workspace.totalActive} active orders`}
          icon={ListChecks}
        />
        <Tile
          label="Overdue"
          value={String(queues.overdue)}
          sub={queues.overdue ? "past the expected time" : "nothing late"}
          icon={Clock}
          tone={queues.overdue ? "warning" : "neutral"}
        />
        <Tile
          label="Blocked"
          value={String(queues.blocked)}
          sub={
            queues.blocked ? "stopped until someone acts" : "nothing stopped"
          }
          icon={Ban}
          tone={queues.blocked ? "danger" : "neutral"}
        />
        <Tile
          label="Total orders"
          value={String(workspace.allOrders.length)}
          sub="every order this team touches"
          icon={Layers}
          onClick={() => setTab("all")}
        />
        <Tile
          label="Completed"
          value={String(workspace.completedOrders.length)}
          sub={
            workspace.completedOrders.length
              ? "delivered and closed"
              : "none closed yet"
          }
          icon={CheckCircle2}
          tone={workspace.completedOrders.length ? "success" : "neutral"}
          onClick={() => setTab("completed")}
        />
      </div>

      {/*
        The tab bar lives INSIDE the panel it controls, on its top edge.
        Floating above it as a separate pill, the strip read as its own object
        and nothing said which surface it governed. Attached, with the active
        tab underlined into the panel's own border, the relationship is the
        layout rather than something the reader has to infer.

        It scrolls rather than wraps: five tabs wrapping onto two ragged rows at
        a narrow width looked broken, and one clean row that moves is calmer
        than two that do not.
      */}
      <Panel padded={false}>
        <Tabs.Root value={tab} onValueChange={setTab} className="min-w-0">
          <Tabs.List
            aria-label="This team's queues"
            className="border-line-subtle flex min-w-0 gap-1 overflow-x-auto border-b px-3"
          >
            <QueueTab
              value="needs"
              icon={ListChecks}
              label="Needs you now"
              count={queues.needsMe.length}
            />
            <QueueTab
              value="waiting"
              icon={Clock}
              label="Waiting on"
              count={queues.waiting.length}
            />
            <QueueTab
              value="holding"
              icon={AlertTriangle}
              label="Holding up"
              count={holdingUp.length}
            />
            <QueueTab
              value="incoming"
              icon={Inbox}
              label="Heading your way"
              count={queues.incoming.length}
            />
            <QueueTab
              value="all"
              icon={Layers}
              label="All orders"
              count={workspace.allOrders.length}
            />
            <QueueTab
              value="completed"
              icon={CheckCircle2}
              label="Completed"
              count={workspace.completedOrders.length}
            />
          </Tabs.List>

          <Tabs.Content value="needs" className="min-w-0 outline-none">
            <QueuePanel
              note="The next action on each of these is yours. Ranked — stopped before late, late before on track."
              columns={QUEUE_COLUMNS}
              rows={toRows(queues.needsMe, slug)}
              exportName={`${slug}-needs-you-now`}
              searchPlaceholder="Search your queue…"
              emptyTitle="Your queue is clear"
              emptyDescription="Nothing is waiting on this team. Anything you answer for is with somebody else — see the other tabs."
            />
          </Tabs.Content>

          <Tabs.Content value="waiting" className="min-w-0 outline-none">
            <QueuePanel
              note="Yours to answer for, but the next move is somebody else's. This is why the rest is not moving."
              columns={withParty("Waiting on")}
              rows={toRows(queues.waiting, slug, "nextActionOwner")}
              exportName={`${slug}-waiting-on`}
              searchPlaceholder="Search what you are waiting on…"
              emptyTitle="Nothing sitting with anyone else"
              emptyDescription="Nothing of yours is parked with another party right now."
            />
          </Tabs.Content>

          <Tabs.Content value="holding" className="min-w-0 outline-none">
            <QueuePanel
              note="Orders somebody else answers for, where the next move is yours. Clearing these unblocks another team."
              columns={withParty("Holding up")}
              rows={toRows(holdingUp, slug, "owner")}
              exportName={`${slug}-holding-up`}
              searchPlaceholder="Search what you are holding up…"
              emptyTitle="You are not holding anybody up"
              emptyDescription="Every order waiting on you is one you also own, so nobody else is blocked by it."
            />
          </Tabs.Content>

          <Tabs.Content value="incoming" className="min-w-0 outline-none">
            <QueuePanel
              note="Not yours yet — the step after the one they are on is. Worth knowing before it lands."
              columns={withParty("With now")}
              rows={toRows(queues.incoming, slug, "nextActionOwner")}
              exportName={`${slug}-heading-your-way`}
              searchPlaceholder="Search what is heading your way…"
              emptyTitle="Nothing inbound"
              emptyDescription="No order is one step away from this team."
            />
          </Tabs.Content>

          <Tabs.Content value="all" className="min-w-0 outline-none">
            <QueuePanel
              note="Every order this team owns a step on, whatever stage it is standing at — the running list, not the worklist. Open one for its steps, its correspondence and its documents."
              columns={QUEUE_COLUMNS}
              rows={toRows(workspace.allOrders, slug)}
              exportName={`${slug}-all-orders`}
              searchPlaceholder="Search all of this team's orders…"
              emptyTitle="No orders yet"
              emptyDescription="No order on the platform has a step this team owns. That changes as soon as one is raised."
            />
          </Tabs.Content>

          <Tabs.Content value="completed" className="min-w-0 outline-none">
            <QueuePanel
              note="Closed and delivered, with the step they finished on. Everything filed against them — documents, correspondence, the full stage history — stays readable."
              columns={QUEUE_COLUMNS}
              rows={toRows(workspace.completedOrders, slug)}
              exportName={`${slug}-completed-orders`}
              searchPlaceholder="Search completed orders…"
              emptyTitle="Nothing closed yet"
              emptyDescription="No order this team works on has been closed out. Completed orders stay here permanently once they are."
            />
          </Tabs.Content>
        </Tabs.Root>
      </Panel>
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
  rowNoun = "orders",
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
    <>
      {/* One line saying what THIS tab means. Inside the panel and under the
          bar, so it reads as the tab's own subtitle rather than the page's. */}
      <p className="border-line-subtle text-fg-tertiary border-b px-4 py-2.5 text-[11.5px] leading-relaxed">
        {note}
      </p>
      {/*
        The table carries the panel's gutter, same as the note above it.

        Without this the search box, the rows and — most visibly — the
        pagination bar ran flush to the card's edge and out past its rounded
        corners, so the footer read as loose page furniture that had escaped the
        card rather than as the table's own base.
      */}
      <div className="min-w-0 px-4 pt-3 pb-3.5">
        <RecordTable
          columns={columns}
          rows={rows}
          rowNoun={rowNoun}
          searchPlaceholder={searchPlaceholder}
          exportName={exportName}
          emptyTitle={emptyTitle}
          emptyDescription={emptyDescription}
        />
      </div>
    </>
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
        "group flex shrink-0 items-center gap-1.5 rounded-t-[8px] border-b-2 border-transparent px-3 py-2.5",
        "text-[12.5px] whitespace-nowrap transition-colors",
        "text-fg-secondary hover:text-fg hover:bg-surface-3",
        "data-[state=active]:border-accent data-[state=active]:text-accent-text data-[state=active]:font-medium",
        "focus-visible:ring-accent/40 focus-visible:ring-2 focus-visible:outline-none",
      )}
    >
      <Icon className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
      <span>{label}</span>
      {count > 0 && (
        <span
          className={cn(
            "tnum rounded-full px-1.5 text-[10.5px] transition-colors",
            "bg-surface-3 text-fg-secondary",
            "group-data-[state=active]:bg-accent-subtle group-data-[state=active]:text-accent-text",
          )}
        >
          {count}
        </span>
      )}
    </Tabs.Trigger>
  );
}

function Tile({
  label,
  value,
  sub,
  icon: Icon,
  tone = "neutral",
  onClick,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  icon: LucideIcon;
  tone?: "neutral" | "success" | "warning" | "danger";
  /** Present when the tile opens the list behind the number. */
  onClick?: () => void;
}) {
  const toneClass = {
    neutral: "text-fg-tertiary",
    success: "text-success",
    warning: "text-warning",
    danger: "text-danger",
  }[tone];

  /*
   * A tile that opens something is a button and looks like one.
   *
   * The counts that only summarise the tabs below stay inert — making every
   * tile hoverable would promise five destinations and deliver two.
   */
  const Root = onClick ? "button" : "div";

  return (
    <Root
      {...(onClick ? { type: "button" as const, onClick } : {})}
      className={cn(
        "bg-surface-1 border-line-subtle min-w-0 rounded-[11px] border p-3",
        onClick &&
          "hover:border-line-strong hover:bg-surface-2 focus-visible:ring-accent/40 cursor-pointer text-left transition-colors focus-visible:ring-2 focus-visible:outline-none",
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <Icon
          className={cn("size-3.5 shrink-0", toneClass)}
          strokeWidth={2}
          aria-hidden
        />
        <span className="text-fg-tertiary truncate text-[10.5px] font-semibold tracking-[0.04em] uppercase">
          {label}
        </span>
      </div>
      <div className="tnum text-fg mt-1.5 text-[21px] leading-none font-semibold tracking-[-0.01em]">
        {value}
      </div>
      {sub && (
        <div className="text-fg-tertiary mt-1 truncate text-[11px]">{sub}</div>
      )}
    </Root>
  );
}
