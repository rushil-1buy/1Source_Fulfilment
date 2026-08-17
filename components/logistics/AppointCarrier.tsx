'use client';

/**
 * Appointing a carrier for a leg — where the leg is ours to appoint one for.
 *
 * The refusal is shown, not hidden. A leg the supplier already paid for gets a
 * stated reason in the Incoterm's own words rather than a missing button:
 * "nothing here" tells a desk the feature is broken, whereas "bought on CIF,
 * they pay ocean freight to the named destination port" tells them why there is
 * nothing to do, which is the answer they actually needed.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Ban, Check, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { appointCarrier } from '@/lib/actions/appointments';
import {
  activeLogisticsPartners,
  LEG_LABEL,
  LOGISTICS_PARTNERS,
  type Leg,
} from '@/lib/domain/appointments';
import { Button, KeyValue, SectionLabel } from '@/components/ui/Layout';
import { Chip } from '@/components/ui/Badges';
import { cn } from '@/lib/utils';

export interface LegSlot {
  leg: Leg;
  /** Ours to book, decided from the Incoterm on the relevant side. */
  ours: boolean;
  reason: string;
  /** Already booked with this carrier, if it is. */
  bookedWith: string | null;
  service: string | null;
  /** Once dispatched the carrier is fixed — its tracking belongs to it. */
  dispatched: boolean;
}

const field =
  'bg-surface-1 border-line-subtle focus:border-accent text-fg w-full rounded-[8px] border px-2.5 py-1.5 text-[13px] outline-none';

export function AppointCarrier({ orderId, slots }: { orderId: string; slots: LegSlot[] }) {
  if (slots.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <div>
        <SectionLabel>Appointing a carrier</SectionLabel>
        <p className="text-fg-tertiary mt-1 text-[11.5px] leading-relaxed">
          A leg is only ours to book when the delivery term puts the carriage on us. Where it does
          not, the reason is stated rather than the option hidden.
        </p>
      </div>
      {slots.map((s) => (
        <LegRow key={s.leg} orderId={orderId} slot={s} />
      ))}
    </div>
  );
}

