import { getStage } from '@/lib/domain/stages';
import { listSimulations, simulationOptions } from '@/lib/actions/simulation';
import { agenticRunLog } from '@/lib/actions/agentic-run';
import { HUMAN_TOUCHPOINTS, summariseTouchpoints } from '@/lib/domain/human-touchpoints';
import { PageHeader, PageShell, Panel, PanelHeader } from '@/components/ui/Layout';
import { Chip } from '@/components/ui/Badges';
import { SimulationConsole } from '@/components/agentic/SimulationConsole';

/** Orders genuinely move here, so nothing about this page may be cached. */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Autonomous flow' };

export default async function AgenticPage() {
  const [options, rows] = await Promise.all([simulationOptions(), listSimulations()]);

  const sims = rows.map((r) => {
    const s = getStage(r.stage);
    return { ...r, stageCode: s.code, stageLabel: s.label };
  });

  // The run log for the order on screen, so the flow is still there when you
  // come back to the page rather than only while the tab that ran it is open.
  const initialLog = sims[0] ? await agenticRunLog(sims[0].id) : [];

  // Counted from the touchpoint map itself rather than written into the copy,
  // so the claim on this page cannot drift away from what the run actually does.
  const touch = summariseTouchpoints(Object.keys(HUMAN_TOUCHPOINTS));

  return (
    <PageShell width="full">
      <PageHeader
        title="Autonomous fulfilment"
        description="Configure an order, then watch the agent work it end to end through the real gates — and see exactly where a real person would have been standing."
      />

      <Panel>
        <PanelHeader
          title="What this demonstrates, and what it does not"
          description="Worth reading once before the first run, because the interesting claim is a narrow one."
        />
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <div className="min-w-0">
            <p className="text-fg-secondary text-[12.5px] leading-relaxed">
              Every step goes through the same machinery a person uses — the same evidence gate, the
              same documents, the same stage ladder. Nothing is narrated and no check is relaxed. If
              the platform would refuse a person here, it refuses the agent, and the run stops with
              the gate&rsquo;s own message.
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-fg-secondary text-[12.5px] leading-relaxed">
              <strong className="text-fg font-semibold">
                {touch.total} steps in this flow need a real person.
              </strong>{' '}
              The run passes through them so it can reach the end, and marks every one with who it
              stood in for and what they would have done. In the live platform the money steps queue
              for Finance and wait.
            </p>
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
              {touch.byKind.map((k) => (
                <Chip key={k.kind} tone="warning" size="sm">
                  {k.count} · {k.label}
                </Chip>
              ))}
            </div>
            <p className="text-fg-tertiary mt-2 text-[11.5px] leading-relaxed">
              The bypass is of the person, never of the check — every one of those steps still had
              to satisfy the same evidence gate as any other.
            </p>
          </div>
        </div>
      </Panel>

      <SimulationConsole options={options} sims={sims} initialLog={initialLog} />
    </PageShell>
  );
}
