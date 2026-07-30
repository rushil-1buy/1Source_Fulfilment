'use client';

/**
 * ⌘K — the command palette the top bar has been advertising.
 *
 * The bar showed a search field and a ⌘K hint, and the button dispatched a
 * synthetic KeyboardEvent at `document` that nothing listened for. cmdk was even
 * in package.json, unimported. So the most prominent control in the app did
 * nothing at all, while telling the operator it did.
 *
 * TWO THINGS IN ONE BOX, on purpose:
 *
 *  · With no query it is a jump list — every screen, by name, reachable in three
 *    keystrokes. That alone is most of the value; an operator moving between
 *    orders and escrow all day should not be aiming at a sidebar.
 *  · With a query it searches the database. Not just order numbers: whatever
 *    number the person on the phone read out, which is as likely to be the
 *    customer's PO, a proforma, or a part number. All of them resolve to the order
 *    they belong to, because that is the question being asked either way.
 *
 * Searching is debounced and runs on the server, and a stale response can never
 * overwrite a newer one — see the sequence guard in `run`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import * as Dialog from '@radix-ui/react-dialog';
import * as Icons from 'lucide-react';
import { ArrowRight, CornerDownLeft, Loader2, Search } from 'lucide-react';
import { searchEverything } from '@/lib/actions/search';
import { MIN_QUERY, type SearchOutcome } from '@/lib/queries/search';
import { NAV_GROUPS } from '@/lib/nav';
import { usePreferences } from '@/components/providers/Preferences';

/** How long to wait after the last keystroke. Long enough not to query per letter. */
const DEBOUNCE_MS = 180;

function NavIcon({ name, className }: { name: string; className?: string }) {
  const Ico = (Icons as unknown as Record<string, typeof Search>)[name] ?? Search;
  return <Ico className={className} strokeWidth={1.8} aria-hidden />;
}

/**
 * Mounted only while open — see the call site in TopBar.
 *
 * That is what makes the state reset free: closing unmounts, so the next open
 * starts from a fresh query with no results carried over. Keeping it mounted and
 * clearing the fields in an effect does the same thing less reliably, and sets
 * state during render for no gain.
 */
