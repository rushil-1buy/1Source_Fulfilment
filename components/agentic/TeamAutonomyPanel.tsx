'use client';

/**
 * What the agent would do for THIS desk, and what would still be theirs.
 *
 * The walkthrough answers the question at platform level. A team asks it
 * differently — "what happens to my job?" — and deserves an answer on their own
 * screen rather than a link to a demo. So the same script is filtered to their
 * steps and stated plainly, including the honest part: which steps still come
 * back to them, and why.
 *
 * Finance gets the opposite message from everyone else, and it is not a
 * consolation prize. Their steps are held BY POLICY, with every check passing —
 * that is a statement about what the platform will not do without them.
 */

import Link from 'next/link';
import { ArrowUpRight, Bot, ShieldCheck, UserCheck } from 'lucide-react';
import { AGENTIC_SCRIPT, isAutonomousTeam } from '@/lib/domain/agentic-sim';
import { STAKEHOLDER_META, type Stakeholder } from '@/lib/domain/enums';
import { KeyValue, Panel, PanelHeader } from '@/components/ui/Layout';
import { Chip } from '@/components/ui/Badges';

export function TeamAutonomyPanel({ team }: { team: Stakeholder }) {
  const mine = AGENTIC_SCRIPT.filter((s) => s.team === team);
  if (mine.length === 0) return null;

  const autonomous = mine.filter((s) => s.mode === 'AUTONOMOUS');
  const kept = mine.filter((s) => s.mode !== 'AUTONOMOUS');
  const supervised = !isAutonomousTeam(team);
  const meta = STAKEHOLDER_META[team];

  return (
    <Panel>
      <PanelHeader
        title="Where this desk is heading"
        description={
          supervised
            ? `${meta.short} stays human-supervised. The agent prepares every one of these steps in full and files none of them — money leaving the business is the one action that cannot be undone by redoing a step.`
            : `The agent is planned to work these steps for ${meta.short}, so the desk handles the exceptions rather than the queue.`
        }
        actions={
          <Chip tone={supervised ? 'accent' : 'success'} size="sm" icon={supervised ? ShieldCheck : Bot}>
            {supervised ? 'Human-supervised' : 'Agent-assisted'}
          </Chip>
        }
      />

      <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3">
        <KeyValue label="Steps on this desk">{mine.length}</KeyValue>
        <KeyValue label={supervised ? 'Prepared for you' : 'Agent handles'}>
          {supervised ? mine.length : autonomous.length}
        </KeyValue>
        <KeyValue label={supervised ? 'You approve' : 'Comes back to you'}>{kept.length}</KeyValue>
      </div>

      <ul className="border-line-subtle mt-3 flex min-w-0 flex-col border-t">
        {mine.map((s) => (
          <li
            key={s.id}
            className="border-line-subtle flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1 border-b py-2 last:border-b-0"
          >
            <span className="text-fg-tertiary shrink-0 font-mono text-[10.5px]">{s.code}</span>
            <span className="text-fg min-w-0 flex-1 text-[12.5px]">{s.title}</span>
            <Chip
              tone={
                s.mode === 'AUTONOMOUS'
                  ? 'success'
                  : s.mode === 'HELD'
                    ? 'accent'
                    : s.mode === 'REFUSED'
                      ? 'danger'
                      : 'warning'
              }
              size="sm"
              icon={s.mode === 'AUTONOMOUS' ? Bot : UserCheck}
            >
              {s.mode === 'AUTONOMOUS'
                ? 'Agent'
                : s.mode === 'HELD'
                  ? 'You approve'
                  : s.mode === 'REFUSED'
                    ? 'Refused to act'
                    : 'Back to you'}
            </Chip>
          </li>
        ))}
      </ul>

      <p className="text-fg-secondary mt-3 text-[12px] leading-relaxed">
        {supervised
          ? 'Nothing on this list is held because a check failed — every one passes. They are held because the platform will not move money without a named person, and that does not change as the agent takes on more elsewhere.'
          : kept.length === 0
            ? 'Nothing on this desk needs a person on a clean run. Anything the checks cannot settle still comes back here — an agent that never escalates is one nobody should trust.'
            : `The ${kept.length} step${kept.length === 1 ? '' : 's'} that come back ${kept.length === 1 ? 'is a judgement call' : 'are the judgement calls'}: a figure that will not reconcile, or a result inside tolerance but not clean. Those are the ones worth this desk's time.`}
      </p>

      <Link
        href="/agentic"
        className="text-accent-text mt-2.5 inline-flex items-center gap-1.5 text-[12.5px] font-medium hover:underline"
      >
        Run the agent on the demo order
        <ArrowUpRight className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
      </Link>
    </Panel>
  );
}
