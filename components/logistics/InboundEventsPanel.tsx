'use client';

/**
 * The things that happen to a consignment, and what each one costs.
 *
 * The ladder covers dispatched, in transit, entry filed, cleared, received.
 * A real inbound leg spends most of its attention BETWEEN those: a flight
 * rolled, an appraiser querying the value, an examination ordered, demurrage
 * running, a carton short on the dock. Without somewhere to put those, they
 * live in somebody's inbox and surface as a margin surprise.
 *
 * WHO BEARS IT IS SHOWN BEFORE IT IS RECORDED, and it is not a field. The
 * delivery term decides it — demurrage is ours on FOB and the supplier's on
 * DDP — so the desk sees the consequence while choosing rather than discovering
 * it afterwards, and cannot record a cost against the wrong party by picking
 * the wrong option in a dropdown.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Clock, PauseCircle, Plus, ShieldAlert, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { recordInboundEvent, resolveInboundEvent } from '@/lib/actions/inbound-events';
import {
  eventBearer,
  eventsForStage,
  INBOUND_EVENTS,
  type InboundEventDef,
} from '@/lib/domain/inbound-events';
import { STAKEHOLDER_META } from '@/lib/domain/enums';
import { Button, KeyValue, SectionLabel } from '@/components/ui/Layout';
import { Chip, StakeholderBadge } from '@/components/ui/Badges';
import { cn } from '@/lib/utils';

const field =
  'bg-surface-1 border-line-subtle focus:border-accent text-fg w-full rounded-[8px] border px-2.5 py-1.5 text-[13px] outline-none';

export interface OpenInboundEvent {
  id: string;
  eventId: string;
  stageId: string;
  note: string | null;
  bearerParty: string;
  effect: string;
  openedAt: string;
}

export function InboundEventsPanel({
  orderId,
  currentStage,
  buyIncoterms,
  openEvents,
}: {
  orderId: string;
  currentStage: string;
  buyIncoterms: string;
  /** Recorded and not yet closed. The holding ones stop the order. */
  openEvents: OpenInboundEvent[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const available = eventsForStage(currentStage);
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [cost, setCost] = useState('');


  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolution, setResolution] = useState('');

  const resolve = (id: string) =>
    start(async () => {
      const res = await resolveInboundEvent(id, resolution);
      if (res.ok) {
        toast.success(res.message, { description: res.detail, duration: 8000 });
        setResolvingId(null);
        setResolution('');
        router.refresh();
      } else {
        toast.error(res.message, { description: res.detail, duration: 9000 });
      }
    });

  const submit = (def: InboundEventDef) =>
    start(async () => {
      const res = await recordInboundEvent(orderId, def.id, {
        note: note.trim() || undefined,
        costAmount: cost.trim() ? Number(cost) : null,
      });
      if (res.ok) {
        toast.success(res.message, { description: res.detail, duration: 9000 });
        setOpenId(null);
        setNote('');
        setCost('');
        router.refresh();
      } else {
        toast.error(res.message, { description: res.detail, duration: 9000 });
      }
    });

  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <div>
        <SectionLabel>What has happened to this consignment</SectionLabel>
        <p className="text-fg-tertiary mt-1 text-[11.5px] leading-relaxed">
          Only the events that can occur at this step are offered. Who bears each one is derived
          from the delivery term, not chosen — recording a cost against the wrong party is
          absorbing somebody else&rsquo;s money.
        </p>
      </div>

      {/*
        ── What is still open ────────────────────────────────────────────

        Above the catalogue, because an open holding event is the reason the
        order is not moving, and a desk arriving here needs that before it needs
        a list of other things that could go wrong.
      */}
      {openEvents.length > 0 && (
        <ul className="flex min-w-0 flex-col gap-2">
          {openEvents.map((ev) => {
            const def = INBOUND_EVENTS.find((d) => d.id === ev.eventId);
            const holding = ev.effect === 'HOLDS';
            return (
              <li
                key={ev.id}
                className={cn(
                  'min-w-0 rounded-[10px] border p-3',
                  holding ? 'border-warning-border bg-warning-subtle' : 'border-line-subtle bg-surface-1',
                )}
              >
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <PauseCircle className="text-warning size-4 shrink-0" strokeWidth={2} aria-hidden />
                  <span className="text-fg min-w-0 flex-1 text-[13px] font-semibold">
                    {def?.label ?? ev.eventId}
                  </span>
                  <Chip tone="warning" size="sm">
                    {holding ? 'Holding the order' : 'Open'}
                  </Chip>
                </div>
                {ev.note && (
                  <p className="text-fg-secondary mt-1.5 text-[12px] leading-relaxed">{ev.note}</p>
                )}
                {holding && (
                  <p className="text-warning mt-1 text-[11.5px] leading-relaxed">
                    The order will not advance past this step until this is closed. That is not our
                    paperwork to waive — it is somebody else holding the goods.
                  </p>
                )}

                {resolvingId === ev.id ? (
                  <div className="border-warning-border/60 mt-2.5 border-t pt-2.5">
                    <label className="min-w-0">
                      <SectionLabel>How was it resolved</SectionLabel>
                      <textarea
                        value={resolution}
                        onChange={(e) => setResolution(e.target.value)}
                        rows={2}
                        placeholder="What was answered, by whom, and against which reference."
                        className={cn(field, 'mt-1 resize-y')}
                      />
                    </label>
                    <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
                      <Button variant="primary" onClick={() => resolve(ev.id)} disabled={pending}>
                        Close it
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => setResolvingId(null)}
                        disabled={pending}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2.5">
                    <Button variant="secondary" onClick={() => setResolvingId(ev.id)}>
                      Close this out
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ul className="flex min-w-0 flex-col gap-2">
        {available.map((def) => {
          const bearer = eventBearer(def, buyIncoterms);
          const isOpen = openId === def.id;
          const Icon =
            def.effect === 'ESCALATES' ? ShieldAlert : def.effect === 'HOLDS' ? PauseCircle : Truck;

          return (
            <li
              key={def.id}
              className={cn(
                'bg-surface-1 min-w-0 rounded-[10px] border p-3',
                def.effect === 'ESCALATES'
                  ? 'border-danger-border'
                  : def.effect === 'HOLDS'
                    ? 'border-warning-border'
                    : 'border-line-subtle',
              )}
            >
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <Icon
                  className={cn(
                    'size-4 shrink-0',
                    def.effect === 'ESCALATES'
                      ? 'text-danger'
                      : def.effect === 'HOLDS'
                        ? 'text-warning'
                        : 'text-fg-tertiary',
                  )}
                  strokeWidth={2}
                  aria-hidden
                />
                <span className="text-fg min-w-0 flex-1 text-[13px] font-semibold">
                  {def.label}
                </span>
                {def.accrues && (
                  <Chip tone="warning" size="sm" icon={Clock}>
                    Clock running
                  </Chip>
                )}
                {def.effect === 'HOLDS' && (
                  <Chip tone="warning" size="sm">
                    Holds the order
                  </Chip>
                )}
                {def.effect === 'ESCALATES' && (
                  <Chip tone="danger" size="sm">
                    Becomes an exception
                  </Chip>
                )}
              </div>

              <p className="text-fg-secondary mt-1.5 text-[12px] leading-relaxed">{def.what}</p>

              {/* The consequence, before it is recorded rather than after. */}
              <div className="border-line-subtle mt-2 grid min-w-0 gap-2 border-t pt-2 sm:grid-cols-2">
                <KeyValue label="Who bears it">
                  <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <StakeholderBadge stakeholder={bearer.party} short />
                    {bearer.ours && (
                      <Chip tone="warning" size="sm">
                        On our margin
                      </Chip>
                    )}
                  </span>
                </KeyValue>
                <KeyValue label="What it costs">
                  <span className="text-fg-secondary">{def.costNote}</span>
                </KeyValue>
              </div>
              <p className="text-fg-tertiary mt-1.5 text-[11px] leading-relaxed">
                {bearer.because}
                {bearer.recoverableFrom && (
                  <>
                    {' '}
                    Recovery may run to{' '}
                    <strong className="text-fg-secondary font-medium">
                      {STAKEHOLDER_META[bearer.recoverableFrom].label}
                    </strong>
                    .
                  </>
                )}
              </p>

              <p className="text-fg mt-1.5 flex items-start gap-1.5 text-[11.5px] leading-relaxed">
                <AlertTriangle className="text-warning mt-0.5 size-3.5 shrink-0" strokeWidth={2} aria-hidden />
                <span>
                  <strong className="font-semibold">Do this:</strong> {def.action}
                  {def.evidence && (
                    <>
                      {' '}
                      <span className="text-fg-tertiary">Evidence: {def.evidence.toLowerCase()}.</span>
                    </>
                  )}
                </span>
              </p>

              {isOpen ? (
                <div className="border-line-subtle mt-2.5 border-t pt-2.5">
                  <div className="grid min-w-0 gap-2.5 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                    <label className="min-w-0">
                      <SectionLabel>What happened</SectionLabel>
                      <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        rows={2}
                        placeholder="Reference, dates, who said what."
                        className={cn(field, 'mt-1 resize-y')}
                      />
                    </label>
                    <label className="min-w-0">
                      {/* Optional on purpose: forcing a number on the day gets
                          zeros typed in, and a zero later reads as "free". */}
                      <SectionLabel>Cost, if known yet</SectionLabel>
                      <input
                        type="number"
                        min={0}
                        value={cost}
                        onChange={(e) => setCost(e.target.value)}
                        placeholder="Leave blank if not yet known"
                        className={cn(field, 'tnum mt-1')}
                      />
                    </label>
                  </div>
                  <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
                    <Button variant="primary" onClick={() => submit(def)} disabled={pending}>
                      Record it
                    </Button>
                    <Button variant="secondary" onClick={() => setOpenId(null)} disabled={pending}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-2.5">
                  <Button variant="secondary" icon={Plus} onClick={() => setOpenId(def.id)}>
                    Record this
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
