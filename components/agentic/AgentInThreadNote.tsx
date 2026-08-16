'use client';

/**
 * The agent's standing in this team's thread.
 *
 * Sits above the correspondence rather than inside it, because it answers a
 * question the messages themselves cannot: how many of the replies below were
 * written by the agent, and can you tell which. The answer has to be yes —
 * an agent reply that reads as hand-written is the single most damaging thing
 * this feature could ship.
 *
 * Counts are derived from the thread itself, not asserted: a message is the
 * agent's when the sending participant is named as the agent.
 */

import { Bot } from 'lucide-react';
import type { OrderDetail } from '@/lib/queries/order-detail';
import { STAKEHOLDER_META, type Stakeholder } from '@/lib/domain/enums';
import { Chip } from '@/components/ui/Badges';

export function AgentInThreadNote({
  team,
  order,
}: {
  team: Stakeholder;
  order: OrderDetail;
}) {
  const agentSent = order.communications.filter((c) =>
    c.participants.some((p) => p.role === 'FROM' && p.name.startsWith('Autonomous agent')),
  );
  const quoting = agentSent.filter((c) => Boolean(c.quotedHistory));
  if (agentSent.length === 0) return null;

  return (
    <div className="border-accent-border bg-accent-subtle/40 mb-3 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-[10px] border px-3 py-2.5">
      <Bot className="text-accent-text size-4 shrink-0" strokeWidth={2} aria-hidden />
      <span className="text-fg min-w-0 flex-1 text-[12.5px] leading-relaxed">
        <strong className="font-semibold">The agent is in this thread.</strong> It has sent{' '}
        {agentSent.length} message{agentSent.length === 1 ? '' : 's'} for{' '}
        {STAKEHOLDER_META[team].short}
        {quoting.length > 0 && (
          <>
            , {quoting.length} of them quoting the email {quoting.length === 1 ? 'it was' : 'they were'}{' '}
            drafted from
          </>
        )}
        . Every one is attributed to the agent by name — expand a message to read the mail it
        answered directly above the reply.
      </span>
      <Chip tone="accent" size="sm">
        {agentSent.length} agent-sent
      </Chip>
    </div>
  );
}
