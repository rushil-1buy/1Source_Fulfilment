import Link from 'next/link';
import { ArrowUpRight, Bot, PackageSearch } from 'lucide-react';
import { db } from '@/lib/db';
import { getStage } from '@/lib/domain/stages';
import { SIM_PREFIX } from '@/lib/domain/simulation-config';
import { PageHeader, PageShell, Panel, PanelHeader } from '@/components/ui/Layout';
import { Chip } from '@/components/ui/Badges';

/**
 * An order that is not there any more.
 *
 * The default 404 is a dead end, and this route reaches it by design: resetting
 * the simulator deletes the order it was pressed on, so anybody still holding
 * that URL — a second tab, a bookmark, a link pasted into a chat — lands here.
 * Telling them "this page could not be found" is true and useless when the
 * reason is knowable and the way forward is one click away.
 *
 * So it names the likely cause and offers the orders that DO exist, with the
 * live simulated ones first because they are what somebody who got here was
 * most probably looking at.
 */
export const dynamic = 'force-dynamic';

export default async function OrderNotFound() {
  const [sims, recent] = await Promise.all([
    db.workOrder.findMany({
      where: { alias: { startsWith: SIM_PREFIX } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, alias: true, stage: true },
      take: 5,
    }),
    db.workOrder.findMany({
      where: { alias: { not: { startsWith: SIM_PREFIX } } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, alias: true, stage: true },
      take: 5,
    }),
  ]);

  return (
    <PageShell width="narrow">
      <PageHeader
        title="That order is no longer here"
        description="The link points at a work order that does not exist any more."
      />

      <Panel>
        <PanelHeader
          title="What most likely happened"
          description="Two things remove an order, and one of them is a button."
        />
        <ul className="text-fg-secondary flex min-w-0 flex-col gap-2 text-[12.5px] leading-relaxed">
          <li className="flex min-w-0 items-start gap-2">
            <Bot className="text-accent-text mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden />
            <span>
              <strong className="text-fg font-medium">A simulation was reset.</strong> Reset deletes
              the simulated order and everything written against it, so a tab left open on it lands
              here. Creating another takes one click.
            </span>
          </li>
          <li className="flex min-w-0 items-start gap-2">
            <PackageSearch
              className="text-fg-tertiary mt-0.5 size-4 shrink-0"
              strokeWidth={2}
              aria-hidden
            />
            <span>
              <strong className="text-fg font-medium">The demonstration data was rebuilt.</strong>{' '}
              Re-seeding replaces every order, and the new ones carry new identifiers.
            </span>
          </li>
        </ul>

        {/*
          Links styled as buttons, not Buttons wrapping links.

          `icon={Bot}` passes a component REFERENCE across the server/client
          boundary, which React cannot serialise — the page crashed on render
          rather than rendering the recovery it exists to offer. An icon as a
          child is an element and crosses fine, and a link is the right element
          for navigation anyway.
        */}
        <div className="border-line-subtle mt-3 flex min-w-0 flex-wrap items-center gap-2 border-t pt-3">
          <Link
            href="/agentic"
            className="bg-accent text-accent-fg hover:bg-accent-hover inline-flex items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-[13px] font-medium transition-colors"
          >
            <Bot className="size-4 shrink-0" strokeWidth={2} aria-hidden />
            Go to the autonomous flow
          </Link>
          <Link
            href="/orders"
            className="border-line-subtle text-fg-secondary hover:bg-surface-3 hover:text-fg inline-flex items-center gap-1.5 rounded-[8px] border px-2.5 py-1.5 text-[13px] font-medium transition-colors"
          >
            See every order
          </Link>
        </div>
      </Panel>

      {sims.length > 0 && (
        <Panel>
          <PanelHeader
            title="Simulated orders that do exist"
            description="If you were looking at a simulation, it is probably one of these."
          />
          <ul className="flex min-w-0 flex-col gap-1.5">
            {sims.map((o) => (
              <li key={o.id} className="flex min-w-0 flex-wrap items-center gap-2 text-[12.5px]">
                <Chip tone="accent" size="sm">
                  {o.alias}
                </Chip>
                <span className="text-fg-secondary min-w-0 flex-1 truncate">
                  {getStage(o.stage).code} {getStage(o.stage).label}
                </span>
                <Link
                  href={`/orders/${o.id}`}
                  className="text-accent-text inline-flex items-center gap-1 font-medium hover:underline"
                >
                  Open
                  <ArrowUpRight className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {recent.length > 0 && (
        <Panel>
          <PanelHeader title="Recent orders" description="The most recently raised work orders." />
          <ul className="flex min-w-0 flex-col gap-1.5">
            {recent.map((o) => (
              <li key={o.id} className="flex min-w-0 flex-wrap items-center gap-2 text-[12.5px]">
                <span className="text-fg shrink-0 font-mono font-semibold">{o.alias}</span>
                <span className="text-fg-secondary min-w-0 flex-1 truncate">
                  {getStage(o.stage).code} {getStage(o.stage).label}
                </span>
                <Link
                  href={`/orders/${o.id}`}
                  className="text-accent-text inline-flex items-center gap-1 font-medium hover:underline"
                >
                  Open
                  <ArrowUpRight className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </PageShell>
  );
}
