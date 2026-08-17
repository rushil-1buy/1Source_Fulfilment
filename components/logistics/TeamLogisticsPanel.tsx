'use client';

/**
 * What the carrier says, on the desk that has to answer for it.
 *
 * The logistics teams were the only ones who could see where an order stood
 * without being able to see where the GOODS stood — which is the one fact their
 * job actually turns on. A stage tells you the order reached "in transit"; it
 * does not tell you the consignment cleared a hub three days ago and has not
 * moved since.
 *
 * SCOPED BY LEG, deliberately. Inbound owns everything up to receipt at 1BUY —
 * the import leg and both testing legs, since those are consignments they book
 * and chase. Outbound owns the leg to the customer. Showing each desk every leg
 * would mean the outbound team scanning past three inbound consignments to find
 * the one that is theirs, which is how a status panel becomes wallpaper.
 */

import { AlertTriangle, MapPin, PackageCheck, Plane, Truck } from 'lucide-react';
import { Chip } from '@/components/ui/Badges';
import { EmptyState, KeyValue } from '@/components/ui/Layout';
import type { Stakeholder } from '@/lib/domain/enums';
import { formatDate, formatDateTime, relativeTime } from '@/lib/utils';
import { cn } from '@/lib/utils';

export interface TeamShipment {
  id: string;
  legType: string;
  carrierCode: string;
  serviceName: string | null;
  awb: string | null;
  originName: string;
  originCountry: string;
  destName: string;
  destCountry: string;
  pieces: number;
  grossWeightKg: number | null;
  status: string;
  dispatchedAt: string | null;
  estimatedDelivery: string | null;
  deliveredAt: string | null;
  /**
   * Past the carrier's own promised date, computed on the server.
   *
   * "Is it late" is a fact about NOW, and reading the clock during render is
   * both impure and a lie the moment the tab sits open — the server already
   * knows the time it rendered at, so it decides.
   */
  overdue: boolean;
  events: { id: string; occurredAt: string; code: string; description: string; location: string | null }[];
}

/** Which legs belong to which desk. */
const LEGS_FOR: Record<string, string[]> = {
  ONE_BUY_INBOUND: ['IMPORT', 'TEST_OUT', 'TEST_RETURN'],
  ONE_BUY_OUTBOUND: ['OUTBOUND'],
};

const LEG_LABEL: Record<string, string> = {
  IMPORT: 'Inbound import leg',
  TEST_OUT: 'Out to the testing laboratory',
  TEST_RETURN: 'Back from the testing laboratory',
  OUTBOUND: 'Outbound to the customer',
};

/**
 * Carrier statuses, in the order a consignment meets them.
 *
 * EXCEPTION is deliberately not on the line — it is not a later stage of
 * progress, it is progress having stopped, and putting it at the end of a
 * sequence would suggest the consignment is nearly there.
 */
const PROGRESS = ['BOOKED', 'IN_TRANSIT', 'CUSTOMS', 'OUT_FOR_DELIVERY', 'DELIVERED'];

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Not booked yet',
  BOOKED: 'Booked',
  IN_TRANSIT: 'In transit',
  CUSTOMS: 'With customs',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  EXCEPTION: 'Exception',
};

const toneFor = (s: string) =>
  s === 'DELIVERED' ? 'success' : s === 'EXCEPTION' ? 'danger' : s === 'DRAFT' ? 'muted' : 'accent';

export function TeamLogisticsPanel({
  team,
  shipments,
}: {
  team: Stakeholder;
  shipments: TeamShipment[];
}) {
  const legs = LEGS_FOR[team] ?? [];
  const mine = shipments.filter((s) => legs.includes(s.legType));

  if (mine.length === 0) {
    return (
      <EmptyState
        title="Nothing booked on this desk yet"
        description="Once a consignment is booked for this leg, the carrier's status and every tracking event it reports appear here."
      />
    );
  }

  return (
    <div className="min-w-0">
      <p className="text-fg-tertiary mb-1 text-[11.5px] leading-relaxed">
        Live status from the logistics partner. The stage tells you where the ORDER is; this tells
        you where the consignment is, which is not always the same thing.
      </p>
      <div className="flex min-w-0 flex-col">
        {mine.map((s) => (
          <Leg key={s.id} s={s} />
        ))}
      </div>
    </div>
  );
}

