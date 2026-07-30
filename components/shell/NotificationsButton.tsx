'use client';

/**
 * The bell, and what it is actually counting.
 *
 * It used to carry a hard-coded red dot — permanently lit, attached to a button
 * with no click handler. An indicator that is always on teaches the operator to
 * ignore the one place the app has to say "look here", so the dot is now derived
 * from real work: blocked orders, breached and at-risk stages, overdue tasks and
 * unread messages. No alerts, no dot.
 *
 * Loaded when the panel is opened rather than on every page render — nothing here
 * is needed until somebody asks, and the count is refreshed each time it opens so
 * an operator who has just cleared something sees that.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as Popover from '@radix-ui/react-popover';
import * as Tooltip from '@radix-ui/react-tooltip';
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Clock,
  Loader2,
  MailOpen,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { fetchNotifications } from '@/lib/actions/search';
import type { AlertItem, NotificationFeed } from '@/lib/queries/notifications';
import { cn, relativeTime } from '@/lib/utils';

const KIND_META: Record<AlertItem['kind'], { icon: typeof Bell; label: string }> = {
  BLOCKED: { icon: ShieldAlert, label: 'Blocked' },
  BREACHED: { icon: AlertTriangle, label: 'Overrun' },
  AT_RISK: { icon: Clock, label: 'Running late' },
  OVERDUE_TASK: { icon: Clock, label: 'Overdue task' },
  UNREAD: { icon: MailOpen, label: 'Unread' },
};

const SEVERITY_TONE: Record<AlertItem['severity'], string> = {
  CRITICAL: 'text-danger',
  WARNING: 'text-warning',
  INFO: 'text-fg-tertiary',
};

export function NotificationsButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [feed, setFeed] = useState<NotificationFeed | null>(null);
  // Starts true so the first fetch needs no setState before it awaits — the mount
  // effect below therefore triggers no synchronous render cascade.
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setFeed(await fetchNotifications());
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * The count has to be right BEFORE the panel is opened, or the badge is
   * decoration again — so one fetch on mount. Refreshing when the panel opens is
   * driven from onOpenChange rather than a second effect, which also removes the
   * double fetch that firing on both mount and open would cause.
   */
  useEffect(() => {
    let alive = true;
    fetchNotifications()
      .then((f) => {
        if (alive) setFeed(f);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const counts = feed?.counts;
  const total = counts?.total ?? 0;
  const worst: AlertItem['severity'] | null = !counts
    ? null
    : counts.critical > 0
      ? 'CRITICAL'
      : counts.warning > 0
        ? 'WARNING'
        : counts.info > 0
          ? 'INFO'
          : null;

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) void load();
      }}
    >
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Popover.Trigger asChild>
            <button
              type="button"
              aria-label={
                total === 0
                  ? 'Notifications — nothing needs attention'
                  : `Notifications — ${total} need${total === 1 ? 's' : ''} attention`
              }
              className="text-fg-secondary hover:bg-surface-3 hover:text-fg relative grid size-8 place-items-center rounded-[8px] transition-colors"
            >
              <Bell className="size-[17px]" strokeWidth={1.8} aria-hidden />
              {/* Only rendered when there IS something. The number is on the badge
                  up to 9 so the bell answers "how many" without being opened. */}
              {total > 0 && (
                <span
                  className={cn(
                    'text-accent-fg absolute -top-0.5 -right-0.5 grid min-w-[15px] place-items-center rounded-full px-[3px] text-[9px] font-semibold tabular-nums',
                    worst === 'CRITICAL'
                      ? 'bg-danger'
                      : worst === 'WARNING'
                        ? 'bg-warning text-warning-fg'
                        : 'bg-accent',
                  )}
                  aria-hidden
                >
                  {total > 9 ? '9+' : total}
                </span>
              )}
            </button>
          </Popover.Trigger>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="bottom"
            sideOffset={6}
            className="bg-surface-2 border-line text-fg shadow-e3 z-50 max-w-[220px] rounded-[8px] border px-2.5 py-1.5 text-xs"
          >
            <div className="font-medium">Notifications</div>
            <div className="text-fg-tertiary mt-0.5">
              {total === 0
                ? 'Nothing needs attention right now.'
                : `${counts?.critical ?? 0} urgent · ${counts?.warning ?? 0} to watch · ${counts?.info ?? 0} to read`}
            </div>
            <Tooltip.Arrow className="fill-[var(--surface-2)]" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>

      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="bg-surface-1 border-line shadow-e4 z-50 flex max-h-[min(70vh,520px)] w-[min(94vw,400px)] flex-col overflow-hidden rounded-[12px] border"
        >
          <div className="border-line-subtle flex items-center gap-2 border-b px-3.5 py-2.5">
            <span className="text-fg text-[13px] font-semibold">Needs attention</span>
            {counts && total > 0 && (
              <span className="text-fg-tertiary text-[11px]">
                {counts.critical > 0 && <span className="text-danger">{counts.critical} urgent</span>}
                {counts.critical > 0 && counts.warning + counts.info > 0 && ' · '}
                {counts.warning > 0 && <span className="text-warning">{counts.warning} to watch</span>}
                {counts.warning > 0 && counts.info > 0 && ' · '}
                {counts.info > 0 && `${counts.info} to read`}
              </span>
            )}
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              aria-label="Refresh"
              className="text-fg-tertiary hover:bg-surface-3 hover:text-fg ml-auto grid size-6 shrink-0 place-items-center rounded-[6px] transition-colors disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="size-3.5" aria-hidden />
              )}
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {!feed && loading && (
              <div className="text-fg-tertiary px-3.5 py-6 text-center text-[12px]">Loading…</div>
            )}

            {feed && total === 0 && (
              <div className="px-3.5 py-8 text-center">
                <CheckCircle2 className="text-success mx-auto size-5" strokeWidth={2} aria-hidden />
                <div className="text-fg mt-2 text-[13px] font-medium">Nothing needs attention</div>
                <div className="text-fg-tertiary mt-1 text-[11.5px] leading-relaxed">
                  No order is blocked, nothing has overrun its stage, and there are no overdue tasks
                  or unread messages.
                </div>
              </div>
            )}

            <ul className="divide-line-subtle divide-y">
              {feed?.items.map((item) => {
                const meta = KIND_META[item.kind];
                const Icon = meta.icon;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        router.push(item.href);
                      }}
                      className="hover:bg-surface-2 flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left transition-colors"
                    >
                      <Icon
                        className={cn('mt-0.5 size-4 shrink-0', SEVERITY_TONE[item.severity])}
                        strokeWidth={2}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="text-fg block text-[12.5px] leading-snug font-medium">
                          {item.title}
                        </span>
                        <span className="text-fg-secondary mt-0.5 block text-[11.5px] leading-relaxed">
                          {item.detail}
                        </span>
                        <span className="text-fg-tertiary mt-1 block text-[10.5px]">
                          {meta.label} · since {relativeTime(item.since)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {feed && total > 0 && (
            <div className="border-line-subtle bg-surface-2 border-t px-3.5 py-2">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  router.push('/dashboard');
                }}
                className="text-accent-text text-[11.5px] font-medium hover:underline"
              >
                Open the control tower →
              </button>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
