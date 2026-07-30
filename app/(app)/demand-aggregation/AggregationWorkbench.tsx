'use client';

/**
 * The aggregation workbench.
 *
 * Three panes, in the order the work actually happens:
 *
 *   1. Open demand      — every customer line still to source, grouped BY PART so
 *                         the overlap is visible without hunting. This is the
 *                         whole reason the page exists: you cannot spot that four
 *                         customers want the same shift register by reading four
 *                         separate orders.
 *   2. The pool         — what has been picked, rolled up per part, with the
 *                         negotiated bulk price and the saving it produces.
 *   3. Float            — one bulk purchase order, one work order per customer.
 *
 * Quantities are held per customer line, never per part. Pooling is a decision
 * about whose demand goes in, and rolling it up too early would lose which
 * customer is owed what.
 */

import { Fragment, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  Layers,
  Minus,
  Plus,
  Search,
  Send,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { floatAggregation, saveAggregation, cancelAggregation } from '@/lib/actions/aggregation';
import {
  assessPool,
  poolDemand,
  poolIsFloatable,
  type DemandCandidate,
  type PoolInput,
} from '@/lib/domain/aggregation';
import type { AggregationDetail, AggregationRow } from '@/lib/queries/aggregation';
import { Button, EmptyState, Panel, PanelHeader, Pct, SectionLabel } from '@/components/ui/Layout';
import { Chip, StatusChip } from '@/components/ui/Badges';
import { Hint } from '@/components/ui/InfoTooltip';
import { cn, formatDate } from '@/lib/utils';

const field =
  'bg-surface-1 border-line-subtle focus:border-accent text-fg placeholder:text-fg-tertiary w-full rounded-[8px] border px-2.5 py-1.5 text-[13px] outline-none';

interface Supplier {
  id: string;
  name: string;
  code: string;
  currency: string;
  incoterms: string;
  country: string;
}

/** What the operator has picked, keyed by customer PO line. */
type Picks = Record<string, number>;
/** Negotiated bulk price per MPN, as typed. */
type Prices = Record<string, { buy: string; baseline: string; lead: string }>;

export function AggregationWorkbench({
  candidates,
  pools,
  suppliers,
  initialView,
  editing,
}: {
  candidates: DemandCandidate[];
  pools: AggregationRow[];
  suppliers: Supplier[];
  initialView: 'open' | 'pools';
  editing: AggregationDetail | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [view, setView] = useState<'open' | 'pools'>(editing ? 'open' : initialView);

  const byLine = useMemo(
    () => new Map(candidates.map((c) => [c.customerPoLineId, c])),
    [candidates],
  );

  // ── Form state, seeded from an existing draft when editing ─────────────────
  const [picks, setPicks] = useState<Picks>(() => {
    const p: Picks = {};
    for (const l of editing?.lines ?? []) p[l.customerPoLineId] = l.quantity;
    return p;
  });
  const [prices, setPrices] = useState<Prices>(() => {
    const p: Prices = {};
    for (const part of editing?.parts ?? []) {
      p[part.mpn] = {
        buy: part.buyUnitPrice > 0 ? String(part.buyUnitPrice) : '',
        baseline: part.baselineUnitPrice != null ? String(part.baselineUnitPrice) : '',
        lead: part.leadTimeDays != null ? String(part.leadTimeDays) : '',
      };
    }
    return p;
  });
  const [title, setTitle] = useState(editing?.title ?? '');
  const [rationale, setRationale] = useState(editing?.rationale ?? '');
  const [supplierId, setSupplierId] = useState(editing?.supplierId ?? '');
  const [sourcingRef, setSourcingRef] = useState(editing?.sourcingRef ?? '');
  const [requiredBy, setRequiredBy] = useState(editing?.requiredBy?.slice(0, 10) ?? '');
  const [incoterms, setIncoterms] = useState(editing?.incoterms ?? 'FOB');
  const [paymentMethod, setPaymentMethod] = useState(editing?.paymentMethod ?? 'ESCROW');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  /** Aggregation is about overlap, so filtering to it is the default lens. */
  const [sharedOnly, setSharedOnly] = useState(false);

  const supplier = suppliers.find((s) => s.id === supplierId) ?? null;
  const currency = supplier?.currency ?? editing?.currency ?? 'USD';

  // ── Open demand, grouped by part so the overlap is the first thing you see ─
  const groups = useMemo(() => {
    const map = new Map<string, DemandCandidate[]>();
    for (const c of candidates) {
      if (c.availableQty <= 0) continue;
      const list = map.get(c.mpn) ?? [];
      list.push(c);
      map.set(c.mpn, list);
    }
    return [...map.entries()]
      .map(([mpn, list]) => ({
        mpn,
        manufacturer: list[0].manufacturer,
        description: list[0].description,
        lines: list.sort((a, b) => b.availableQty - a.availableQty),
        orders: new Set(list.map((c) => c.customerPoId)).size,
        customers: new Set(list.map((c) => c.customerName)).size,
        availableQty: list.reduce((a, c) => a + c.availableQty, 0),
        earliest: list
          .map((c) => c.requestedDate)
          .filter(Boolean)
          .sort()[0] as string | undefined,
      }))
      // Overlapping parts first — those are the ones worth pooling.
      .sort((a, b) => b.orders - a.orders || b.availableQty - a.availableQty);
  }, [candidates]);

  /**
   * What the demand pane actually shows. Filtered rather than paginated: the
   * question is "is this part in the list", and a search answers that in one
   * keystroke where paging makes you hunt.
   */
  const visibleGroups = useMemo(() => {
    const q = query.trim().toUpperCase();
    return groups.filter((g) => {
      if (sharedOnly && g.orders < 2) return false;
      if (!q) return true;
      return (
        g.mpn.toUpperCase().includes(q) ||
        g.manufacturer.toUpperCase().includes(q) ||
        g.description.toUpperCase().includes(q) ||
        g.lines.some(
          (l) =>
            l.customerPoNumber.toUpperCase().includes(q) ||
            l.customerName.toUpperCase().includes(q),
        )
      );
    });
  }, [groups, query, sharedOnly]);

  const sharedCount = useMemo(() => groups.filter((g) => g.orders > 1).length, [groups]);

  // ── The live pool ─────────────────────────────────────────────────────────
  const inputs: PoolInput[] = useMemo(
    () =>
      Object.entries(picks)
        .filter(([, q]) => q > 0)
        .map(([id, q]) => {
          const candidate = byLine.get(id);
          return candidate ? { candidate, quantity: q } : null;
        })
        .filter((x): x is PoolInput => x !== null),
    [picks, byLine],
  );

  const priceMap = useMemo(() => {
    const out: Record<string, { buyUnitPrice: number; baselineUnitPrice: number | null }> = {};
    for (const [mpn, v] of Object.entries(prices)) {
      const buy = Number(v.buy);
      if (Number.isFinite(buy) && buy > 0) {
        const base = Number(v.baseline);
        out[mpn] = {
          buyUnitPrice: buy,
          baselineUnitPrice: Number.isFinite(base) && base > 0 ? base : null,
        };
      }
    }
    return out;
  }, [prices]);

  const summary = useMemo(() => poolDemand(inputs, priceMap), [inputs, priceMap]);
  const problems = useMemo(
    () =>
      assessPool(inputs, summary, {
        supplierChosen: Boolean(supplierId),
        hasRationale: rationale.trim().length >= 12,
      }),
    [inputs, summary, supplierId, rationale],
  );
  const floatable = poolIsFloatable(problems) && title.trim().length >= 3;
  const blocking = problems.filter((p) => p.severity === 'BLOCKING');
  const warnings = problems.filter((p) => p.severity === 'WARNING');
  const readOnly = Boolean(editing && editing.status !== 'DRAFT');

  // ── Picking ───────────────────────────────────────────────────────────────
  const setPick = (c: DemandCandidate, qty: number) => {
    setPicks((p) => {
      const next = { ...p };
      // Clamped here as well as on the server: an input that silently accepts an
      // impossible number and fails on save wastes the operator's time.
      const clamped = Math.max(0, Math.min(qty, c.availableQty));
      if (clamped === 0) delete next[c.customerPoLineId];
      else next[c.customerPoLineId] = clamped;
      return next;
    });
  };

  const addWholeGroup = (lines: DemandCandidate[]) => {
    setPicks((p) => {
      const next = { ...p };
      for (const c of lines) next[c.customerPoLineId] = c.availableQty;
      return next;
    });
  };

  const clearGroup = (lines: DemandCandidate[]) => {
    setPicks((p) => {
      const next = { ...p };
      for (const c of lines) delete next[c.customerPoLineId];
      return next;
    });
  };

  /** Back to an empty pool, for after a float or an explicit start-over. */
  const resetBuilder = () => {
    setPicks({});
    setPrices({});
    setTitle('');
    setRationale('');
    setSupplierId('');
    setSourcingRef('');
    setRequiredBy('');
    setErrors({});
    setExpanded(null);
  };

  const payload = () => ({
    id: editing?.id ?? null,
    title: title.trim(),
    rationale: rationale.trim(),
    supplierId: supplierId || null,
    sourcingRef: sourcingRef.trim() || null,
    requiredBy: requiredBy || null,
    incoterms,
    paymentMethod: paymentMethod as 'ESCROW',
    lines: inputs.map((i) => ({ customerPoLineId: i.candidate.customerPoLineId, quantity: i.quantity })),
    parts: summary.parts
      .filter((p) => p.buyUnitPrice != null)
      .map((p) => ({
        mpn: p.mpn,
        buyUnitPrice: p.buyUnitPrice!,
        baselineUnitPrice: p.baselineUnitPrice,
        leadTimeDays: prices[p.mpn]?.lead ? Number(prices[p.mpn].lead) : null,
      })),
  });

  const save = (then?: (id: string) => void) => {
    setErrors({});
    startTransition(async () => {
      const res = await saveAggregation(payload());
      if (res.ok && res.id) {
        toast.success(res.message, { description: res.detail });
        if (then) then(res.id);
        else router.replace(`/demand-aggregation?pool=${res.id}`);
        router.refresh();
      } else {
        setErrors(res.errors ?? {});
        toast.error(res.message, { description: res.detail, duration: 11000 });
      }
    });
  };

  const float = () => {
    // Save first: the server floats what is stored, not what is on screen, so
    // floating an unsaved edit would raise an order for the wrong quantities.
    save((id) =>
      startTransition(async () => {
        const res = await floatAggregation(id);
        if (res.ok) {
          toast.success(res.message, { description: res.detail, duration: 16000 });
          /**
           * Reset the builder before navigating.
           *
           * router.replace to the same route does not remount this component, so
           * without this the picks survive the float — and because the demand is
           * now allocated, every one of them immediately reads as over-committed.
           * The operator would be looking at a wall of errors about an order that
           * had just succeeded.
           */
          resetBuilder();
          setView('pools');
          router.replace('/demand-aggregation?view=pools');
          router.refresh();
        } else {
          toast.error(res.message, { description: res.detail, duration: 14000 });
        }
      }),
    );
  };

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      {/* ── Which pane ──────────────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="border-line-subtle bg-surface-2 flex rounded-[9px] border p-0.5">
          {(['open', 'pools'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={cn(
                'rounded-[7px] px-3 py-1.5 text-[12.5px] font-medium transition-colors',
                view === v ? 'bg-surface-1 text-fg shadow-e1' : 'text-fg-secondary hover:text-fg',
              )}
            >
              {v === 'open' ? 'Build a pool' : `Pools (${pools.length})`}
            </button>
          ))}
        </div>
        {editing && (
          <Chip tone={editing.status === 'FLOATED' ? 'success' : 'accent'} size="sm">
            Editing {editing.reference} · {editing.status.toLowerCase()}
          </Chip>
        )}
        {editing && (
          <Link
            href="/demand-aggregation"
            className="text-fg-secondary hover:text-fg text-[12px] underline"
          >
            Start a new pool
          </Link>
        )}
      </div>

      {/* ── Always-visible summary and actions ──────────────────────────────
          The pool used to sit below a full screen of demand table, so picking a
          part produced no visible feedback at all — the totals it changed were
          off-screen. This bar is sticky so every pick answers "what did that
          do", and it carries the primary actions so they are never hunted for. */}
      {view === 'open' && !readOnly && (
        <div className="bg-surface-1/95 border-line-subtle supports-[backdrop-filter]:bg-surface-1/80 sticky top-2 z-20 min-w-0 rounded-[10px] border px-3 py-2.5 shadow-e2 backdrop-blur">
          <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2">
            <StatPair label="Parts" value={summary.parts.length.toLocaleString('en-IN')} />
            <StatPair
              label="Customer orders"
              value={`${summary.customerPoCount} / ${summary.customerCount} cust`}
            />
            <StatPair label="Units" value={summary.totalUnits.toLocaleString('en-IN')} />
            <StatPair
              label="Spend"
              value={
                summary.pooledSpend > 0 ? `${currency} ${summary.pooledSpend.toLocaleString('en-IN')}` : '—'
              }
            />
            <StatPair
              label="Saving"
              value={
                summary.saving === 0
                  ? '—'
                  : `${summary.saving > 0 ? '+' : '−'}${currency} ${Math.abs(summary.saving).toLocaleString('en-IN')}`
              }
              tone={summary.saving > 0 ? 'good' : summary.saving < 0 ? 'bad' : undefined}
            />

            <span className="ml-auto flex flex-wrap items-center gap-2">
              {blocking.length > 0 && (
                <Hint
                  content={
                    <span className="grid gap-1">
                      {blocking.slice(0, 4).map((p, i) => (
                        <span key={i}>{p.message}</span>
                      ))}
                    </span>
                  }
                >
                  <span>
                    <Chip tone="danger" size="sm" icon={TriangleAlert}>
                      {blocking.length} to fix
                    </Chip>
                  </span>
                </Hint>
              )}
              {blocking.length === 0 && warnings.length > 0 && (
                <Chip tone="warning" size="sm" icon={AlertTriangle}>
                  {warnings.length} to check
                </Chip>
              )}
              <Button
                variant="secondary"
                size="sm"
                icon={Layers}
                disabled={pending || inputs.length === 0}
                onClick={() => save()}
              >
                {pending ? 'Saving…' : editing ? 'Save' : 'Save draft'}
              </Button>
              <Button
                variant="primary"
                size="sm"
                icon={Send}
                disabled={pending}
                disabledReason={
                  !floatable ? (blocking[0]?.message ?? 'Give the pool a name first.') : undefined
                }
                onClick={float}
              >
                Float the bulk order
              </Button>
            </span>
          </div>
        </div>
      )}

      {view === 'pools' ? (
        <PoolsList pools={pools} pending={pending} />
      ) : (
        /* Stacked, not side by side. Two tables of six and seven columns cannot
           both live in half a viewport — the pool's price and saving columns were
           being clipped, and a table that scrolls sideways inside a narrow column
           is worse than one that has room. Top to bottom also matches the order
           of the work: find the overlap, check the pool, place the order. */
        <div className="grid min-w-0 grid-cols-1 gap-4">
          {/* ══ Open demand ════════════════════════════════════════════════ */}
          <Panel padded={false}>
            <div className="p-4 pb-2">
              <PanelHeader
                title="1 · Choose the demand"
                description="Every customer order line still to source, grouped by part. Parts more than one order wants come first — those are the ones worth pooling."
                actions={
                  <span className="text-fg-tertiary text-[11.5px] whitespace-nowrap">
                    {visibleGroups.length === groups.length
                      ? `${groups.length} part${groups.length === 1 ? '' : 's'}`
                      : `${visibleGroups.length} of ${groups.length}`}
                  </span>
                }
              />
              {/* A filter, not pagination. The question is "is this part here",
                  and paging makes you hunt for the answer. */}
              <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
                <div className="relative min-w-0 flex-1 basis-[220px]">
                  <Search
                    className="text-fg-tertiary pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
                    aria-hidden
                  />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Filter by part, manufacturer, customer or order number…"
                    aria-label="Filter open demand"
                    className={cn(field, 'pl-8')}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setSharedOnly((v) => !v)}
                  aria-pressed={sharedOnly}
                  className={cn(
                    'flex shrink-0 items-center gap-1.5 rounded-[7px] border px-2.5 py-1.5 text-[12px] transition-colors',
                    sharedOnly
                      ? 'border-accent-border bg-accent-subtle text-accent-text'
                      : 'border-line-subtle text-fg-secondary hover:bg-surface-3',
                  )}
                >
                  <Layers className="size-3.5" strokeWidth={2} aria-hidden />
                  Only parts 2+ orders want
                  <span className="text-fg-tertiary tnum">({sharedCount})</span>
                </button>
              </div>
            </div>

            {visibleGroups.length === 0 && groups.length > 0 ? (
              <div className="px-4 pb-4">
                <p className="text-fg-tertiary text-[12.5px] leading-relaxed">
                  Nothing matches{query.trim() ? ` “${query.trim()}”` : ''}
                  {sharedOnly ? ' among parts more than one order wants' : ''}.{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setQuery('');
                      setSharedOnly(false);
                    }}
                    className="text-accent-text underline"
                  >
                    Clear the filters
                  </button>
                  .
                </p>
              </div>
            ) : groups.length === 0 ? (
              <div className="px-4 pb-4">
                <EmptyState
                  icon={Layers}
                  title="Nothing left to source"
                  description="Every customer order line is already allocated to a supplier order. Aggregation starts from open demand."
                />
              </div>
            ) : (
              /* A table, not a list of cards. Quantities only compare when they
                 sit in one right-aligned column, and "which part has the most
                 demand behind it" is the question this pane exists to answer. */
              /* Capped height with an internal scroll: the pane must not grow
                 with the catalogue, or the pool below it leaves the screen and
                 the operator loses sight of what they are building. */
              <div className="min-w-0 overflow-x-auto overflow-y-auto max-h-[clamp(18rem,46vh,34rem)]">
                <table className="w-full min-w-[720px] border-collapse text-left">
                  <thead className="bg-surface-inset sticky top-0 z-10">
                    <tr className="border-line-subtle border-y">
                      <Th width="34px" />
                      <Th>Part</Th>
                      <Th width="132px" align="right">
                        Orders wanting it
                      </Th>
                      <Th width="118px" align="right">
                        Available
                      </Th>
                      <Th width="118px" align="right">
                        In the pool
                      </Th>
                      <Th width="110px">Earliest date</Th>
                      <Th width="118px" align="right" />
                    </tr>
                  </thead>
                  <tbody>
                    {visibleGroups.map((g) => {
                      const picked = g.lines.reduce((a, c) => a + (picks[c.customerPoLineId] ?? 0), 0);
                      const allIn = g.lines.every(
                        (c) => (picks[c.customerPoLineId] ?? 0) === c.availableQty,
                      );
                      const open = expanded === g.mpn;
                      return (
                        <Fragment key={g.mpn}>
                          <tr
                            className={cn(
                              'border-line-subtle border-b',
                              picked > 0 && 'bg-accent-subtle/40',
                            )}
                          >
                            <td className="px-2 py-2 align-top">
                              <button
                                type="button"
                                onClick={() => setExpanded(open ? null : g.mpn)}
                                aria-expanded={open}
                                aria-label={`${open ? 'Hide' : 'Show'} the customer orders wanting ${g.mpn}`}
                                className="text-fg-tertiary hover:bg-surface-3 hover:text-fg grid size-6 place-items-center rounded-[5px] transition-colors"
                              >
                                <ChevronDown
                                  className={cn('size-3.5 transition-transform', open && 'rotate-180')}
                                  strokeWidth={2.5}
                                  aria-hidden
                                />
                              </button>
                            </td>
                            <td className="px-3 py-2 align-top">
                              <div className="text-fg font-mono text-[12px] font-semibold">{g.mpn}</div>
                              <div className="text-fg-tertiary text-[11px] leading-snug">
                                {g.manufacturer} · {g.description}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right align-top">
                              {g.orders > 1 ? (
                                <Hint
                                  content={
                                    <span>
                                      {g.orders} customer orders across {g.customers} customer
                                      {g.customers === 1 ? '' : 's'} want this part. Buying it once at
                                      the combined quantity is what clears a volume tier.
                                    </span>
                                  }
                                >
                                  <span>
                                    <Chip tone="accent" size="sm" icon={Layers}>
                                      {g.orders} orders
                                    </Chip>
                                  </span>
                                </Hint>
                              ) : (
                                <span className="text-fg-tertiary text-[11.5px]">1 order</span>
                              )}
                            </td>
                            <td className="tnum text-fg px-3 py-2 text-right align-top text-[12px] font-medium">
                              {g.availableQty.toLocaleString('en-IN')}
                            </td>
                            <td className="tnum px-3 py-2 text-right align-top text-[12px]">
                              {/* Blank, not a dash. Ten em dashes down a column is
                                  noise that competes with the numbers that matter. */}
                              {picked > 0 && (
                                <span className="text-accent-text font-semibold">
                                  {picked.toLocaleString('en-IN')}
                                </span>
                              )}
                            </td>
                            <td className="text-fg-secondary px-3 py-2 align-top text-[11.5px] whitespace-nowrap">
                              {g.earliest ? formatDate(g.earliest) : '—'}
                            </td>
                            <td className="px-3 py-2 text-right align-top">
                              {!readOnly && (
                                <Button
                                  variant={allIn ? 'secondary' : 'primary'}
                                  size="sm"
                                  icon={allIn ? Minus : Plus}
                                  onClick={() => (allIn ? clearGroup(g.lines) : addWholeGroup(g.lines))}
                                >
                                  {allIn ? 'Remove' : 'Add all'}
                                </Button>
                              )}
                            </td>
                          </tr>

                          {open && (
                            <tr className="border-line-subtle bg-surface-inset border-b">
                              <td />
                              <td colSpan={6} className="px-3 py-2.5">
                                <SectionLabel>Which customer orders want it</SectionLabel>
                                {/* Nested table on purpose: this is the same kind
                                    of data one level down, and a list of cards
                                    here would break the column alignment the
                                    parent row just established. */}
                                <table className="w-full border-collapse text-left">
                                  <thead>
                                    <tr className="border-line-subtle border-b">
                                      <Th>Their order</Th>
                                      <Th>Customer</Th>
                                      <Th width="110px">Wanted by</Th>
                                      <Th width="120px" align="right">
                                        Free to pool
                                      </Th>
                                      <Th width="128px" align="right">
                                        Take
                                      </Th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {g.lines.map((c) => {
                                      const q = picks[c.customerPoLineId] ?? 0;
                                      return (
                                        <tr
                                          key={c.customerPoLineId}
                                          className="border-line-subtle border-b last:border-0"
                                        >
                                          <td className="text-fg px-2 py-1.5 font-mono text-[11.5px]">
                                            {c.customerPoNumber}
                                          </td>
                                          <td className="text-fg-secondary max-w-[210px] truncate px-2 py-1.5 text-[11.5px]">
                                            {c.customerName}
                                          </td>
                                          <td className="text-fg-secondary px-2 py-1.5 text-[11px] whitespace-nowrap">
                                            {c.requestedDate ? formatDate(c.requestedDate) : '—'}
                                          </td>
                                          <td className="tnum text-fg-secondary px-2 py-1.5 text-right text-[11.5px]">
                                            {c.availableQty.toLocaleString('en-IN')}
                                            <span className="text-fg-tertiary">
                                              {' '}
                                              / {c.orderedQty.toLocaleString('en-IN')}
                                            </span>
                                          </td>
                                          <td className="px-2 py-1.5 text-right">
                                            {readOnly ? (
                                              <span className="tnum text-fg text-[12px]">
                                                {q.toLocaleString('en-IN')}
                                              </span>
                                            ) : (
                                              <input
                                                type="number"
                                                min={0}
                                                max={c.availableQty}
                                                value={q || ''}
                                                placeholder="0"
                                                aria-label={`Quantity of ${g.mpn} to take from ${c.customerPoNumber}`}
                                                onChange={(e) => setPick(c, Number(e.target.value))}
                                                className={cn(field, 'tnum w-[112px] text-right')}
                                              />
                                            )}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          {/* ══ The pool ═══════════════════════════════════════════════════ */}
          <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[1.35fr_1fr] xl:items-start">
            <Panel>
              <PanelHeader
                title="2 · Price the pool"
                description={
                  summary.parts.length === 0
                    ? 'Add demand from the left and it rolls up here, one line per part.'
                    : `${summary.parts.length} consolidated line${summary.parts.length === 1 ? '' : 's'} from ${summary.customerPoCount} customer order${summary.customerPoCount === 1 ? '' : 's'} across ${summary.customerCount} customer${summary.customerCount === 1 ? '' : 's'}.`
                }
                actions={
                  summary.totalUnits > 0 ? (
                    <span className="text-fg tnum text-[12.5px] font-semibold">
                      {summary.totalUnits.toLocaleString('en-IN')} units
                    </span>
                  ) : undefined
                }
              />

              {summary.parts.length === 0 ? (
                <p className="text-fg-tertiary text-[12.5px] leading-relaxed">
                  Nothing pooled yet. Expand a part on the left to pick which customer orders go in,
                  or use <strong className="font-medium">Add all</strong> to take every open line for
                  that part.
                </p>
              ) : (
                <div className="grid gap-3">
                  {/* One row per consolidated line, with the price and the saving
                      in aligned columns. The old card-per-part layout put three
                      inputs and a row of chips in every card, so no two prices or
                      savings ever lined up and the pool could not be read down. */}
                  <div className="min-w-0 overflow-x-auto">
                    <table className="w-full min-w-[560px] border-collapse text-left">
                      <thead className="bg-surface-inset">
                        <tr className="border-line-subtle border-y">
                          <Th>Part</Th>
                          <Th width="104px" align="right">
                            Pooled
                          </Th>
                          <Th width="120px" align="right">
                            Bulk price
                          </Th>
                          <Th width="120px" align="right">
                            Unpooled
                          </Th>
                          <Th width="92px" align="right">
                            Lead
                          </Th>
                          <Th width="132px" align="right">
                            Saving
                          </Th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.parts.map((p) => (
                          <Fragment key={p.mpn}>
                            <tr className="border-line-subtle border-b">
                              <td className="px-3 py-2 align-top">
                                <div className="text-fg font-mono text-[12px] font-semibold">
                                  {p.mpn}
                                </div>
                                <div className="text-fg-tertiary text-[11px]">
                                  from {p.customerPoCount} order{p.customerPoCount === 1 ? '' : 's'}
                                </div>
                              </td>
                              <td className="tnum text-fg px-3 py-2 text-right align-top text-[12px] font-medium">
                                {p.pooledQty.toLocaleString('en-IN')}
                              </td>
                              <td className="px-3 py-2 align-top">
                                <input
                                  type="number"
                                  step="0.0001"
                                  min={0}
                                  disabled={readOnly}
                                  value={prices[p.mpn]?.buy ?? ''}
                                  placeholder="0.00"
                                  aria-label={`Bulk price for ${p.mpn} in ${currency}`}
                                  onChange={(e) =>
                                    setPrices((st) => ({
                                      ...st,
                                      [p.mpn]: {
                                        ...(st[p.mpn] ?? { baseline: '', lead: '' }),
                                        buy: e.target.value,
                                      },
                                    }))
                                  }
                                  className={cn(
                                    field,
                                    'tnum text-right',
                                    p.buyUnitPrice == null && 'border-warning/60',
                                  )}
                                />
                              </td>
                              <td className="px-3 py-2 align-top">
                                <input
                                  type="number"
                                  step="0.0001"
                                  min={0}
                                  disabled={readOnly}
                                  value={prices[p.mpn]?.baseline ?? ''}
                                  placeholder={
                                    p.baselineUnitPrice != null ? String(p.baselineUnitPrice) : '—'
                                  }
                                  aria-label={`Unpooled price for ${p.mpn}`}
                                  onChange={(e) =>
                                    setPrices((st) => ({
                                      ...st,
                                      [p.mpn]: {
                                        ...(st[p.mpn] ?? { buy: '', lead: '' }),
                                        baseline: e.target.value,
                                      },
                                    }))
                                  }
                                  className={cn(field, 'tnum text-right')}
                                />
                              </td>
                              <td className="px-3 py-2 align-top">
                                <input
                                  type="number"
                                  min={0}
                                  disabled={readOnly}
                                  value={prices[p.mpn]?.lead ?? ''}
                                  placeholder="21"
                                  aria-label={`Lead time in days for ${p.mpn}`}
                                  onChange={(e) =>
                                    setPrices((st) => ({
                                      ...st,
                                      [p.mpn]: {
                                        ...(st[p.mpn] ?? { buy: '', baseline: '' }),
                                        lead: e.target.value,
                                      },
                                    }))
                                  }
                                  className={cn(field, 'tnum text-right')}
                                />
                              </td>
                              <td className="tnum px-3 py-2 text-right align-top text-[12px]">
                                {p.saving == null ? (
                                  <span className="text-warning text-[11px]">needs a price</span>
                                ) : p.saving === 0 ? (
                                  <span className="text-fg-tertiary">—</span>
                                ) : (
                                  <>
                                    {/* The sign goes on the money, not only on the
                                        percentage. A loss shown as "USD 91,020" in
                                        red still reads as a saving of 91,020 at a
                                        glance, and colour alone must never be the
                                        thing carrying the meaning. */}
                                    <span
                                      className={cn(
                                        'font-medium',
                                        p.saving > 0 ? 'text-success' : 'text-danger',
                                      )}
                                    >
                                      {p.saving > 0 ? '+' : '−'}
                                      {currency} {Math.abs(p.saving).toLocaleString('en-IN')}
                                    </span>
                                    <span
                                      className={cn(
                                        'block text-[10.5px]',
                                        p.saving > 0 ? 'text-fg-tertiary' : 'text-danger',
                                      )}
                                    >
                                      {p.saving > 0 ? 'cheaper' : 'MORE than unpooled'}
                                      {p.savingPct != null
                                        ? ` · ${Math.abs(p.savingPct).toFixed(1)}%`
                                        : ''}
                                    </span>
                                  </>
                                )}
                              </td>
                            </tr>
                            {/* Who is in this line. A second row rather than
                                chips inside the first, so the columns above stay
                                aligned however many customers contribute. */}
                            <tr className="border-line-subtle bg-surface-inset/60 border-b">
                              <td colSpan={6} className="px-3 py-1.5">
                                <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                                  <span className="text-fg-tertiary text-[10px] font-semibold tracking-[0.06em] uppercase">
                                    Contributed by
                                  </span>
                                  {p.contributions.map((c) => (
                                    <Hint
                                      key={c.customerPoLineId}
                                      content={
                                        <span>
                                          {c.customerName} — {c.quantity.toLocaleString('en-IN')}{' '}
                                          units, {c.sharePct.toFixed(1)}% of this pooled line
                                        </span>
                                      }
                                    >
                                      <span className="text-fg-secondary tnum text-[11px]">
                                        <span className="font-mono">{c.customerPoNumber}</span>{' '}
                                        {c.quantity.toLocaleString('en-IN')}
                                        <span className="text-fg-tertiary">
                                          {' '}
                                          ({c.sharePct.toFixed(0)}%)
                                        </span>
                                      </span>
                                    </Hint>
                                  ))}
                                </span>
                              </td>
                            </tr>
                          </Fragment>
                        ))}
                      </tbody>
                      <tfoot className="bg-surface-inset">
                        <tr className="border-line-subtle border-t">
                          <td className="text-fg px-3 py-2 text-[12px] font-semibold">
                            {summary.parts.length} line{summary.parts.length === 1 ? '' : 's'}
                          </td>
                          <td className="tnum text-fg px-3 py-2 text-right text-[12px] font-semibold">
                            {summary.totalUnits.toLocaleString('en-IN')}
                          </td>
                          <td className="tnum text-fg px-3 py-2 text-right text-[12px] font-semibold">
                            {currency} {summary.pooledSpend.toLocaleString('en-IN')}
                          </td>
                          <td className="tnum text-fg-secondary px-3 py-2 text-right text-[12px]">
                            {currency} {summary.baselineSpend.toLocaleString('en-IN')}
                          </td>
                          <td />
                          <td className="tnum px-3 py-2 text-right text-[12px] font-semibold">
                            <span className={summary.saving >= 0 ? 'text-success' : 'text-danger'}>
                              {summary.saving > 0 ? '+' : summary.saving < 0 ? '−' : ''}
                              {currency} {Math.abs(summary.saving).toLocaleString('en-IN')}
                            </span>
                            <span className="block text-[10.5px]">
                              <Pct value={summary.savingPct} tone="auto" />
                            </span>
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  {summary.partsWithoutPrice.length > 0 && (
                    <p className="text-warning text-[11.5px] leading-relaxed">
                      {summary.partsWithoutPrice.join(', ')} still need a negotiated price before the
                      bulk order can be raised.
                    </p>
                  )}
                  {summary.earliestRequiredBy && (
                    <p className="text-fg-secondary text-[11.5px] leading-relaxed">
                      Tightest customer date in the pool:{' '}
                      <strong className="font-medium">{formatDate(summary.earliestRequiredBy)}</strong>.
                      The bulk order has to beat that one, not the average.
                    </p>
                  )}
                </div>
              )}
            </Panel>

            {/* ══ The bulk order ═══════════════════════════════════════════ */}
            <Panel>
              <PanelHeader
                title="3 · Place the bulk order"
                description="One purchase order to one supplier. Each contributing customer order still gets its own work order against it."
              />
              <div className="grid gap-3">
                <label className="block min-w-0">
                  <span className="text-fg-secondary mb-1 block text-[11.5px] font-medium">
                    What to call this pool
                  </span>
                  <input
                    value={title}
                    disabled={readOnly}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Q3 commodity consolidation — shift registers and MOSFETs"
                    className={cn(field, errors.title && 'border-danger')}
                  />
                  {errors.title && (
                    <span className="text-danger mt-1 block text-[11.5px]">{errors.title}</span>
                  )}
                </label>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block min-w-0">
                    <span className="text-fg-secondary mb-1 block text-[11.5px] font-medium">
                      Supplier for the bulk order
                    </span>
                    <select
                      value={supplierId}
                      disabled={readOnly}
                      onChange={(e) => {
                        setSupplierId(e.target.value);
                        const s = suppliers.find((x) => x.id === e.target.value);
                        if (s) setIncoterms(s.incoterms);
                      }}
                      className={cn(field, errors.supplierId && 'border-danger')}
                    >
                      <option value="">Choose an approved supplier…</option>
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} · {s.country} · {s.currency}
                        </option>
                      ))}
                    </select>
                    <span className="text-fg-tertiary mt-1 block text-[11px] leading-relaxed">
                      Only suppliers on the Approved Vendor List appear here. Their currency becomes
                      the pool&rsquo;s.
                    </span>
                  </label>

                  <label className="block min-w-0">
                    <span className="text-fg-secondary mb-1 block text-[11.5px] font-medium">
                      RFQ / Sourcing ID
                    </span>
                    <input
                      value={sourcingRef}
                      disabled={readOnly}
                      onChange={(e) => setSourcingRef(e.target.value)}
                      placeholder="RFQ-2026-0420"
                      className={cn(field, 'font-mono text-[12px]')}
                    />
                  </label>

                  <label className="block min-w-0">
                    <span className="text-fg-secondary mb-1 block text-[11.5px] font-medium">
                      Required by
                    </span>
                    <input
                      type="date"
                      value={requiredBy}
                      disabled={readOnly}
                      onChange={(e) => setRequiredBy(e.target.value)}
                      className={field}
                    />
                  </label>

                  <label className="block min-w-0">
                    <span className="text-fg-secondary mb-1 block text-[11.5px] font-medium">
                      Payment method
                    </span>
                    <select
                      value={paymentMethod}
                      disabled={readOnly}
                      onChange={(e) => setPaymentMethod(e.target.value)}
                      className={field}
                    >
                      <option value="ESCROW">Through escrow</option>
                      <option value="ADVANCE">Advance payment</option>
                      <option value="CREDIT">On credit</option>
                    </select>
                  </label>
                </div>

                <label className="block min-w-0">
                  <span className="text-fg-secondary mb-1 block text-[11.5px] font-medium">
                    Why these orders are being pooled
                  </span>
                  <textarea
                    value={rationale}
                    disabled={readOnly}
                    rows={3}
                    onChange={(e) => setRationale(e.target.value)}
                    placeholder="e.g. Four customer orders want the same three commodity parts inside eight weeks. One order clears the 30k volume tier that none of them reaches alone."
                    className={cn(field, 'resize-y leading-relaxed', errors.rationale && 'border-danger')}
                  />
                  <span
                    className={cn(
                      'mt-1 block text-[11.5px] leading-relaxed',
                      errors.rationale ? 'text-danger' : 'text-fg-tertiary',
                    )}
                  >
                    {errors.rationale ??
                      'Required. Different customers end up on one purchase order at one price — this is the answer when somebody asks why.'}
                  </span>
                </label>
              </div>

              {/* ── What is stopping it ─────────────────────────────────── */}
              {(blocking.length > 0 || warnings.length > 0) && !readOnly && (
                <div className="mt-3 grid gap-2">
                  {blocking.map((p, i) => (
                    <div
                      key={`b${i}`}
                      className="border-danger/40 bg-danger-subtle rounded-[8px] border px-3 py-2"
                    >
                      <div className="text-danger flex items-start gap-1.5 text-[12px] font-semibold">
                        <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
                        {p.message}
                      </div>
                      {p.detail && (
                        <p className="text-fg-secondary mt-1 text-[11.5px] leading-relaxed">{p.detail}</p>
                      )}
                    </div>
                  ))}
                  {warnings.map((p, i) => (
                    <div
                      key={`w${i}`}
                      className="border-warning/40 bg-warning-subtle rounded-[8px] border px-3 py-2"
                    >
                      <div className="text-warning flex items-start gap-1.5 text-[12px] font-semibold">
                        <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
                        {p.message}
                      </div>
                      {p.detail && (
                        <p className="text-fg-secondary mt-1 text-[11.5px] leading-relaxed">{p.detail}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* ── What floating will produce ──────────────────────────── */}
              {floatable && (
                <div className="border-line-subtle bg-surface-inset mt-3 rounded-[9px] border px-3 py-2.5">
                  <SectionLabel>What floating this will create</SectionLabel>
                  <ul className="text-fg-secondary grid gap-1 text-[12px] leading-relaxed">
                    <li className="flex items-start gap-1.5">
                      <Check className="text-success mt-0.5 size-3.5 shrink-0" aria-hidden />
                      One purchase order to {supplier?.name} with{' '}
                      {summary.parts.length} consolidated line{summary.parts.length === 1 ? '' : 's'} —{' '}
                      {summary.totalUnits.toLocaleString('en-IN')} units for {currency}{' '}
                      {summary.pooledSpend.toLocaleString('en-IN')}
                    </li>
                    <li className="flex items-start gap-1.5">
                      <Check className="text-success mt-0.5 size-3.5 shrink-0" aria-hidden />
                      {summary.customerPoCount} work order
                      {summary.customerPoCount === 1 ? '' : 's'} — one per customer order, each with
                      its own quote, invoice and delivery
                    </li>
                    <li className="flex items-start gap-1.5">
                      <Check className="text-success mt-0.5 size-3.5 shrink-0" aria-hidden />
                      Line-by-line allocations so every pooled piece is tied to the customer who
                      ordered it
                    </li>
                  </ul>
                </div>
              )}

              {/* No buttons here: the sticky bar at the top carries them, and two
                  sets of the same primary action is how somebody floats a pool
                  twice by accident. */}
              {!readOnly && inputs.length > 0 && (
                <p className="text-fg-tertiary border-line-subtle mt-3 border-t pt-3 text-[11.5px] leading-relaxed">
                  {inputs.length} customer line{inputs.length === 1 ? '' : 's'} from{' '}
                  {summary.customerPoCount} order{summary.customerPoCount === 1 ? '' : 's'} in the
                  pool. Save and Float are in the bar at the top of the page.
                </p>
              )}

              {readOnly && editing && (
                <div className="border-line-subtle mt-3 border-t pt-3">
                  <SectionLabel>Floated</SectionLabel>
                  <p className="text-fg-secondary text-[12.5px] leading-relaxed">
                    Raised as{' '}
                    <strong className="font-mono">{editing.supplierPoNumber}</strong> on{' '}
                    {editing.floatedAt ? formatDate(editing.floatedAt) : '—'}, producing{' '}
                    {editing.workOrders.length} work order
                    {editing.workOrders.length === 1 ? '' : 's'}.
                  </p>
                  <ul className="mt-2 grid gap-1">
                    {editing.workOrders.map((w) => (
                      <li key={w.id}>
                        <Link
                          href={`/orders/${w.id}`}
                          className="border-line-subtle hover:bg-surface-3 flex min-w-0 flex-wrap items-center gap-2 rounded-[7px] border px-2.5 py-1.5 text-[12px] transition-colors"
                        >
                          <span className="text-fg font-mono">{w.alias}</span>
                          <span className="text-fg-tertiary font-mono text-[11px]">
                            {w.customerPoNumber}
                          </span>
                          <span className="text-fg-secondary min-w-0 flex-1 truncate">
                            {w.customerName}
                          </span>
                          <ArrowRight className="text-fg-tertiary size-3.5 shrink-0" aria-hidden />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * One figure in the sticky bar. Label above value, so the numbers align on a
 * single baseline and the row reads as a strip of facts rather than sentences.
 */
function StatPair({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'good' | 'bad';
}) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="text-fg-tertiary text-[9.5px] font-semibold tracking-[0.06em] uppercase">
        {label}
      </span>
      <span
        className={cn(
          'tnum text-[13px] font-semibold whitespace-nowrap',
          tone === 'good' ? 'text-success' : tone === 'bad' ? 'text-danger' : 'text-fg',
        )}
      >
        {value}
      </span>
    </span>
  );
}

/** One column header, matching the header style used across the app's tables. */
function Th({
  children,
  width,
  align = 'left',
}: {
  children?: React.ReactNode;
  width?: string;
  align?: 'left' | 'right';
}) {
  return (
    <th
      scope="col"
      style={width ? { width } : undefined}
      className={cn(
        'text-fg-tertiary px-3 py-2 text-[10.5px] font-semibold tracking-[0.04em] whitespace-nowrap uppercase',
        align === 'right' && 'text-right',
      )}
    >
      {children}
    </th>
  );
}


function PoolsList({ pools, pending }: { pools: AggregationRow[]; pending: boolean }) {
  const router = useRouter();
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  if (pools.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon={Layers}
          title="No pools yet"
          description="Build one from open demand. A pool consolidates the same part across several customer orders so it can be bought once, in bulk."
        />
      </Panel>
    );
  }

  const cancel = (id: string) => {
    cancelAggregation(id, reason).then((res) => {
      if (res.ok) {
        toast.success(res.message, { description: res.detail });
        setCancelling(null);
        setReason('');
        router.refresh();
      } else {
        toast.error(res.message, { description: res.detail, duration: 10000 });
      }
    });
  };

  return (
    <Panel padded={false}>
      <div className="p-4 pb-2">
        <PanelHeader
          title="Pools"
          description="Consolidations, newest first. A floated pool is a purchase order that exists — it cannot be edited, only read."
        />
      </div>
      <div className="min-w-0 overflow-x-auto">
        <table className="w-full min-w-[980px] border-collapse text-left">
          <thead className="bg-surface-inset">
            <tr className="border-line-subtle border-y">
              {['Reference', 'Title', 'Status', 'Supplier', 'Orders', 'Parts', 'Units', 'Spend', 'Saving', 'Bulk PO', 'Work orders', ''].map(
                (h) => (
                  <th
                    key={h}
                    scope="col"
                    className="text-fg-tertiary px-3 py-2 text-[10.5px] font-semibold tracking-[0.04em] whitespace-nowrap uppercase"
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {pools.map((p) => (
              <tr key={p.id} className="border-line-subtle border-b align-top last:border-0">
                <td className="px-3 py-2">
                  <Link
                    href={`/demand-aggregation?pool=${p.id}`}
                    className="text-accent-text font-mono text-[12px] hover:underline"
                  >
                    {p.reference}
                  </Link>
                </td>
                <td className="text-fg max-w-[220px] px-3 py-2 text-[12px]">{p.title}</td>
                <td className="px-3 py-2">
                  <StatusChip status={p.status} size="sm" />
                </td>
                <td className="text-fg-secondary px-3 py-2 text-[12px]">{p.supplierName ?? '—'}</td>
                <td className="tnum px-3 py-2 text-[12px]">
                  {p.customerPoCount}
                  <span className="text-fg-tertiary text-[10.5px]">
                    {' '}
                    / {p.customerCount} cust
                  </span>
                </td>
                <td className="tnum px-3 py-2 text-[12px]">{p.partCount}</td>
                <td className="tnum px-3 py-2 text-[12px]">{p.totalUnits.toLocaleString('en-IN')}</td>
                <td className="tnum px-3 py-2 text-[12px]">
                  {p.currency} {p.pooledSpend.toLocaleString('en-IN')}
                </td>
                <td className="tnum px-3 py-2 text-[12px]">
                  <span className={p.saving > 0 ? 'text-success' : p.saving < 0 ? 'text-danger' : ''}>
                    {p.saving !== 0
                      ? `${p.currency} ${p.saving.toLocaleString('en-IN')}`
                      : '—'}
                  </span>
                  {p.saving !== 0 && (
                    <span className="text-fg-tertiary block text-[10.5px]">
                      {p.savingPct.toFixed(1)}%
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-[11.5px]">{p.supplierPoNumber ?? '—'}</td>
                <td className="px-3 py-2">
                  {p.workOrderAliases.length === 0 ? (
                    <span className="text-fg-tertiary text-[11.5px]">—</span>
                  ) : (
                    <span className="flex flex-wrap gap-1">
                      {p.workOrderAliases.map((a) => (
                        <span
                          key={a}
                          className="border-line-subtle text-fg-secondary rounded-[5px] border px-1 py-[1px] font-mono text-[10.5px]"
                        >
                          {a}
                        </span>
                      ))}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {p.status === 'DRAFT' &&
                    (cancelling === p.id ? (
                      <span className="flex min-w-0 flex-col items-end gap-1">
                        <input
                          value={reason}
                          autoFocus
                          onChange={(e) => setReason(e.target.value)}
                          placeholder="Why cancel?"
                          className={cn(field, 'w-[170px] text-[11.5px]')}
                        />
                        <span className="flex gap-1">
                          <Button
                            variant="danger"
                            size="sm"
                            icon={Trash2}
                            disabled={pending || reason.trim().length < 8}
                            onClick={() => cancel(p.id)}
                          >
                            Confirm
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            icon={X}
                            onClick={() => {
                              setCancelling(null);
                              setReason('');
                            }}
                          >
                            Back
                          </Button>
                        </span>
                      </span>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={Trash2}
                        onClick={() => setCancelling(p.id)}
                      >
                        Cancel
                      </Button>
                    ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
