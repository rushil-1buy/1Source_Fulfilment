'use client';

/**
 * THE COMMUNICATION TAB — master prompt §7, built to spec.
 *
 * Everything relating to one work order, in one calm thread:
 *  * System events (auto-logged on every transition) are visually subordinate to
 *    human correspondence, but never hidden.
 *  * Every human entry carries channel, direction, participants with stakeholder
 *    badges, collapsible quoted history, CONTEXT CHIPS (the requirement that no
 *    message floats without knowing which part of the order it concerns),
 *    attachments, internal-vs-shared visibility, status with ageing, metadata.
 *  * Internal-only notes get a hatched border so they can never be mistaken for
 *    something the customer or supplier has seen.
 */

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { MessageComposer } from './MessageComposer';
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  Boxes,
  Clock,
  Download,
  FileText,
  Filter,
  Mail,
  MessageCircle,
  MessageSquare,
  MonitorSmartphone,
  Package,
  Paperclip,
  Phone,
  Pin,
  Route,
  Search,
  Send,
  ShieldAlert,
  StickyNote,
  Truck,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { OrderDetail } from '@/lib/queries/order-detail';
import { Button, EmptyState, Panel, SectionLabel } from '@/components/ui/Layout';
import { Chip, StakeholderBadge, StatusChip } from '@/components/ui/Badges';
import { Hint } from '@/components/ui/InfoTooltip';
import { STAKEHOLDERS, STAKEHOLDER_META, type Stakeholder } from '@/lib/domain/enums';
import { exceptionDef } from '@/lib/domain/exceptions';
import { getStage } from '@/lib/domain/stages';
import { cn, formatDateTime, humanDuration, relativeTime } from '@/lib/utils';

type Comm = OrderDetail['communications'][number];

const CHANNEL_ICONS: Record<string, LucideIcon> = {
  EMAIL: Mail,
  WHATSAPP: MessageCircle,
  PHONE: Phone,
  PORTAL: MonitorSmartphone,
  MEETING: Users,
  COURIER: Package,
  SYSTEM: Activity,
};

const CHANNEL_LABELS: Record<string, string> = {
  EMAIL: 'Email',
  WHATSAPP: 'WhatsApp',
  PHONE: 'Phone call',
  PORTAL: 'Portal message',
  MEETING: 'Meeting',
  COURIER: 'Letter / courier',
  SYSTEM: 'System event',
};

const CONTEXT_ICONS: Record<string, LucideIcon> = {
  STAGE: Route,
  LINE_ITEM: Boxes,
  DOCUMENT: FileText,
  SHIPMENT_LEG: Truck,
  EXCEPTION: ShieldAlert,
};

