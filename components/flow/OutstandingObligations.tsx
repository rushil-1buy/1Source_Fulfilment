'use client';

/**
 * What the order moved past without finishing.
 *
 * The flow lets the warehouse go on while Finance settles up, which is right —
 * a customer's delivery should not wait on an internal money step. The price of
 * that is a debt nobody is standing in front of any more, so it gets a banner
 * rather than a row in a tab: an obligation that is only visible to somebody
 * who goes looking for it is one that gets found by the supplier's collections
 * team first.
 *
 * Each one names who owes it, what leaving it costs, and the wall it will hit —
 * because "outstanding" on its own tells a desk there is a problem without
 * telling them whose or when it bites.
 */

import Link from 'next/link';
import { AlertTriangle, ArrowUpRight } from 'lucide-react';
import type { Obligation } from '@/lib/domain/obligations';
import { StakeholderBadge } from '@/components/ui/Badges';
import { slugForTeam } from '@/lib/domain/enums';

export function OutstandingObligations({
  obligations,
  orderId,
}: {
  obligations: Obligation[];
  orderId: string;
}) {
  if (obligations.length === 0) return null;

  return (
    <section
      aria-label="Outstanding obligations"
      className="border-warning-border bg-warning-subtle min-w-0 rounded-[11px] border p-3"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <AlertTriangle className="text-warning size-4 shrink-0" strokeWidth={2.2} aria-hidden />
        <span className="text-warning text-[11px] font-semibold tracking-[0.04em] uppercase">
          {obligations.length === 1
            ? 'One step was passed and is still owed'
            : `${obligations.length} steps were passed and are still owed`}
        </span>
      </div>

      <p className="text-fg-secondary mt-1.5 text-[12px] leading-relaxed">
        The order moved on so nothing downstream was held up. That deferred these — it did not
        discharge them.
      </p>

      <ul className="mt-2.5 flex min-w-0 flex-col gap-2">
        {obligations.map((o) => {
          const slug = slugForTeam(o.owedBy);
          return (
            <li
              key={o.stageId}
              className="bg-surface-1 border-warning-border/60 min-w-0 rounded-[9px] border p-2.5"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-fg-tertiary shrink-0 font-mono text-[10.5px]">{o.code}</span>
                <span className="text-fg min-w-0 flex-1 text-[12.5px] font-semibold">{o.label}</span>
                <StakeholderBadge stakeholder={o.owedBy} short />
              </div>
              <p className="text-fg-secondary mt-1 text-[11.5px] leading-relaxed">{o.cost}</p>
              <p className="text-fg-tertiary mt-1 text-[11px] leading-relaxed">
                {o.blockingNow ? (
                  <strong className="text-warning font-semibold">
                    The order cannot reach {o.blocksAtCode} {o.blocksAtLabel} until this is done.
                  </strong>
                ) : (
                  <>
                    The order may run on, but it will not pass {o.blocksAtCode} {o.blocksAtLabel}{' '}
                    while this is open.
                  </>
                )}
                {slug && (
                  <>
                    {' '}
                    <Link
                      href={`/teams/${slug}/orders/${orderId}`}
                      className="text-accent-text inline-flex items-center gap-1 font-medium hover:underline"
                    >
                      Open {o.owedByLabel}&rsquo;s view
                      <ArrowUpRight className="size-3 shrink-0" strokeWidth={2} aria-hidden />
                    </Link>
                  </>
                )}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