export function CommandPalette({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const { label: pick } = usePreferences();
  const [query, setQuery] = useState('');
  const [outcome, setOutcome] = useState<SearchOutcome | null>(null);
  const [loading, setLoading] = useState(false);

  /**
   * Monotonic request id. Responses can come back out of order — "STM" issued
   * before "STM32" may resolve after it — and without this the palette would
   * settle on results for a query the operator has already moved past.
   */
  const seq = useRef(0);

  const run = useCallback(async (q: string) => {
    const mine = ++seq.current;
    if (q.trim().length < MIN_QUERY) {
      setOutcome(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await searchEverything(q);
      if (mine !== seq.current) return; // a newer query has been issued
      setOutcome(res);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void run(query), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, run]);

  const go = useCallback(
    (href: string) => {
      onOpenChange(false);
      router.push(href);
    },
    [onOpenChange, router],
  );

  const navItems = useMemo(
    () =>
      NAV_GROUPS.flatMap((g) =>
        g.items.map((item) => ({ ...item, group: g.label ?? 'Go to' })),
      ),
    [],
  );

  const showResults = query.trim().length >= MIN_QUERY;
  const nothingFound = showResults && !loading && outcome && outcome.total === 0;

  return (
    <Dialog.Root open onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/55 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-label="Search and go to"
          className="bg-surface-1 border-line shadow-e4 fixed top-[12vh] left-1/2 z-[60] flex max-h-[72vh] w-[min(94vw,640px)] -translate-x-1/2 flex-col overflow-hidden rounded-[14px] border"
        >
          <Command
            shouldFilter={!showResults}
            loop
            className="flex min-h-0 flex-col"
            // cmdk moves the highlight with the arrows; Enter runs onSelect.
          >
            <div className="border-line-subtle flex items-center gap-2.5 border-b px-4 py-3">
              {loading ? (
                <Loader2 className="text-fg-tertiary size-4 shrink-0 animate-spin" aria-hidden />
              ) : (
                <Search className="text-fg-tertiary size-4 shrink-0" aria-hidden />
              )}
              <Command.Input
                autoFocus
                value={query}
                onValueChange={setQuery}
                placeholder="Search orders, POs, proformas, parts, documents — or jump to a screen"
                className="text-fg placeholder:text-fg-tertiary min-w-0 flex-1 bg-transparent text-[13.5px] outline-none"
              />
              <kbd className="border-line-subtle bg-surface-2 text-fg-tertiary hidden shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] sm:block">
                Esc
              </kbd>
            </div>

            <Command.List className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
              {/* One-liner so the operator knows what a short query is waiting for. */}
              {query.trim().length > 0 && query.trim().length < MIN_QUERY && (
                <div className="text-fg-tertiary px-2.5 py-2 text-[12px]">
                  Keep typing — at least {MIN_QUERY} characters to search.
                </div>
              )}

              {nothingFound && (
                <div className="px-2.5 py-6 text-center">
                  <div className="text-fg text-[13px] font-medium">
                    Nothing matches “{outcome!.query}”
                  </div>
                  <div className="text-fg-tertiary mt-1 text-[12px]">
                    Order numbers, our PO and customer PO numbers, proforma numbers, part numbers,
                    manufacturers, HSN codes, customers, suppliers and document titles are all
                    searched.
                  </div>
                </div>
              )}

              {/* ── Database results ─────────────────────────────────────────── */}
              {showResults &&
                outcome?.groups.map((g) => (
                  <Command.Group
                    key={g.id}
                    heading={g.label}
                    className="[&_[cmdk-group-heading]]:text-fg-tertiary mb-1 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10.5px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-[0.05em] [&_[cmdk-group-heading]]:uppercase"
                  >
                    {g.hits.map((hit) => (
                      <Command.Item
                        key={hit.id}
                        value={`${g.id}-${hit.id}-${hit.label}-${hit.sublabel}`}
                        onSelect={() => go(hit.href)}
                        className="data-[selected=true]:bg-surface-3 flex cursor-pointer items-center gap-3 rounded-[8px] px-2.5 py-2 outline-none"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="text-fg block truncate text-[13px] font-medium">
                            {hit.label}
                          </span>
                          <span className="text-fg-tertiary block truncate text-[11.5px]">
                            {hit.sublabel}
                            {/* Why this row is here, when the label does not show it —
                                otherwise a hit matched on a line item looks arbitrary. */}
                            {hit.matchedOn && (
                              <span className="text-fg-tertiary/80"> · matched on {hit.matchedOn}</span>
                            )}
                          </span>
                        </span>
                        {hit.meta && (
                          <span className="text-fg-tertiary tnum hidden shrink-0 text-[11px] sm:block">
                            {hit.meta}
                          </span>
                        )}
                        <ArrowRight className="text-fg-tertiary size-3.5 shrink-0" aria-hidden />
                      </Command.Item>
                    ))}
                  </Command.Group>
                ))}

              {showResults && outcome?.truncated && (
                <div className="text-fg-tertiary px-2.5 py-2 text-[11px]">
                  Showing the closest matches only. Narrow the search to see the rest.
                </div>
              )}

              {/* ── Jump list, when nothing is typed ─────────────────────────── */}
              {!showResults &&
                NAV_GROUPS.map((g) => (
                  <Command.Group
                    key={g.id}
                    heading={g.label ?? 'Go to'}
                    className="[&_[cmdk-group-heading]]:text-fg-tertiary mb-1 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10.5px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-[0.05em] [&_[cmdk-group-heading]]:uppercase"
                  >
                    {g.items.map((item) => (
                      <Command.Item
                        key={item.href}
                        // Both labels are in the value so Plain English mode does not
                        // change what the box can find.
                        value={`${item.label} ${item.plainLabel} ${item.hint}`}
                        onSelect={() => go(item.href)}
                        className="data-[selected=true]:bg-surface-3 flex cursor-pointer items-center gap-3 rounded-[8px] px-2.5 py-2 outline-none"
                      >
                        <NavIcon name={item.icon} className="text-fg-tertiary size-4 shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="text-fg block truncate text-[13px]">
                            {pick(item.label, item.plainLabel)}
                          </span>
                          <span className="text-fg-tertiary block truncate text-[11.5px]">
                            {item.hint}
                          </span>
                        </span>
                        <ArrowRight className="text-fg-tertiary size-3.5 shrink-0" aria-hidden />
                      </Command.Item>
                    ))}
                  </Command.Group>
                ))}
            </Command.List>

            <div className="border-line-subtle bg-surface-2 text-fg-tertiary flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-3.5 py-2 text-[10.5px]">
              <span className="flex items-center gap-1">
                <kbd className="border-line-subtle bg-surface-1 rounded border px-1 py-0.5 font-mono">
                  ↑
                </kbd>
                <kbd className="border-line-subtle bg-surface-1 rounded border px-1 py-0.5 font-mono">
                  ↓
                </kbd>
                move
              </span>
              <span className="flex items-center gap-1">
                <CornerDownLeft className="size-3" aria-hidden />
                open
              </span>
              <span className="ml-auto">
                {showResults
                  ? `${outcome?.total ?? 0} result${(outcome?.total ?? 0) === 1 ? '' : 's'}`
                  : `${navItems.length} screens`}
              </span>
            </div>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
