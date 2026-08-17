'use client';

/**
 * Choosing the order before running it.
 *
 * The shape of the order decides almost everything the run then does: which
 * Incoterm puts the inbound leg on us, whether escrow appears at all, whether
 * the testing phase runs, which parts go to the laboratory. A walkthrough on
 * somebody else's fixed order can only ever show one answer to all of those,
 * which is why this screen comes first.
 *
 * Testing is per LINE, not per order — the flag lives on the customer PO line
 * exactly as it does when a person raises the order by hand, because sending
 * every part to a laboratory when only the controller is in question is how a
 * real order loses a fortnight.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Bot, Minus, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { createSimulatedOrder } from '@/lib/actions/simulation';
import type { SimConfig } from '@/lib/domain/simulation-config';
import { INCOTERMS, incotermFor } from '@/lib/domain/incoterms';
import { PAYMENT_METHODS, PAYMENT_METHOD_META, type PaymentMethod } from '@/lib/domain/enums';
import { Button, KeyValue, Panel, PanelHeader, SectionLabel } from '@/components/ui/Layout';
import { Chip } from '@/components/ui/Badges';
import { cn } from '@/lib/utils';

export interface SimOptions {
  customers: { id: string; name: string; city: string | null }[];
  suppliers: { id: string; name: string; country: string | null; currency: string; incoterms: string }[];
  parts: {
    mpn: string;
    manufacturer: string;
    description: string;
    hsnCode: string;
    countryOfOrigin: string;
  }[];
}

const field =
  'bg-surface-1 border-line-subtle focus:border-accent text-fg w-full rounded-[8px] border px-2.5 py-1.5 text-[13px] outline-none';

interface DraftLine {
  mpn: string;
  qty: number;
  testing: boolean;
}

export function SimulationConfig({ options }: { options: SimOptions }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const [customerId, setCustomerId] = useState(options.customers[0]?.id ?? '');
  const [supplierId, setSupplierId] = useState(options.suppliers[0]?.id ?? '');
  // The supplier's usual term is offered as the starting point rather than
  // imposed — most orders are bought on it, and the ones that are not are
  // exactly the ones somebody wants to simulate.
  const [buyIncoterms, setBuyIncoterms] = useState(options.suppliers[0]?.incoterms ?? 'CIF');
  const [sellIncoterms, setSellIncoterms] = useState('DDP');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('ESCROW');
  const [lines, setLines] = useState<DraftLine[]>(
    options.parts[0] ? [{ mpn: options.parts[0].mpn, qty: 500, testing: true }] : [],
  );

  const chosenSupplier = options.suppliers.find((s) => s.id === supplierId);
  const buyDef = incotermFor(buyIncoterms);
  const sellDef = incotermFor(sellIncoterms);
  const inboundOurs = buyDef?.carriage.party === 'BUYER';
  const outboundOurs = sellDef?.carriage.party === 'SELLER';
  const testedLines = lines.filter((l) => l.testing).length;

  const addLine = () => {
    const used = new Set(lines.map((l) => l.mpn));
    const next = options.parts.find((p) => !used.has(p.mpn));
    if (!next) {
      toast.info('Every part on the master list is already on the order.');
      return;
    }
    setLines((ls) => [...ls, { mpn: next.mpn, qty: 250, testing: false }]);
  };

  const patch = (i: number, p: Partial<DraftLine>) =>
    setLines((ls) => ls.map((l, x) => (x === i ? { ...l, ...p } : l)));

  const create = () =>
    start(async () => {
      const config: SimConfig = {
        customerId,
        supplierId,
        buyIncoterms,
        sellIncoterms,
        paymentMethod,
        lines,
      };
      const res = await createSimulatedOrder(config);
      if (res.ok) {
        toast.success(res.message, { description: res.detail, duration: 9000 });
        router.refresh();
      } else {
        toast.error(res.message, { description: res.detail, duration: 9000 });
      }
    });

  return (
    <Panel>
      <PanelHeader
        title="Configure the order the agent will run"
        description="Everything downstream follows from these choices — which legs are ours, whether escrow exists, which parts go to the laboratory. The order created is a real one: it appears in the Control Tower and in every team queue alongside the rest."
        actions={
          <Chip tone="accent" size="sm" icon={Bot}>
            Step 1
          </Chip>
        }
      />

      {/* ── Parties ────────────────────────────────────────────────────────── */}
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <label className="min-w-0">
          <SectionLabel>Customer — who we sell to</SectionLabel>
          <select
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className={cn(field, 'mt-1')}
          >
            {options.customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.city ? ` — ${c.city}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0">
          <SectionLabel>Supplier — who we buy from</SectionLabel>
          <select
            value={supplierId}
            onChange={(e) => {
              setSupplierId(e.target.value);
              const s = options.suppliers.find((x) => x.id === e.target.value);
              if (s) setBuyIncoterms(s.incoterms);
            }}
            className={cn(field, 'mt-1')}
          >
            {options.suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.country ? ` — ${s.country}` : ''} ({s.currency})
              </option>
            ))}
          </select>
        </label>
      </div>

      {/*
        ── Terms ────────────────────────────────────────────────────────────

        Named for the party each one governs, and ordered to match the parties
        above: customer, then supplier. "We buy on" and "We sell on" asked the
        reader to hold which side of the trade 1BUY is on before the label meant
        anything — and on the sell contract we are the seller, which is the
        exact inversion people get wrong. Naming the counterparty removes the
        step.
      */}
      <div className="border-line-subtle mt-3 grid min-w-0 gap-3 border-t pt-3 sm:grid-cols-3">
        <label className="min-w-0">
          <SectionLabel>Incoterms to customer</SectionLabel>
          <select
            value={sellIncoterms}
            onChange={(e) => setSellIncoterms(e.target.value)}
            className={cn(field, 'mt-1')}
          >
            {INCOTERMS.map((c) => (
              <option key={c} value={c}>
                {c} — {incotermFor(c)?.name}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0">
          <SectionLabel>Incoterms to supplier</SectionLabel>
          <select
            value={buyIncoterms}
            onChange={(e) => setBuyIncoterms(e.target.value)}
            className={cn(field, 'mt-1')}
          >
            {INCOTERMS.map((c) => (
              <option key={c} value={c}>
                {c} — {incotermFor(c)?.name}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0">
          <SectionLabel>Payment method</SectionLabel>
          <select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
            className={cn(field, 'mt-1')}
          >
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_META[m].label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/*
        What the chosen terms actually mean, before the order is created.

        These two sentences are the whole reason the term is a choice and not a
        default: they say which desk will have work to do and which will not.
      */}
      <div className="bg-surface-2 border-line-subtle mt-3 grid min-w-0 gap-2.5 rounded-[10px] border p-3 sm:grid-cols-2">
        <KeyValue label={`Inbound leg — supplier terms, ${buyIncoterms}`}>
          <span className={inboundOurs ? 'text-fg' : 'text-fg-secondary'}>
            {inboundOurs
              ? 'Ours to book. 1BUY Inbound appoints the carrier and carries the freight cost.'
              : `The supplier's. They have already bought the carriage — Inbound has nothing to appoint.`}
          </span>
        </KeyValue>
        <KeyValue label={`Outbound leg — customer terms, ${sellIncoterms}`}>
          <span className={outboundOurs ? 'text-fg' : 'text-fg-secondary'}>
            {outboundOurs
              ? 'Ours to book. 1BUY Outbound appoints the carrier to the customer.'
              : 'The customer collects and arranges their own carriage.'}
          </span>
        </KeyValue>
        <KeyValue label="Financial arming">
          <span className="text-fg-secondary">
            {paymentMethod === 'ESCROW'
              ? 'Escrow is appointed and funded; the provider confirms the hold to the supplier, and the money moves only once the goods are received at 1BUY.'
              : paymentMethod === 'ADVANCE'
                ? 'Paid in advance against the supplier proforma — no escrow account is opened.'
                : 'Bought on credit terms — no money moves before delivery.'}
          </span>
        </KeyValue>
        <KeyValue label="Quality assurance">
          <span className="text-fg-secondary">
            {testedLines === 0
              ? 'No line is marked for testing, so the whole testing phase is skipped.'
              : testedLines === lines.length
                ? // "1 of 1 line go … the rest ship without it" promised a
                  // remainder that does not exist, on the commonest setup there is.
                  `Every line goes to the laboratory${lines.length > 1 ? ` — all ${lines.length} of them` : ''}.`
                : `${testedLines} of ${lines.length} lines go to the laboratory; the other ${
                    lines.length - testedLines === 1
                      ? 'one ships'
                      : `${lines.length - testedLines} ship`
                  } without it.`}
          </span>
        </KeyValue>
      </div>

      {/* ── Lines ──────────────────────────────────────────────────────────── */}
      <div className="border-line-subtle mt-3 border-t pt-3">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <SectionLabel>Parts on the order</SectionLabel>
          <Button variant="secondary" icon={Plus} onClick={addLine}>
            Add a part
          </Button>
        </div>

        <div className="mt-2 flex min-w-0 flex-col gap-2">
          {lines.length === 0 && (
            <p className="text-fg-tertiary text-[12.5px]">
              No parts yet — add at least one before creating the order.
            </p>
          )}
          {lines.map((l, i) => {
            const meta = options.parts.find((p) => p.mpn === l.mpn);
            return (
              <div
                key={i}
                className="bg-surface-1 border-line-subtle min-w-0 rounded-[10px] border p-2.5"
              >
                <div className="grid min-w-0 items-end gap-2.5 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto_auto]">
                  <label className="min-w-0">
                    <SectionLabel>Part number</SectionLabel>
                    <select
                      value={l.mpn}
                      onChange={(e) => patch(i, { mpn: e.target.value })}
                      className={cn(field, 'mt-1 font-mono')}
                    >
                      {options.parts.map((p) => (
                        <option key={p.mpn} value={p.mpn}>
                          {p.mpn} — {p.manufacturer}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="min-w-0">
                    <SectionLabel>Quantity</SectionLabel>
                    <input
                      type="number"
                      min={1}
                      value={l.qty}
                      onChange={(e) => patch(i, { qty: Number(e.target.value) })}
                      className={cn(field, 'mt-1 tnum')}
                    />
                  </label>
                  <label className="flex min-w-0 cursor-pointer items-center gap-2 pb-1.5">
                    <input
                      type="checkbox"
                      checked={l.testing}
                      onChange={(e) => patch(i, { testing: e.target.checked })}
                      className="accent-accent size-4 shrink-0"
                    />
                    <span className="text-fg text-[12.5px] font-medium">Send to testing</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setLines((ls) => ls.filter((_, x) => x !== i))}
                    aria-label="Remove this line"
                    className="text-fg-tertiary hover:text-danger hover:bg-surface-3 mb-1 rounded-[7px] p-1.5 transition-colors"
                  >
                    {lines.length === 1 ? (
                      <Minus className="size-4" strokeWidth={2} aria-hidden />
                    ) : (
                      <X className="size-4" strokeWidth={2} aria-hidden />
                    )}
                  </button>
                </div>
                {meta && (
                  <p className="text-fg-tertiary mt-1.5 text-[11.5px] leading-relaxed">
                    {meta.description} · HSN {meta.hsnCode} · origin {meta.countryOfOrigin}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="border-line-subtle mt-3 flex min-w-0 flex-wrap items-center gap-2 border-t pt-3">
        <Button
          variant="primary"
          icon={Bot}
          onClick={create}
          disabled={pending || lines.length === 0}
        >
          Create the order
        </Button>
        <span className="text-fg-tertiary text-[11.5px] leading-relaxed">
          {lines.length} line{lines.length === 1 ? '' : 's'} · {chosenSupplier?.name ?? '—'} on{' '}
          {buyIncoterms} · customer on {sellIncoterms} ·{' '}
          {PAYMENT_METHOD_META[paymentMethod].label.toLowerCase()}. It starts at A1 with the whole
          flow ahead of it.
        </span>
      </div>
    </Panel>
  );
}