function LegRow({ orderId, slot }: { orderId: string; slot: LegSlot }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const partners = activeLogisticsPartners();
  const [partner, setPartner] = useState(partners[0]?.code ?? '');
  const [service, setService] = useState(partners[0]?.services[0] ?? '');

  const chosen = LOGISTICS_PARTNERS.find((p) => p.code === partner);

  const book = () =>
    start(async () => {
      const res = await appointCarrier(orderId, slot.leg, partner, service);
      if (res.ok) {
        toast.success(res.message, { description: res.detail, duration: 8000 });
        router.refresh();
      } else {
        toast.error(res.message, { description: res.detail, duration: 9000 });
      }
    });

  return (
    <div
      className={cn(
        'bg-surface-1 min-w-0 rounded-[10px] border p-3',
        slot.ours ? 'border-line-subtle' : 'border-line-subtle opacity-90',
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <Truck className="text-fg-tertiary size-4 shrink-0" strokeWidth={1.9} aria-hidden />
        <span className="text-fg min-w-0 flex-1 text-[13px] font-semibold">
          {LEG_LABEL[slot.leg]}
        </span>
        {slot.bookedWith ? (
          <Chip tone="success" size="sm" icon={Check}>
            {slot.bookedWith}
            {slot.service ? ` · ${slot.service}` : ''}
          </Chip>
        ) : slot.ours ? (
          <Chip tone="warning" size="sm">
            Not booked
          </Chip>
        ) : (
          <Chip tone="muted" size="sm" icon={Ban}>
            Not ours to book
          </Chip>
        )}
      </div>

      <p className="text-fg-secondary mt-1.5 text-[12px] leading-relaxed">{slot.reason}</p>

      {slot.ours && slot.dispatched && (
        <p className="text-fg-tertiary mt-2 text-[11.5px] leading-relaxed">
          Already dispatched, so the carrier is fixed — its tracking history belongs to it.
        </p>
      )}

      {slot.ours && !slot.dispatched && (
        <div className="border-line-subtle mt-2.5 border-t pt-2.5">
          <div className="grid min-w-0 gap-2.5 sm:grid-cols-3">
            <label className="min-w-0">
              <SectionLabel>Carrier</SectionLabel>
              <select
                value={partner}
                onChange={(e) => {
                  setPartner(e.target.value);
                  const p = LOGISTICS_PARTNERS.find((x) => x.code === e.target.value);
                  setService(p?.services[0] ?? '');
                }}
                className={cn(field, 'mt-1')}
              >
                {partners.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-0">
              <SectionLabel>Service</SectionLabel>
              <select
                value={service}
                onChange={(e) => setService(e.target.value)}
                className={cn(field, 'mt-1')}
              >
                {(chosen?.services ?? []).map((sv) => (
                  <option key={sv} value={sv}>
                    {sv}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex min-w-0 items-end">
              <Button variant="primary" icon={Truck} onClick={book} disabled={pending || !partner}>
                {slot.bookedWith ? 'Re-appoint' : 'Appoint carrier'}
              </Button>
            </div>
          </div>
          {chosen && (
            <p className="text-fg-tertiary mt-2 text-[11.5px] leading-relaxed">
              {chosen.strengths}
              {LOGISTICS_PARTNERS.length === 1 &&
                ' Further carriers onboard as registry entries as the network grows.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Appointing the escrow provider — Finance's alone.
 *
 * Never gated on a delivery term, only on the payment method: escrow secures an
 * obligation, and no Incoterm has an opinion about who holds the money.
 */
export function AppointEscrow({
  orderId,
  paymentMethod,
  currentProvider,
  escrowRef,
  funded,
  partners,
}: {
  orderId: string;
  paymentMethod: string;
  currentProvider: string | null;
  escrowRef: string | null;
  funded: boolean;
  partners: { code: string; name: string; region: string; status: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const active = partners.filter((p) => p.status === 'ACTIVE');
  const [choice, setChoice] = useState(active[0]?.code ?? '');

  const appoint = () =>
    start(async () => {
      const { appointEscrowProvider } = await import('@/lib/actions/appointments');
      const res = await appointEscrowProvider(orderId, choice);
      if (res.ok) {
        toast.success(res.message, { description: res.detail, duration: 9000 });
        router.refresh();
      } else {
        toast.error(res.message, { description: res.detail, duration: 9000 });
      }
    });

  if (paymentMethod !== 'ESCROW') {
    return (
      <p className="text-fg-secondary text-[12.5px] leading-relaxed">
        This order settles by {paymentMethod.toLowerCase()}, so there is no escrow to appoint.
        Holding money the contract does not ask anyone to hold would only add a party to the flow.
      </p>
    );
  }

  const appointed = currentProvider && currentProvider !== 'TBD';

  return (
    <div className="min-w-0">
      <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3">
        <KeyValue label="Provider">
          {appointed ? currentProvider : <span className="text-fg-tertiary">Not appointed</span>}
        </KeyValue>
        <KeyValue label="Account reference">
          {escrowRef ? <span className="font-mono">{escrowRef}</span> : <span className="text-fg-tertiary">—</span>}
        </KeyValue>
        <KeyValue label="Funded">{funded ? 'Yes' : 'Not yet'}</KeyValue>
      </div>

      {funded ? (
        <p className="text-fg-secondary border-line-subtle mt-3 border-t pt-3 text-[12px] leading-relaxed">
          The account is funded, so the provider is fixed. Moving to another provider now would be a
          transfer of held money, not an appointment.
        </p>
      ) : (
        <div className="border-line-subtle mt-3 border-t pt-3">
          <div className="grid min-w-0 gap-2.5 sm:grid-cols-2">
            <label className="min-w-0">
              <SectionLabel>Escrow provider</SectionLabel>
              <select
                value={choice}
                onChange={(e) => setChoice(e.target.value)}
                className={cn(field, 'mt-1')}
              >
                {active.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name} — {p.region}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex min-w-0 items-end">
              <Button variant="primary" onClick={appoint} disabled={pending || !choice}>
                {appointed ? 'Re-appoint provider' : 'Appoint and open the account'}
              </Button>
            </div>
          </div>
          <p className="text-fg-tertiary mt-2 text-[11.5px] leading-relaxed">
            The held amount follows the order&rsquo;s agreed basis rather than being typed — an
            escrow held for a figure nobody can trace back to the order is the first thing a dispute
            attacks. {active.length === 1 && 'Further APAC partners onboard as the network grows.'}
          </p>
        </div>
      )}
    </div>
  );
}
