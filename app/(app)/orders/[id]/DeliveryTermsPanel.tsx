'use client';

/**
 * Delivery terms, insurance and duty — for one order.
 *
 * The order has two sets of terms: what we bought on and what we sold on. Read
 * separately they each look benign; read together they say who pays for the
 * middle, and the middle is where the money is. So the panel leads with the gap
 * and only then breaks each side down.
 *
 * Everything factual comes from lib/domain/incoterms so the definitions live in
 * one place and this file only decides what to show.
 */

import { useState } from 'react';
import { AlertTriangle, ArrowRight, Check, Info, Landmark, Ship, Shield, Truck } from 'lucide-react';
import { Money, Panel, PanelHeader, SectionLabel } from '@/components/ui/Layout';
import { IncotermTooltip } from '@/components/ui/IncotermTooltip';
import { Chip } from '@/components/ui/Badges';
import { Hint } from '@/components/ui/InfoTooltip';
import {
  INCOTERMS,
  INCOTERM_DEFS,
  LEVY_TREATMENT,
  costLabel,
  customsValuation,
  incotermFor,
  responsibilities,
  termGap,
  type IncotermDef,
} from '@/lib/domain/incoterms';
import { cn } from '@/lib/utils';

export interface DeliveryTermsData {
  /** Terms on the work order — the governing figure for the job. */
  workOrderIncoterms: string;
  /** Terms printed on our purchase order to the supplier. */
  supplierPoIncoterms: string;
  /** Terms we promised the customer. */
  customerPoIncoterms: string;
  supplierName: string;
  customerName: string;
  /** Actual amounts on this order, so the treatment is not hypothetical. */
  costs: {
    freightCost: number;
    insuranceCost: number;
    clearanceCost: number;
    dutyBcd: number;
    dutySws: number;
    dutyIgst: number;
  };
  /** Whether an insurance figure has been recorded at all. */
  hasInsurance: boolean;
}

const ICON: Record<string, typeof Truck> = {
  carriage: Truck,
  insurance: Shield,
  exportClearance: Ship,
  importClearance: Landmark,
};