export function CommunicationTab({ order }: { order: OrderDetail }) {
  const [search, setSearch] = useState('');
  const [oldestFirst, setOldestFirst] = useState(false);
  const [showSystem, setShowSystem] = useState(true);
  const [channel, setChannel] = useState<string>('ALL');
  const [stakeholder, setStakeholder] = useState<string>('ALL');
  const [status, setStatus] = useState<string>('ALL');
  const [internalOnly, setInternalOnly] = useState(false);
  const [withAttachments, setWithAttachments] = useState(false);
  const [expandedQuotes, setExpandedQuotes] = useState<Set<string>>(new Set());
  /** null when closed; otherwise which intent the composer was opened with. */
  const [composer, setComposer] = useState<'LOG' | 'SEND' | null>(null);

  const filtersActive =
    search.trim().length > 0 ||
    channel !== 'ALL' ||
    stakeholder !== 'ALL' ||
    status !== 'ALL' ||
    internalOnly ||
    withAttachments ||
    !showSystem;

  const clearFilters = () => {
    setSearch('');
    setChannel('ALL');
    setStakeholder('ALL');
    setStatus('ALL');
    setInternalOnly(false);
    setWithAttachments(false);
    setShowSystem(true);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = order.communications.filter((c) => {
      if (!showSystem && c.entryClass === 'SYSTEM') return false;
      if (channel !== 'ALL' && c.channel !== channel) return false;
      if (status !== 'ALL' && c.status !== status) return false;
      if (internalOnly && c.visibility !== 'INTERNAL') return false;
      if (withAttachments && c.attachments.length === 0) return false;
      if (
        stakeholder !== 'ALL' &&
        !c.participants.some((p) => p.stakeholder === stakeholder) &&
        c.sharedWith !== stakeholder
      )
        return false;
      if (q) {
        const haystack = [
          c.subject,
          c.body,
          ...c.participants.map((p) => `${p.name} ${p.email ?? ''}`),
          ...c.attachments.map((a) => `${a.title} ${a.fileName}`),
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
    return rows.sort((a, b) => {
      const at = new Date(a.occurredAt).getTime();
      const bt = new Date(b.occurredAt).getTime();
      return oldestFirst ? at - bt : bt - at;
    });
  }, [
    order.communications,
    search,
    showSystem,
    channel,
    stakeholder,
    status,
    internalOnly,
    withAttachments,
    oldestFirst,
  ]);

  /**
   * Pinned messages get their own section at the top (§7.3), and only the
   * remainder is grouped by day. Keeping pinned items inside the day groups
   * would let the same date form two non-adjacent groups.
   */
  const pinned = useMemo(() => filtered.filter((c) => c.isPinned), [filtered]);

  const groups = useMemo(() => {
    const out: { day: string; items: Comm[] }[] = [];
    for (const c of filtered) {
      if (c.isPinned) continue;
      const day = new Date(c.occurredAt).toDateString();
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(c);
      else out.push({ day, items: [c] });
    }
    return out;
  }, [filtered]);

  const perStakeholder = useMemo(() => {
    const counts = new Map<Stakeholder, number>();
    for (const c of order.communications) {
      if (c.entryClass !== 'HUMAN') continue;
      for (const p of c.participants) {
        const s = p.stakeholder as Stakeholder;
        counts.set(s, (counts.get(s) ?? 0) + 1);
      }
    }
    return STAKEHOLDERS.map((s) => ({ stakeholder: s, count: counts.get(s) ?? 0 })).filter(
      (x) => x.count > 0,
    );
  }, [order.communications]);

  const humanCount = order.communications.filter((c) => c.entryClass === 'HUMAN').length;
  const systemCount = order.communications.length - humanCount;

  /**
   * Exports what is on screen, not the whole thread — the filters are how the
   * operator narrowed it to the exchange they care about, and an export that
   * quietly ignores them is the wrong file. Tab-separated so the body text,
   * which routinely contains commas and newlines, survives a paste into a sheet.
   */
  const exportThread = () => {
    const esc = (v: string) => v.replace(/\t/g, ' ').replace(/\r?\n/g, ' ⏎ ');
    const header = [
      'When',
      'Type',
      'Channel',
      'Direction',
      'From',
      'To',
      'Visibility',
      'Status',
      'Subject',
      'Body',
    ];
    const rows = filtered.map((c) => {
      const from = c.participants.find((p) => p.role === 'FROM');
      const to = c.participants.filter((p) => p.role === 'TO');
      return [
        new Date(c.occurredAt).toISOString(),
        c.entryClass === 'SYSTEM' ? 'System event' : 'Correspondence',
        c.channel,
        c.direction,
        from ? `${from.name} (${STAKEHOLDER_META[from.stakeholder as Stakeholder].label})` : '',
        to.map((p) => p.name).join('; '),
        c.visibility === 'SHARED' ? 'Shared with the other party' : 'Internal only',
        c.status,
        esc(c.subject),
        esc(c.body),
      ].map(esc);
    });
    const tsv = [header, ...rows].map((r) => r.join('\t')).join('\n');
    const blob = new Blob([`﻿${tsv}`], { type: 'text/tab-separated-values;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${order.alias}-communication-${new Date().toISOString().slice(0, 10)}.tsv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filtered.length} entr${filtered.length === 1 ? 'y' : 'ies'}.`, {
      description: filtersActive
        ? 'Only the entries currently shown by your filters were included.'
        : 'The whole thread was included.',
    });
  };
  const awaiting = order.communications.filter((c) => c.status === 'AWAITING_REPLY').length;

  const openExceptions = order.exceptions.filter(
    (e) => e.status === 'OPEN' || e.status === 'IN_PROGRESS',
  );

  return (
    <div className="grid min-w-0 grid-cols-1 gap-3">
      {/* ── Outstanding decisions ─────────────────────────────────────────────
          The thread is where the record of a decision lives, so an unresolved
          one is surfaced here as an outstanding item — with a pointer to the tab
          that owns the evidence, rather than the buttons themselves. */}
      {openExceptions.length > 0 && (
        <div className="border-danger-border bg-danger-subtle min-w-0 rounded-[11px] border p-3.5">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <ShieldAlert className="text-danger size-4 shrink-0" strokeWidth={2.2} aria-hidden />
            <span className="text-danger text-[12px] font-semibold tracking-[0.04em] uppercase">
              Awaiting a decision
            </span>
            <span className="text-fg-tertiary ml-auto text-[11px]">
              Nothing further will be logged on this order until it is resolved.
            </span>
          </div>
          <ul className="mt-2 grid gap-2">
            {openExceptions.map((e) => {
              const def = exceptionDef(e.type);
              return (
                <li
                  key={e.id}
                  className="border-line-subtle bg-surface-1 flex min-w-0 flex-wrap items-start gap-x-3 gap-y-1.5 rounded-[9px] border px-3 py-2.5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="text-fg block text-[12.5px] font-medium">
                      {def?.label ?? e.type.replace(/_/g, ' ')}
                    </span>
                    <span className="text-fg-secondary mt-0.5 block text-[12px] leading-relaxed">
                      {e.reason}
                    </span>
                    <span className="text-fg-tertiary mt-1 block text-[11px]">
                      Open since {relativeTime(e.openedAt)} · decided in the{' '}
                      {def?.ownerTab ?? 'overview'} tab · {def?.routes.length ?? 0} routes available
                    </span>
                  </span>
                  <Chip tone="danger" size="sm">
                    {e.severity.toLowerCase()}
                  </Chip>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ── Summary strip ─────────────────────────────────────────────────── */}
      <Panel className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          <div className="min-w-0">
            <SectionLabel>This order&apos;s conversation</SectionLabel>
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <span className="text-fg-secondary">
                <b className="text-fg">{humanCount}</b> message{humanCount === 1 ? '' : 's'}
              </span>
              <span className="text-fg-tertiary">·</span>
              <span className="text-fg-secondary">
                <b className="text-fg">{systemCount}</b> system events
              </span>
              {awaiting > 0 && (
                <>
                  <span className="text-fg-tertiary">·</span>
                  <Chip tone="warning" icon={Clock} size="sm">
                    {awaiting} awaiting reply
                  </Chip>
                </>
              )}
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {perStakeholder.map((s) => (
              <Hint
                key={s.stakeholder}
                content={
                  <span>
                    {s.count} message(s) involving {STAKEHOLDER_META[s.stakeholder].label}
                  </span>
                }
              >
                <button
                  type="button"
                  onClick={() =>
                    setStakeholder(stakeholder === s.stakeholder ? 'ALL' : s.stakeholder)
                  }
                  className={cn(
                    'rounded-[6px] transition-opacity',
                    stakeholder !== 'ALL' && stakeholder !== s.stakeholder && 'opacity-40',
                  )}
                >
                  <span className="flex items-center gap-1">
                    <StakeholderBadge stakeholder={s.stakeholder} short />
                    <span className="text-fg-tertiary tnum text-[10.5px]">{s.count}</span>
                  </span>
                </button>
              </Hint>
            ))}
          </div>
        </div>
      </Panel>

      {/* ── Composer + controls ───────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button variant="primary" icon={StickyNote} onClick={() => setComposer('LOG')}>
          Log a communication
        </Button>
        <Button variant="secondary" icon={Send} onClick={() => setComposer('SEND')}>
          Send message
        </Button>
        <Button variant="ghost" icon={Download} onClick={exportThread}>
          Export thread
        </Button>

        {composer && (
          <MessageComposer
            workOrderId={order.id}
            orderAlias={order.alias}
            intent={composer}
            open={composer !== null}
            onOpenChange={(o) => !o && setComposer(null)}
          />
        )}

        <div className="relative ml-auto min-w-0 flex-1 sm:max-w-[260px]">
          <Search
            className="text-fg-tertiary pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
            aria-hidden
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search messages, people, files…"
            aria-label="Search communication"
            className="bg-surface-1 border-line-subtle focus:border-accent text-fg placeholder:text-fg-tertiary w-full rounded-[8px] border py-1.5 pr-2.5 pl-8 text-[13px] outline-none"
          />
        </div>
      </div>

      {/* ── Filters ───────────────────────────────────────────────────────── */}
      <Panel className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-fg-tertiary flex items-center gap-1 text-[10.5px] font-semibold tracking-[0.05em] uppercase">
            <Filter className="size-3" aria-hidden /> Filter
          </span>
          <Select
            value={channel}
            onChange={setChannel}
            label="Channel"
            options={[
              { value: 'ALL', label: 'Any channel' },
              ...Object.keys(CHANNEL_LABELS).map((k) => ({ value: k, label: CHANNEL_LABELS[k] })),
            ]}
          />
          <Select
            value={stakeholder}
            onChange={setStakeholder}
            label="Stakeholder"
            options={[
              { value: 'ALL', label: 'Anyone' },
              ...STAKEHOLDERS.map((s) => ({ value: s, label: STAKEHOLDER_META[s].label })),
            ]}
          />
          <Select
            value={status}
            onChange={setStatus}
            label="Status"
            options={[
              { value: 'ALL', label: 'Any status' },
              { value: 'AWAITING_REPLY', label: 'Awaiting reply' },
              { value: 'REPLIED', label: 'Replied' },
              { value: 'ACTION_REQUIRED', label: 'Action required' },
              { value: 'CLOSED', label: 'Closed' },
            ]}
          />
          <Toggle active={internalOnly} onClick={() => setInternalOnly((v) => !v)}>
            Internal only
          </Toggle>
          <Toggle active={withAttachments} onClick={() => setWithAttachments((v) => !v)}>
            <Paperclip className="size-3" aria-hidden /> Has files
          </Toggle>
          <Toggle active={showSystem} onClick={() => setShowSystem((v) => !v)}>
            <Activity className="size-3" aria-hidden /> System events
          </Toggle>
          <Toggle active={oldestFirst} onClick={() => setOldestFirst((v) => !v)}>
            {oldestFirst ? 'Oldest first' : 'Newest first'}
          </Toggle>
          {filtersActive && (
            <Button variant="ghost" size="sm" icon={X} onClick={clearFilters}>
              Clear
            </Button>
          )}
        </div>
      </Panel>

      {/* ── Thread ────────────────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <Panel>
          {order.communications.length === 0 ? (
            <EmptyState
              icon={MessageSquare}
              title="No communication logged yet"
              description="Everything you record here stays attached to this order forever — emails, calls, WhatsApp messages, meetings. Nothing gets lost in someone's inbox."
              action={
                <Button variant="primary" icon={StickyNote}>
                  Log the first communication
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Search}
              title="Nothing matches these filters"
              description="No message on this order matches what you have selected."
              action={
                <Button variant="secondary" icon={X} onClick={clearFilters}>
                  Clear filters
                </Button>
              }
            />
          )}
        </Panel>
      ) : (
        <div className="min-w-0 space-y-3">
          {pinned.length > 0 && (
            <section className="min-w-0">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-accent-text flex items-center gap-1 text-[10.5px] font-semibold tracking-[0.06em] uppercase">
                  <Pin className="size-3" aria-hidden /> Pinned
                </span>
                <span className="bg-line-subtle h-px flex-1" aria-hidden />
                <span className="text-fg-tertiary tnum text-[10.5px]">{pinned.length}</span>
              </div>
              <ul className="min-w-0 space-y-2">
                {pinned.map((c) =>
                  c.entryClass === 'SYSTEM' ? (
                    <SystemEntry key={c.id} comm={c} />
                  ) : (
                    <HumanEntry
                      key={c.id}
                      comm={c}
                      quoteOpen={expandedQuotes.has(c.id)}
                      onToggleQuote={() =>
                        setExpandedQuotes((prev) => {
                          const next = new Set(prev);
                          if (next.has(c.id)) next.delete(c.id);
                          else next.add(c.id);
                          return next;
                        })
                      }
                    />
                  ),
                )}
              </ul>
            </section>
          )}
          {groups.map((g) => (
            <section key={g.day} className="min-w-0">
              {/* Sticky day separator */}
              <div className="bg-surface-0/90 sticky top-14 z-10 -mx-1 mb-2 px-1 py-1 backdrop-blur-sm">
                <div className="flex items-center gap-2">
                  <span className="text-fg-tertiary text-[10.5px] font-semibold tracking-[0.06em] uppercase">
                    {new Date(g.items[0].occurredAt).toLocaleDateString('en-IN', {
                      weekday: 'short',
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </span>
                  <span className="bg-line-subtle h-px flex-1" aria-hidden />
                  <span className="text-fg-tertiary tnum text-[10.5px]">{g.items.length}</span>
                </div>
              </div>

              <ul className="min-w-0 space-y-2">
                {g.items.map((c) =>
                  c.entryClass === 'SYSTEM' ? (
                    <SystemEntry key={c.id} comm={c} />
                  ) : (
                    <HumanEntry
                      key={c.id}
                      comm={c}
                      quoteOpen={expandedQuotes.has(c.id)}
                      onToggleQuote={() =>
                        setExpandedQuotes((prev) => {
                          const next = new Set(prev);
                          if (next.has(c.id)) next.delete(c.id);
                          else next.add(c.id);
                          return next;
                        })
                      }
                    />
                  ),
                )}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

// ── System event: deliberately subordinate ──────────────────────────────────

function SystemEntry({ comm }: { comm: Comm }) {
  return (
    <li className="flex min-w-0 items-start gap-2 px-1 py-1">
      <span className="bg-surface-3 text-fg-tertiary mt-0.5 grid size-5 shrink-0 place-items-center rounded-full">
        <Activity className="size-3" strokeWidth={2} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-fg-tertiary text-[11.5px] leading-snug">
          <span className="text-fg-secondary font-medium">{comm.subject}</span>
          {' — '}
          {comm.body}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
          {comm.contextChips.map((chip) => (
            <ContextChip key={chip.id} chip={chip} />
          ))}
          <span className="text-fg-tertiary text-[10px]">
            {new Date(comm.occurredAt).toLocaleTimeString('en-IN', {
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            })}
          </span>
        </span>
      </span>
    </li>
  );
}

// ── Human correspondence: prominent card ────────────────────────────────────

function HumanEntry({
  comm,
  quoteOpen,
  onToggleQuote,
}: {
  comm: Comm;
  quoteOpen: boolean;
  onToggleQuote: () => void;
}) {
  const ChannelIcon = CHANNEL_ICONS[comm.channel] ?? Mail;
  const from = comm.participants.find((p) => p.role === 'FROM');
  const to = comm.participants.filter((p) => p.role === 'TO');
  const cc = comm.participants.filter((p) => p.role === 'CC');
  const isInternal = comm.visibility === 'INTERNAL';
  const ageingHours =
    comm.status === 'AWAITING_REPLY'
      ? (Date.now() - new Date(comm.occurredAt).getTime()) / 36e5
      : null;

  return (
    <li
      className={cn(
        'bg-surface-1 min-w-0 overflow-hidden rounded-[11px] border',
        isInternal ? 'border-warning-border' : 'border-line-subtle',
        comm.isUnread && 'ring-warning/40 ring-1',
      )}
    >
      {/* Hatched strip marks internal-only, so it can never be mistaken for
          something the customer or supplier has seen (§7.2). */}
      {isInternal && <div className="hatched-internal h-1.5 w-full" aria-hidden />}

      <div className="min-w-0 p-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="bg-surface-3 text-fg-secondary grid size-6 shrink-0 place-items-center rounded-full">
            <ChannelIcon className="size-3.5" strokeWidth={1.9} aria-hidden />
          </span>
          <Hint content={<span>{CHANNEL_LABELS[comm.channel]}</span>}>
            <span className="text-fg-tertiary text-[10.5px] font-semibold tracking-[0.04em] uppercase">
              {CHANNEL_LABELS[comm.channel]}
            </span>
          </Hint>
          <DirectionChip direction={comm.direction} />
          {comm.isPinned && (
            <Chip tone="accent" icon={Pin} size="sm">
              Pinned
            </Chip>
          )}
          {isInternal ? (
            <Chip tone="warning" size="sm">
              Internal only
            </Chip>
          ) : (
            <Chip tone="info" size="sm">
              Shared with {comm.sharedWith ? STAKEHOLDER_META[comm.sharedWith as Stakeholder].label : 'party'}
            </Chip>
          )}
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            <StatusChip status={comm.status} size="sm" />
            {ageingHours != null && ageingHours > 24 && (
              <Chip tone="danger" icon={Clock} size="sm">
                {humanDuration(ageingHours)}
              </Chip>
            )}
          </span>
        </div>

        <h3 className="text-fg mt-2 text-[13px] leading-snug font-semibold">{comm.subject}</h3>

        {/* Participants with stakeholder badges */}
        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
          {from && (
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="text-fg-tertiary">From</span>
              <StakeholderBadge stakeholder={from.stakeholder as Stakeholder} short />
              <span className="text-fg-secondary truncate">{from.name}</span>
            </span>
          )}
          {to.length > 0 && (
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="text-fg-tertiary">To</span>
              {to.map((p) => (
                <span key={p.id} className="flex items-center gap-1">
                  <StakeholderBadge stakeholder={p.stakeholder as Stakeholder} short />
                  <span className="text-fg-secondary truncate">{p.name}</span>
                </span>
              ))}
            </span>
          )}
          {cc.length > 0 && (
            <span className="text-fg-tertiary truncate">
              cc {cc.map((p) => p.name).join(', ')}
            </span>
          )}
        </div>

        <p className="text-fg-secondary mt-2 text-[12.5px] leading-relaxed whitespace-pre-line">
          {comm.body}
        </p>

        {comm.quotedHistory && (
          <div className="mt-2">
            <button
              type="button"
              onClick={onToggleQuote}
              className="text-fg-tertiary hover:text-fg text-[11px] underline decoration-dotted"
            >
              {quoteOpen ? 'Hide earlier messages' : 'Show earlier messages'}
            </button>
            {quoteOpen && (
              <pre className="border-line-subtle text-fg-tertiary mt-1.5 overflow-x-auto border-l-2 pl-2.5 text-[11.5px] whitespace-pre-wrap">
                {comm.quotedHistory}
              </pre>
            )}
          </div>
        )}

        {comm.attachments.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {comm.attachments.map((a) => (
              <li key={a.id}>
                <span className="border-line-subtle bg-surface-inset flex items-center gap-1.5 rounded-[7px] border px-2 py-1 text-[11px]">
                  <Paperclip className="text-fg-tertiary size-3 shrink-0" aria-hidden />
                  <span className="max-w-[180px] truncate font-mono">{a.fileName}</span>
                  <span className="text-fg-tertiary shrink-0">
                    {(a.sizeBytes / 1024).toFixed(0)} KB
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* Context chips — the "no message floats" requirement */}
        {comm.contextChips.length > 0 && (
          <div className="border-line-subtle mt-2.5 border-t pt-2">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="text-fg-tertiary text-[10px] font-semibold tracking-[0.05em] uppercase">
                About
              </span>
              {comm.contextChips.map((chip) => (
                <ContextChip key={chip.id} chip={chip} />
              ))}
            </div>
          </div>
        )}

        <div className="text-fg-tertiary mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10.5px]">
          <span>{formatDateTime(comm.occurredAt)}</span>
          {comm.loggedBy && <span>Logged by {comm.loggedBy.name}</span>}
          {comm.externalRef && <span className="font-mono">Ref {comm.externalRef}</span>}
          <span>{relativeTime(comm.occurredAt)}</span>
        </div>
      </div>
    </li>
  );
}

function DirectionChip({ direction }: { direction: string }) {
  if (direction === 'INBOUND')
    return (
      <Chip tone="neutral" icon={ArrowDownLeft} size="sm">
        Inbound
      </Chip>
    );
  if (direction === 'OUTBOUND')
    return (
      <Chip tone="neutral" icon={ArrowUpRight} size="sm">
        Outbound
      </Chip>
    );
  return (
    <Chip tone="muted" icon={StickyNote} size="sm">
      Internal note
    </Chip>
  );
}

function ContextChip({ chip }: { chip: Comm['contextChips'][number] }) {
  const Icon = CONTEXT_ICONS[chip.kind] ?? Route;
  let detail = chip.label;
  if (chip.kind === 'STAGE' && chip.refId) {
    try {
      const s = getStage(chip.refId);
      detail = `${s.code} · ${s.label}`;
    } catch {
      /* stage no longer in the ladder — fall back to the stored label */
    }
  }
  return (
    <Hint
      content={
        <span>
          {chip.kind.replace(/_/g, ' ').toLowerCase()}: {detail}
        </span>
      }
    >
      <button
        type="button"
        className="border-line-subtle bg-surface-inset text-fg-secondary hover:border-accent-border hover:text-accent-text flex max-w-full items-center gap-1 rounded-[6px] border px-1.5 py-[1px] text-[10.5px] transition-colors"
      >
        <Icon className="size-2.5 shrink-0" strokeWidth={2.2} aria-hidden />
        <span className="truncate">{detail}</span>
      </button>
    </Hint>
  );
}

// ── Small controls ──────────────────────────────────────────────────────────

function Select({
  value,
  onChange,
  label,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="min-w-0">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-surface-1 border-line-subtle text-fg-secondary focus:border-accent max-w-[150px] rounded-[7px] border px-1.5 py-1 text-[11.5px] outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Toggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex shrink-0 items-center gap-1 rounded-[7px] border px-2 py-1 text-[11.5px] whitespace-nowrap transition-colors',
        active
          ? 'border-accent-border bg-accent-subtle text-accent-text'
          : 'border-line-subtle text-fg-tertiary hover:text-fg hover:bg-surface-3',
      )}
    >
      {children}
    </button>
  );
}
