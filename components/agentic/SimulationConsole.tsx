'use client';

/**
 * Configure, run, reset — the three states of the console, in that order.
 *
 * Deliberately one screen rather than three: the configuration is what explains
 * the run, and a run you have to navigate away from its own settings to watch
 * loses the thread. Once an order exists the configuration folds away rather
 * than disappearing, because the first question anybody asks halfway through a
 * run is "what did we set this one to".
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowUpRight, ChevronDown, RotateCcw, Settings2 } from 'lucide-react';
import { toast } from 'sonner';
import { resetSimulations } from '@/lib/actions/simulation';
import { PAYMENT_METHOD_META, type PaymentMethod } from '@/lib/domain/enums';
import { Button, Panel, PanelHeader } from '@/components/ui/Layout';
import { Chip } from '@/components/ui/Badges';
import { AgenticRunner } from './AgenticRunner';
import { SimulationConfig, type SimOptions } from './SimulationConfig';
import { cn } from '@/lib/utils';

export interface SimSummary {
  id: string;
  alias: string;
  stage: string;
  stageCode: string;
  stageLabel: string;
  status: string;
  buyIncoterms: string;
  sellIncoterms: string | null;
  paymentMethod: string;
  testingRequired: boolean;
  customer: string;
  supplier: string;
  documents: number;
  transitions: number;
}

export function SimulationConsole({
  options,
  sims,
}: {
  options: SimOptions;
  sims: SimSummary[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const active = sims[0] ?? null;
  const [configOpen, setConfigOpen] = useState(!active);

  const reset = () =>
    start(async () => {
      const res = await resetSimulations();
      if (res.ok) {
        toast.success(res.message, { description: res.detail, duration: 8000 });
        setConfigOpen(true);
        router.refresh();
      } else {
        toast.error(res.message, { description: res.detail });
      }
    });

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* ── The order being run, and how to start over ──────────────────────── */}
      {active && (
        <Panel>
          <PanelHeader
            title={`${active.alias} — the order the agent is running`}
            description="A real work order. It is in the Control Tower, in the order list and in every team queue that has something to do on it, exactly like any other."
            actions={
              <Button variant="secondary" icon={RotateCcw} onClick={reset} disabled={pending}>
                Reset and start over
              </Button>
            }
          />
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <Chip tone="neutral" size="sm">
              {active.customer} ← {active.supplier}
            </Chip>
            <Chip tone="neutral" size="sm">
              Bought on {active.buyIncoterms}
            </Chip>
            <Chip tone="neutral" size="sm">
              Sold on {active.sellIncoterms ?? '—'}
            </Chip>
            <Chip tone="neutral" size="sm">
              {PAYMENT_METHOD_META[active.paymentMethod as PaymentMethod]?.label ??
                active.paymentMethod}
            </Chip>
            <Chip tone={active.testingRequired ? 'accent' : 'muted'} size="sm">
              {active.testingRequired ? 'Testing on some lines' : 'No testing'}
            </Chip>
            <Chip tone="muted" size="sm">
              {active.documents} document{active.documents === 1 ? '' : 's'} ·{' '}
              {active.transitions} transition{active.transitions === 1 ? '' : 's'}
            </Chip>
            <Link
              href={`/orders/${active.id}`}
              className="text-accent-text ml-auto inline-flex items-center gap-1.5 text-[12.5px] font-medium hover:underline"
            >
              Helicopter view
              <ArrowUpRight className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
            </Link>
          </div>
          <p className="text-fg-tertiary border-line-subtle mt-3 border-t pt-3 text-[11.5px] leading-relaxed">
            Reset deletes this order and everything the run wrote against it, so the flow can be
            shown again from a different configuration. It only ever reaches orders it created —
            seeded and hand-raised orders are never touched.
          </p>
        </Panel>
      )}

      {/* ── Configuration: open by default until an order exists ────────────── */}
      {active ? (
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => setConfigOpen((o) => !o)}
            className="text-fg-secondary hover:text-fg inline-flex items-center gap-1.5 text-[12.5px] font-medium transition-colors"
          >
            <Settings2 className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
            {configOpen ? 'Hide the configuration' : 'Configure another order'}
            <ChevronDown
              className={cn('size-3.5 shrink-0 transition-transform', configOpen && 'rotate-180')}
              strokeWidth={2}
              aria-hidden
            />
          </button>
          {configOpen && (
            <div className="mt-2.5 min-w-0">
              <SimulationConfig options={options} />
            </div>
          )}
        </div>
      ) : (
        <SimulationConfig options={options} />
      )}

      {/* ── The run ─────────────────────────────────────────────────────────── */}
      {active && (
        <AgenticRunner
          key={active.id}
          orderId={active.id}
          orderAlias={active.alias}
          startCode={active.stageCode}
          startLabel={active.stageLabel}
        />
      )}

      {/* Earlier runs stay reachable rather than being silently replaced. */}
      {sims.length > 1 && (
        <Panel>
          <PanelHeader
            title="Earlier simulated orders"
            description="Still in the platform, still openable — a reset clears all of them together."
          />
          <ul className="flex min-w-0 flex-col gap-1.5">
            {sims.slice(1).map((s) => (
              <li key={s.id} className="flex min-w-0 flex-wrap items-center gap-2 text-[12.5px]">
                <span className="text-fg font-mono font-semibold">{s.alias}</span>
                <span className="text-fg-tertiary font-mono text-[10.5px]">{s.stageCode}</span>
                <span className="text-fg-secondary min-w-0 flex-1 truncate">{s.stageLabel}</span>
                <Link href={`/orders/${s.id}`} className="text-accent-text hover:underline">
                  Open
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