export function DeliveryTermsPanel({ data }: { data: DeliveryTermsData }) {
  const [reference, setReference] = useState(false);

  const buy = incotermFor(data.workOrderIncoterms);
  const sell = incotermFor(data.customerPoIncoterms);
  const gap = termGap(data.workOrderIncoterms, data.customerPoIncoterms);
  /**
   * The work order and the supplier's PO should agree. When they do not, one of
   * them is wrong and the difference decides who pays for a leg — worth saying
   * loudly rather than quietly picking one.
   */
  const mismatch =
    data.supplierPoIncoterms &&
    data.workOrderIncoterms &&
    data.supplierPoIncoterms.trim().toUpperCase() !== data.workOrderIncoterms.trim().toUpperCase();

  if (!buy || !sell) {
    return (
      <Panel>
        <PanelHeader
          title="Delivery terms"
          description="The delivery term on this order is not one we recognise, so responsibility for freight, insurance and duty cannot be worked out from it."
          termKey="incoterms"
        />
        <p className="text-warning text-[12.5px] leading-relaxed">
          Recorded as{' '}
          <strong className="font-mono">{data.workOrderIncoterms || '(blank)'}</strong> buying and{' '}
          <strong className="font-mono">{data.customerPoIncoterms || '(blank)'}</strong> selling. Set
          both to a standard Incoterms 2020 rule on the order and this panel will spell out who
          carries what.
        </p>
      </Panel>
    );
  }

  const valuation = customsValuation(buy);
  const totalOurs = gap
    ? gap.oursToCarry.reduce((a, k) => a + (data.costs[k as keyof typeof data.costs] ?? 0), 0)
    : 0;

  return (
    /* grid-cols-1, not a bare grid: without an explicit track the implicit column
       is sized to max-content, so a table with a min-width pushes the whole
       column — and the Panel inside it — wider than the viewport. min-w-0
       constrains the container, never the track. */
    <div className="grid min-w-0 grid-cols-1 gap-4">
      {/* ── The gap. The reason the panel exists. ───────────────────────────── */}
      <Panel>
        <PanelHeader
          title="Delivery terms, insurance and duty"
          description="Two sets of terms govern this order — what we bought on and what we sold on. Everything between the two is ours to arrange, insure, clear and pay for."
          termKey="incoterms"
        />

        <div className="grid gap-2.5 lg:grid-cols-[1fr_auto_1fr] lg:items-stretch">
          <TermCard
            heading="We buy on"
            counterparty={data.supplierName}
            def={buy}
            side="BUY"
          />
          <div className="text-fg-tertiary flex items-center justify-center lg:flex-col">
            <ArrowRight className="size-4 lg:rotate-0" aria-hidden />
          </div>
          <TermCard
            heading="We sell on"
            counterparty={data.customerName}
            def={sell}
            side="SELL"
          />
        </div>

        {mismatch && (
          <div className="border-danger/40 bg-danger-subtle mt-3 rounded-[9px] border px-3 py-2.5">
            <div className="text-danger flex items-center gap-1.5 text-[12px] font-semibold">
              <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
              The work order and the supplier&rsquo;s purchase order disagree
            </div>
            <p className="text-fg-secondary mt-1 text-[11.5px] leading-relaxed">
              The job is recorded as{' '}
              <strong className="font-mono">{data.workOrderIncoterms}</strong> but the purchase order
              sent to {data.supplierName} says{' '}
              <strong className="font-mono">{data.supplierPoIncoterms}</strong>. Those two terms put
              freight, insurance or duty on different parties, so one of them is wrong. The supplier
              will perform against the document they were sent — fix the work order to match it, or
              re-issue the purchase order.
            </p>
          </div>
        )}

        {gap && (
          <div className="border-accent-border bg-accent-subtle mt-3 rounded-[9px] border px-3 py-2.5">
            <SectionLabel>What falls to us in the middle</SectionLabel>
            <p className="text-fg text-[12.5px] leading-relaxed">{gap.summary}</p>
            {gap.oursToCarry.length > 0 && (
              <>
                <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
                  {gap.oursToCarry.map((k) => {
                    const amount = data.costs[k as keyof typeof data.costs] ?? 0;
                    return (
                      <li
                        key={k}
                        className="border-line-subtle bg-surface-1 flex min-w-0 items-center justify-between gap-2 rounded-[7px] border px-2.5 py-1.5"
                      >
                        <span className="text-fg-secondary min-w-0 truncate text-[12px]">
                          {costLabel(k)}
                        </span>
                        {amount > 0 ? (
                          <Money amount={amount} withCode={false} className="shrink-0 font-medium" />
                        ) : (
                          <Chip tone="warning" size="sm">
                            Not recorded yet
                          </Chip>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {/* Careful with the wording: on a pre-shipment order these costs
                    have not been incurred rather than been forgotten. Saying
                    "missing" would read as a data error on every early order. */}
                <p className="text-fg-tertiary mt-2 text-[11.5px] leading-relaxed">
                  {totalOurs > 0 ? (
                    <>
                      <Money amount={totalOurs} className="text-fg font-medium" /> recorded against
                      these so far. The rest land as the order moves — margin is provisional until
                      every one of them carries a figure.
                    </>
                  ) : (
                    'None of these has a figure yet. They fall due as the order moves through shipping and customs, so the margin shown today is before all of them.'
                  )}
                </p>
              </>
            )}
          </div>
        )}

        {/* ── Insurance, called out separately ────────────────────────────── */}
        <div
          className={cn(
            'mt-3 rounded-[9px] border px-3 py-2.5',
            gap?.insuranceGap && !data.hasInsurance
              ? 'border-warning/40 bg-warning-subtle'
              : 'border-line-subtle bg-surface-inset',
          )}
        >
          <SectionLabel>
            <Shield className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />
            Insurance on this order
          </SectionLabel>
          <p className="text-fg-secondary text-[12.5px] leading-relaxed">{gap?.insuranceNote}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {data.hasInsurance ? (
              <Chip tone="success" icon={Check} size="sm">
                <Money amount={data.costs.insuranceCost} withCode={false} /> recorded
              </Chip>
            ) : buy.insurance.mandatory ? (
              <Chip tone="info" size="sm">
                Inside the supplier price — {buy.code} obliges them to insure
              </Chip>
            ) : (
              <Chip tone="warning" icon={AlertTriangle} size="sm">
                No insurance cost recorded on this order
              </Chip>
            )}
            <span className="text-fg-tertiary min-w-0 text-[11.5px] leading-relaxed">
              {buy.insurance.mandatory
                ? buy.insurance.note
                : `Under ${buy.code} insuring the inbound leg is a commercial decision, not an obligation — so it only exists if we buy it.`}
            </span>
          </div>
        </div>
      </Panel>

      {/* ── Customs duty: how it is worked out and how it is treated ───────── */}
      <Panel>
        <PanelHeader
          title="Customs duty — how it is worked out and how we treat it"
          description="The delivery term decides the value duty is charged on. Whether a levy is a real cost depends on something else entirely: whether we can credit it."
          termKey="landedCost"
        />

        <div
          className={cn(
            'rounded-[9px] border px-3 py-2.5',
            valuation.needsAddBack ? 'border-warning/40 bg-warning-subtle' : 'border-line-subtle bg-surface-inset',
          )}
        >
          <SectionLabel>The value duty is charged on</SectionLabel>
          <p className="text-fg-secondary text-[12.5px] leading-relaxed">{valuation.note}</p>
          {valuation.needsAddBack && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {valuation.notionalFreightPctOfFob !== null && (
                <Chip tone="warning" size="sm">
                  Notional freight {valuation.notionalFreightPctOfFob}% of FOB
                </Chip>
              )}
              {valuation.notionalInsurancePctOfFob !== null && (
                <Chip tone="warning" size="sm">
                  Notional insurance {valuation.notionalInsurancePctOfFob}% of FOB
                </Chip>
              )}
              <Chip tone="neutral" size="sm">
                Rule 10(2), Customs Valuation Rules 2007
              </Chip>
            </div>
          )}
        </div>

        <div className="mt-3 min-w-0 overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-left">
            <thead className="bg-surface-inset">
              <tr className="border-line-subtle border-y">
                <Th>Levy or cost</Th>
                <Th width="120px">On this order</Th>
                <Th width="130px">Creditable?</Th>
                <Th>How it is treated</Th>
              </tr>
            </thead>
            <tbody>
              {LEVY_TREATMENT.map((l) => {
                const amount = data.costs[l.key as keyof typeof data.costs] ?? 0;
                /** Whose cost it is under the term we bought on. */
                const oursUnderTerm = buy.weExpectToPay.includes(l.key);
                return (
                  <tr key={l.key} className="border-line-subtle border-b last:border-0 align-top">
                    <td className="px-3 py-2">
                      <div className="text-fg text-[12.5px] font-medium">{l.label}</div>
                      <div className="text-fg-tertiary text-[11px]">
                        {buy.mode === 'DOM'
                          ? 'Not applicable — domestic purchase'
                          : oursUnderTerm
                            ? `Ours under ${buy.code}`
                            : buy.alreadyInThePrice.includes(l.key)
                              ? `Inside the supplier price under ${buy.code}`
                              : `Not ours under ${buy.code}`}
                      </div>
                    </td>
                    <td className="tnum px-3 py-2 text-[12.5px]">
                      {amount > 0 ? (
                        <Money amount={amount} withCode={false} />
                      ) : (
                        <span className="text-fg-tertiary text-[11.5px]">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {l.creditable ? (
                        <Chip tone="success" size="sm">
                          Yes — input tax credit
                        </Chip>
                      ) : (
                        <Chip tone="danger" size="sm">
                          No — a real cost
                        </Chip>
                      )}
                    </td>
                    <td className="text-fg-secondary px-3 py-2 text-[11.5px] leading-relaxed">
                      {l.treatment}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="text-fg-tertiary mt-2 text-[11.5px] leading-relaxed">
          The distinction in the third column is the one that moves reported margin. BCD and the
          Surcharge are money gone; IGST at import comes back as credit. Treating IGST as a cost
          would understate margin on every single import — the Commercials panel shows both figures
          side by side for exactly that reason.
        </p>
      </Panel>

      {/* ── The reference, for any term rather than just this order's ─────── */}
      <Panel padded={false}>
        <div className="p-4">
          <PanelHeader
            title="What each delivery term means"
            description="All eleven Incoterms® 2020 rules and the one Indian domestic convention, with who carries what under each."
            termKey="incoterms"
            actions={
              <button
                type="button"
                onClick={() => setReference((r) => !r)}
                aria-expanded={reference}
                className="border-line-subtle text-fg-secondary hover:bg-surface-3 rounded-[7px] border px-2 py-1 text-[11.5px] transition-colors"
              >
                {reference ? 'Hide' : 'Show all terms'}
              </button>
            }
          />
        </div>
        {reference && (
          <div className="min-w-0 overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-left">
              <thead className="bg-surface-inset">
                <tr className="border-line-subtle border-y">
                  <Th width="150px">Term</Th>
                  <Th width="100px">Freight</Th>
                  <Th width="120px">Insurance</Th>
                  <Th width="120px">Import duty</Th>
                  <Th width="180px">Risk passes</Th>
                  <Th>What it implies</Th>
                </tr>
              </thead>
              <tbody>
                {INCOTERMS.map((code) => {
                  const d = INCOTERM_DEFS[code];
                  const isThis =
                    code === buy.code || code === sell.code;
                  return (
                    <tr
                      key={code}
                      className={cn(
                        'border-line-subtle border-b align-top last:border-0',
                        isThis && 'bg-accent-subtle/40',
                      )}
                    >
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-fg font-mono text-[12px] font-semibold">{code}</span>
                          {code === buy.code && (
                            <Chip tone="accent" size="sm">
                              We buy
                            </Chip>
                          )}
                          {code === sell.code && (
                            <Chip tone="accent" size="sm">
                              We sell
                            </Chip>
                          )}
                        </div>
                        <div className="text-fg-secondary mt-0.5 text-[11.5px] leading-snug">
                          {d.name}
                        </div>
                        <div className="text-fg-tertiary mt-0.5 text-[10.5px]">
                          {d.mode === 'SEA'
                            ? 'Sea freight only'
                            : d.mode === 'DOM'
                              ? 'Not an Incoterm — Indian domestic'
                              : 'Any mode of transport'}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-[11.5px]">
                        <PartyCell party={d.carriage.party} />
                      </td>
                      <td className="px-3 py-2 text-[11.5px]">
                        <PartyCell party={d.insurance.party} />
                        <div className="text-fg-tertiary mt-0.5 text-[10.5px]">
                          {d.insurance.mandatory ? 'Obliged to insure' : 'Nobody obliged'}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-[11.5px]">
                        <PartyCell party={d.importClearance} />
                      </td>
                      <td className="text-fg-secondary px-3 py-2 text-[11.5px] leading-relaxed">
                        {d.riskTransfersAt}
                      </td>
                      <td className="px-3 py-2">
                        <p className="text-fg-secondary text-[11.5px] leading-relaxed">{d.implies}</p>
                        {d.watchOut && (
                          <p className="text-warning mt-1.5 text-[11.5px] leading-relaxed">
                            <AlertTriangle
                              className="mr-1 inline size-3 align-[-1px] shrink-0"
                              aria-hidden
                            />
                            {d.watchOut}
                          </p>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!reference && (
          <p className="text-fg-tertiary px-4 pb-4 text-[11.5px] leading-relaxed">
            Open this when a supplier proposes a term we do not normally use, or when a customer asks
            what a code on their quote commits them to.
          </p>
        )}
      </Panel>
    </div>
  );
}

/** One side of the deal: the term, and the four responsibilities under it. */
function TermCard({
  heading,
  counterparty,
  def,
  side,
}: {
  heading: string;
  counterparty: string;
  def: IncotermDef;
  side: 'BUY' | 'SELL';
}) {
  const rows = responsibilities(def, side);
  return (
    <div className="border-line-subtle bg-surface-inset flex min-w-0 flex-col rounded-[10px] border px-3 py-2.5">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-fg-tertiary text-[10.5px] font-semibold tracking-[0.06em] uppercase">
          {heading}
        </span>
        <span className="text-fg font-mono text-[13px] font-semibold">{def.code}</span>
        <IncotermTooltip code={def.code} />
        <span className="text-fg-secondary min-w-0 text-[12px]">{def.name}</span>
      </div>
      <div className="text-fg-tertiary mt-0.5 text-[11.5px]">
        {side === 'BUY' ? 'From' : 'To'} {counterparty}
      </div>

      <p className="text-fg-secondary mt-2 text-[12px] leading-relaxed">
        {side === 'BUY' ? def.whenWeBuy : def.whenWeSell}
      </p>

      <dl className="mt-2.5 grid gap-1.5">
        {rows.map((r) => {
          const Icon = ICON[r.key] ?? Info;
          return (
            <div key={r.key} className="flex min-w-0 items-start gap-2">
              <Icon className="text-fg-tertiary mt-[3px] size-3.5 shrink-0" aria-hidden />
              <dt className="text-fg-tertiary w-[104px] shrink-0 text-[11px] leading-[1.35]">
                {r.label}
              </dt>
              <dd className="min-w-0 flex-1">
                <Hint content={<span>{r.detail}</span>}>
                  <span
                    className={cn(
                      'text-[11.5px] font-medium',
                      r.party === '1BUY' ? 'text-accent-text' : 'text-fg',
                    )}
                  >
                    {r.party}
                    {r.obligatory && (
                      <span className="text-success ml-1 text-[10.5px] font-normal">· obliged</span>
                    )}
                  </span>
                </Hint>
                {r.warning && (
                  <span className="text-warning block text-[10.5px] leading-[1.35]">{r.warning}</span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>

      <div className="border-line-subtle mt-2.5 border-t pt-2">
        <span className="text-fg-tertiary text-[10.5px] leading-relaxed">
          <strong className="font-semibold">Risk passes:</strong> {def.riskTransfersAt}
        </span>
      </div>
    </div>
  );
}

function PartyCell({ party }: { party: string }) {
  const isUs = party === '1BUY';
  return (
    <span className={cn('font-medium', isUs ? 'text-accent-text' : 'text-fg-secondary')}>
      {party === 'SELLER'
        ? 'Seller'
        : party === 'BUYER'
          ? 'Buyer'
          : party === 'NONE'
            ? '—'
            : party === 'SHARED'
              ? 'Split'
              : party}
    </span>
  );
}

function Th({ children, width }: { children: React.ReactNode; width?: string }) {
  return (
    <th
      scope="col"
      style={width ? { width } : undefined}
      className="text-fg-tertiary px-3 py-2 text-[10.5px] font-semibold tracking-[0.04em] whitespace-nowrap uppercase"
    >
      {children}
    </th>
  );
}