function Leg({ s }: { s: TeamShipment }) {
  const reached = PROGRESS.indexOf(s.status);
  const stalled = s.status === 'EXCEPTION';
  const latest = s.events[s.events.length - 1];
  const Icon = s.legType === 'OUTBOUND' ? Truck : Plane;

  return (
    <div className="border-line-subtle min-w-0 border-t p-4 first:border-t-0">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
        <Icon className="text-fg-tertiary size-4 shrink-0" strokeWidth={1.9} aria-hidden />
        <span className="text-fg min-w-0 text-[13px] font-semibold">
          {LEG_LABEL[s.legType] ?? s.legType}
        </span>
        <Chip tone={toneFor(s.status)} size="sm" icon={stalled ? AlertTriangle : undefined}>
          {STATUS_LABEL[s.status] ?? s.status}
        </Chip>
        {s.overdue && (
          <Chip tone="warning" size="sm">
            Past the carrier&rsquo;s own estimate
          </Chip>
        )}
      </div>

      <div className="mt-2.5 grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-4">
        <KeyValue label="Carrier">{s.carrierCode}{s.serviceName ? ` · ${s.serviceName}` : ''}</KeyValue>
        <KeyValue label="Airway bill">
          {s.awb ? <span className="font-mono">{s.awb}</span> : <span className="text-fg-tertiary">Not issued</span>}
        </KeyValue>
        <KeyValue label="Route">
          {s.originName} ({s.originCountry}) → {s.destName} ({s.destCountry})
        </KeyValue>
        <KeyValue label="Consignment">
          {s.pieces} {s.pieces === 1 ? 'piece' : 'pieces'}
          {s.grossWeightKg ? ` · ${s.grossWeightKg} kg` : ''}
        </KeyValue>
        <KeyValue label="Dispatched">
          {s.dispatchedAt ? formatDate(s.dispatchedAt) : <span className="text-fg-tertiary">—</span>}
        </KeyValue>
        <KeyValue label="Carrier estimate">
          {s.estimatedDelivery ? formatDate(s.estimatedDelivery) : <span className="text-fg-tertiary">None given</span>}
        </KeyValue>
        <KeyValue label="Delivered">
          {s.deliveredAt ? formatDate(s.deliveredAt) : <span className="text-fg-tertiary">Not yet</span>}
        </KeyValue>
        <KeyValue label="Last reported">
          {latest ? relativeTime(latest.occurredAt) : <span className="text-fg-tertiary">No events</span>}
        </KeyValue>
      </div>

      {/* Progress along the carrier's own milestones. Rendered as segments
          rather than a percentage: a consignment is at a named checkpoint, not
          at 60% of a journey. */}
      {!stalled && (
        <div className="mt-3 flex min-w-0 gap-1" aria-hidden>
          {PROGRESS.map((p, i) => (
            <span
              key={p}
              className={cn(
                'h-1 flex-1 rounded-full',
                i <= reached ? 'bg-accent' : 'bg-line-subtle',
              )}
            />
          ))}
        </div>
      )}

      {s.events.length > 0 && (
        <ol className="border-line-subtle mt-3 flex min-w-0 flex-col border-t pt-2.5">
          {/* Newest first: the question is "where is it now", and the answer
              should not be at the bottom of a list. */}
          {[...s.events].reverse().map((e, i) => (
            <li
              key={e.id}
              className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-0.5 py-1.5"
            >
              <span
                className={cn(
                  'mt-1 size-1.5 shrink-0 rounded-full',
                  i === 0 ? 'bg-accent' : 'bg-line-strong',
                )}
                aria-hidden
              />
              <span className={cn('min-w-0 flex-1 text-[12.5px]', i === 0 ? 'text-fg font-medium' : 'text-fg-secondary')}>
                {e.description}
              </span>
              {e.location && (
                <span className="text-fg-tertiary flex shrink-0 items-center gap-1 text-[11.5px]">
                  <MapPin className="size-3 shrink-0" strokeWidth={2} aria-hidden />
                  {e.location}
                </span>
              )}
              <span className="text-fg-tertiary shrink-0 text-[11px]">
                {formatDateTime(e.occurredAt)}
              </span>
            </li>
          ))}
        </ol>
      )}

      {s.deliveredAt && (
        <p className="text-success mt-2 flex items-center gap-1.5 text-[12px]">
          <PackageCheck className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
          Delivered {formatDate(s.deliveredAt)} — this leg is closed.
        </p>
      )}
    </div>
  );
}
