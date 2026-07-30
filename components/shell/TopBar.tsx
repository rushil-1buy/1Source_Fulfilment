'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as Tooltip from '@radix-ui/react-tooltip';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  Check,
  ChevronRight,
  Languages,
  Menu,
  Monitor,
  Moon,
  Search,
  Sun,
  User,
} from 'lucide-react';
import { breadcrumbFor } from '@/lib/nav';
import { cn } from '@/lib/utils';
import { usePreferences, type ThemeChoice } from '@/components/providers/Preferences';
import { CommandPalette } from './CommandPalette';
import { NotificationsButton } from './NotificationsButton';
import { HelpButton } from './HelpButton';

const THEME_OPTIONS: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'Match my device', icon: Monitor },
];

export function TopBar({ onMenuClick }: { onMenuClick?: () => void } = {}) {
  const pathname = usePathname();
  const trail = breadcrumbFor(pathname);
  const { theme, resolvedTheme, setTheme, plainEnglish, setPlainEnglish } = usePreferences();
  const [paletteOpen, setPaletteOpen] = useState(false);

  /**
   * The real ⌘K binding.
   *
   * The button here used to synthesise a KeyboardEvent and dispatch it at
   * `document`, hoping something was listening. Nothing was — so both the button
   * and the shortcut printed on it did nothing. The listener lives here now, and
   * the button simply opens the same state.
   *
   * Ctrl+K as well as ⌘K: the app is used on Windows too, and a shortcut that only
   * works on one platform is a shortcut half the operators never find.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const ThemeIcon = resolvedTheme === 'dark' ? Moon : Sun;

  return (
    <Tooltip.Provider delayDuration={300}>
      <header className="bg-surface-1/85 border-line-subtle sticky top-0 z-30 flex h-14 min-w-0 items-center gap-1.5 border-b px-2.5 backdrop-blur-md sm:gap-3 sm:px-4">
        {/* Hamburger — only below lg, where the sidebar is a drawer */}
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Open navigation"
          className="text-fg-secondary hover:bg-surface-3 hover:text-fg grid size-8 shrink-0 place-items-center rounded-[8px] transition-colors lg:hidden"
        >
          <Menu className="size-[18px]" strokeWidth={1.8} aria-hidden />
        </button>

        {/* Breadcrumbs — truncate hard rather than pushing the bar wider */}
        <nav aria-label="Breadcrumb" className="min-w-0 flex-1 overflow-hidden">
          <ol className="flex items-center gap-1 text-[13px]">
            {trail.length === 0 ? (
              <li className="text-fg-tertiary">1BUY Fulfilment</li>
            ) : (
              trail.map((crumb, i) => {
                const isLast = i === trail.length - 1;
                return (
                  <li
                    key={crumb.href}
                    // Only the final crumb survives on narrow screens, so the bar
                    // never has to widen to fit a deep trail.
                    className={cn(
                      'min-w-0 items-center gap-1',
                      isLast ? 'flex' : 'hidden sm:flex',
                    )}
                  >
                    {i > 0 && (
                      <ChevronRight className="text-fg-tertiary size-3.5 shrink-0" aria-hidden />
                    )}
                    {isLast ? (
                      <span className="truncate font-medium" aria-current="page">
                        {crumb.label}
                      </span>
                    ) : (
                      <Link
                        href={crumb.href}
                        className="text-fg-tertiary hover:text-fg truncate transition-colors"
                      >
                        {crumb.label}
                      </Link>
                    )}
                  </li>
                );
              })
            )}
          </ol>
        </nav>

        {/* Global search / command palette trigger */}
        <button
          type="button"
          className="bg-surface-0 border-line-subtle text-fg-tertiary hover:border-line hover:text-fg-secondary hidden items-center gap-2 rounded-[8px] border px-2.5 py-1.5 text-[13px] transition-colors md:flex"
          onClick={() => setPaletteOpen(true)}
        >
          <Search className="size-3.5" aria-hidden />
          <span className="pr-6">Search orders, parts, documents…</span>
          <kbd className="border-line-subtle bg-surface-1 text-fg-tertiary rounded border px-1.5 py-0.5 font-mono text-[10px]">
            ⌘K
          </kbd>
        </button>

        <div className="bg-line-subtle mx-0.5 hidden h-6 w-px md:block" aria-hidden />

        <IconButton
          label={plainEnglish ? 'Plain English mode is on' : 'Turn on Plain English mode'}
          hint="Swaps industry jargon for everyday words across the whole app."
          active={plainEnglish}
          onClick={() => setPlainEnglish(!plainEnglish)}
        >
          <Languages className="size-[17px]" strokeWidth={1.8} aria-hidden />
        </IconButton>

        <DropdownMenu.Root>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  className="text-fg-secondary hover:bg-surface-3 hover:text-fg grid size-8 place-items-center rounded-[8px] transition-colors"
                  aria-label="Change theme"
                >
                  <ThemeIcon className="size-[17px]" strokeWidth={1.8} aria-hidden />
                </button>
              </DropdownMenu.Trigger>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content
                side="bottom"
                sideOffset={6}
                className="bg-surface-2 border-line text-fg shadow-e3 z-50 rounded-[8px] border px-2.5 py-1.5 text-xs"
              >
                Change theme
                <Tooltip.Arrow className="fill-[var(--surface-2)]" />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={6}
              className="bg-surface-2 border-line shadow-e3 z-50 min-w-[190px] rounded-[10px] border p-1"
            >
              {THEME_OPTIONS.map((opt) => (
                <DropdownMenu.Item
                  key={opt.value}
                  onSelect={() => setTheme(opt.value)}
                  className="text-fg-secondary hover:bg-surface-3 hover:text-fg data-highlighted:bg-surface-3 data-highlighted:text-fg flex cursor-pointer items-center gap-2 rounded-[7px] px-2 py-1.5 text-[13px] outline-none"
                >
                  <opt.icon className="size-4" strokeWidth={1.8} aria-hidden />
                  <span className="flex-1">{opt.label}</span>
                  {theme === opt.value && <Check className="text-accent size-3.5" aria-hidden />}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>

        <NotificationsButton />

        <span className="hidden sm:contents">
          <HelpButton onOpenPalette={() => setPaletteOpen(true)} />
        </span>

        <div className="bg-line-subtle mx-0.5 hidden h-6 w-px sm:block" aria-hidden />

        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              className="hover:bg-surface-3 flex items-center gap-2 rounded-[8px] py-1 pr-1.5 pl-1 transition-colors"
              aria-label="Account menu"
            >
              <span className="bg-sh-onebuy-subtle text-sh-onebuy grid size-7 place-items-center rounded-full text-[11px] font-semibold">
                RK
              </span>
              <span className="hidden text-left leading-tight lg:block">
                <span className="block text-[12px] font-medium">Rushil Kohli</span>
                <span className="text-fg-tertiary block text-[10px]">Admin</span>
              </span>
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={6}
              className="bg-surface-2 border-line shadow-e3 z-50 min-w-[200px] rounded-[10px] border p-1"
            >
              <div className="border-line-subtle mb-1 border-b px-2 pb-2 pt-1.5">
                <div className="text-[13px] font-medium">Rushil Kohli</div>
                <div className="text-fg-tertiary text-[11px]">rushil@1buy.ai · Admin</div>
              </div>
              <DropdownMenu.Item
                asChild
                className="text-fg-secondary data-highlighted:bg-surface-3 data-highlighted:text-fg flex cursor-pointer items-center gap-2 rounded-[7px] px-2 py-1.5 text-[13px] outline-none"
              >
                <Link href="/settings">
                  <User className="size-4" strokeWidth={1.8} aria-hidden />
                  Settings
                </Link>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </header>

      {/* Mounted only while open, so its query and results reset on close without
          an effect doing it. Portals out, so its place in the tree is irrelevant. */}
      {paletteOpen && <CommandPalette onOpenChange={setPaletteOpen} />}
    </Tooltip.Provider>
  );
}

function IconButton({
  label,
  hint,
  active,
  onClick,
  children,
}: {
  label: string;
  hint: string;
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          aria-pressed={active}
          className={cn(
            'grid size-8 place-items-center rounded-[8px] transition-colors',
            active
              ? 'bg-accent-subtle text-accent-text'
              : 'text-fg-secondary hover:bg-surface-3 hover:text-fg',
          )}
        >
          {children}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="bottom"
          sideOffset={6}
          className="bg-surface-2 border-line text-fg shadow-e3 z-50 max-w-[220px] rounded-[8px] border px-2.5 py-1.5 text-xs"
        >
          <div className="font-medium">{label}</div>
          <div className="text-fg-tertiary mt-0.5">{hint}</div>
          <Tooltip.Arrow className="fill-[var(--surface-2)]" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
