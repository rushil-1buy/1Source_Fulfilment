'use client';

/**
 * Help, answering the question its own tooltip already asked.
 *
 * The button carried the hint "What am I looking at? What should I do here?" and
 * had no click handler at all. Those are two good questions, so this answers them
 * for the screen the operator is actually on rather than opening a generic manual:
 * the route's own description, what the screen is for, and where to go next.
 *
 * It also lists the keyboard shortcuts, because ⌘K is advertised in the bar and
 * nothing else in the app ever mentions the rest.
 */

import { useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as Popover from '@radix-ui/react-popover';
import * as Tooltip from '@radix-ui/react-tooltip';
import { CircleHelp, ExternalLink, Keyboard } from 'lucide-react';
import { ALL_NAV_ITEMS } from '@/lib/nav';
import { usePreferences } from '@/components/providers/Preferences';

const SHORTCUTS: { keys: string[]; what: string }[] = [
  { keys: ['⌘', 'K'], what: 'Search everything, or jump to a screen' },
  { keys: ['Esc'], what: 'Close whatever is open' },
  { keys: ['↑', '↓'], what: 'Move through search results' },
  { keys: ['↵'], what: 'Open the highlighted result' },
];

export function HelpButton({ onOpenPalette }: { onOpenPalette: () => void }) {
  const pathname = usePathname();
  const { label: pick, plainEnglish, setPlainEnglish } = usePreferences();

  /**
   * The deepest nav item whose href prefixes the current path, so /orders/WO-123
   * still finds the Orders entry rather than falling through to nothing.
   */
  const here = useMemo(() => {
    const matches = ALL_NAV_ITEMS.filter(
      (i) => pathname === i.href || pathname.startsWith(`${i.href}/`),
    );
    return matches.sort((a, b) => b.href.length - a.href.length)[0] ?? null;
  }, [pathname]);

  return (
    <Popover.Root>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Popover.Trigger asChild>
            <button
              type="button"
              aria-label="Help"
              className="text-fg-secondary hover:bg-surface-3 hover:text-fg grid size-8 place-items-center rounded-[8px] transition-colors"
            >
              <CircleHelp className="size-[17px]" strokeWidth={1.8} aria-hidden />
            </button>
          </Popover.Trigger>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="bottom"
            sideOffset={6}
            className="bg-surface-2 border-line text-fg shadow-e3 z-50 max-w-[220px] rounded-[8px] border px-2.5 py-1.5 text-xs"
          >
            <div className="font-medium">Help</div>
            <div className="text-fg-tertiary mt-0.5">
              What am I looking at? What should I do here?
            </div>
            <Tooltip.Arrow className="fill-[var(--surface-2)]" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>

      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="bg-surface-1 border-line shadow-e4 z-50 flex max-h-[min(70vh,520px)] w-[min(94vw,380px)] flex-col overflow-hidden rounded-[12px] border"
        >
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {/* ── This screen ────────────────────────────────────────────────── */}
            <div className="border-line-subtle border-b px-3.5 py-3">
              <div className="text-fg-tertiary text-[10px] font-semibold tracking-[0.05em] uppercase">
                This screen
              </div>
              {here ? (
                <>
                  <div className="text-fg mt-1 text-[13px] font-semibold">
                    {pick(here.label, here.plainLabel)}
                  </div>
                  <p className="text-fg-secondary mt-1 text-[12px] leading-relaxed">{here.hint}</p>
                  {here.children && here.children.length > 0 && (
                    <ul className="mt-2 space-y-0.5">
                      {here.children.map((c) => (
                        <li key={c.href}>
                          <Popover.Close asChild>
                            <Link
                              href={c.href}
                              className="text-accent-text text-[11.5px] hover:underline"
                            >
                              {pick(c.label, c.plainLabel)} →
                            </Link>
                          </Popover.Close>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <p className="text-fg-secondary mt-1 text-[12px] leading-relaxed">
                  This page is not one of the main screens. Use the search below to get back to one.
                </p>
              )}
            </div>

            {/* ── Plain English, since the toggle is an unlabelled icon ──────── */}
            <div className="border-line-subtle border-b px-3.5 py-3">
              <div className="text-fg-tertiary text-[10px] font-semibold tracking-[0.05em] uppercase">
                Unfamiliar wording?
              </div>
              <p className="text-fg-secondary mt-1 text-[12px] leading-relaxed">
                Plain English mode swaps trade jargon for everyday words across the whole app —
                “Proforma Invoice” becomes “Quote”, and so on.
              </p>
              <button
                type="button"
                onClick={() => setPlainEnglish(!plainEnglish)}
                className="border-line-subtle text-fg-secondary hover:bg-surface-3 mt-2 rounded-[7px] border px-2 py-1 text-[11.5px]"
              >
                {plainEnglish ? 'Turn Plain English off' : 'Turn Plain English on'}
              </button>
            </div>

            {/* ── Shortcuts ──────────────────────────────────────────────────── */}
            <div className="border-line-subtle border-b px-3.5 py-3">
              <div className="text-fg-tertiary flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.05em] uppercase">
                <Keyboard className="size-3" aria-hidden />
                Shortcuts
              </div>
              <ul className="mt-1.5 space-y-1">
                {SHORTCUTS.map((s) => (
                  <li key={s.what} className="flex items-center gap-2">
                    <span className="flex shrink-0 items-center gap-0.5">
                      {s.keys.map((k) => (
                        <kbd
                          key={k}
                          className="border-line-subtle bg-surface-2 text-fg-secondary rounded border px-1.5 py-0.5 font-mono text-[10px]"
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                    <span className="text-fg-secondary min-w-0 text-[11.5px]">{s.what}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* ── Where to go ────────────────────────────────────────────────── */}
            <div className="px-3.5 py-3">
              <div className="text-fg-tertiary text-[10px] font-semibold tracking-[0.05em] uppercase">
                Still stuck
              </div>
              <div className="mt-1.5 flex flex-col gap-1.5">
                <Popover.Close asChild>
                  <button
                    type="button"
                    onClick={onOpenPalette}
                    className="text-accent-text text-left text-[11.5px] hover:underline"
                  >
                    Search everything (⌘K) →
                  </button>
                </Popover.Close>
                <Popover.Close asChild>
                  <Link href="/settings" className="text-accent-text text-[11.5px] hover:underline">
                    Settings and glossary →
                  </Link>
                </Popover.Close>
                <a
                  href="mailto:rushil@1buy.ai?subject=1BUY%20Fulfilment%20—%20help"
                  className="text-fg-secondary flex items-center gap-1 text-[11.5px] hover:underline"
                >
                  Email the team
                  <ExternalLink className="size-3" aria-hidden />
                </a>
              </div>
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
