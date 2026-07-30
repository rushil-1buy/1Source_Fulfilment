'use client';

/**
 * SETTINGS → INTEGRATIONS & CONNECTOR HEALTH — §11A.0 rule 6, AC#21.
 *
 * Per connector: mode, last success, last failure with reason, sync frequency,
 * a Test connection button that exercises the real runtime, and credential
 * status — never the secrets themselves.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity,
  AlertTriangle,
  BadgeCheck,
  Ban,
  Check,
  CircleAlert,
  Cpu,
  FlaskConical,
  Hand,
  KeyRound,
  Plug,
  RefreshCw,
  Trash2,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  clearConnectorLog,
  setAllConnectorModes,
  setConnectorMode,
  setForceFailure,
  testConnection,
} from '@/lib/actions/integrations';
import {
  Button,
  EmptyState,
  PageHeader,
  PageShell,
  Panel,
  PanelHeader,
  SectionLabel,
} from '@/components/ui/Layout';
import { Chip, StatusChip } from '@/components/ui/Badges';
import { Hint, InfoTooltip } from '@/components/ui/InfoTooltip';
import { CONNECTOR_MODES, CONNECTOR_MODE_META, type ConnectorMode } from '@/lib/domain/enums';
import { cn, formatDateTime, relativeTime } from '@/lib/utils';

export interface ConnectorView {
  id: string;
  label: string;
  mode: string;
  vendorName: string | null;
  vendorStatus: string;
  syncSeconds: number;
  credentialsOk: boolean;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureMsg: string | null;
  forceFailure: boolean;
  stats: { total: number; ok: number; failed: number; avgLatencyMs: number };
  recentCalls: {
    id: string;
    operation: string;
    ok: boolean;
    statusCode: number | null;
    errorMessage: string | null;
    latencyMs: number;
    attempt: number;
    mode: string;
    correlationId: string;
    createdAt: string;
  }[];
}

const MODE_ICON = {
  MOCK: FlaskConical,
  MANUAL: Hand,
  SANDBOX: Cpu,
  LIVE: Zap,
  NOT_CONFIGURED: Ban,
} as const;

export function ConnectorHealth({ connectors }: { connectors: ConnectorView[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; message: string; detail?: string }>) =>
    startTransition(async () => {
      const res = await fn();
      if (res.ok) toast.success(res.message, { description: res.detail });
      else toast.error(res.message, { description: res.detail });
      router.refresh();
    });

  const allManual = connectors.every((c) => c.mode === 'MANUAL');
  const anyFailing = connectors.some((c) => c.forceFailure);

  return (
    <PageShell width="full">
      <PageHeader
        title="Integrations & connector health"
        plainTitle="Connected systems"
        termKey="connectorMode"
        description="Five external systems are in scope. Every one of them is optional: the platform works fully with all of them off, because a person can enter anything an API would have fetched."
      />

      {/* ── Manual-first banner (AC#19) ─────────────────────────────────────── */}
      <div
        className={cn(
          'mb-4 rounded-[12px] border p-3.5',
          allManual ? 'border-accent-border bg-accent-subtle' : 'border-line-subtle bg-surface-1',
        )}
      >
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-fg flex items-center gap-1.5 text-[13px] font-semibold">
              <Hand className="size-4 shrink-0" strokeWidth={2} aria-hidden />
              Manual-first by design
            </div>
            <p className="text-fg-secondary mt-1 max-w-[min(80ch,100%)] text-[12px] leading-relaxed">
              {allManual
                ? 'Every connector is in Manual mode right now. Nothing is automated — and every order can still be driven from first PO to closure entirely by hand.'
                : 'APIs only pre-fill and auto-advance what a person could enter themselves. Switch everything to Manual to prove the platform stands alone.'}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              variant={allManual ? 'secondary' : 'primary'}
              icon={Hand}
              disabled={pending || allManual}
              disabledReason={allManual ? 'Every connector is already manual.' : undefined}
              onClick={() => run(() => setAllConnectorModes('MANUAL'))}
            >
              Set all to Manual
            </Button>
            <Button
              variant="secondary"
              icon={FlaskConical}
              disabled={pending}
              onClick={() => run(() => setAllConnectorModes('MOCK'))}
            >
              Set all to Mock
            </Button>
          </div>
        </div>
      </div>

      {anyFailing && (
        <div className="border-danger-border bg-danger-subtle mb-4 flex items-start gap-2 rounded-[12px] border p-3">
          <AlertTriangle className="text-danger mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="min-w-0">
            <div className="text-danger text-[12.5px] font-semibold">
              Simulated outage is switched on
            </div>
            <p className="text-fg-secondary mt-0.5 text-[12px]">
              At least one connector is forced to fail. Affected screens will show a fallback banner
              and offer manual entry — nothing blocks and no data is lost.
            </p>
          </div>
        </div>
      )}

      <div className="grid min-w-0 grid-cols-1 gap-3">
        {connectors.map((c) => {
          const ModeIcon = MODE_ICON[c.mode as keyof typeof MODE_ICON] ?? Plug;
          const meta = CONNECTOR_MODE_META[c.mode as ConnectorMode];
          const isOpen = expanded === c.id;

          return (
            <Panel key={c.id} className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        'grid size-7 shrink-0 place-items-center rounded-[8px]',
                        c.mode === 'MANUAL'
                          ? 'bg-surface-3 text-fg-secondary'
                          : c.mode === 'MOCK'
                            ? 'bg-warning-subtle text-warning'
                            : c.mode === 'LIVE'
                              ? 'bg-success-subtle text-success'
                              : 'bg-surface-3 text-fg-tertiary',
                      )}
                    >
                      <ModeIcon className="size-4" strokeWidth={2} aria-hidden />
                    </span>
                    <span className="text-fg truncate text-[13.5px] font-semibold">{c.label}</span>
                    <Hint content={<span>{meta?.description}</span>}>
                      <span>
                        <Chip
                          tone={
                            c.mode === 'LIVE'
                              ? 'success'
                              : c.mode === 'MOCK'
                                ? 'warning'
                                : c.mode === 'NOT_CONFIGURED'
                                  ? 'danger'
                                  : 'neutral'
                          }
                        >
                          {meta?.label ?? c.mode}
                        </Chip>
                      </span>
                    </Hint>
                    {c.vendorStatus === 'NOT_FINALISED' && (
                      <Hint
                        content={
                          <span>
                            No vendor has been chosen for this yet. The adapter is deliberately
                            provider-agnostic, so picking one later will not force a rewrite.
                          </span>
                        }
                      >
                        <span>
                          <Chip tone="info" icon={CircleAlert} size="sm">
                            Vendor not finalised
                          </Chip>
                        </span>
                      </Hint>
                    )}
                    {c.forceFailure && (
                      <Chip tone="danger" icon={AlertTriangle} size="sm">
                        Forced to fail
                      </Chip>
                    )}
                  </div>
                  <div className="text-fg-tertiary mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
                    <span>{c.vendorName ?? 'Provider to be decided'}</span>
                    <span className="flex items-center gap-1">
                      <KeyRound className="size-3" aria-hidden />
                      {c.credentialsOk ? 'Credentials on file' : 'No credentials'}
                    </span>
                    <span>Sync every {Math.round(c.syncSeconds / 60)} min</span>
                  </div>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  <label className="min-w-0">
                    <span className="sr-only">Mode for {c.label}</span>
                    <select
                      value={c.mode}
                      disabled={pending}
                      onChange={(e) => run(() => setConnectorMode(c.id, e.target.value))}
                      className="bg-surface-1 border-line-subtle text-fg-secondary focus:border-accent rounded-[7px] border px-2 py-1 text-[12px] outline-none"
                    >
                      {CONNECTOR_MODES.map((m) => (
                        <option
                          key={m}
                          value={m}
                          disabled={(m === 'LIVE' || m === 'SANDBOX') && !c.credentialsOk}
                        >
                          {CONNECTOR_MODE_META[m].label}
                          {(m === 'LIVE' || m === 'SANDBOX') && !c.credentialsOk
                            ? ' — needs credentials'
                            : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button
                    size="sm"
                    icon={RefreshCw}
                    disabled={pending}
                    onClick={() => run(() => testConnection(c.id))}
                  >
                    Test connection
                  </Button>
                  <Button
                    size="sm"
                    variant={c.forceFailure ? 'danger' : 'ghost'}
                    icon={AlertTriangle}
                    disabled={pending}
                    onClick={() => run(() => setForceFailure(c.id, !c.forceFailure))}
                  >
                    {c.forceFailure ? 'Stop failing' : 'Simulate outage'}
                  </Button>
                </div>
              </div>

              {/* Health strip */}
              <div className="border-line-subtle mt-3 grid grid-cols-2 gap-3 border-t pt-3 sm:grid-cols-4">
                <Metric label="Last success">
                  {c.lastSuccessAt ? (
                    <Hint content={<span>{formatDateTime(c.lastSuccessAt)}</span>}>
                      <span className="text-success">{relativeTime(c.lastSuccessAt)}</span>
                    </Hint>
                  ) : (
                    <span className="text-fg-tertiary">Never called</span>
                  )}
                </Metric>
                <Metric label="Last failure">
                  {c.lastFailureAt ? (
                    <Hint content={<span>{formatDateTime(c.lastFailureAt)}</span>}>
                      <span className="text-danger">{relativeTime(c.lastFailureAt)}</span>
                    </Hint>
                  ) : (
                    <span className="text-fg-tertiary">None</span>
                  )}
                </Metric>
                <Metric label="Calls logged">
                  <span className="tnum">
                    {c.stats.total}
                    {c.stats.total > 0 && (
                      <span className="text-fg-tertiary ml-1 text-[11px]">
                        ({c.stats.ok} ok / {c.stats.failed} failed)
                      </span>
                    )}
                  </span>
                </Metric>
                <Metric label="Avg latency">
                  <span className="tnum">
                    {c.stats.total > 0 ? `${c.stats.avgLatencyMs} ms` : '—'}
                  </span>
                </Metric>
              </div>

              {c.lastFailureMsg && (
                <div className="border-danger-border bg-danger-subtle mt-3 rounded-[8px] border px-2.5 py-2">
                  <span className="text-danger text-[11px] font-semibold tracking-[0.04em] uppercase">
                    Last failure reason
                  </span>
                  <p className="text-fg-secondary mt-0.5 text-[12px]">{c.lastFailureMsg}</p>
                </div>
              )}

              {/* Call log */}
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : c.id)}
                  className="text-accent-text text-[12px] hover:underline"
                >
                  {isOpen ? 'Hide' : 'Show'} recent calls ({c.recentCalls.length})
                </button>
                {isOpen && (
                  <div className="mt-2">
                    {c.recentCalls.length === 0 ? (
                      <EmptyState
                        compact
                        icon={Activity}
                        title="No calls logged yet"
                        description="Every call this connector makes is recorded here with its request, response, latency and correlation id."
                      />
                    ) : (
                      <>
                        <div className="overflow-x-auto">
                          <table className="w-full border-collapse text-left text-[11.5px]">
                            <thead className="bg-surface-inset">
                              <tr className="border-line-subtle border-y">
                                <Th>Operation</Th>
                                <Th>Result</Th>
                                <Th>Mode</Th>
                                <Th align="right">Attempt</Th>
                                <Th align="right">Latency</Th>
                                <Th>Correlation id</Th>
                                <Th>When</Th>
                              </tr>
                            </thead>
                            <tbody>
                              {c.recentCalls.map((call) => (
                                <tr key={call.id} className="border-line-subtle border-b last:border-0">
                                  <td className="px-2 py-1.5 font-mono">{call.operation}</td>
                                  <td className="px-2 py-1.5">
                                    {call.ok ? (
                                      <Chip tone="success" icon={Check} size="sm">
                                        {call.statusCode ?? 200}
                                      </Chip>
                                    ) : (
                                      <Hint content={<span>{call.errorMessage}</span>}>
                                        <span>
                                          <Chip tone="danger" icon={AlertTriangle} size="sm">
                                            {call.statusCode ?? 'error'}
                                          </Chip>
                                        </span>
                                      </Hint>
                                    )}
                                  </td>
                                  <td className="px-2 py-1.5">
                                    <Chip size="sm">{call.mode.toLowerCase()}</Chip>
                                  </td>
                                  <td className="tnum px-2 py-1.5 text-right">{call.attempt}</td>
                                  <td className="tnum px-2 py-1.5 text-right">{call.latencyMs} ms</td>
                                  <td className="text-fg-tertiary px-2 py-1.5 font-mono">
                                    {call.correlationId}
                                  </td>
                                  <td className="text-fg-tertiary px-2 py-1.5">
                                    {relativeTime(call.createdAt)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="mt-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={Trash2}
                            disabled={pending}
                            onClick={() => run(() => clearConnectorLog(c.id))}
                          >
                            Clear this log
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </Panel>
          );
        })}
      </div>

      <Panel className="mt-4">
        <PanelHeader
          title="What each mode means"
          description="Switching mode changes behaviour immediately — no restart."
        />
        <ul className="grid gap-2 sm:grid-cols-2">
          {CONNECTOR_MODES.map((m) => {
            const Icon = MODE_ICON[m];
            return (
              <li
                key={m}
                className="border-line-subtle flex min-w-0 items-start gap-2 rounded-[9px] border p-2.5"
              >
                <Icon className="text-fg-tertiary mt-0.5 size-4 shrink-0" strokeWidth={1.9} aria-hidden />
                <span className="min-w-0">
                  <span className="text-fg block text-[12.5px] font-medium">
                    {CONNECTOR_MODE_META[m].label}
                  </span>
                  <span className="text-fg-tertiary block text-[11.5px] leading-relaxed">
                    {CONNECTOR_MODE_META[m].description}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
        <div className="border-line-subtle mt-3 border-t pt-3">
          <SectionLabel>Where values come from</SectionLabel>
          <p className="text-fg-tertiary max-w-[min(90ch,100%)] text-[11.5px] leading-relaxed">
            Anything that could have come from an API records how it actually arrived — typed by a
            person, fetched from the live system, or produced by the simulator — and shows it as a
            badge next to the value. You should never have to guess whether a colleague typed a
            customs status or the customs system reported it.
            <InfoTooltip termKey="provenance" className="ml-1 align-middle" />
          </p>
        </div>
      </Panel>
    </PageShell>
  );
}

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-fg-tertiary text-[9.5px] font-semibold tracking-[0.05em] uppercase">
        {label}
      </div>
      <div className="text-fg mt-0.5 truncate text-[12.5px] font-medium">{children}</div>
    </div>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      scope="col"
      className={cn(
        'text-fg-tertiary px-2 py-1.5 text-[9.5px] font-semibold tracking-[0.04em] whitespace-nowrap uppercase',
        align === 'right' && 'text-right',
      )}
    >
      {children}
    </th>
  );
}

export { StatusChip, BadgeCheck };
