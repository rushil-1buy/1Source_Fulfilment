'use client';

/**
 * The inbound leg, driven from one place.
 *
 * Book, sync, receive — the three moments a desk actually touches the carrier.
 * Separate buttons rather than one that does everything, because each waits on
 * something outside this platform: you cannot track a consignment that has not
 * been collected, or book in one still in the air.
 *
 * Every run prints what it DID, line by line. A carrier integration that
 * returns "synced" tells a desk nothing; one that says which scans arrived,
 * which step the order moved to and which event it raised can be checked
 * against the tracking page.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, PackageCheck, RefreshCw, Truck } from 'lucide-react';
import { toast } from 'sonner';
import {
  bookInboundShipment,
  receiveInboundConsignment,
  syncInboundTracking,
} from '@/lib/actions/inbound-flow';
import { dhlCode } from '@/lib/domain/dhl-tracking';
import { Button, KeyValue, SectionLabel } from '@/components/ui/Layout';
import { Chip } from '@/components/ui/Badges';
import { cn, formatDateTime } from '@/lib/utils';

export interface InboundLegView {
  awb: string | null;
  carrier: string;
  service: string | null;
  status: string;
  pieces: number;
  grossWeightKg: number | null;
  estimatedDelivery: string | null;
  deliveredAt: string | null;
  events: { code: string; occurredAt: string; description: string; location: string | null }[];
}

export function InboundFlowPanel({
  orderId,
  leg,
  lines,
  hasGrn,
  legIsOurs,
  legReason,
}: {
  orderId: string;
  leg: InboundLegView | null;
  lines: { mpn: string; quantity: number }[];
  hasGrn: boolean;
  /** Whether the delivery term makes this leg ours to book. */
  legIsOurs: boolean;
  legReason: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [log, setLog] = useState<string[]>([]);
  const [counting, setCounting] = useState(false);
  const [counts, setCounts] = useState<Record<string, string>>({});

  const run = (fn: () => Promise<{ ok: boolean; message: string; detail?: string; did?: string[] }>) =>
    start(async () => {
      const res = await fn();
      setLog(res.did ?? []);
      if (res.ok) toast.success(res.message, { description: res.detail, duration: 9000 });
      else toast.error(res.message, { description: res.detail, duration: 10000 });
      router.refresh();
    });

  const delivered = leg?.status === 'DELIVERED';

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div>
        <SectionLabel>The inbound leg, end to end</SectionLabel>
        <p className="text-fg-tertiary mt-1 text-[11.5px] leading-relaxed">
          Book the consignment, pull the carrier&rsquo;s scans, and book it in. Tracking is the only
          thing here allowed to move the order, and it can only move it forward — a step that needs
          our own evidence still refuses, exactly as it would for a person.
        </p>
      </div>

      {/* ── Where the consignment is ────────────────────────────────────── */}
      {leg?.awb ? (
        <div className="bg-surface-1 border-line-subtle min-w-0 rounded-[10px] border p-3">
          <div className="grid min-w-0 gap-2.5 sm:grid-cols-3">
            <KeyValue label="Waybill">
              <span className="font-mono">{leg.awb}</span>
            </KeyValue>
            <KeyValue label="Carrier and service">
              {leg.carrier}
              {leg.service ? ` · ${leg.service}` : ''}
            </KeyValue>
            <KeyValue label="Status">
              <Chip tone={delivered ? 'success' : leg.status === 'CUSTOMS' ? 'warning' : 'accent'} size="sm">
                {leg.status}
              </Chip>
            </KeyValue>
            <KeyValue label="Pieces and weight">
              {leg.pieces} · {leg.grossWeightKg ?? '—'} kg
            </KeyValue>
            <KeyValue label="Estimated delivery">
              {leg.estimatedDelivery ? formatDateTime(leg.estimatedDelivery) : '—'}
            </KeyValue>
            <KeyValue label="Delivered">
              {leg.deliveredAt ? formatDateTime(leg.deliveredAt) : 'Not yet'}
            </KeyValue>
          </div>
        </div>
      ) : (
        <p className="text-fg-tertiary text-[12px] leading-relaxed">
          {legIsOurs
            ? 'No consignment booked yet.'
            : `Not ours to book. ${legReason}`}
        </p>
      )}

      {/* ── The three moves ─────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button
          variant="primary"
          icon={Truck}
          onClick={() => run(() => bookInboundShipment(orderId))}
          disabled={pending || !legIsOurs || Boolean(leg?.awb)}
        >
          {leg?.awb ? 'Booked' : 'Book the consignment'}
        </Button>
        <Button
          variant="secondary"
          icon={RefreshCw}
          onClick={() => run(() => syncInboundTracking(orderId))}
          disabled={pending || !leg?.awb}
        >
          Pull tracking
        </Button>
        <Button
          variant="secondary"
          icon={PackageCheck}
          onClick={() => setCounting((c) => !c)}
          disabled={pending || hasGrn || !leg?.awb}
        >
          {hasGrn ? 'Booked in' : 'Book it in'}
        </Button>
      </div>

      {/* ── Counting it in ──────────────────────────────────────────────── */}
      {counting && !hasGrn && (
        <div className="bg-surface-1 border-line-subtle min-w-0 rounded-[10px] border p-3">
          <SectionLabel>Count against the packing list</SectionLabel>
          <p className="text-fg-tertiary mt-1 mb-2 text-[11px] leading-relaxed">
            Counted against what the supplier says they sent, not against the purchase order —
            that is the number a shortage claim is argued against. Leave a line blank to accept it
            in full.
          </p>
          <div className="flex min-w-0 flex-col gap-1.5">
            {lines.map((l) => (
              <label key={l.mpn} className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="text-fg min-w-0 flex-1 font-mono text-[12px]">{l.mpn}</span>
                <span className="text-fg-tertiary shrink-0 text-[11.5px]">
                  expected {l.quantity}
                </span>
                <input
                  type="number"
                  min={0}
                  placeholder={String(l.quantity)}
                  value={counts[l.mpn] ?? ''}
                  onChange={(e) => setCounts((c) => ({ ...c, [l.mpn]: e.target.value }))}
                  className="bg-surface-1 border-line-subtle focus:border-accent text-fg tnum w-24 shrink-0 rounded-[8px] border px-2 py-1 text-[12.5px] outline-none"
                />
              </label>
            ))}
          </div>
          <div className="mt-2.5">
            <Button
              variant="primary"
              icon={Check}
              disabled={pending}
              onClick={() =>
                run(() =>
                  receiveInboundConsignment(
                    orderId,
                    lines.map((l) => ({
                      mpn: l.mpn,
                      receivedQty: counts[l.mpn] ? Number(counts[l.mpn]) : l.quantity,
                    })),
                  ),
                )
              }
            >
              Raise the goods receipt note
            </Button>
          </div>
        </div>
      )}

      {/* ── What the last run did ───────────────────────────────────────── */}
      {log.length > 0 && (
        <ul className="border-line-subtle bg-surface-2 min-w-0 rounded-[10px] border p-3 text-[12px]">
          {log.map((l) => (
            <li key={l} className="text-fg-secondary flex min-w-0 items-start gap-2 leading-relaxed">
              <Check className="text-success mt-0.5 size-3.5 shrink-0" strokeWidth={2.2} aria-hidden />
              <span className="min-w-0">{l}</span>
            </li>
          ))}
        </ul>
      )}

      {/* ── The scans themselves ────────────────────────────────────────── */}
      {leg && leg.events.length > 0 && (
        <div className="min-w-0">
          <SectionLabel>Carrier scans</SectionLabel>
          <ul className="mt-1.5 flex min-w-0 flex-col gap-1">
            {[...leg.events]
              .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
              .map((e, i) => {
                const m = dhlCode(e.code);
                return (
                  <li key={`${e.code}-${i}`} className="flex min-w-0 items-start gap-2 text-[11.5px]">
                    <span
                      className={cn(
                        'shrink-0 rounded-[5px] px-1.5 py-0.5 font-mono text-[10px]',
                        m.confidence === 'UNKNOWN'
                          ? 'bg-warning-subtle text-warning'
                          : 'bg-surface-3 text-fg-secondary',
                      )}
                      title={m.meaning}
                    >
                      {e.code}
                    </span>
                    <span className="text-fg-secondary min-w-0 flex-1">{e.description}</span>
                    <span className="text-fg-tertiary shrink-0 whitespace-nowrap">
                      {formatDateTime(e.occurredAt)}
                    </span>
                  </li>
                );
              })}
          </ul>
        </div>
      )}
    </div>
  );
}
